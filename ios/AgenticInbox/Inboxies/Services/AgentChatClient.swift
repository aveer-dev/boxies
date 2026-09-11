import Foundation

/// Cloudflare Agents chat client for iOS.
/// Protocol mirrors `@cloudflare/ai-chat` / `useAgentChat` (cf_agent_* message types)
/// and loads conversation history via `/get-messages`.
@MainActor
final class AgentChatClient: NSObject, ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isConnected = false
    @Published var isStreaming = false
    @Published var isLoadingHistory = false
    @Published var statusText: String?
    @Published var historyError: String?

    var onStreamFinished: ((_ hasToolActions: Bool) -> Void)?
    var onHistoryLoaded: (([ChatMessage]) -> Void)?

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var authToken: String?
    private var mailboxId: String?
    private var conversationId: String?
    private var streamingAssistantId: String?
    private var hasActiveToolAction = false
    private var pingTimer: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reasoningStartTime: Date?
    private var isExplicitDisconnect = false
    /// Maps toolCallId → name/input from tool-input events so tool-output
    /// chunks (which often omit toolName) still get a human-readable label.
    private var pendingToolCalls: [String: PendingToolCall] = [:]

    private struct PendingToolCall {
        var toolName: String
        var input: [String: Any]?
    }

    func connect(mailboxId: String, conversationId: String, authToken: String?) {
        if isConnected && self.mailboxId == mailboxId && self.conversationId == conversationId {
            return
        }
        let isSameConversation = self.mailboxId == mailboxId && self.conversationId == conversationId
        teardownSocket(explicit: false)
        if !isSameConversation {
            messages = []
        }
        isExplicitDisconnect = false
        statusText = nil
        historyError = nil
        isLoadingHistory = true
        self.mailboxId = mailboxId
        self.conversationId = conversationId
        self.authToken = authToken

        // Load prior conversation history from server
        Task {
            await loadInitialMessages(mailboxId: mailboxId, conversationId: conversationId, authToken: authToken)
        }

        guard let url = Self.agentURL(mailboxId: mailboxId, conversationId: conversationId, websocket: true) else {
            print("[AgentChatClient] Invalid chat URL for: \(mailboxId)::\(conversationId)")
            isLoadingHistory = false
            return
        }

        let config = URLSessionConfiguration.default
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url)
        if let authToken, !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        let task = session!.webSocketTask(with: request)
        webSocket = task
        task.resume()
        listen(task)
    }

    func disconnect() {
        teardownSocket(explicit: true)
    }

    private func teardownSocket(explicit: Bool) {
        isExplicitDisconnect = explicit
        reconnectTask?.cancel()
        reconnectTask = nil
        stopPing()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        session?.invalidateAndCancel()
        session = nil
        isConnected = false
        isStreaming = false
        statusText = nil
        streamingAssistantId = nil
        hasActiveToolAction = false
        reasoningStartTime = nil
        pendingToolCalls = [:]
    }

    func clearHistory() {
        sendJSON(["type": "cf_agent_chat_clear"])
        messages = []
    }

    /// EmailAgent DO name: `mailboxId::conversationId`. Keep `::` literal for PartyServer.
    static func agentInstanceName(mailboxId: String, conversationId: String) -> String {
        "\(mailboxId)::\(conversationId)"
    }

    static func agentURL(mailboxId: String, conversationId: String, websocket: Bool, pathSuffix: String = "") -> URL? {
        let rawAgentName = agentInstanceName(mailboxId: mailboxId, conversationId: conversationId)
        let base = AppConfig.apiBaseURL
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              components.host != nil else { return nil }
        components.scheme = websocket ? (base.scheme == "https" ? "wss" : "ws") : base.scheme
        components.percentEncodedPath = "\(AppConfig.agentPathPrefix)/\(rawAgentName)\(pathSuffix)"
        return components.url
    }

    static func fetchMessages(mailboxId: String, conversationId: String, authToken: String?) async -> [ChatMessage]? {
        guard let url = agentURL(mailboxId: mailboxId, conversationId: conversationId, websocket: false, pathSuffix: "/get-messages") else {
            return nil
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let authToken, !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            if let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                return array.flatMap(parseMessages)
            }
            return []
        } catch {
            print("[AgentChatClient] Failed to fetch messages: \(error)")
            return nil
        }
    }

    func loadInitialMessages(mailboxId: String, conversationId: String, authToken: String?) async {
        isLoadingHistory = true
        historyError = nil
        defer { isLoadingHistory = false }

        var loaded: [ChatMessage]?
        for attempt in 0..<3 {
            loaded = await Self.fetchMessages(mailboxId: mailboxId, conversationId: conversationId, authToken: authToken)
            if loaded != nil { break }
            if attempt < 2 {
                try? await Task.sleep(nanoseconds: 400_000_000)
            }
        }

        guard self.mailboxId == mailboxId && self.conversationId == conversationId else { return }
        guard let loaded else {
            if messages.isEmpty {
                historyError = "Couldn't load this chat."
            }
            return
        }
        if isStreaming { return }
        if loaded.isEmpty && !self.messages.isEmpty { return }
        self.messages = loaded
        self.onHistoryLoaded?(loaded)
    }

    func sendUserMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isConnected, !isStreaming else { return }

        let userId = UUID().uuidString
        messages.append(ChatMessage(id: userId, role: "user", text: trimmed))

        // Send full known history preserving both reasoning and text parts (excluding synthetic tool UI actions)
        let validHistory = messages.filter { !$0.isError && !$0.isToolAction }
        let history: [[String: Any]] = validHistory.map { msg in
            var parts: [[String: Any]] = []
            if let r = msg.reasoning, !r.isEmpty {
                var reasoningPart: [String: Any] = [
                    "type": "reasoning",
                    "text": r,
                    "state": "done"
                ]
                if let dur = msg.reasoningDuration {
                    reasoningPart["duration"] = dur
                }
                parts.append(reasoningPart)
            }
            if !msg.text.isEmpty {
                parts.append([
                    "type": "text",
                    "text": msg.text,
                    "state": "done"
                ])
            }
            var dict: [String: Any] = [
                "id": msg.id,
                "role": msg.role,
                "parts": parts,
            ]
            if let dur = msg.reasoningDuration {
                dict["reasoningDuration"] = dur
            }
            return dict
        }

        let bodyObject: [String: Any] = ["messages": history]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: bodyObject),
              let bodyString = String(data: bodyData, encoding: .utf8) else { return }

        let requestId = UUID().uuidString
        sendJSON([
            "type": "cf_agent_use_chat_request",
            "id": requestId,
            "init": [
                "method": "POST",
                "body": bodyString,
            ],
        ])
        isStreaming = true
        // Thinking UI lives on the message bubble / fallback row — statusText is
        // reserved for in-progress tool actions so we never show two Thinking loaders.
        statusText = nil
        streamingAssistantId = nil
        hasActiveToolAction = false
        pendingToolCalls = [:]
    }

    private func sendJSON(_ object: [String: Any]) {
        guard isConnected, webSocket != nil else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        webSocket?.send(.string(text)) { error in
            if let error {
                print("[AgentChatClient] WebSocket send error: \(error.localizedDescription)")
            }
        }
    }

    private func listen(_ task: URLSessionWebSocketTask? = nil) {
        let current = task ?? webSocket
        current?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.webSocket === current else { return }
                switch result {
                case .failure(let error):
                    self.isConnected = false
                    print("[AgentChatClient] WebSocket receive error: \(error.localizedDescription)")
                    if !self.isExplicitDisconnect {
                        self.attemptReconnect()
                    }
                case .success(let message):
                    self.handle(message)
                    self.listen(current)
                }
            }
        }
    }

    private func attemptReconnect() {
        guard let mailboxId = self.mailboxId,
              let conversationId = self.conversationId,
              !isExplicitDisconnect else { return }
        reconnectTask?.cancel()
        reconnectTask = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled, !self.isExplicitDisconnect, !self.isConnected else { return }
            print("[AgentChatClient] Attempting silent reconnect…")
            self.connect(mailboxId: mailboxId, conversationId: conversationId, authToken: self.authToken)
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "cf_agent_chat_messages":
            // A snapshot during an in-flight turn would drop the local user message
            // and any tool rows that haven't been persisted yet.
            if isStreaming { return }
            if let arr = json["messages"] as? [[String: Any]] {
                let parsed = arr.flatMap(Self.parseMessages)
                if !parsed.isEmpty {
                    messages = parsed
                }
            }
        case "cf_agent_chat_clear":
            messages = []
        case "cf_agent_use_chat_response":
            let chunk = json["body"] as? String ?? ""
            let done = json["done"] as? Bool ?? false
            let isError = json["error"] as? Bool ?? false

            if isError {
                let errorText = chunk.isEmpty ? "An error occurred while generating a response." : chunk
                handleStreamError(errorText)
            } else if !chunk.isEmpty {
                appendStreamChunk(chunk)
            }

            if done {
                stampReasoningDurationIfNeeded()
                isStreaming = false
                statusText = nil
                streamingAssistantId = nil
                pendingToolCalls = [:]
                let hadTool = hasActiveToolAction
                hasActiveToolAction = false
                onStreamFinished?(hadTool)
            }
        default:
            break
        }
    }

    private func appendStreamChunk(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // Plain text fallback
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && trimmed != "0" && trimmed != "[DONE]" {
                appendAssistantText(trimmed)
            }
            return
        }

        let type = obj["type"] as? String ?? ""

        // 1. Reasoning / thinking events & deltas
        if type == "reasoning-start" {
            if reasoningStartTime == nil {
                reasoningStartTime = Date()
            }
            // Clear tool status so the single Thinking loader can take over.
            statusText = nil
            return
        }
        if type == "reasoning-end" {
            stampReasoningDurationIfNeeded()
            return
        }
        if type == "reasoning-delta" || (type.contains("reasoning") && type.contains("delta")) {
            if let delta = obj["delta"] as? String ?? obj["text"] as? String ?? obj["reasoningDelta"] as? String, !delta.isEmpty {
                statusText = nil
                appendAssistantReasoning(delta)
            }
            return
        }

        // 2. Text deltas
        if type == "text-delta" || type.contains("text") {
            if let delta = obj["delta"] as? String ?? obj["text"] as? String ?? obj["textDelta"] as? String, !delta.isEmpty {
                statusText = nil
                appendAssistantText(delta)
            }
            return
        }

        // 3. Tool events
        if type.starts(with: "tool-") || type.contains("tool") {
            stampReasoningDurationIfNeeded()
            hasActiveToolAction = true

            let toolCallId = obj["toolCallId"] as? String
            let rawName = obj["toolName"] as? String
            let input = obj["input"] as? [String: Any] ?? obj["args"] as? [String: Any]

            if type.contains("start") || type.contains("input") {
                let toolName = Self.resolveToolName(rawName: rawName, eventType: type)
                if let toolName {
                    if let toolCallId {
                        var pending = pendingToolCalls[toolCallId] ?? PendingToolCall(toolName: toolName, input: nil)
                        pending.toolName = toolName
                        if let input { pending.input = input }
                        pendingToolCalls[toolCallId] = pending
                    }
                    statusText = Self.statusForTool(toolName)
                } else {
                    statusText = "Working on email actions…"
                }
            } else if type.contains("output") {
                let pending = toolCallId.flatMap { pendingToolCalls[$0] }
                let toolName = Self.resolveToolName(rawName: rawName ?? pending?.toolName, eventType: type)
                    ?? pending?.toolName
                let resolvedInput = input ?? pending?.input

                guard let toolName, Self.isRealToolName(toolName) else { return }

                if let toolCallId {
                    pendingToolCalls.removeValue(forKey: toolCallId)
                }

                let desc = Self.describeToolAction(name: toolName, input: resolvedInput)
                let id = UUID().uuidString
                let toolMessage = ChatMessage(
                    id: id,
                    role: "assistant",
                    text: desc,
                    isToolAction: true,
                    toolName: toolName
                )
                // Insert before the streaming assistant bubble so live order
                // matches reopened history: tools → thought → reply.
                if let assistantId = streamingAssistantId,
                   let idx = messages.firstIndex(where: { $0.id == assistantId }) {
                    messages.insert(toolMessage, at: idx)
                } else {
                    messages.append(toolMessage)
                }
                // Tool finished — drop progress when nothing else is in flight.
                // If other tools are still pending, keep a status row for those.
                if pendingToolCalls.isEmpty {
                    statusText = nil
                } else if let remaining = pendingToolCalls.values.first {
                    statusText = Self.statusForTool(remaining.toolName)
                }
                // Keep streamingAssistantId so later text/reasoning stay on one bubble.
            }
            return
        }

        // 4. Error chunks
        if type == "error" {
            let errorMsg = obj["errorText"] as? String ?? "An error occurred."
            handleStreamError(errorMsg)
            return
        }
    }

    private func appendAssistantReasoning(_ delta: String) {
        if reasoningStartTime == nil {
            reasoningStartTime = Date()
        }
        if let id = streamingAssistantId,
           let idx = messages.firstIndex(where: { $0.id == id }) {
            messages[idx].reasoning = (messages[idx].reasoning ?? "") + delta
        } else {
            let id = UUID().uuidString
            streamingAssistantId = id
            messages.append(ChatMessage(id: id, role: "assistant", text: "", reasoning: delta))
        }
    }

    private func appendAssistantText(_ text: String) {
        stampReasoningDurationIfNeeded()
        if let id = streamingAssistantId,
           let idx = messages.firstIndex(where: { $0.id == id }) {
            messages[idx].text += text
        } else {
            let id = UUID().uuidString
            streamingAssistantId = id
            messages.append(ChatMessage(id: id, role: "assistant", text: text))
        }
    }

    private func stampReasoningDurationIfNeeded() {
        guard let start = reasoningStartTime else { return }
        let elapsed = Date().timeIntervalSince(start)
        if let id = streamingAssistantId,
           let idx = messages.firstIndex(where: { $0.id == id }) {
            if messages[idx].reasoningDuration == nil {
                messages[idx].reasoningDuration = elapsed
            }
        }
        reasoningStartTime = nil
    }

    private func handleStreamError(_ errorMsg: String) {
        isStreaming = false
        statusText = nil
        streamingAssistantId = nil
        pendingToolCalls = [:]
        let id = UUID().uuidString
        messages.append(ChatMessage(id: id, role: "assistant", text: errorMsg, isError: true))
    }

    static func parseMessages(_ dict: [String: Any]) -> [ChatMessage] {
        guard let id = dict["id"] as? String,
              let role = dict["role"] as? String else { return [] }

        var results: [ChatMessage] = []
        var text = ""
        var reasoning: String?
        var reasoningDuration: TimeInterval?
        var seenToolCallIds = Set<String>()

        let parts = (dict["parts"] as? [[String: Any]]) ?? (dict["content"] as? [[String: Any]])

        if let parts {
            for part in parts {
                let pType = part["type"] as? String ?? ""

                if pType == "text" {
                    if let t = part["text"] as? String ?? part["content"] as? String {
                        text += t
                    }
                } else if pType == "reasoning" || pType.contains("reasoning") {
                    let r = part["text"] as? String ?? part["reasoning"] as? String ?? part["delta"] as? String ?? ""
                    if !r.isEmpty {
                        reasoning = (reasoning ?? "") + r
                    }
                    if reasoningDuration == nil {
                        if let d = part["duration"] as? Double {
                            reasoningDuration = d
                        } else if let d = part["duration"] as? Int {
                            reasoningDuration = Double(d)
                        }
                    }
                } else if pType == "tool-invocation" || pType == "tool-call" || pType == "tool-result" || pType.starts(with: "tool-") || pType == "dynamic-tool" || part["toolName"] != nil {
                    let invocation = part["toolInvocation"] as? [String: Any]
                    let callId = (invocation?["toolCallId"] as? String)
                        ?? (part["toolCallId"] as? String)
                        ?? (part["id"] as? String)

                    var tName = (invocation?["toolName"] as? String)
                        ?? (part["toolName"] as? String)
                        ?? (part["name"] as? String)

                    if tName == nil || tName?.isEmpty == true {
                        if pType.starts(with: "tool-") && pType != "tool-call" && pType != "tool-result" && pType != "tool-invocation" {
                            tName = pType.replacingOccurrences(of: "tool-", with: "")
                        }
                    }

                    guard let toolName = tName, isRealToolName(toolName) else {
                        continue
                    }

                    // De-duplicate call+result (and mixed shapes) within one assistant message.
                    let nameKey = "name:\(toolName)"
                    if let callId, seenToolCallIds.contains(callId) {
                        continue
                    }
                    if seenToolCallIds.contains(nameKey) {
                        continue
                    }
                    if let callId {
                        seenToolCallIds.insert(callId)
                    }
                    seenToolCallIds.insert(nameKey)

                    let input = (invocation?["args"] as? [String: Any])
                        ?? (invocation?["input"] as? [String: Any])
                        ?? (part["input"] as? [String: Any])
                        ?? (part["args"] as? [String: Any])

                    let desc = describeToolAction(name: toolName, input: input)
                    let toolMsgId = "\(id)-tool-\(results.count)"
                    results.append(ChatMessage(
                        id: toolMsgId,
                        role: "assistant",
                        text: desc,
                        isToolAction: true,
                        toolName: toolName
                    ))
                }
            }
        }

        if reasoning == nil, let r = dict["reasoning"] as? String, !r.isEmpty {
            reasoning = r
        }
        if reasoningDuration == nil {
            if let d = dict["reasoningDuration"] as? Double {
                reasoningDuration = d
            } else if let d = dict["reasoningDuration"] as? Int {
                reasoningDuration = Double(d)
            }
        }

        if text.isEmpty, let content = dict["content"] as? String {
            text = content
        }
        if text.isEmpty, let t = dict["text"] as? String {
            text = t
        }

        if !text.isEmpty || reasoning != nil {
            results.append(ChatMessage(
                id: id,
                role: role,
                text: text,
                reasoning: reasoning,
                reasoningDuration: reasoningDuration,
                isToolAction: false,
                toolName: nil
            ))
        }

        return results
    }

    static func parseMessage(_ dict: [String: Any]) -> ChatMessage? {
        parseMessages(dict).last
    }

    /// Lifecycle suffixes from AI SDK stream event types — not real tool names.
    private static let lifecycleToolNames: Set<String> = [
        "call", "result", "invocation",
        "input-start", "input-delta", "input-available",
        "output-available", "output-error", "output-denied",
        "start", "end", "delta", "available", "error",
    ]

    private static func isRealToolName(_ name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return !lifecycleToolNames.contains(trimmed)
    }

    private static func resolveToolName(rawName: String?, eventType: String) -> String? {
        if let rawName, isRealToolName(rawName) {
            return rawName
        }
        if eventType.starts(with: "tool-") {
            let stripped = eventType.replacingOccurrences(of: "tool-", with: "")
            if isRealToolName(stripped) {
                return stripped
            }
        }
        return nil
    }

    private static func statusForTool(_ name: String) -> String {
        switch name {
        case "draft_reply": return "Drafting reply…"
        case "draft_email": return "Creating draft…"
        case "list_emails": return "Searching emails…"
        case "get_email", "get_thread": return "Reading thread…"
        case "search_emails": return "Searching mailbox…"
        case "mark_email_read": return "Updating email…"
        case "move_email": return "Organizing email…"
        case "discard_draft": return "Deleting draft…"
        default: return "Working on email actions…"
        }
    }

    private static func describeToolAction(name: String, input: [String: Any]?) -> String {
        switch name {
        case "draft_reply":
            return "Drafted a reply in your Drafts folder."
        case "draft_email":
            if let to = input?["to"] as? String, !to.isEmpty {
                return "Created draft email to \(to)."
            }
            return "Created a new draft in Drafts."
        case "list_emails":
            return "Reviewed recent emails in your inbox."
        case "get_email", "get_thread":
            return "Read thread context."
        case "search_emails":
            if let q = input?["query"] as? String, !q.isEmpty {
                return "Searched mailbox for \"\(q)\"."
            }
            return "Searched mailbox."
        case "mark_email_read":
            return "Marked email as read."
        case "move_email":
            if let folder = input?["folder"] as? String {
                return "Moved email to \(folder.capitalized)."
            }
            return "Moved email."
        case "discard_draft":
            return "Discarded draft."
        default:
            return "Completed action: \(name.replacingOccurrences(of: "_", with: " "))."
        }
    }

    private func startPing() {
        stopPing()
        pingTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard !Task.isCancelled else { break }
                await self?.sendPing()
            }
        }
    }

    private func stopPing() {
        pingTimer?.cancel()
        pingTimer = nil
    }

    private func sendPing() {
        webSocket?.sendPing { error in
            if let error {
                print("[AgentChatClient] WebSocket ping failed: \(error.localizedDescription)")
            }
        }
    }
}

extension AgentChatClient: URLSessionWebSocketDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        Task { @MainActor in
            guard webSocketTask === self.webSocket else { return }
            self.isConnected = true
            self.startPing()
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor in
            guard webSocketTask === self.webSocket else { return }
            self.isConnected = false
            self.stopPing()
            if !self.isExplicitDisconnect {
                self.attemptReconnect()
            }
        }
    }
}

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
    private var reasoningStartTime: Date?
    private var isExplicitDisconnect = false

    func connect(mailboxId: String, conversationId: String, authToken: String?) {
        if isConnected && self.mailboxId == mailboxId && self.conversationId == conversationId {
            return
        }
        disconnect()
        isExplicitDisconnect = false
        statusText = nil
        self.mailboxId = mailboxId
        self.conversationId = conversationId
        self.authToken = authToken

        // Load prior conversation history from server
        Task {
            await loadInitialMessages(mailboxId: mailboxId, conversationId: conversationId, authToken: authToken)
        }

        // Literal :: separator required by partyserver and agent-conversations helpers
        let rawAgentName = "\(mailboxId)::\(conversationId)"
        let base = AppConfig.apiBaseURL
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              components.host != nil else {
            print("[AgentChatClient] Invalid API URL: \(base)")
            return
        }
        components.scheme = base.scheme == "https" ? "wss" : "ws"
        components.percentEncodedPath = "\(AppConfig.agentPathPrefix)/\(rawAgentName)"
        guard let url = components.url else {
            print("[AgentChatClient] Invalid chat URL for: \(rawAgentName)")
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
        isConnected = true
        startPing()
        listen()
    }

    func disconnect() {
        isExplicitDisconnect = true
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
    }

    func clearHistory() {
        sendJSON(["type": "cf_agent_chat_clear"])
        messages = []
    }

    static func fetchMessages(mailboxId: String, conversationId: String, authToken: String?) async -> [ChatMessage] {
        let rawAgentName = "\(mailboxId)::\(conversationId)"
        let base = AppConfig.apiBaseURL
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              components.host != nil else { return [] }
        components.percentEncodedPath = "\(AppConfig.agentPathPrefix)/\(rawAgentName)/get-messages"
        guard let url = components.url else { return [] }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let authToken, !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return []
            }
            if let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                return array.flatMap(parseMessages)
            }
        } catch {
            print("[AgentChatClient] Failed to fetch messages: \(error)")
        }
        return []
    }

    func loadInitialMessages(mailboxId: String, conversationId: String, authToken: String?) async {
        isLoadingHistory = true
        defer { isLoadingHistory = false }

        let loaded = await Self.fetchMessages(mailboxId: mailboxId, conversationId: conversationId, authToken: authToken)
        if self.mailboxId == mailboxId && self.conversationId == conversationId {
            self.messages = loaded
            self.onHistoryLoaded?(loaded)
        }
    }

    func sendUserMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

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
        statusText = "Thinking…"
        streamingAssistantId = nil
        hasActiveToolAction = false
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return }
        webSocket?.send(.string(text)) { error in
            if let error {
                print("[AgentChatClient] WebSocket send error: \(error.localizedDescription)")
            }
        }
    }

    private func listen() {
        webSocket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.isConnected = false
                    print("[AgentChatClient] WebSocket receive error: \(error.localizedDescription)")
                    if !self.isExplicitDisconnect {
                        self.attemptReconnect()
                    }
                case .success(let message):
                    self.handle(message)
                    self.listen()
                }
            }
        }
    }

    private func attemptReconnect() {
        guard let mailboxId = self.mailboxId,
              let conversationId = self.conversationId,
              !isExplicitDisconnect else { return }
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !self.isExplicitDisconnect, !self.isConnected else { return }
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
                if let start = self.reasoningStartTime {
                    let elapsed = Date().timeIntervalSince(start)
                    if let id = self.streamingAssistantId,
                       let idx = self.messages.firstIndex(where: { $0.id == id }) {
                        if self.messages[idx].reasoningDuration == nil {
                            self.messages[idx].reasoningDuration = elapsed
                        }
                    }
                    self.reasoningStartTime = nil
                }
                isStreaming = false
                statusText = nil
                streamingAssistantId = nil
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
            statusText = "Thinking…"
            return
        }
        if type == "reasoning-end" {
            statusText = nil
            if let start = reasoningStartTime {
                let elapsed = Date().timeIntervalSince(start)
                if let id = streamingAssistantId,
                   let idx = messages.firstIndex(where: { $0.id == id }) {
                    messages[idx].reasoningDuration = elapsed
                }
                reasoningStartTime = nil
            }
            return
        }
        if type == "reasoning-delta" || (type.contains("reasoning") && type.contains("delta")) {
            if let delta = obj["delta"] as? String ?? obj["text"] as? String ?? obj["reasoningDelta"] as? String, !delta.isEmpty {
                statusText = "Thinking…"
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
            if let start = reasoningStartTime {
                let elapsed = Date().timeIntervalSince(start)
                if let id = streamingAssistantId,
                   let idx = messages.firstIndex(where: { $0.id == id }) {
                    if messages[idx].reasoningDuration == nil {
                        messages[idx].reasoningDuration = elapsed
                    }
                }
                reasoningStartTime = nil
            }
            hasActiveToolAction = true
            let toolName = obj["toolName"] as? String ?? type.replacingOccurrences(of: "tool-", with: "")
            if type.contains("start") || type.contains("input") {
                statusText = Self.statusForTool(toolName)
            } else if type.contains("output") || type.contains("available") {
                let desc = Self.describeToolAction(name: toolName, input: obj["input"] as? [String: Any])
                let id = UUID().uuidString
                messages.append(ChatMessage(id: id, role: "assistant", text: desc, isToolAction: true, toolName: toolName))
                streamingAssistantId = nil
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
        if let start = reasoningStartTime {
            let elapsed = Date().timeIntervalSince(start)
            if let id = streamingAssistantId,
               let idx = messages.firstIndex(where: { $0.id == id }) {
                if messages[idx].reasoningDuration == nil {
                    messages[idx].reasoningDuration = elapsed
                }
            }
            reasoningStartTime = nil
        }
        if let id = streamingAssistantId,
           let idx = messages.firstIndex(where: { $0.id == id }) {
            messages[idx].text += text
        } else {
            let id = UUID().uuidString
            streamingAssistantId = id
            messages.append(ChatMessage(id: id, role: "assistant", text: text))
        }
    }

    private func handleStreamError(_ errorMsg: String) {
        isStreaming = false
        statusText = nil
        streamingAssistantId = nil
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
            for (index, part) in parts.enumerated() {
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

                    guard let toolName = tName, !toolName.isEmpty, toolName != "call", toolName != "result" else {
                        continue
                    }

                    // De-duplicate if the same tool call appears as both call and result
                    let dedupeKey = callId ?? "\(index)-\(toolName)"
                    if seenToolCallIds.contains(dedupeKey) {
                        continue
                    }
                    seenToolCallIds.insert(dedupeKey)

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
            self.isConnected = true
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor in
            self.isConnected = false
        }
    }
}

import SwiftUI

enum ConversationTitleHelper {
    static func deriveTitle(from text: String) -> String {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Take first line only if multiline
        if let firstLine = cleaned.components(separatedBy: .newlines).first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) {
            cleaned = firstLine.trimmingCharacters(in: .whitespaces)
        }

        // Strip markdown formatting symbols like #, *, _, `, >
        cleaned = cleaned.replacingOccurrences(of: "^[#>*_`~\\-\\s]+", with: "", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: "[*_`~]", with: "", options: .regularExpression)

        // Case-insensitive prefix removal for conversational filler
        let prefixesToRemove = [
            "can you please", "could you please", "would you please",
            "can you", "could you", "would you",
            "please", "help me to", "help me",
            "i want to", "i need to", "i'd like to", "id like to",
            "tell me about", "tell me", "show me",
            "search for", "find me", "look for",
            "what is", "what are", "what's",
            "how do i", "how can i", "how to",
            "draft a reply to", "draft reply to", "draft a", "draft",
            "write an email to", "write a reply to", "write a", "write"
        ]

        var lower = cleaned.lowercased()
        for prefix in prefixesToRemove {
            if lower.hasPrefix(prefix) {
                let startIndex = cleaned.index(cleaned.startIndex, offsetBy: prefix.count)
                cleaned = String(cleaned[startIndex...]).trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: ":,- ")))
                lower = cleaned.lowercased()
                break
            }
        }

        // Trim trailing punctuation
        cleaned = cleaned.trimmingCharacters(in: CharacterSet(charactersIn: "?!.,:; \t\n\r"))

        guard !cleaned.isEmpty else {
            return "New chat"
        }

        // Capitalize first letter
        cleaned = cleaned.prefix(1).uppercased() + cleaned.dropFirst()

        // Max length cap ~ 36 chars, snapping to word boundary
        let maxLen = 36
        if cleaned.count > maxLen {
            let index = cleaned.index(cleaned.startIndex, offsetBy: maxLen)
            let truncated = String(cleaned[..<index])
            if let lastSpace = truncated.lastIndex(of: " "), lastSpace > cleaned.index(cleaned.startIndex, offsetBy: 16) {
                cleaned = String(truncated[..<lastSpace])
            } else {
                cleaned = truncated
            }
        }

        return cleaned.isEmpty ? "New chat" : cleaned
    }
}

private func formatRelativeDate(_ isoString: String) -> String {
    guard let date = AgentConversationDateHelpers.parseDate(isoString) else {
        return String(isoString.prefix(10))
    }
    let calendar = Calendar.current
    if calendar.isDateInToday(date) {
        let rel = RelativeDateTimeFormatter()
        rel.unitsStyle = .abbreviated
        return rel.localizedString(for: date, relativeTo: Date())
    }
    if calendar.isDateInYesterday(date) {
        return "Yesterday"
    }
    let rel = RelativeDateTimeFormatter()
    rel.unitsStyle = .short
    return rel.localizedString(for: date, relativeTo: Date())
}

struct ConversationRowView: View {
    let conversation: AgentConversation

    var body: some View {
        VStack(alignment: .leading, spacing: AppTheme.List.rowTextSpacing) {
            HStack(alignment: .firstTextBaseline) {
                Text(conversation.title)
                    .font(.inter(size: AppTheme.List.title, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .tracking(AppTheme.List.tracking)
                Spacer(minLength: 8)
                Text(formatRelativeDate(conversation.updatedAt))
                    .font(.inter(size: AppTheme.List.date))
                    .foregroundStyle(AppTheme.muted)
            }
            if let preview = conversation.lastMessagePreview, !preview.isEmpty {
                Text(preview)
                    .font(.inter(size: AppTheme.List.preview, weight: .regular))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                    .tracking(AppTheme.List.tracking)
            }
        }
        .padding(.vertical, AppTheme.List.rowVerticalPadding)
        .padding(.horizontal, AppTheme.List.rowHorizontalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.List.separatorColor)
                .frame(height: AppTheme.List.separatorHeight)
                .padding(.horizontal, AppTheme.List.rowHorizontalPadding)
                .accessibilityHidden(true)
        }
    }
}

private struct ChatRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

private extension View {
    func chatRowChrome() -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(AppTheme.background)
    }
}

struct ConversationDateSectionHeader: View {
    let title: String
    let isCollapsed: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 5) {
                Text(title)
                    .font(.inter(size: AppTheme.List.sectionHeader, weight: .medium))
                    .tracking(AppTheme.List.tracking)
                    .foregroundStyle(AppTheme.muted)
                    .textCase(nil)

                Image(systemName: "chevron.right")
                    .font(.inter(size: AppTheme.FontSize.chevron, weight: .semibold))
                    .foregroundStyle(AppTheme.muted.opacity(0.6))
                    .rotationEffect(.degrees(isCollapsed ? 0 : 90))

                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(top: 18, leading: AppTheme.List.rowHorizontalPadding, bottom: 4, trailing: AppTheme.List.rowHorizontalPadding))
        .listRowSeparator(.hidden)
        .listRowBackground(AppTheme.background)
    }
}

struct ConversationsListView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    var bottomInset: CGFloat = HomeChromeMetrics.listBottomInset(hasMinimizedCompose: false)
    let onOpen: (AgentConversation) -> Void

    @State private var conversationToRename: AgentConversation?
    @State private var renameText = ""
    @State private var showRenameAlert = false
    @State private var collapsedGroupTitles: Set<String> = []

    private var userConversations: [AgentConversation] {
        app.conversations.filter { $0.id != "auto" }
    }

    private var dateGroupedConversations: [ConversationDateGroup] {
        AgentConversationDateHelpers.groupConversationsByDate(userConversations)
    }

    var body: some View {
        List {
            Section {
                Button {
                    Task {
                        if let created = await app.createConversation() {
                            onOpen(created)
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                            .font(.inter(size: 14, weight: .semibold))
                        Text("New chat")
                            .font(.inter(size: AppTheme.List.title, weight: .medium))
                            .tracking(AppTheme.List.tracking)
                    }
                    .foregroundStyle(AppTheme.accent)
                    .padding(.vertical, 14)
                    .padding(.horizontal, AppTheme.List.rowHorizontalPadding)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(ChatRowButtonStyle())
                .chatRowChrome()
            }

            if userConversations.isEmpty {
                Section {
                    emptyState
                }
            } else {
                ForEach(dateGroupedConversations) { group in
                    Section {
                        if !collapsedGroupTitles.contains(group.title) {
                            ForEach(group.conversations) { conversation in
                                Button {
                                    onOpen(conversation)
                                } label: {
                                    ConversationRowView(conversation: conversation)
                                }
                                .buttonStyle(ChatRowButtonStyle())
                                .chatRowChrome()
                                .contextMenu {
                                    Button {
                                        conversationToRename = conversation
                                        renameText = conversation.title == "New chat" ? "" : conversation.title
                                        showRenameAlert = true
                                    } label: {
                                        Label("Rename", systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        Task { await app.deleteConversation(id: conversation.id) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                            .onDelete { offsets in
                                deleteConversations(in: group, at: offsets)
                            }
                        }
                    } header: {
                        ConversationDateSectionHeader(
                            title: group.title,
                            isCollapsed: collapsedGroupTitles.contains(group.title),
                            onToggle: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    if collapsedGroupTitles.contains(group.title) {
                                        collapsedGroupTitles.remove(group.title)
                                    } else {
                                        collapsedGroupTitles.insert(group.title)
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .refreshable { await app.refreshConversations() }
        .safeAreaInset(edge: .bottom) { Color.clear.frame(height: bottomInset) }
        .alert("Rename Chat", isPresented: $showRenameAlert) {
            TextField("Chat title", text: $renameText)
            Button("Cancel", role: .cancel) { }
            Button("Save") {
                let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, let convId = conversationToRename?.id {
                    Task {
                        await app.updateConversation(id: convId, title: trimmed)
                    }
                }
            }
        }
        .task {
            await app.refreshConversations()
            await backfillUntitledConversations()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.inter(size: 32))
                .foregroundStyle(AppTheme.accent)
            Text("No conversations yet")
                .font(.inter(size: 16, weight: .semibold))
                .tracking(0.2)
                .foregroundStyle(AppTheme.ink)
            Text("Ask your AI assistant to search emails, draft replies, or organize your inbox.")
                .font(.inter(size: 13, weight: .regular))
                .tracking(AppTheme.Chat.tracking)
                .foregroundStyle(AppTheme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private func deleteConversations(in group: ConversationDateGroup, at offsets: IndexSet) {
        let toDelete = offsets.map { group.conversations[$0] }
        Task {
            for conv in toDelete {
                await app.deleteConversation(id: conv.id)
            }
        }
    }

    private func backfillUntitledConversations() async {
        guard let mailboxId = app.selectedMailboxId else { return }
        let untitled = userConversations.filter { $0.title == "New chat" }
        for conv in untitled.prefix(8) {
            let msgs = await AgentChatClient.fetchMessages(
                mailboxId: mailboxId,
                conversationId: conv.id,
                authToken: auth.token
            )
            if let firstUser = msgs.first(where: { $0.role == "user" && !$0.text.isEmpty }) {
                let derived = ConversationTitleHelper.deriveTitle(from: firstUser.text)
                let lastText = msgs.last?.text ?? firstUser.text
                let preview = String(lastText.prefix(120))
                await app.updateConversation(id: conv.id, title: derived, lastMessagePreview: preview)
            }
        }
    }
}

struct ChatConversationsModalListView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    let onSelect: (AgentConversation) -> Void
    let onNewChat: () -> Void
    let onClose: () -> Void

    @State private var conversationToRename: AgentConversation?
    @State private var renameText = ""
    @State private var showRenameAlert = false
    @State private var collapsedGroupTitles: Set<String> = []

    private var userConversations: [AgentConversation] {
        app.conversations.filter { $0.id != "auto" }
    }

    private var dateGroupedConversations: [ConversationDateGroup] {
        AgentConversationDateHelpers.groupConversationsByDate(userConversations)
    }

    var body: some View {
        List {
            if userConversations.isEmpty {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.inter(size: 32))
                            .foregroundStyle(AppTheme.accent)
                        Text("No conversations yet")
                            .font(.inter(size: 16, weight: .semibold))
                            .tracking(0.2)
                            .foregroundStyle(AppTheme.ink)
                        Text("Ask your AI assistant to search emails, draft replies, or organize your inbox.")
                            .font(.inter(size: 13, weight: .regular))
                            .tracking(AppTheme.Chat.tracking)
                            .foregroundStyle(AppTheme.muted)
                            .multilineTextAlignment(.center)

                        Button {
                            onNewChat()
                        } label: {
                            Label("Start a new chat", systemImage: "plus")
                                .font(.inter(size: AppTheme.Chat.prompt, weight: .medium))
                                .tracking(AppTheme.Chat.tracking)
                                .foregroundStyle(AppTheme.accent)
                        }
                        .padding(.top, 8)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                }
            } else {
                ForEach(dateGroupedConversations) { group in
                    Section {
                        if !collapsedGroupTitles.contains(group.title) {
                            ForEach(group.conversations) { conversation in
                                Button {
                                    onSelect(conversation)
                                } label: {
                                    ConversationRowView(conversation: conversation)
                                }
                                .buttonStyle(ChatRowButtonStyle())
                                .chatRowChrome()
                                .contextMenu {
                                    Button {
                                        conversationToRename = conversation
                                        renameText = conversation.title == "New chat" ? "" : conversation.title
                                        showRenameAlert = true
                                    } label: {
                                        Label("Rename", systemImage: "pencil")
                                    }
                                    Button(role: .destructive) {
                                        Task { await app.deleteConversation(id: conversation.id) }
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                            .onDelete { offsets in
                                deleteConversations(in: group, at: offsets)
                            }
                        }
                    } header: {
                        ConversationDateSectionHeader(
                            title: group.title,
                            isCollapsed: collapsedGroupTitles.contains(group.title),
                            onToggle: {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    if collapsedGroupTitles.contains(group.title) {
                                        collapsedGroupTitles.remove(group.title)
                                    } else {
                                        collapsedGroupTitles.insert(group.title)
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .background(DetailNavigationTitleFont())
        .refreshable { await app.refreshConversations() }
        .navigationTitle("Chats")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.inter(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityLabel("Close")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onNewChat()
                } label: {
                    Image(systemName: "plus")
                        .font(.inter(size: 16, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityLabel("New chat")
            }
        }
        .alert("Rename Chat", isPresented: $showRenameAlert) {
            TextField("Chat title", text: $renameText)
            Button("Cancel", role: .cancel) { }
            Button("Save") {
                let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, let convId = conversationToRename?.id {
                    Task {
                        await app.updateConversation(id: convId, title: trimmed)
                    }
                }
            }
        }
        .task {
            await app.refreshConversations()
            await backfillUntitledConversations()
        }
    }

    private func deleteConversations(in group: ConversationDateGroup, at offsets: IndexSet) {
        let toDelete = offsets.map { group.conversations[$0] }
        Task {
            for conv in toDelete {
                await app.deleteConversation(id: conv.id)
            }
        }
    }

    private func backfillUntitledConversations() async {
        guard let mailboxId = app.selectedMailboxId else { return }
        let untitled = userConversations.filter { $0.title == "New chat" }
        for conv in untitled.prefix(8) {
            let msgs = await AgentChatClient.fetchMessages(
                mailboxId: mailboxId,
                conversationId: conv.id,
                authToken: auth.token
            )
            if let firstUser = msgs.first(where: { $0.role == "user" && !$0.text.isEmpty }) {
                let derived = ConversationTitleHelper.deriveTitle(from: firstUser.text)
                let lastText = msgs.last?.text ?? firstUser.text
                let preview = String(lastText.prefix(120))
                await app.updateConversation(id: conv.id, title: derived, lastMessagePreview: preview)
            }
        }
    }
}

struct ChatConversationDetailView: View {
    let conversationId: String
    var seedPrompt: String?
    var onSeedConsumed: (() -> Void)?
    let onNewChat: () -> Void
    let onClose: () -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    @StateObject private var chat = AgentChatClient()
    @State private var draft = ""
    @FocusState private var isInputFocused: Bool
    @State private var selectedReasoningMessage: ChatMessage?
    @State private var activeSearchQuery: String?
    @State private var showRenameAlert = false
    @State private var renameText = ""

    private let suggestedPrompts = [
        "Show latest inbox emails",
        "Draft a reply to latest email",
        "Summarize unread emails",
        "Find orders and receipts",
    ]

    private var currentTitle: String {
        app.conversations.first(where: { $0.id == conversationId })?.title ?? "Ask AI"
    }

    private var isSendDisabled: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || chat.isStreaming
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            messagesList
                .contentShape(Rectangle())
                .onTapGesture {
                    isInputFocused = false
                }
                .safeAreaInset(edge: .bottom) {
                    Color.clear.frame(height: 70)
                }

            inputBar
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
        }
        .background(AppTheme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarRole(.editor)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack {
                    Text(currentTitle)
                        .font(.inter(size: 16, weight: .semibold))
                        .tracking(0.2)
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    Spacer()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        renameText = currentTitle == "Ask AI" ? "" : currentTitle
                        showRenameAlert = true
                    } label: {
                        Label("Rename chat", systemImage: "pencil")
                    }
                    Button {
                        onNewChat()
                    } label: {
                        Label("New chat", systemImage: "plus")
                    }
                    Button(role: .destructive) {
                        chat.clearHistory()
                    } label: {
                        Label("Clear this chat", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityLabel("Options")
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.inter(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityLabel("Close")
            }
        }
        .sheet(item: $selectedReasoningMessage) { msg in
            if let reasoning = msg.reasoning {
                ReasoningModalView(
                    reasoning: reasoning,
                    durationString: msg.reasoningDurationString
                )
            }
        }
        .sheet(isPresented: Binding(
            get: { activeSearchQuery != nil },
            set: { if !$0 { activeSearchQuery = nil } }
        )) {
            if let query = activeSearchQuery {
                SearchView(initialQuery: query)
            }
        }
        .alert("Rename Chat", isPresented: $showRenameAlert) {
            TextField("Chat title", text: $renameText)
            Button("Cancel", role: .cancel) { }
            Button("Save") {
                let trimmed = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    Task {
                        await app.updateConversation(id: conversationId, title: trimmed)
                    }
                }
            }
        }
        .task {
            chat.onStreamFinished = { hasToolActions in
                if hasToolActions {
                    Task { @MainActor in
                        await app.notifyAIToolCompleted()
                    }
                }
                if let lastMsg = chat.messages.last(where: { !$0.isError }), !lastMsg.text.isEmpty {
                    let preview = String(lastMsg.text.prefix(120))
                    Task { @MainActor in
                        await app.updateConversation(id: conversationId, lastMessagePreview: preview)
                    }
                }
            }

            chat.onHistoryLoaded = { loaded in
                let conv = app.conversations.first(where: { $0.id == conversationId })
                let isDefaultTitle = conv == nil || conv?.title == "New chat" || conv?.title == "Ask AI"
                let lastResponse = loaded.last(where: { !$0.isToolAction && !$0.isError && !$0.text.isEmpty })
                if isDefaultTitle, let firstUser = loaded.first(where: { $0.role == "user" && !$0.text.isEmpty }) {
                    let derived = ConversationTitleHelper.deriveTitle(from: firstUser.text)
                    let lastText = lastResponse?.text ?? loaded.last?.text ?? firstUser.text
                    let preview = String(lastText.prefix(120))
                    Task { @MainActor in
                        await app.updateConversation(id: conversationId, title: derived, lastMessagePreview: preview)
                    }
                } else if conv?.lastMessagePreview == nil, let last = lastResponse ?? loaded.last, !last.text.isEmpty {
                    let preview = String(last.text.prefix(120))
                    Task { @MainActor in
                        await app.updateConversation(id: conversationId, lastMessagePreview: preview)
                    }
                }
            }

            guard let mailboxId = app.selectedMailboxId else { return }
            chat.connect(mailboxId: mailboxId, conversationId: conversationId, authToken: auth.token)

            if let seed = seedPrompt, !seed.isEmpty {
                draft = seed
                onSeedConsumed?()
            }
        }
        .onDisappear {
            isInputFocused = false
            chat.disconnect()
        }
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if chat.isLoadingHistory {
                        HStack {
                            Spacer()
                            ProgressView()
                                .padding(.vertical, 24)
                            Spacer()
                        }
                    } else if chat.messages.isEmpty {
                        emptyStateView
                    } else {
                        ForEach(chat.messages) { message in
                            ChatBubble(
                                message: message,
                                onOpenReasoning: {
                                    selectedReasoningMessage = message
                                },
                                onCompose: { address in
                                    onClose()
                                    Task {
                                        await app.startCompose(mode: .new, initialTo: [address])
                                    }
                                },
                                onSearch: { query in
                                    activeSearchQuery = query
                                },
                                onAskAI: { prompt in
                                    isInputFocused = false
                                    sendMessage(prompt)
                                }
                            )
                            .id(message.id)
                        }
                    }

                    if let status = chat.statusText {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.mini)
                            Text(status)
                                .font(.inter(size: AppTheme.Chat.toolAction, weight: .regular))
                                .tracking(AppTheme.Chat.tracking)
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)
                        .id("status_indicator")
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture {
                    isInputFocused = false
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .contentShape(Rectangle())
            .onTapGesture {
                isInputFocused = false
            }
            .onChange(of: chat.messages.count) { _, _ in
                if let last = chat.messages.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            .onChange(of: chat.statusText) { _, newStatus in
                if newStatus != nil {
                    withAnimation { proxy.scrollTo("status_indicator", anchor: .bottom) }
                }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            VStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.inter(size: 36))
                    .foregroundStyle(AppTheme.accent)
                Text("How can I help you today?")
                    .font(.inter(size: 17, weight: .semibold))
                    .tracking(0.2)
                    .foregroundStyle(AppTheme.ink)
                Text("I can search messages, summarize threads, draft replies, and organize your mailbox.")
                    .font(.inter(size: 13))
                    .tracking(AppTheme.Chat.tracking)
                    .foregroundStyle(AppTheme.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 24)
            .padding(.horizontal, 16)

            VStack(spacing: 8) {
                ForEach(suggestedPrompts, id: \.self) { prompt in
                    Button {
                        isInputFocused = false
                        sendMessage(prompt)
                    } label: {
                        HStack {
                            Text(prompt)
                                .font(.inter(size: AppTheme.Chat.prompt, weight: .medium))
                                .tracking(AppTheme.Chat.tracking)
                                .foregroundStyle(AppTheme.ink)
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .font(.inter(size: 12, weight: .semibold))
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(AppTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            inputField
            sendButton
        }
        .liquidGlassContainer(spacing: 10)
    }

    private var inputField: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(AppTheme.muted)
            TextField("Ask about your inbox…", text: $draft)
                .font(.inter(size: AppTheme.Chat.input, weight: .regular))
                .focused($isInputFocused)
                .submitLabel(.send)
                .onSubmit {
                    guard !isSendDisabled else { return }
                    let text = draft
                    draft = ""
                    isInputFocused = false
                    sendMessage(text)
                }
            if !draft.isEmpty {
                Button {
                    draft = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 52)
        .liquidGlass(in: RoundedRectangle(cornerRadius: 50, style: .continuous))
    }

    private var sendButton: some View {
        Button {
            let text = draft
            draft = ""
            isInputFocused = false
            sendMessage(text)
        } label: {
            Image(systemName: "arrow.up")
                .font(.inter(size: 16, weight: .semibold))
                .foregroundStyle(isSendDisabled ? AppTheme.muted : AppTheme.ink)
                .frame(height: 52)
                .frame(width: 52)
                .frame(alignment: .center)
        }
        .buttonStyle(.plain)
        .liquidGlass(in: Capsule())
        .disabled(isSendDisabled)
        .accessibilityLabel("Send message")
    }

    private func sendMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        chat.sendUserMessage(trimmed)

        let conv = app.conversations.first(where: { $0.id == conversationId })
        let isDefaultTitle = conv == nil || conv?.title == "New chat" || conv?.title == "Ask AI" || conv?.title.isEmpty == true

        if isDefaultTitle {
            let derived = ConversationTitleHelper.deriveTitle(from: trimmed)
            Task {
                await app.updateConversation(id: conversationId, title: derived, lastMessagePreview: trimmed)
            }
        } else {
            Task {
                await app.updateConversation(id: conversationId, lastMessagePreview: trimmed)
            }
        }
    }
}

struct ChatSheetView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var seedPrompt: String?
    var initialConversationId: String?

    @State private var navigationPath: [String]
    @State private var pendingSeedPrompt: String?

    init(seedPrompt: String? = nil, initialConversationId: String? = nil) {
        self.seedPrompt = seedPrompt
        self.initialConversationId = initialConversationId
        self._pendingSeedPrompt = State(initialValue: seedPrompt)
        if let initialConversationId {
            self._navigationPath = State(initialValue: [initialConversationId])
        } else {
            self._navigationPath = State(initialValue: [])
        }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ChatConversationsModalListView(
                onSelect: { conversation in
                    navigationPath = [conversation.id]
                },
                onNewChat: {
                    Task {
                        if let created = await app.createConversation(title: "New chat") {
                            navigationPath = [created.id]
                        }
                    }
                },
                onClose: {
                    dismiss()
                }
            )
            .navigationDestination(for: String.self) { conversationId in
                ChatConversationDetailView(
                    conversationId: conversationId,
                    seedPrompt: pendingSeedPrompt,
                    onSeedConsumed: {
                        pendingSeedPrompt = nil
                    },
                    onNewChat: {
                        Task {
                            if let created = await app.createConversation(title: "New chat") {
                                navigationPath = [created.id]
                            }
                        }
                    },
                    onClose: {
                        dismiss()
                    }
                )
            }
        }
        .task {
            if navigationPath.isEmpty {
                if let seed = seedPrompt, !seed.isEmpty {
                    let title = ConversationTitleHelper.deriveTitle(from: seed)
                    if let created = await app.createConversation(title: title) {
                        navigationPath = [created.id]
                    }
                } else if let initialConversationId {
                    navigationPath = [initialConversationId]
                }
            }
        }
    }
}

private struct ThinkingGhostButton: View {
    let message: ChatMessage
    let isLiveThinking: Bool
    let onTap: () -> Void

    private var labelText: String {
        if isLiveThinking {
            return "Thinking…"
        }
        if let dur = message.reasoningDurationString {
            return "Thought for \(dur)"
        }
        return "Thought process"
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 5) {
                Text(labelText)
                    .font(.inter(size: AppTheme.Chat.meta, weight: .medium))
                    .tracking(AppTheme.Chat.tracking)
                    .foregroundStyle(AppTheme.muted)

                if isLiveThinking {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.inter(size: AppTheme.FontSize.chevron, weight: .semibold))
                        .foregroundStyle(AppTheme.muted.opacity(0.6))
                }
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ReasoningModalView: View {
    let reasoning: String
    let durationString: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    MarkdownContentView(
                        text: reasoning,
                        fontSize: AppTheme.Chat.body
                    )
                    .foregroundStyle(AppTheme.ink)
                    .textSelection(.enabled)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(AppTheme.background)
            .background(DetailNavigationTitleFont())
            .navigationTitle(durationString != nil ? "Thought for \(durationString!)" : "Thought process")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                    }
                }
            }
        }
        .presentationDetents([.fraction(0.4), .large])
        .presentationContentInteraction(.resizes)
        .presentationDragIndicator(.visible)
    }
}

private struct ChatBubble: View {
    let message: ChatMessage
    let onOpenReasoning: () -> Void
    var onCompose: ((MailAddress) -> Void)? = nil
    var onSearch: ((String) -> Void)? = nil
    var onAskAI: ((String) -> Void)? = nil

    var body: some View {
        HStack(alignment: .top) {
            if message.role == "user" { Spacer(minLength: 40) }

            if message.isToolAction {
                Text(message.text)
                    .font(.inter(size: AppTheme.Chat.toolAction, weight: .medium))
                    .tracking(AppTheme.Chat.tracking)
                    .foregroundStyle(AppTheme.ink)
                    .padding(.trailing, 14)
                    .padding(.vertical, 10)
            } else if message.isError {
                Text(message.text)
                    .font(.inter(size: AppTheme.Chat.toolAction, weight: .regular))
                    .tracking(AppTheme.Chat.tracking)
                    .foregroundStyle(AppTheme.deepDarkRed)
                    .padding(.trailing, 14)
                    .padding(.vertical, 10)
            } else if message.role == "user" {
                MarkdownContentView(
                    text: message.text,
                    fontSize: AppTheme.Chat.body,
                    onCompose: onCompose,
                    onSearch: onSearch,
                    onAskAI: onAskAI
                )
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .textSelection(.enabled)
                .background(AppTheme.pillFill)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .textSelection(.enabled)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    if let reasoning = message.reasoning, !reasoning.isEmpty {
                        ThinkingGhostButton(
                            message: message,
                            isLiveThinking: message.text.isEmpty,
                            onTap: onOpenReasoning
                        )
                    }

                    if !message.text.isEmpty {
                        MarkdownContentView(
                            text: message.text,
                            fontSize: AppTheme.Chat.body,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .textSelection(.enabled)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 12)
                    }
                }
            }

            if message.role != "user" { Spacer(minLength: 40) }
        }
    }
}

import SwiftUI

/// Notion-like search screen: floating bottom search field + result rows.
struct SearchView: View {
    var initialQuery: String = ""
    var onClose: (() -> Void)?

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var query: String
    @State private var results: [Email] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var showChat = false
    @FocusState private var focused: Bool

    init(initialQuery: String = "", onClose: (() -> Void)? = nil) {
        self.initialQuery = initialQuery
        self.onClose = onClose
        _query = State(initialValue: initialQuery)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var parsedQuery: ParsedSearch {
        SearchQueryParser.parse(trimmedQuery)
    }

    private var highlightText: String {
        let free = parsedQuery.query
        return free.isEmpty ? "" : free
    }

    private var hasResults: Bool {
        !results.isEmpty
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            AppTheme.background.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                if !trimmedQuery.isEmpty {
                    askAIButton
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 20)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .padding()
                    Spacer()
                } else if isSearching || hasResults {
                    Text("Results")
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .opacity(hasResults && !isSearching ? 1 : 0)

                    EmailListView(
                        emails: results,
                        highlightQuery: highlightText,
                        isLoading: isSearching,
                        bottomInset: 0
                    ) { email in
                        Task {
                            await app.openEmail(email)
                        }
                    }
                } else if shouldShowEmptyResults {
                    Text("No matching emails")
                        .font(.inter(size: 15))
                        .foregroundStyle(AppTheme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                    Spacer()
                } else {
                    operatorTip
                    Spacer()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            searchBar
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 10)
        }
        .scrollDismissesKeyboard(.immediately)
        .task {
            guard initialQuery.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(280))
            focused = true
        }
        .task(id: query) {
            await runSearch()
        }
        .fullScreenCover(isPresented: $showChat, onDismiss: {
            app.dismissChatSession()
        }) {
            ChatSheetView(
                seedPrompt: trimmedQuery,
                initialConversationId: app.chatSession.conversationId,
                forceNewChat: true
            )
        }
    }

    private var shouldShowEmptyResults: Bool {
        let parsed = parsedQuery
        if parsed.hasStructuredFilters { return true }
        return trimmedQuery.count >= 2
    }

    private var operatorTip: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tip: Use operators like from:name, is:unread, has:attachment, before:2025-01-01")
                .font(.inter(size: 13))
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var askAIButton: some View {
        Button {
            app.openChatSession(forceNew: true)
            showChat = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.inter(size: 16, weight: .medium))
                Text("Ask AI “\(trimmedQuery)”")
                    .font(.inter(size: 16, weight: .medium))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 52)
            .background(AppTheme.surface)
            .foregroundStyle(AppTheme.ink)
            .clipShape(Capsule())
            .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
        }
        .buttonStyle(.plain)
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            searchField
            cancelButton
        }
        .liquidGlassContainer(spacing: 10)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AppTheme.muted)
            TextField("Search mail (try from:, is:unread)", text: $query)
                .focused($focused)
                .submitLabel(.search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                    results = []
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

    private var cancelButton: some View {
        Button {
            focused = false
            if let onClose {
                onClose()
            } else {
                dismiss()
            }
        } label: {
            Image(systemName: "xmark")
                .font(.inter(size: 14, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .frame(height: 52)
                .frame(width: 52)
                .frame(alignment: .center)
        }
        .buttonStyle(.plain)
        .liquidGlass(in: Capsule())
        .accessibilityLabel("Cancel")
    }

    private func runSearch() async {
        let q = trimmedQuery
        guard let mailboxId = app.selectedMailboxId else { return }
        let parsed = SearchQueryParser.parse(q)

        let shouldSearch = parsed.hasStructuredFilters || q.count >= 2
        guard shouldSearch else {
            results = []
            errorMessage = nil
            return
        }

        // Instant local FTS5 on free-text only (operators are not local filters).
        if !parsed.query.isEmpty {
            let localMatches = DatabaseService.shared.searchEmails(
                mailboxId: mailboxId,
                query: parsed.query,
                limit: 30
            )
            if !localMatches.isEmpty {
                results = localMatches
            }
        } else {
            // Operator-only: wait for network rather than FTS-matching "from:…"
            results = []
        }

        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        do {
            try await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            let response = try await APIClient.shared.searchEmails(mailboxId: mailboxId, parsed: parsed)
            results = response.emails
            DatabaseService.shared.upsertEmails(mailboxId: mailboxId, emails: response.emails)
        } catch is CancellationError {
            // ignore
        } catch {
            if results.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

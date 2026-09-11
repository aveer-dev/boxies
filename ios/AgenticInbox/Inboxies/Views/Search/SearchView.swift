import SwiftUI
import UIKit

/// Notion-like search screen: floating bottom search field + result rows.
struct SearchView: View {
    var initialQuery: String = ""

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var query: String
    @State private var results: [Email] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @State private var showChat = false
    @State private var keyboardOverlap: CGFloat = 0
    @State private var safeBottom: CGFloat = 0
    @FocusState private var focused: Bool

    init(initialQuery: String = "") {
        self.initialQuery = initialQuery
        _query = State(initialValue: initialQuery)
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasResults: Bool {
        !results.isEmpty
    }

    /// Keyboard lift that does not change the sheet's layout bounds.
    /// Zoom snapshots the container; a safe-area change mid-dismiss rebuilds that
    /// snapshot and is the 2-frame snap back to the full search chrome.
    private var keyboardLift: CGFloat {
        max(0, keyboardOverlap - safeBottom)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            AppTheme.background.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                if !trimmedQuery.isEmpty {
                    askAIButton
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
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
                        highlightQuery: query,
                        isLoading: isSearching
                    ) { email in
                        Task {
                            await app.openEmail(email)
                            dismiss()
                        }
                    }
                } else if trimmedQuery.count >= 2 {
                    Text("No matching emails")
                        .font(.inter(size: 15))
                        .foregroundStyle(AppTheme.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                    Spacer()
                } else {
                    Spacer()
                }
            }
            .padding(.top, 28)
            .safeAreaInset(edge: .bottom) {
                Color.clear.frame(height: 70)
            }

            searchBar
                .padding(.horizontal, 12)
                .padding(.bottom, 10 + keyboardLift)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea(.keyboard)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.safeAreaInsets.bottom
        } action: { safeBottom = $0 }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            updateKeyboardOverlap(from: notification)
        }
        .scrollDismissesKeyboard(.immediately)
        .task {
            guard initialQuery.isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(450))
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
            TextField("Search mail", text: $query)
                .focused($focused)
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
            dismiss()
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

    private func updateKeyboardOverlap(from notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return
        }
        let overlap = max(0, UIScreen.main.bounds.height - frame.origin.y)
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            keyboardOverlap = overlap
        }
    }

    private func runSearch() async {
        let q = trimmedQuery
        guard let mailboxId = app.selectedMailboxId else { return }
        guard q.count >= 2 else {
            results = []
            errorMessage = nil
            return
        }

        // 1. Instant local FTS5 search (0ms)
        let localMatches = DatabaseService.shared.searchEmails(mailboxId: mailboxId, query: q, limit: 30)
        if !localMatches.isEmpty {
            results = localMatches
        }

        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        do {
            try await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            let response = try await APIClient.shared.searchEmails(mailboxId: mailboxId, query: q)
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

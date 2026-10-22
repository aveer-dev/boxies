import SwiftUI

/// Every New Inbox conversation (AVE-23). The Inbox list caps New at
/// `EmailListPaging.inboxNewPreviewLimit` rows so Seen always stays in view; its
/// "Show N more new" row pushes this screen onto the home `NavigationStack`.
struct InboxNewListView: View {
    @Environment(AppModel.self) private var app

    var bottomInset: CGFloat = HomeChromeMetrics.listBottomInset(hasMinimizedCompose: false)

    @State private var emails: [Email] = []
    @State private var paging: EmailListPaging?
    @State private var totalCount: Int?
    @State private var isLoading = true
    @State private var loadError: String?

    var body: some View {
        EmailListView(
            emails: emails,
            isLoading: isLoading,
            fallbackFolderId: nil,
            bottomInset: bottomInset,
            onRefresh: { await loadFirstPage() },
            showsTags: true,
            loadError: loadError,
            paging: paging,
            onLoadMore: { await loadMore() }
        ) { email in
            markOpened(email)
            Task { await app.openEmail(email) }
        }
        .background(AppTheme.background)
        .background(HomeNavigationTitleFont())
        .navigationTitle("New")
        .navigationBarTitleDisplayMode(.large)
        .modifier(HomeNavigationSubtitle(subtitle: subtitle, fontWeight: .regular))
        .task(id: app.selectedMailboxId) {
            await loadFirstPage()
        }
    }

    private var subtitle: String {
        guard let totalCount else { return "Inbox" }
        return totalCount == 1 ? "1 new conversation" : "\(totalCount) new conversations"
    }

    private var pagingKey: String {
        EmailListPaging.key(mailboxId: app.selectedMailboxId ?? "", listId: "inbox_new")
    }

    private func loadFirstPage() async {
        guard let mailboxId = app.selectedMailboxId else { return }
        if app.isDebugPreview {
            emails = app.emails.filter(\.isUnread)
            totalCount = emails.count
            paging = nil
            isLoading = false
            return
        }
        let key = pagingKey
        do {
            let response = try await APIClient.shared.listEmails(
                mailboxId: mailboxId,
                folder: "inbox",
                page: 1,
                section: "new"
            )
            guard key == pagingKey else { return }
            // Cache the rows so opening one reads locally; no pruning — this is a filtered view.
            DatabaseService.shared.upsertEmails(mailboxId: mailboxId, emails: response.emails, defaultFolder: "inbox")
            var next = EmailListPaging(key: key)
            next.apply(
                page: 1,
                receivedCount: response.emails.count,
                totalCount: response.totalCount,
                oldestDate: response.emails.last?.date
            )
            paging = next
            emails = response.emails
            totalCount = response.newCount ?? response.totalCount
            loadError = nil
        } catch {
            if emails.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func loadMore() async {
        guard let mailboxId = app.selectedMailboxId,
              var current = paging, current.key == pagingKey,
              let page = current.nextPage else { return }
        current.isLoadingMore = true
        current.loadMoreFailed = false
        paging = current
        do {
            let response = try await APIClient.shared.listEmails(
                mailboxId: mailboxId,
                folder: "inbox",
                page: page,
                section: "new"
            )
            guard paging?.key == pagingKey else { return }
            DatabaseService.shared.upsertEmails(mailboxId: mailboxId, emails: response.emails, defaultFolder: "inbox")
            paging?.isLoadingMore = false
            if paging?.apply(
                page: page,
                receivedCount: response.emails.count,
                totalCount: response.totalCount,
                oldestDate: response.emails.last?.date
            ) == true {
                emails = EmailListPaging.appending(response.emails, to: emails)
            }
        } catch {
            paging?.isLoadingMore = false
            paging?.loadMoreFailed = true
        }
    }

    /// Opening marks the conversation read; the row stays put (with a read dot) until refresh.
    private func markOpened(_ email: Email) {
        guard email.isUnread, let idx = emails.firstIndex(where: { $0.id == email.id }) else { return }
        emails[idx].read = true
        emails[idx].threadUnreadCount = 0
        emails[idx].listSection = "seen"
    }
}

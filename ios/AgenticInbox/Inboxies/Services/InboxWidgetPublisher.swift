import Foundation
import WidgetKit

/// App side of the "Today's inbox" widget (AVE-149): writes `InboxWidgetSnapshot` and the
/// mailbox list to the App Group and asks WidgetKit to reload. Writes are skipped when the
/// content didn't change, so refreshes don't burn the widget's reload budget.
enum InboxWidgetPublisher {
    /// Writes the snapshot; reloads the widget when it changed.
    static func publish(_ snapshot: InboxWidgetSnapshot) {
        guard let store = InboxWidgetStore.shared, store.write(snapshot) else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: InboxWidgetKind.todayInbox)
    }

    /// Mirrors the signed-in user's mailboxes for the widget's mailbox picker.
    static func publishMailboxes(_ mailboxes: [Mailbox]) {
        let refs = mailboxes.map { InboxWidgetStore.MailboxRef(id: $0.id, address: $0.email) }
        guard let store = InboxWidgetStore.shared, store.writeMailboxes(refs) else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: InboxWidgetKind.todayInbox)
    }

    #if DEBUG
    /// DEBUG `-previewWidgetData` (add `zero` for inbox zero): puts the sample snapshot in
    /// the App Group so the real home-screen widget can be reviewed without signing in.
    static func publishPreviewData(inboxZero: Bool) {
        guard let store = InboxWidgetStore.shared else { return }
        let sample: InboxWidgetSnapshot = inboxZero ? .sampleInboxZero : .sampleHasMail
        store.writeMailboxes([.init(id: sample.mailboxId, address: sample.mailboxAddress)])
        store.write(sample)
        WidgetCenter.shared.reloadTimelines(ofKind: InboxWidgetKind.todayInbox)
    }
    #endif

    /// Background push (AVE-228): the app isn't running, so ask the server for the Inbox's
    /// New page and write it. Only mailboxes the app already published are refreshed (the
    /// user is signed in and placed this mailbox's data in the App Group before).
    static func refreshFromServer(mailboxId: String) async {
        guard APIClient.shared.authToken != nil,
              let store = InboxWidgetStore.shared,
              let previous = store.snapshot(mailboxId: mailboxId) else { return }
        guard let page = try? await APIClient.shared.listEmails(
            mailboxId: mailboxId,
            folder: "inbox",
            page: 1,
            section: "new"
        ) else { return }
        publish(.make(
            mailboxId: mailboxId,
            mailboxAddress: previous.mailboxAddress,
            newPage: page,
            replyLaterCount: previous.replyLaterCount
        ))
    }

    /// Sign-out: the widget goes back to "Open Inboxies".
    static func clear() {
        InboxWidgetStore.shared?.removeAll()
        WidgetCenter.shared.reloadTimelines(ofKind: InboxWidgetKind.todayInbox)
    }
}

extension InboxWidgetSnapshot {
    /// The widget's view of an Inbox: the Inbox's New total and its newest New rows, newest
    /// first, up to five. `newCount` is the server's New total (the Inbox unread count, AVE-228)
    /// so the widget, the New section and "All new" agree; cached rows only fill the deck.
    static func make(
        mailbox: Mailbox,
        inboxRows: [Email],
        newCount: Int,
        replyLaterCount: Int,
        now: Date = Date()
    ) -> InboxWidgetSnapshot {
        let newRows = EmailListPaging.inboxSections(inboxRows, sectionFloor: nil).new
        let preview = EmailListPaging.inboxNewPreview(newRows, serverNewCount: newCount, limit: maxThreads)
        return InboxWidgetSnapshot(
            mailboxId: mailbox.id,
            mailboxAddress: mailbox.email,
            newCount: preview.shown.count + preview.hiddenCount,
            replyLaterCount: max(0, replyLaterCount),
            threads: preview.shown.map { thread($0, now: now) },
            updatedAt: now
        )
    }

    /// From the server's own New page (`section=new`): used when the app is woken in the
    /// background, where there is no in-memory Inbox to build from.
    static func make(
        mailboxId: String,
        mailboxAddress: String,
        newPage: EmailListResponse,
        replyLaterCount: Int,
        now: Date = Date()
    ) -> InboxWidgetSnapshot {
        let total = newPage.newCount ?? newPage.totalCount
        let rows = newPage.emails.filter(\.isUnread)
            .sorted { $0.inboxSortKey > $1.inboxSortKey }
            .prefix(min(maxThreads, total))
        return InboxWidgetSnapshot(
            mailboxId: mailboxId,
            mailboxAddress: mailboxAddress,
            newCount: max(0, total),
            replyLaterCount: max(0, replyLaterCount),
            threads: rows.map { thread($0, now: now) },
            updatedAt: now
        )
    }

    private static func thread(_ email: Email, now: Date) -> Thread {
        Thread(
            id: email.id,
            senderName: email.displaySender,
            subject: email.subject.isEmpty ? "(no subject)" : email.subject,
            receivedAt: email.parsedDate ?? now
        )
    }
}

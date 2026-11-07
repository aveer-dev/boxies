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

    /// Sign-out: the widget goes back to "Open Inboxies".
    static func clear() {
        InboxWidgetStore.shared?.removeAll()
        WidgetCenter.shared.reloadTimelines(ofKind: InboxWidgetKind.todayInbox)
    }
}

extension InboxWidgetSnapshot {
    /// The widget's view of an Inbox: the same New rows and New total the Inbox's New
    /// section shows (`inboxSections` + `inboxNewPreview`), newest first, up to five.
    static func make(
        mailbox: Mailbox,
        inboxRows: [Email],
        serverNewCount: Int?,
        replyLaterCount: Int,
        now: Date = Date()
    ) -> InboxWidgetSnapshot {
        let newRows = EmailListPaging.inboxSections(inboxRows, sectionFloor: nil).new
        let preview = EmailListPaging.inboxNewPreview(newRows, serverNewCount: serverNewCount, limit: maxThreads)
        let threads = preview.shown.map { email in
            Thread(
                id: email.id,
                senderName: email.displaySender,
                subject: email.subject.isEmpty ? "(no subject)" : email.subject,
                receivedAt: email.parsedDate ?? now
            )
        }
        return InboxWidgetSnapshot(
            mailboxId: mailbox.id,
            mailboxAddress: mailbox.email,
            newCount: preview.shown.count + preview.hiddenCount,
            replyLaterCount: max(0, replyLaterCount),
            threads: threads,
            updatedAt: now
        )
    }
}

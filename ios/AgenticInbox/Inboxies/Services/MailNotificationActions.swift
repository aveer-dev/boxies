import Foundation
import UserNotifications

/// Actions on a new-mail push (watch phase 1, AVE-141). The Worker tags pushes about
/// a real message with `aps.category = "INBOXIES_MAIL"` (AVE-140); iOS shows these
/// actions on the banner and mirrors them to a paired Apple Watch.
///
/// Archive, Mark read and Reply Later run in the background without unlocking.
/// Reply and Spam need an unlocked device (`.authenticationRequired`). No Trash.
enum MailNotificationAction: String, CaseIterable {
    case archive = "ARCHIVE"
    case markRead = "MARK_READ"
    case replyLater = "REPLY_LATER"
    case reply = "REPLY"
    case spam = "SPAM"
}

/// The message a push is about, from the custom APNs payload keys the Worker sends.
struct MailNotificationTarget: Equatable {
    let mailboxId: String
    let emailId: String
    let threadId: String?

    init(mailboxId: String, emailId: String, threadId: String? = nil) {
        self.mailboxId = mailboxId
        self.emailId = emailId
        self.threadId = threadId
    }

    init?(userInfo: [AnyHashable: Any]) {
        guard let mailboxId = userInfo["mailboxId"] as? String, !mailboxId.isEmpty,
              let emailId = userInfo["emailId"] as? String, !emailId.isEmpty else {
            return nil
        }
        let threadId = (userInfo["threadId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        self.init(mailboxId: mailboxId, emailId: emailId, threadId: threadId)
    }
}

/// What an action sends to the Worker. Pure, so the mapping is unit-tested.
enum MailNotificationRequest: Equatable {
    /// `POST .../emails/:id/move`
    case move(folderId: String, setSenderPreference: Bool)
    /// `PUT .../emails/:id { read: true }`
    case markRead
    /// `PUT .../emails/:id { reply_later: true, reply_later_remind_at }`
    case replyLater(remindAtISO: String)
    /// `POST .../emails/:id/quick-reply { text }`
    case quickReply(text: String)
}

enum MailNotificationActions {
    /// Must match `MAIL_NOTIFICATION_CATEGORY` in `workers/lib/apns.ts`.
    static let categoryIdentifier = "INBOXIES_MAIL"

    /// Fixed short replies for v1 (watch plan). iOS has no API to attach choices to a
    /// `UNTextInputNotificationAction`; the watch app (phase 2) offers these as
    /// suggestions. On a mirrored notification Apple Watch offers dictation and Scribble.
    static let cannedReplies = ["Thanks!", "Got it, will reply soon", "Can we talk later?", "👍"]

    static func category() -> UNNotificationCategory {
        let archive = UNNotificationAction(
            identifier: MailNotificationAction.archive.rawValue,
            title: "Archive",
            options: [],
            icon: UNNotificationActionIcon(systemImageName: "archivebox")
        )
        let markRead = UNNotificationAction(
            identifier: MailNotificationAction.markRead.rawValue,
            title: "Mark as read",
            options: [],
            icon: UNNotificationActionIcon(systemImageName: "envelope.open")
        )
        let replyLater = UNNotificationAction(
            identifier: MailNotificationAction.replyLater.rawValue,
            title: "Reply Later",
            options: [],
            icon: UNNotificationActionIcon(systemImageName: "clock")
        )
        let reply = UNTextInputNotificationAction(
            identifier: MailNotificationAction.reply.rawValue,
            title: "Reply",
            options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "arrowshape.turn.up.left"),
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Reply"
        )
        let spam = UNNotificationAction(
            identifier: MailNotificationAction.spam.rawValue,
            title: "Report spam",
            options: [.destructive, .authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "xmark.octagon")
        )
        return UNNotificationCategory(
            identifier: categoryIdentifier,
            actions: [reply, archive, markRead, replyLater, spam],
            intentIdentifiers: [],
            options: []
        )
    }

    /// Adds `INBOXIES_MAIL` without dropping categories registered elsewhere.
    static func register(on center: UNUserNotificationCenter = .current()) {
        center.getNotificationCategories { existing in
            var categories = existing.filter { $0.identifier != categoryIdentifier }
            categories.insert(category())
            center.setNotificationCategories(categories)
        }
    }

    /// Reply Later from a notification sets a reminder for tomorrow 09:00 local, the same
    /// "Tomorrow" preset as the in-app picker (AVE-86).
    static func request(
        for action: MailNotificationAction,
        replyText: String?,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> MailNotificationRequest? {
        switch action {
        case .archive:
            return .move(folderId: "archive", setSenderPreference: false)
        case .markRead:
            return .markRead
        case .replyLater:
            let remindAt = ReplyLaterReminder.date(for: .tomorrow, now: now, calendar: calendar)
            return .replyLater(remindAtISO: ReplyLaterReminder.isoString(remindAt))
        case .reply:
            let text = replyText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return text.isEmpty ? nil : .quickReply(text: text)
        case .spam:
            return .move(folderId: "spam", setSenderPreference: true)
        }
    }

    /// Runs a notification action against the Worker with the app's session. Never
    /// throws: with no session or on a failed call it logs and returns, so the caller
    /// can always finish the system's completion handler.
    static func handle(response: UNNotificationResponse) async {
        guard let action = MailNotificationAction(rawValue: response.actionIdentifier) else { return }
        let content = response.notification.request.content
        guard let target = MailNotificationTarget(userInfo: content.userInfo) else {
            print("[MailNotificationActions] \(action.rawValue): payload has no mailboxId/emailId")
            return
        }
        let replyText = (response as? UNTextInputNotificationResponse)?.userText
        guard let request = request(for: action, replyText: replyText) else { return }
        guard APIClient.shared.authToken?.isEmpty == false else {
            print("[MailNotificationActions] \(action.rawValue): no session, skipped")
            return
        }
        do {
            try await perform(request, on: target)
        } catch {
            print("[MailNotificationActions] \(action.rawValue) failed: \(error)")
        }
    }

    static func perform(_ request: MailNotificationRequest, on target: MailNotificationTarget) async throws {
        let api = APIClient.shared
        switch request {
        case .move(let folderId, let setSenderPreference):
            try await api.moveEmail(
                mailboxId: target.mailboxId,
                id: target.emailId,
                folderId: folderId,
                setSenderPreference: setSenderPreference
            )
        case .markRead:
            _ = try await api.markRead(mailboxId: target.mailboxId, id: target.emailId)
        case .replyLater(let iso):
            _ = try await api.updateEmail(
                mailboxId: target.mailboxId,
                id: target.emailId,
                replyLater: true,
                replyLaterRemindAt: .set(iso)
            )
        case .quickReply(let text):
            _ = try await api.quickReply(
                mailboxId: target.mailboxId,
                emailId: target.emailId,
                text: text,
                idempotencyKey: UUID().uuidString
            )
        }
    }
}

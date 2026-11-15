#if DEBUG
import Foundation

/// DEBUG launch arguments for the watch app, peers of the phone's `PreviewSupport.swift`
/// (no phone, no network; actions change local state only):
///
/// | Arg | Surface |
/// | --- | --- |
/// | `-previewWatchInbox` | Inbox with fixture conversations, two mailboxes (picker row) |
/// | `-previewWatchMessage` | The first conversation open in the message view |
/// | `-previewWatchReply` | Quick reply (dictation / Scribble + canned replies) |
/// | `-previewWatchConnect` | "Open Inboxies on your iPhone" connect screen |
struct WatchPreviewFixtures {
    enum Opened: Equatable {
        case none
        case message
        case reply
    }

    let mailboxes: [WatchMailbox]
    let emails: [WatchEmail]
    let connection: WatchStore.Connection
    let opened: Opened

    static func fromLaunchArguments(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> WatchPreviewFixtures? {
        if arguments.contains("-previewWatchConnect") {
            return WatchPreviewFixtures(
                mailboxes: [], emails: [],
                connection: .needsPhone("Open Inboxies on your iPhone, then tap Connect."),
                opened: .none
            )
        }
        let opened: Opened
        if arguments.contains("-previewWatchReply") {
            opened = .reply
        } else if arguments.contains("-previewWatchMessage") {
            opened = .message
        } else if arguments.contains("-previewWatchInbox") {
            opened = .none
        } else {
            return nil
        }
        return WatchPreviewFixtures(mailboxes: mailboxes, emails: emails(), connection: .connected, opened: opened)
    }

    static var current: WatchPreviewFixtures? { fromLaunchArguments() }

    private static let mailboxes = [
        WatchMailbox(id: "hello@ada.studio", email: "hello@ada.studio", name: "Ada Studio"),
        WatchMailbox(id: "ada@ada.studio", email: "ada@ada.studio", name: "Ada"),
    ]

    private static func emails(now: Date = Date()) -> [WatchEmail] {
        func ago(_ minutes: Double) -> String {
            ReplyLaterReminder.isoString(now.addingTimeInterval(-minutes * 60))
        }
        return [
            WatchEmail(
                id: "w1", threadId: "t1", subject: "Q3 planning: final numbers",
                sender: "maya@northwind.co", senderName: "Maya Chen", date: ago(4), read: false,
                replyLater: false,
                snippet: "Attached the last pass. Can you confirm the hiring line before Friday?",
                body: "<p>Hi Ada,</p><p>Attached the last pass of the Q3 plan. Revenue is up 12% on the draft; the only open item is the hiring line for design.</p><p>Can you confirm it before Friday? Then I'll send it to the board.</p><p>Thanks,<br>Maya</p>",
                threadCount: 3, threadUnreadCount: 1
            ),
            WatchEmail(
                id: "w2", threadId: "t2", subject: "Your table for Saturday",
                sender: "bookings@lafourchette.example", senderName: "Le Petit Four", date: ago(38), read: false,
                replyLater: false, snippet: "Table for 2 at 19:30 is confirmed. Reply to change the time.",
                body: "Table for 2 at 19:30 on Saturday is confirmed.\n\nReply to this email to change the time.",
                threadCount: 1, threadUnreadCount: 1
            ),
            WatchEmail(
                id: "w3", threadId: "t3", subject: "Re: Logo files",
                sender: "sam@brightline.design", senderName: "Sam Ortiz", date: ago(180), read: true,
                replyLater: true, snippet: "Here are the SVGs and the dark variant you asked for.",
                body: "Here are the SVGs and the dark variant you asked for. Shout if the spacing looks off on the watch icon.",
                threadCount: 2, threadUnreadCount: 0
            ),
            WatchEmail(
                id: "w4", threadId: "t4", subject: "Invoice INV-2041",
                sender: "billing@cloudhost.example", senderName: nil, date: ago(60 * 26), read: true,
                replyLater: false, snippet: "Your invoice for October is ready.",
                body: "Your invoice for October is ready. Total: $48.00.",
                threadCount: 1, threadUnreadCount: 0
            ),
        ]
    }
}
#endif

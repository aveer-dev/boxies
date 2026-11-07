import Foundation

/// Where a tap on the "Today's inbox" widget goes (AVE-149). Same URLs on Android (AVE-150):
/// - a card: `inboxies://thread?mailbox=<id>&thread=<threadId>`
/// - anywhere else: `inboxies://inbox?mailbox=<id>`
/// The app routes them through the same path a notification tap takes.
enum InboxWidgetLink: Equatable {
    case thread(mailboxId: String, threadId: String)
    case inbox(mailboxId: String?)

    var url: URL {
        var parts = URLComponents()
        parts.scheme = "inboxies"
        switch self {
        case let .thread(mailboxId, threadId):
            parts.host = "thread"
            parts.queryItems = [
                URLQueryItem(name: "mailbox", value: mailboxId),
                URLQueryItem(name: "thread", value: threadId),
            ]
        case let .inbox(mailboxId):
            parts.host = "inbox"
            if let mailboxId {
                parts.queryItems = [URLQueryItem(name: "mailbox", value: mailboxId)]
            }
        }
        return parts.url ?? URL(string: "inboxies://inbox")!
    }

    static func parse(_ url: URL) -> InboxWidgetLink? {
        guard url.scheme?.lowercased() == "inboxies",
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        func value(_ name: String) -> String? {
            parts.queryItems?.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        switch url.host?.lowercased() {
        case "thread":
            guard let mailbox = value("mailbox"), let thread = value("thread") else { return nil }
            return .thread(mailboxId: mailbox, threadId: thread)
        case "inbox":
            return .inbox(mailboxId: value("mailbox"))
        default:
            return nil
        }
    }
}

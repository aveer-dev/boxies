import AppIntents
import Foundation

/// The deck's › on the "Today's inbox" widget (AVE-149): brings the next New thread to
/// the front. Runs in the widget extension; WidgetKit reloads the timeline afterwards
/// and animates the cards between the two entries (stable `thread.id` identity).
/// Compiled into the app too, because the shared deck view builds the button.
struct ShowNextThreadIntent: AppIntent {
    static var title: LocalizedStringResource = "Show next email"
    static var description = IntentDescription("Brings the next New conversation to the front of the Today's inbox widget.")
    static var isDiscoverable = false

    @Parameter(title: "Mailbox")
    var mailboxId: String

    init() {}

    init(mailboxId: String) {
        self.mailboxId = mailboxId
    }

    func perform() async throws -> some IntentResult {
        if let store = InboxWidgetStore.shared {
            Self.advance(mailboxId: mailboxId, in: store)
        }
        return .result()
    }

    /// The intent's work, against any store (tests use a temporary one).
    @discardableResult
    static func advance(mailboxId: String, in store: InboxWidgetStore) -> Int? {
        store.advanceFront(mailboxId: mailboxId)
    }
}

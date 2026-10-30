import AppIntents
import WidgetKit

/// A mailbox in the widget's edit sheet. The list comes from the App Group (the app
/// mirrors the signed-in user's mailboxes there); the widget never calls the API.
struct MailboxEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Mailbox"
    static var defaultQuery = MailboxEntityQuery()

    let id: String
    let address: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(address)")
    }

    init(_ ref: InboxWidgetStore.MailboxRef) {
        id = ref.id
        address = ref.address
    }
}

struct MailboxEntityQuery: EntityQuery {
    func entities(for identifiers: [MailboxEntity.ID]) async throws -> [MailboxEntity] {
        let wanted = Set(identifiers)
        return (InboxWidgetStore.shared?.mailboxes() ?? [])
            .filter { wanted.contains($0.id) }
            .map(MailboxEntity.init)
    }

    func suggestedEntities() async throws -> [MailboxEntity] {
        (InboxWidgetStore.shared?.mailboxes() ?? []).map(MailboxEntity.init)
    }
}

/// The widget's configuration: which mailbox. Left empty, it follows the last active
/// mailbox in the app (AVE-90), so most people never open the edit sheet.
struct SelectMailboxIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Mailbox"
    static var description = IntentDescription("Choose which mailbox Today's inbox shows. Leave it empty to follow the mailbox you last used.")

    @Parameter(title: "Mailbox")
    var mailbox: MailboxEntity?

    init() {}

    /// The mailbox to draw: the picked one while it still exists, else the app's active
    /// mailbox, else the first one the app published.
    func resolvedMailboxId(in store: InboxWidgetStore?) -> String? {
        let known = store?.mailboxes() ?? []
        if let picked = mailbox?.id, known.isEmpty || known.contains(where: { $0.id == picked }) {
            return picked
        }
        return SharedSession.activeMailboxId ?? known.first?.id
    }
}

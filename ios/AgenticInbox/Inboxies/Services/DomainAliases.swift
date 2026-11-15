import Foundation

/// Domain aliases (AVE-219): `sales@domain` delivers into one of the domain's mailboxes.
/// Admin-only, managed from Domain Admin → Aliases. Worker routes:
/// `GET|POST /api/v1/admin/domains/:domain/aliases`, `DELETE …/aliases/:aliasLocal`
/// (`workers/routes/domain-dns.ts`). Same rules and copy as Android `DomainAliases`.
enum DomainAliases {
    static let sectionTitle = "Aliases"
    static let addTitle = "Add alias"
    static let emptyMessage = "No aliases yet. An alias like sales@ delivers into one of this domain's mailboxes."
    static let invalidLocal = "Use only letters, numbers, dots, dashes and underscores."
    static let forbiddenTarget = "Aliases can only deliver to mailboxes on this domain or ones you can access."
    static let addFailed = "Couldn't add the alias. Try again."
    static let deleteFailed = "Couldn't delete the alias. Try again."
    static let loadFailed = "Couldn't load aliases."
    static let noTargets = "Create a mailbox on this domain first."

    static func path(domain: String) -> String {
        "/api/v1/admin/domains/\(domain.urlPathEncoded)/aliases"
    }

    static func deletePath(domain: String, aliasLocal: String) -> String {
        "\(path(domain: domain))/\(aliasLocal.urlPathEncoded)"
    }

    /// Camel-case keys, the shape the Worker reads.
    static func createBody(aliasLocal: String, targetMailboxId: String) -> [String: String] {
        ["aliasLocal": aliasLocal, "targetMailboxId": targetMailboxId]
    }

    /// What the Worker stores: trimmed, lowercased, no leading `@`, nothing after an `@`.
    static func normalizedLocal(_ input: String) -> String {
        var local = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while local.hasPrefix("@") { local.removeFirst() }
        if let at = local.firstIndex(of: "@") { local = String(local[..<at]) }
        return local
    }

    /// The Worker's `^[a-zA-Z0-9._-]+$` check.
    static func isValidLocal(_ local: String) -> Bool {
        !local.isEmpty && local.range(of: "^[a-z0-9._-]+$", options: .regularExpression) != nil
    }

    /// Mailboxes an alias may deliver to: the domain's own, else every listed one.
    static func targets(_ rows: [AdminMailboxRow], domain: String) -> [AdminMailboxRow] {
        let suffix = "@\(domain.lowercased())"
        let onDomain = rows.filter { $0.email.lowercased().hasSuffix(suffix) }
        return onDomain.isEmpty ? rows : onDomain
    }

    static func sorted(_ aliases: [DomainAliasItem]) -> [DomainAliasItem] {
        aliases.sorted { $0.aliasLocal < $1.aliasLocal }
    }

    /// Checked before the request: the Worker would 409 on a mailbox and silently
    /// re-point an existing alias, so both are caught here.
    static func conflict(
        local: String,
        domain: String,
        aliases: [DomainAliasItem],
        mailboxes: [AdminMailboxRow]
    ) -> String? {
        let email = "\(local)@\(domain.lowercased())"
        if aliases.contains(where: { $0.aliasLocal.lowercased() == local }) {
            return "\(email) is already an alias"
        }
        if mailboxes.contains(where: { $0.email.lowercased() == email }) {
            return "\(email) is already a mailbox"
        }
        return nil
    }

    /// Toast copy for a failed add: the Worker's sentence when it sent one.
    static func addErrorMessage(status: Int?, serverMessage: String?) -> String {
        let server = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case 400:
            // "Invalid alias local part" reads better as the rule it broke.
            return server.isEmpty || server == "Invalid alias local part" ? invalidLocal : server
        case 403:
            return server.isEmpty ? forbiddenTarget : server
        default:
            // 409 carries "x@domain is already a mailbox" / "in use by a private email".
            return server.isEmpty ? addFailed : server
        }
    }

    static func addErrorMessage(for error: Error) -> String {
        switch error {
        case APIError.http(let status, let message):
            return addErrorMessage(status: status, serverMessage: message)
        case APIError.serviceEnded(_, let message):
            return addErrorMessage(status: 403, serverMessage: message)
        default:
            return addFailed
        }
    }

    static func deleteErrorMessage(for error: Error) -> String {
        switch error {
        case APIError.http(_, let message) where !message.isEmpty:
            return message
        case APIError.serviceEnded(_, let message) where !message.isEmpty:
            return message
        default:
            return deleteFailed
        }
    }

    static func deleteConfirmMessage(_ alias: DomainAliasItem) -> String {
        "Mail sent to \(alias.aliasEmail) will stop reaching \(alias.targetMailboxId)."
    }
}

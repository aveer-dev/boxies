import Foundation

struct Mailbox: Identifiable, Codable, Hashable {
    let id: String
    let email: String
    let name: String
    var settings: MailboxSettings?
    var canManage: Bool?
    /// `owner` or `member` for the signed-in user.
    var role: String?
    /// The domain's subscription ended: the mailbox can be read and exported, not changed.
    var readOnly: Bool?
    /// Billing state of the mailbox's domain (detail GET only; nil without Inboxies billing).
    var service: DomainService?

    var isReadOnly: Bool { readOnly == true }

    var domain: String {
        email.split(separator: "@").last.map { String($0).lowercased() } ?? ""
    }
}

extension Mailbox {
    private enum CodingKeys: String, CodingKey {
        case id, email, name, settings, canManage, role, readOnly, service
    }

    /// Lenient: older Workers omit `readOnly` / `service`, and a malformed service
    /// summary must never cost the user the mailbox.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = try c.decode(String.self, forKey: .email)
        name = try c.decode(String.self, forKey: .name)
        settings = try c.decodeIfPresent(MailboxSettings.self, forKey: .settings)
        canManage = try? c.decodeIfPresent(Bool.self, forKey: .canManage)
        role = try? c.decodeIfPresent(String.self, forKey: .role)
        readOnly = try? c.decodeIfPresent(Bool.self, forKey: .readOnly)
        service = try? c.decodeIfPresent(DomainService.self, forKey: .service)
    }
}

/// Where a paid domain's subscription stands: `GET /billing/domains/:domain/service`,
/// or the `service` summary on a mailbox. Every field decodes leniently.
struct DomainService: Codable, Hashable {
    var domain: String
    /// "active", "ending" (set to cancel, still running) or "ended" (read-only).
    var status: String
    var endsAt: String?
    var endedAt: String?
    /// Inboxies registered the domain, so it lapses unless renewed by `renewBy`.
    var registrarManaged: Bool
    var registrationExpiresAt: String?
    var renewBy: String?
    var daysLeftToRenew: Int?
    /// Renewing (or keeping an ending subscription) is possible right now.
    var canRenew: Bool
    /// Service endpoint only: the caller is an admin of the domain.
    var canManage: Bool?
    var billed: Bool?

    var isEnded: Bool { status == "ended" }
    var isEnding: Bool { status == "ending" }
    /// An admin can act on it now: renew an ended domain, or keep an ending one.
    var canAdminRenew: Bool { canManage == true && canRenew }

    var endsAtDate: Date? { Self.parseDate(endsAt) }
    var renewByDate: Date? { Self.parseDate(renewBy) }

    init(
        domain: String,
        status: String,
        endsAt: String? = nil,
        endedAt: String? = nil,
        registrarManaged: Bool = false,
        registrationExpiresAt: String? = nil,
        renewBy: String? = nil,
        daysLeftToRenew: Int? = nil,
        canRenew: Bool = false,
        canManage: Bool? = nil,
        billed: Bool? = nil
    ) {
        self.domain = domain
        self.status = status
        self.endsAt = endsAt
        self.endedAt = endedAt
        self.registrarManaged = registrarManaged
        self.registrationExpiresAt = registrationExpiresAt
        self.renewBy = renewBy
        self.daysLeftToRenew = daysLeftToRenew
        self.canRenew = canRenew
        self.canManage = canManage
        self.billed = billed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        domain = (try? c.decodeIfPresent(String.self, forKey: .domain)) ?? ""
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "active"
        endsAt = try? c.decodeIfPresent(String.self, forKey: .endsAt)
        endedAt = try? c.decodeIfPresent(String.self, forKey: .endedAt)
        registrarManaged = (try? c.decodeIfPresent(Bool.self, forKey: .registrarManaged)) ?? false
        registrationExpiresAt = try? c.decodeIfPresent(String.self, forKey: .registrationExpiresAt)
        renewBy = try? c.decodeIfPresent(String.self, forKey: .renewBy)
        daysLeftToRenew = try? c.decodeIfPresent(Int.self, forKey: .daysLeftToRenew)
        canRenew = (try? c.decodeIfPresent(Bool.self, forKey: .canRenew)) ?? false
        canManage = try? c.decodeIfPresent(Bool.self, forKey: .canManage)
        billed = try? c.decodeIfPresent(Bool.self, forKey: .billed)
    }

    static func parseDate(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    /// "Oct 14, 2026": end dates and renewal deadlines are day-precise.
    static func displayDate(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }
}

/// `POST /billing/domains/:domain/renew`: the scheduled cancellation was taken back
/// (`resumed`), a Checkout to pay (`checkoutUrl`), or a local-dev instant renewal.
struct DomainRenewResponse: Decodable {
    var resumed: Bool?
    var renewed: Bool?
    var mock: Bool?
    var checkoutUrl: String?
    var sessionId: String?
    var service: DomainService?

    private enum CodingKeys: String, CodingKey {
        case resumed, renewed, mock, checkoutUrl, sessionId, service
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        resumed = try? c.decodeIfPresent(Bool.self, forKey: .resumed)
        renewed = try? c.decodeIfPresent(Bool.self, forKey: .renewed)
        mock = try? c.decodeIfPresent(Bool.self, forKey: .mock)
        checkoutUrl = try? c.decodeIfPresent(String.self, forKey: .checkoutUrl)
        sessionId = try? c.decodeIfPresent(String.self, forKey: .sessionId)
        service = try? c.decodeIfPresent(DomainService.self, forKey: .service)
    }
}

struct MailboxSettings: Codable, Hashable {
    var fromName: String?
    var agentSystemPrompt: String?
    var forwarding: ForwardingSettings?
    var signature: SignatureSettings?
    var autoReply: AutoReplySettings?
    var filters: [InboxFilterRule]?
    var acl: MailboxAcl?
}

/// Read-only: the server derives it from mailbox members. Sharing changes go
/// through members and invites, never through mailbox settings.
struct MailboxAcl: Codable, Hashable {
    var owners: [String]?
    var members: [String]?
}

struct MailboxMember: Codable, Identifiable, Hashable {
    var userId: String
    var email: String
    var name: String?
    var role: String
    var you: Bool?

    var id: String { userId }
    var isOwner: Bool { role == "owner" }
}

struct MailboxInviteRow: Codable, Identifiable, Hashable {
    var id: String
    var mailboxId: String
    var role: String
    var inviteeEmail: String
    var inviteeName: String?
    var expiresAt: String
    var status: String
    var createdAt: String?
}

struct RecoveryEmailStatus: Codable, Hashable {
    var email: String?
    var verified: Bool
    var devCode: String?
}

struct AccountSession: Codable, Identifiable, Hashable {
    var id: String
    var label: String?
    var scope: String?
    var userAgent: String?
    var ipAddress: String?
    var createdAt: String
    var lastActiveAt: String
    var expiresAt: String
    var current: Bool
}

/// An app connected over MCP OAuth (Account → Devices & sessions → Connected apps).
struct McpGrant: Codable, Identifiable, Hashable {
    var id: String
    var clientId: String
    /// Self-registered and unverified; nil when the app gave none.
    var clientName: String?
    var clientUri: String?
    var scopes: [String]
    /// Mailboxes the app is limited to; nil means every mailbox.
    var mailboxIds: [String]?
    var createdAt: String
    var expiresAt: String?
}

struct RevokeSessionsResponse: Codable {
    var ok: Bool
    var revoked: Int?
}

/// A scoped session (private emails only) for the AutoFill extension.
struct ScopedSessionResponse: Codable {
    var id: String
    var token: String
    var expiresAt: String
    var label: String?
}

struct MeResponse: Codable {
    var userId: String?
    var name: String?
    var email: String?
    var sub: String?
    var linkedEmails: [String]?
    var keys: [String]?
    var isAdmin: Bool?
    var administeredDomains: [String]?
    var mailDomain: String?
    var domains: [String]?
    /// TOTP two-factor is on. It only challenges password sign-in.
    var twoFactorEnabled: Bool?
}

struct LinkedIdentity: Codable, Identifiable, Hashable {
    var type: String
    var key: String
    var label: String
    var current: Bool

    var id: String { key }
}

struct IdentitiesResponse: Codable {
    var accountId: String
    var identities: [LinkedIdentity]
    var keys: [String]?
    var linkedEmails: [String]?
}

struct AttachIdentityResponse: Codable {
    var ok: Bool
    var provider: String?
    var accountId: String?
    var userId: String?
    var linkedEmails: [String]?
    var keys: [String]?
    var isAdmin: Bool
    var identities: [LinkedIdentity]?
}

struct ChangePasswordResponse: Codable {
    var ok: Bool
    var userId: String?
    var accountId: String?
    var identities: [LinkedIdentity]?
}

struct AppConfigResponse: Codable {
    var mailDomain: String
    var domains: [String]
    var emailAddresses: [String]?
    var googleClientId: String?
    var appleSignInConfigured: Bool?
}

struct InboxFilterRule: Codable, Hashable, Identifiable {
    var id: String
    var enabled: Bool?
    var name: String?
    var from: String?
    var list: String?
    var subject: String?
    /// Only mail delivered via this private email (lowercased address).
    var toAlias: String? = nil
    var folderId: String?
    var skipAutoDraft: Bool?
    var forwardTo: String?
}

struct SenderPreference: Codable, Hashable, Identifiable {
    var address: String
    var folderId: String
    var displayName: String?
    var source: String?
    var updatedAt: String?

    var id: String { address }
}

struct SenderPreferencesResponse: Codable {
    var preferences: [SenderPreference]
}

struct UpsertSenderPreferenceResponse: Codable {
    var preference: SenderPreference
    var refiledCount: Int
}

struct ForwardingSettings: Codable, Hashable {
    var enabled: Bool?
    var email: String?
}

struct SignatureSettings: Codable, Hashable {
    var enabled: Bool?
    var text: String?
    var html: String?
}

struct AutoReplySettings: Codable, Hashable {
    var enabled: Bool?
    var subject: String?
    var message: String?
}

struct Folder: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let unreadCount: Int
}

struct Attachment: Identifiable, Codable, Hashable {
    let id: String
    var filename: String
    var mimetype: String
    var size: Int
    var contentId: String?
    var disposition: String?

    enum CodingKeys: String, CodingKey {
        case id, filename, mimetype, size, disposition
        case contentId = "content_id"
    }

    var isInline: Bool {
        (disposition ?? "").lowercased() == "inline"
    }

    /// Content-ID without surrounding angle brackets (`<image001@local>` → `image001@local`).
    var normalizedContentId: String? {
        guard var value = contentId?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        if value.hasPrefix("<"), value.hasSuffix(">"), value.count >= 2 {
            value = String(value.dropFirst().dropLast())
        }
        return value
    }
}

/// A From/To/Cc/Bcc mailbox: optional display name plus address.
struct MailAddress: Hashable, Identifiable {
    let name: String?
    let email: String

    var id: String { email.lowercased() }

    var resolvedName: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if let at = address.firstIndex(of: "@"), at != address.startIndex {
            return String(address[..<at])
        }
        return address
    }

    func label(selfAddress: String?) -> String {
        if let selfAddress, !selfAddress.isEmpty,
           email.caseInsensitiveCompare(selfAddress) == .orderedSame {
            return "me"
        }
        return resolvedName
    }

    /// Compose token title: name when present, otherwise the email address.
    var tokenLabel: String {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty { return trimmed }
        return email
    }

    /// Query used when searching mail for this person (`from:` operator).
    var searchQuery: String {
        "from:\(email)"
    }

    static func parseList(_ raw: String?) -> [MailAddress] {
        guard let raw, !raw.isEmpty else { return [] }
        return splitList(raw).compactMap(parse)
    }

    static func parse(_ value: String) -> MailAddress? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let lt = trimmed.lastIndex(of: "<"),
           let gt = trimmed.lastIndex(of: ">"),
           lt < gt {
            let email = String(trimmed[trimmed.index(after: lt)..<gt])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !email.isEmpty else { return nil }
            var name = String(trimmed[..<lt]).trimmingCharacters(in: .whitespacesAndNewlines)
            if name.hasPrefix("\""), name.hasSuffix("\""), name.count >= 2 {
                name = String(name.dropFirst().dropLast()).replacingOccurrences(of: "\\\"", with: "\"")
            }
            let resolved: String? = {
                if name.isEmpty || (name.contains("@") && !name.contains(" ")) { return nil }
                return name
            }()
            return MailAddress(name: resolved, email: email)
        }

        return MailAddress(name: nil, email: trimmed)
    }

    /// Split on commas/semicolons while keeping `"Last, First" <addr>` intact.
    static func splitList(_ raw: String) -> [String] {
        var parts: [String] = []
        var current = ""
        var angleDepth = 0
        var inQuotes = false

        for character in raw {
            if character == "\"" {
                inQuotes.toggle()
                current.append(character)
                continue
            }
            if !inQuotes {
                if character == "<" {
                    angleDepth += 1
                } else if character == ">" {
                    angleDepth = max(0, angleDepth - 1)
                } else if (character == "," || character == ";"), angleDepth == 0 {
                    let part = current.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !part.isEmpty { parts.append(part) }
                    current = ""
                    continue
                }
            }
            current.append(character)
        }

        let part = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !part.isEmpty { parts.append(part) }
        return parts
    }
}

struct EmailAuth: Codable, Hashable {
    var spf: String?
    var dkim: String?
    var dmarc: String?
    var dkimDomain: String?
    var spfMailfrom: String?
    var headerFrom: String?
    var envelopeFrom: String?
    var aligned: Bool?
    var spoofed: Bool?
    var source: String?

    var isSpoofed: Bool { spoofed == true }
}

struct Email: Identifiable, Codable, Hashable {
    let id: String
    var threadId: String?
    var folderId: String?
    var subject: String
    var sender: String
    var senderName: String? = nil
    var recipient: String
    var cc: String?
    var bcc: String?
    var date: String
    var read: Bool
    var starred: Bool
    var replyLater: Bool = false
    var replyLaterAt: String? = nil
    var body: String?
    var snippet: String?
    var inReplyTo: String?
    var messageId: String?
    var rawHeaders: String?
    var threadCount: Int?
    var threadUnreadCount: Int?
    var participants: String?
    var folderName: String?
    var hasDraft: Bool?
    var needsReply: Bool?
    var hasAttachment: Bool? = nil
    var attachments: [Attachment]?
    var auth: EmailAuth? = nil
    var providerMessageId: String? = nil
    var deliveryStatus: String? = nil
    var deliveryError: String? = nil
    /// Inbox New vs Seen (`new` | `seen`); derived from read state when absent.
    var listSection: String? = nil
    var aliasId: String? = nil
    /// Private email this conversation came in on; replies go out from it.
    var aliasEmail: String? = nil
    /// False when that private email is paused, expired or deleted (detail payloads only).
    var aliasActive: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case id, subject, sender, recipient, cc, bcc, date, read, starred, body, snippet, participants, attachments, auth
        case senderName = "sender_name"
        case threadId = "thread_id"
        case folderId = "folder_id"
        case inReplyTo = "in_reply_to"
        case messageId = "message_id"
        case rawHeaders = "raw_headers"
        case threadCount = "thread_count"
        case threadUnreadCount = "thread_unread_count"
        case folderName = "folder_name"
        case hasDraft = "has_draft"
        case needsReply = "needs_reply"
        case hasAttachment = "has_attachment"
        case providerMessageId = "provider_message_id"
        case deliveryStatus = "delivery_status"
        case deliveryError = "delivery_error"
        case listSection = "list_section"
        case replyLater = "reply_later"
        case replyLaterAt = "reply_later_at"
        case aliasId = "alias_id"
        case aliasEmail = "alias_email"
        case aliasActive = "alias_active"
    }

    /// Header rows for View Source, matching web `getSourceHeaders`.
    var sourceHeaders: [(key: String, value: String)] {
        if let rawHeaders, !rawHeaders.isEmpty,
           let data = rawHeaders.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) {
            if let array = json as? [[String: Any]] {
                let parsed = array.compactMap { entry -> (key: String, value: String)? in
                    let key = (entry["key"] as? String) ?? (entry["name"] as? String) ?? ""
                    let value = entry["value"].map { String(describing: $0) } ?? ""
                    guard !key.isEmpty || !value.isEmpty else { return nil }
                    return (key, value)
                }
                if !parsed.isEmpty { return parsed }
            } else if let object = json as? [String: Any] {
                return object.map { (key: $0.key, value: String(describing: $0.value)) }
                    .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
            }
        }

        var headers: [(key: String, value: String)] = []
        if !sender.isEmpty { headers.append(("From", sender)) }
        if !recipient.isEmpty { headers.append(("To", recipient)) }
        if let cc, !cc.isEmpty { headers.append(("Cc", cc)) }
        if let bcc, !bcc.isEmpty { headers.append(("Bcc", bcc)) }
        if !subject.isEmpty { headers.append(("Subject", subject)) }
        if !date.isEmpty { headers.append(("Date", date)) }
        if let messageId, !messageId.isEmpty { headers.append(("Message-ID", messageId)) }
        if let inReplyTo, !inReplyTo.isEmpty { headers.append(("In-Reply-To", inReplyTo)) }
        if let threadId, !threadId.isEmpty { headers.append(("X-Thread-ID", threadId)) }
        return headers
    }

    var displaySender: String {
        if let participants, !participants.isEmpty {
            let separator: Character = participants.contains("\u{001f}") ? "\u{001f}" : ","
            let names = participants
                .split(separator: separator)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .map { Self.displayLabel(for: $0) }
            let unique = Array(NSOrderedSet(array: names)) as? [String] ?? names
            if unique.isEmpty { return resolvedSenderName }
            if unique.count <= 3 { return unique.joined(separator: ", ") }
            return "\(unique.prefix(2).joined(separator: ", ")) +\(unique.count - 2)"
        }
        return resolvedSenderName
    }

    /// Name plus address for quoted/forward headers.
    var formattedFrom: String {
        let name = resolvedSenderName
        if name != sender, !sender.isEmpty {
            return "\(name) <\(sender)>"
        }
        return sender
    }

    var fromAddress: MailAddress {
        MailAddress(name: storedOrParsedFromName, email: sender)
    }

    var toAddresses: [MailAddress] {
        addresses(from: recipient, headerKeys: ["to"])
    }

    var ccAddresses: [MailAddress] {
        addresses(from: cc, headerKeys: ["cc"])
    }

    var bccAddresses: [MailAddress] {
        addresses(from: bcc, headerKeys: ["bcc"])
    }

    /// One-line To/Cc names for the collapsed message header.
    func recipientSummary(selfAddress: String?) -> String {
        var seen = Set<String>()
        var labels: [String] = []
        for address in toAddresses + ccAddresses {
            let key = address.email.lowercased()
            guard !key.isEmpty, seen.insert(key).inserted else { continue }
            labels.append(address.label(selfAddress: selfAddress))
        }
        return labels.joined(separator: ", ")
    }

    private var resolvedSenderName: String {
        fromAddress.resolvedName
    }

    private var storedOrParsedFromName: String? {
        if let senderName, !senderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           senderName.contains("@") == false || senderName.contains(" ") {
            return senderName.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return Self.senderName(fromRawHeaders: rawHeaders)
    }

    private func addresses(from field: String?, headerKeys: [String]) -> [MailAddress] {
        let parsedField = MailAddress.parseList(field)
        let parsedHeaders = MailAddress.parseList(
            Self.headerValue(fromRawHeaders: rawHeaders, keys: Set(headerKeys))
        )
        let names = Dictionary(
            parsedHeaders.compactMap { address -> (String, String)? in
                guard let name = address.name, !name.isEmpty else { return nil }
                return (address.email.lowercased(), name)
            },
            uniquingKeysWith: { first, _ in first }
        )
        let source = parsedField.isEmpty ? parsedHeaders : parsedField
        return source.map { address in
            if address.name != nil { return address }
            if let name = names[address.email.lowercased()] {
                return MailAddress(name: name, email: address.email)
            }
            return address
        }
    }

    private static func headerValue(fromRawHeaders rawHeaders: String?, keys: Set<String>) -> String? {
        guard let rawHeaders, !rawHeaders.isEmpty,
              let data = rawHeaders.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else { return nil }

        func matches(_ key: String) -> Bool {
            keys.contains(key.lowercased())
        }

        if let array = json as? [[String: Any]] {
            let values = array.compactMap { entry -> String? in
                let key = ((entry["key"] as? String) ?? (entry["name"] as? String) ?? "")
                guard matches(key) else { return nil }
                return entry["value"].map { String(describing: $0) }
            }.filter { !$0.isEmpty }
            return values.isEmpty ? nil : values.joined(separator: ", ")
        }

        if let object = json as? [String: Any] {
            let values = object.compactMap { key, value -> String? in
                guard matches(key) else { return nil }
                return String(describing: value)
            }.filter { !$0.isEmpty }
            return values.isEmpty ? nil : values.joined(separator: ", ")
        }

        return nil
    }

    private static func displayLabel(for value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("@"), !trimmed.contains(" ") {
            return trimmed.split(separator: "@").first.map(String.init) ?? trimmed
        }
        return trimmed
    }

    private static func senderName(fromRawHeaders rawHeaders: String?) -> String? {
        guard let fromValue = headerValue(fromRawHeaders: rawHeaders, keys: ["from"]) else { return nil }
        return parseFromDisplayName(fromValue)
    }

    private static func parseFromDisplayName(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let lt = trimmed.lastIndex(of: "<"), let gt = trimmed.lastIndex(of: ">"), lt < gt {
            var name = String(trimmed[..<lt]).trimmingCharacters(in: .whitespacesAndNewlines)
            if name.hasPrefix("\""), name.hasSuffix("\""), name.count >= 2 {
                name = String(name.dropFirst().dropLast()).replacingOccurrences(of: "\\\"", with: "\"")
            }
            if name.isEmpty || (name.contains("@") && !name.contains(" ")) { return nil }
            return name
        }

        if trimmed.contains("@"), !trimmed.contains(" ") { return nil }
        return trimmed
    }

    var isUnread: Bool {
        if isDraft { return false }
        if let threadUnreadCount, threadUnreadCount > 0 { return true }
        return !read
    }

    /// Resolved New vs Seen membership for inbox list IA.
    var resolvedListSection: String {
        if let listSection, listSection == "new" || listSection == "seen" {
            return listSection
        }
        return isUnread ? "new" : "seen"
    }

    var isDraft: Bool {
        folderId == "draft" || folderName?.lowercased() == "drafts" || folderName?.lowercased() == "draft"
    }

    var isSpoofed: Bool { auth?.isSpoofed == true }

    var isDeliveryFailure: Bool { DeliveryStatusHelpers.isFailure(deliveryStatus) }

    var deliveryStatusLabel: String? {
        guard isDeliveryFailure else { return nil }
        return DeliveryStatusHelpers.label(for: deliveryStatus)
    }

    var nonInlineAttachments: [Attachment] {
        (attachments ?? []).filter { !$0.isInline }
    }

    /// List rows use `has_attachment` (thread-wide). Detail rows use the files on this message.
    var hasFileAttachment: Bool {
        if !nonInlineAttachments.isEmpty { return true }
        return hasAttachment == true
    }

    var bodyLooksLikeHTML: Bool {
        guard let body else { return false }
        return body.range(of: #"</?[a-zA-Z][^>]*>"#, options: .regularExpression) != nil
    }

    /// Plain-text list preview. Mirrors web `getSnippetText`: snippets are
    /// a raw body prefix, so HTML (especially sent mail) must be stripped.
    var previewText: String {
        let source = (snippet?.isEmpty == false ? snippet : nil) ?? body
        return Self.snippetText(source)
    }

    static func snippetText(_ snippet: String?, maxLength: Int = 100) -> String {
        guard var text = snippet, !text.isEmpty else { return "" }

        let regex: String.CompareOptions = [.regularExpression, .caseInsensitive]
        text = text.replacingOccurrences(of: #"<style[^>]*>[\s\S]*?</style>"#, with: "", options: regex)
        text = text.replacingOccurrences(of: #"<style[^>]*>[\s\S]*"#, with: "", options: regex)
        text = text.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"<[^>]*$"#, with: "", options: .regularExpression)
        text = decodeHTMLEntities(text)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if text.isEmpty { return "" }
        if text.count > maxLength {
            return String(text.prefix(maxLength)) + "..."
        }
        return text
    }

    private static func decodeHTMLEntities(_ text: String) -> String {
        var result = text
        if let regex = try? NSRegularExpression(pattern: #"&#(x?)([0-9a-fA-F]+);"#, options: .caseInsensitive) {
            let nsRange = NSRange(result.startIndex..<result.endIndex, in: result)
            let matches = regex.matches(in: result, range: nsRange)
            for match in matches.reversed() {
                guard let full = Range(match.range, in: result),
                      let hexFlag = Range(match.range(at: 1), in: result),
                      let valueRange = Range(match.range(at: 2), in: result) else { continue }
                let raw = String(result[valueRange])
                let parsed = result[hexFlag].isEmpty ? Int(raw) : Int(raw, radix: 16)
                guard let parsed, let code = UInt32(exactly: parsed), let scalar = UnicodeScalar(code) else { continue }
                result.replaceSubrange(full, with: String(Character(scalar)))
            }
        }
        let named = [
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&#39;": "'",
            "&apos;": "'",
            "&nbsp;": " ",
        ]
        for (entity, replacement) in named {
            result = result.replacingOccurrences(of: entity, with: replacement)
        }
        return result
    }

    var parsedDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = formatter.date(from: date) { return d }
        let fallback = ISO8601DateFormatter()
        return fallback.date(from: date)
    }
}

extension Email {
    /// Lenient decode: list, detail, cache and SSE `new_email` payloads do not all
    /// carry every column (older Workers omit `reply_later`), and SQLite booleans
    /// can arrive as 0/1. Lives in an extension so the memberwise init survives.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        threadId = try c.decodeIfPresent(String.self, forKey: .threadId)
        folderId = try c.decodeIfPresent(String.self, forKey: .folderId)
        subject = try c.decodeIfPresent(String.self, forKey: .subject) ?? ""
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? ""
        senderName = try c.decodeIfPresent(String.self, forKey: .senderName)
        recipient = try c.decodeIfPresent(String.self, forKey: .recipient) ?? ""
        cc = try c.decodeIfPresent(String.self, forKey: .cc)
        bcc = try c.decodeIfPresent(String.self, forKey: .bcc)
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        read = c.decodeLenientBool(forKey: .read) ?? false
        starred = c.decodeLenientBool(forKey: .starred) ?? false
        replyLater = c.decodeLenientBool(forKey: .replyLater) ?? false
        replyLaterAt = try c.decodeIfPresent(String.self, forKey: .replyLaterAt)
        body = try c.decodeIfPresent(String.self, forKey: .body)
        snippet = try c.decodeIfPresent(String.self, forKey: .snippet)
        inReplyTo = try c.decodeIfPresent(String.self, forKey: .inReplyTo)
        messageId = try c.decodeIfPresent(String.self, forKey: .messageId)
        rawHeaders = try c.decodeIfPresent(String.self, forKey: .rawHeaders)
        threadCount = try c.decodeIfPresent(Int.self, forKey: .threadCount)
        threadUnreadCount = try c.decodeIfPresent(Int.self, forKey: .threadUnreadCount)
        participants = try c.decodeIfPresent(String.self, forKey: .participants)
        folderName = try c.decodeIfPresent(String.self, forKey: .folderName)
        hasDraft = c.decodeLenientBool(forKey: .hasDraft)
        needsReply = c.decodeLenientBool(forKey: .needsReply)
        hasAttachment = c.decodeLenientBool(forKey: .hasAttachment)
        attachments = try c.decodeIfPresent([Attachment].self, forKey: .attachments)
        auth = try? c.decodeIfPresent(EmailAuth.self, forKey: .auth)
        providerMessageId = try c.decodeIfPresent(String.self, forKey: .providerMessageId)
        deliveryStatus = try c.decodeIfPresent(String.self, forKey: .deliveryStatus)
        deliveryError = try c.decodeIfPresent(String.self, forKey: .deliveryError)
        listSection = try c.decodeIfPresent(String.self, forKey: .listSection)
        aliasId = try c.decodeIfPresent(String.self, forKey: .aliasId)
    }
}

extension KeyedDecodingContainer {
    /// `true`/`false` or SQLite-style `0`/`1`; nil when absent, null, or another type.
    func decodeLenientBool(forKey key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        return nil
    }
}

enum EmailDateFilter: String, CaseIterable, Equatable, Hashable {
    case any = "Any time"
    case today = "Today"
    case lastThreeDays = "Last 3 days"
    case thisWeek = "This week"
}

struct EmailFilterState: Equatable {
    var unreadOnly: Bool = false
    var starredOnly: Bool = false
    var replyLaterOnly: Bool = false
    var toMeOnly: Bool = false
    var ccOrBccMeOnly: Bool = false
    var withAttachmentsOnly: Bool = false
    var dateFilter: EmailDateFilter = .any
    var needsReplyOnly: Bool = false

    var isActive: Bool {
        unreadOnly || starredOnly || replyLaterOnly || toMeOnly || ccOrBccMeOnly ||
        withAttachmentsOnly || dateFilter != .any || needsReplyOnly
    }

    var activeCount: Int {
        var count = 0
        if unreadOnly { count += 1 }
        if starredOnly { count += 1 }
        if replyLaterOnly { count += 1 }
        if toMeOnly { count += 1 }
        if ccOrBccMeOnly { count += 1 }
        if withAttachmentsOnly { count += 1 }
        if dateFilter != .any { count += 1 }
        if needsReplyOnly { count += 1 }
        return count
    }

    mutating func reset() {
        unreadOnly = false
        starredOnly = false
        replyLaterOnly = false
        toMeOnly = false
        ccOrBccMeOnly = false
        withAttachmentsOnly = false
        dateFilter = .any
        needsReplyOnly = false
    }

    func matches(_ email: Email, userEmail: String, calendar: Calendar = .current, now: Date = Date()) -> Bool {
        if unreadOnly && !email.isUnread {
            return false
        }
        if starredOnly && !email.starred {
            return false
        }
        if replyLaterOnly && !email.replyLater {
            return false
        }
        if withAttachmentsOnly && !email.hasFileAttachment {
            return false
        }
        if needsReplyOnly && email.needsReply != true {
            return false
        }

        let normalizedUser = userEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !normalizedUser.isEmpty {
            if toMeOnly {
                let inTo = email.toAddresses.contains { $0.email.lowercased() == normalizedUser }
                let inRecip = email.recipient.lowercased().contains(normalizedUser)
                if !inTo && !inRecip {
                    return false
                }
            }
            if ccOrBccMeOnly {
                let inCc = email.ccAddresses.contains { $0.email.lowercased() == normalizedUser }
                let inBcc = email.bccAddresses.contains { $0.email.lowercased() == normalizedUser }
                let inCcRaw = email.cc?.lowercased().contains(normalizedUser) ?? false
                let inBccRaw = email.bcc?.lowercased().contains(normalizedUser) ?? false
                if !inCc && !inBcc && !inCcRaw && !inBccRaw {
                    return false
                }
            }
        }

        if dateFilter != .any {
            guard let date = email.parsedDate else { return false }
            switch dateFilter {
            case .any:
                break
            case .today:
                if !calendar.isDateInToday(date) { return false }
            case .lastThreeDays:
                let threeDaysAgo = calendar.date(byAdding: .day, value: -3, to: now) ?? now
                let start = calendar.startOfDay(for: threeDaysAgo)
                if date < start { return false }
            case .thisWeek:
                if !calendar.isDate(date, equalTo: now, toGranularity: .weekOfYear) { return false }
            }
        }

        return true
    }

    func filter(_ list: [Email], userEmail: String) -> [Email] {
        guard isActive else { return list }
        let cal = Calendar.current
        let now = Date()
        return list.filter { matches($0, userEmail: userEmail, calendar: cal, now: now) }
    }
}

struct EmailListResponse: Codable {
    let emails: [Email]
    let totalCount: Int
    let newCount: Int?
    let seenCount: Int?
}

struct RecentRecipient: Codable, Hashable, Identifiable {
    let email: String
    let name: String?
    let lastEmailedAt: String?

    var id: String { email.lowercased() }

    var asMailAddress: MailAddress {
        MailAddress(name: name, email: email)
    }
}

struct RecentRecipientsResponse: Codable {
    let recipients: [RecentRecipient]
}

struct InboxDigest: Codable, Hashable {
    var greetingName: String
    var unreadCount: Int
    var todos: [InboxDigestTodo]
    var topics: [InboxDigestTopic]

    enum CodingKeys: String, CodingKey {
        case greetingName = "greeting_name"
        case unreadCount = "unread_count"
        case todos, topics
    }
}

struct InboxDigestTodo: Identifiable, Codable, Hashable {
    let id: String
    var emailId: String
    var threadId: String?
    var title: String
    var summary: String
    var date: String

    enum CodingKeys: String, CodingKey {
        case id, title, summary, date
        case emailId = "email_id"
        case threadId = "thread_id"
    }
}

struct InboxDigestTopic: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var emoji: String
    var caughtUp: Bool
    var remainingSummary: String?
    var items: [InboxDigestTopicItem]

    enum CodingKeys: String, CodingKey {
        case id, title, emoji, items
        case caughtUp = "caught_up"
        case remainingSummary = "remaining_summary"
    }
}

struct InboxDigestTopicItem: Identifiable, Codable, Hashable {
    var emailId: String
    var threadId: String?
    var subject: String
    var summary: String
    var date: String
    var unread: Bool
    var attachmentCount: Int

    var id: String { emailId }

    enum CodingKeys: String, CodingKey {
        case subject, summary, date, unread
        case emailId = "email_id"
        case threadId = "thread_id"
        case attachmentCount = "attachment_count"
    }
}

struct DigestStatusResponse: Codable {
    let status: String
    var count: Int?
}

struct SendEmailResponse: Codable {
    let id: String
    let status: String
}

struct DraftSaveResponse: Codable {
    let id: String?
    let draftId: String?
    let status: String?
    let subject: String?
    let recipient: String?
    let date: String?

    var resolvedId: String {
        id ?? draftId ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id
        case draftId = "draft_id"
        case status
        case subject
        case recipient
        case date
    }
}

struct AgentConversation: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var createdAt: String
    var updatedAt: String
    var lastMessagePreview: String?
}

/// Visible screen inside the AI chat sheet. Lives on `AppModel` so SwiftUI
/// remounting the sheet cannot mint a second conversation id.
enum ChatSession: Equatable {
    case dismissed
    case list
    case conversation(String)

    var conversationId: String? {
        if case .conversation(let id) = self { return id }
        return nil
    }

    static func newConversationId() -> String {
        UUID().uuidString.lowercased()
    }
}

struct ConversationDateGroup: Identifiable {
    let id: String
    let title: String
    let conversations: [AgentConversation]
}

extension AgentConversation {
    var parsedUpdatedAt: Date {
        if let d = AgentConversationDateHelpers.parseDate(updatedAt) { return d }
        if let d = AgentConversationDateHelpers.parseDate(createdAt) { return d }
        return .distantPast
    }
}

enum AgentConversationDateHelpers {
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoStandard: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let sqlFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f.timeZone = TimeZone(secondsFromGMT: 0)
        return f
    }()

    static func parseDate(_ string: String) -> Date? {
        if let d = isoFractional.date(from: string) { return d }
        if let d = isoStandard.date(from: string) { return d }
        return sqlFormat.date(from: string)
    }

    static func groupConversationsByDate(_ conversations: [AgentConversation]) -> [ConversationDateGroup] {
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let sevenDaysAgo = calendar.date(byAdding: .day, value: -7, to: startOfToday) ?? .distantPast
        let thirtyDaysAgo = calendar.date(byAdding: .day, value: -30, to: startOfToday) ?? .distantPast

        let sorted = conversations.sorted { $0.parsedUpdatedAt > $1.parsedUpdatedAt }

        var todayList: [AgentConversation] = []
        var yesterdayList: [AgentConversation] = []
        var prev7DaysList: [AgentConversation] = []
        var prev30DaysList: [AgentConversation] = []
        var monthGroups: [Int: (title: String, conversations: [AgentConversation])] = [:]

        let currentYear = calendar.component(.year, from: now)

        for conv in sorted {
            let date = conv.parsedUpdatedAt
            if calendar.isDateInToday(date) {
                todayList.append(conv)
            } else if calendar.isDateInYesterday(date) {
                yesterdayList.append(conv)
            } else if date >= sevenDaysAgo {
                prev7DaysList.append(conv)
            } else if date >= thirtyDaysAgo {
                prev30DaysList.append(conv)
            } else {
                let year = calendar.component(.year, from: date)
                let month = calendar.component(.month, from: date)
                let sortKey = year * 100 + month

                let monthFormatter = DateFormatter()
                if year == currentYear {
                    monthFormatter.dateFormat = "MMMM"
                } else {
                    monthFormatter.dateFormat = "MMMM yyyy"
                }
                let title = monthFormatter.string(from: date)

                if monthGroups[sortKey] == nil {
                    monthGroups[sortKey] = (title: title, conversations: [conv])
                } else {
                    monthGroups[sortKey]?.conversations.append(conv)
                }
            }
        }

        var groups: [ConversationDateGroup] = []

        if !todayList.isEmpty {
            groups.append(ConversationDateGroup(id: "today", title: "Today", conversations: todayList))
        }
        if !yesterdayList.isEmpty {
            groups.append(ConversationDateGroup(id: "yesterday", title: "Yesterday", conversations: yesterdayList))
        }
        if !prev7DaysList.isEmpty {
            groups.append(ConversationDateGroup(id: "prev7Days", title: "Previous 7 Days", conversations: prev7DaysList))
        }
        if !prev30DaysList.isEmpty {
            groups.append(ConversationDateGroup(id: "prev30Days", title: "Previous 30 Days", conversations: prev30DaysList))
        }

        let sortedMonthKeys = monthGroups.keys.sorted(by: >)
        for key in sortedMonthKeys {
            if let group = monthGroups[key] {
                groups.append(ConversationDateGroup(id: "month-\(key)", title: group.title, conversations: group.conversations))
            }
        }

        return groups
    }
}

struct AuthResponse: Codable {
    let token: String
    let expiresAt: String
    let user: AuthUser
}

struct AuthUser: Codable {
    let id: String
    let email: String?
}

struct ChatMessage: Identifiable, Hashable {
    let id: String
    let role: String
    var text: String
    var reasoning: String? = nil
    var reasoningDuration: TimeInterval? = nil
    var isToolAction: Bool = false
    var toolName: String? = nil
    var isError: Bool = false
    var timestamp: Date = Date()

    var reasoningDurationString: String? {
        guard let duration = reasoningDuration else { return nil }
        let secs = max(1, Int(round(duration)))
        return "\(secs)s"
    }
}

enum ComposeMode: String, Hashable {
    case new
    case reply
    case replyAll
    case forward
    case editDraft
}

enum ComposePresentation: Hashable {
    case expanded
    case minimized
}

struct InvitePublic: Codable {
    var mailboxId: String
    var role: String
    var inviteeEmail: String
    var inviteeName: String?
    var expiresAt: String
    var status: String
}

struct InviteAcceptResponse: Codable {
    var mailboxId: String
    var userId: String
    /// New accounts only; accepting while signed in keeps the current session.
    var token: String?
    var expiresAt: String?
    var email: String?
}

struct InviteCodeResponse: Codable {
    var ok: Bool
    var sentTo: String
    var devCode: String?
}

struct PasswordLoginResponse: Codable {
    var token: String
    var expiresAt: String
    var email: String?
    var sub: String?
    var keys: [String]?
}

/// `/api/v1/auth/password/reset`. With two-factor on, the reset answers with a
/// challenge instead of a session (a reset proves the recovery email, not the
/// second factor).
struct ResetPasswordResponse: Codable {
    var ok: Bool?
    var token: String?
    var expiresAt: String?
    var email: String?
    var twoFactorRequired: Bool?
    var twoFactorToken: String?
    var twoFactorMethods: [String]?

    var twoFactorChallenge: TwoFactorChallenge? {
        guard twoFactorRequired == true, let twoFactorToken, !twoFactorToken.isEmpty else { return nil }
        return TwoFactorChallenge(token: twoFactorToken, methods: twoFactorMethods ?? [], email: email)
    }
}

/// A password sign-in that still needs a second factor: an authenticator
/// (TOTP) code or a one-time backup code, sent with `token` to
/// `/api/v1/auth/two-factor/verify`. Good for one sign-in, 10 minutes, 5 codes.
struct TwoFactorChallenge: Equatable, Sendable {
    var token: String
    /// Server methods, e.g. `["totp", "backup_code"]`.
    var methods: [String]
    var email: String?

    /// The 401 `TWO_FACTOR_REQUIRED` body of `/api/v1/auth/password`.
    static func parse(_ data: Data) -> TwoFactorChallenge? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["twoFactorRequired"] as? Bool) == true,
              let token = obj["twoFactorToken"] as? String, !token.isEmpty else { return nil }
        let methods = (obj["twoFactorMethods"] as? [Any])?.compactMap { $0 as? String } ?? []
        return TwoFactorChallenge(token: token, methods: methods, email: nil)
    }
}

/// A passkey registered to the signed-in account (`/api/auth/passkey/list-user-passkeys`).
struct PasskeyRow: Codable, Identifiable, Hashable {
    var id: String
    var name: String?
    var createdAt: String?
    var deviceType: String?
    var backedUp: Bool?
}

struct ForgotPasswordResponse: Codable {
    var ok: Bool
    var message: String?
    var devResetCode: String?
    var devResetToken: String?
}

struct InviteCreateResponse: Codable {
    var token: String
    var inviteUrl: String
    var emailSent: Bool
    var emailError: String?
    var mailboxId: String
    var inviteeEmail: String
    var role: String
    var expiresAt: String
}

struct AdminMailboxRow: Codable, Identifiable {
    var id: String
    var email: String
    var name: String
    var acl: MailboxAcl?
    var claimed: Bool?
    var fromName: String?
}

struct AdminCreateMailboxInvite: Codable {
    var token: String?
    var inviteUrl: String?
    var emailSent: Bool?
    var emailError: String?
    var inviteeEmail: String?
    var role: String?
}

struct AdminCreateMailboxResponse: Codable {
    var id: String?
    var email: String?
    var name: String?
    var invite: AdminCreateMailboxInvite?
}

struct AdminDomainInfo: Codable, Identifiable, Hashable {
    var id: String { domain }
    var domain: String
    var zoneId: String
    var status: String
    var nameservers: [String]
    var createdAt: String?
    var updatedAt: String?
}

struct AdminDomainsResponse: Codable {
    var domains: [AdminDomainInfo]
}

struct EmailHealthItem: Codable, Identifiable, Hashable {
    var id: String { type + name }
    var name: String
    var type: String
    var status: String
    var expectedValue: String
    var currentValue: String?
    var message: String
}

struct EmailHealthAudit: Codable, Hashable {
    var overallStatus: String
    var zoneStatus: String
    var nameservers: [String]
    var items: [EmailHealthItem]
    var issues: [String]
}

struct DomainHealthResponse: Codable {
    var domain: String
    var zoneId: String
    var zoneStatus: String
    var nameservers: [String]
    var audit: EmailHealthAudit
}

struct FixEmailDnsResponse: Codable {
    var success: Bool
    var audit: EmailHealthAudit?
}

struct CloudflareDnsRecord: Codable, Identifiable, Hashable {
    var id: String
    var zone_id: String
    var zone_name: String
    var name: String
    var type: String
    var content: String
    var proxiable: Bool
    var proxied: Bool
    var ttl: Int
    var priority: Int?
    var comment: String?
}

struct DnsRecordsListResponse: Codable {
    var records: [CloudflareDnsRecord]
}

struct DnsRecordMutationResponse: Codable {
    var record: CloudflareDnsRecord
}

struct OnboardingPersonalResponse: Codable {
    var token: String
    var expiresAt: String
    var mailbox: OnboardingMailboxInfo
}

struct OnboardingMailboxInfo: Codable {
    var id: String
    var email: String
    var name: String
}

struct OnboardingDomainResponse: Codable {
    var token: String
    var expiresAt: String
    var mailbox: OnboardingMailboxInfo
    var domain: OnboardingDomainInfo
    var audit: EmailHealthAudit?
}

struct OnboardingDomainInfo: Codable {
    var domain: String
    var zoneId: String
    var status: String
    var nameservers: [String]
}

struct DomainPricingLineItem: Codable, Hashable {
    var name: String
    var description: String
    var amountUsd: Double
}

struct DomainPricingBreakdown: Codable, Hashable {
    var domainWholesaleUsd: Double
    var platformFeeUsd: Double
    var totalAnnualUsd: Double
    var currency: String
    var interval: String
    var lineItems: [DomainPricingLineItem]?

    enum CodingKeys: String, CodingKey {
        case domainWholesaleUsd, platformFeeUsd, totalAnnualUsd, currency, interval, lineItems
        case domainFeeUsd, billingInterval
    }

    /// The Worker sends both `domainWholesaleUsd`/`interval` and the newer
    /// `domainFeeUsd`/`billingInterval`; accept either.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let wholesale = try c.decodeIfPresent(Double.self, forKey: .domainWholesaleUsd)
            ?? c.decodeIfPresent(Double.self, forKey: .domainFeeUsd) else {
            throw DecodingError.keyNotFound(
                CodingKeys.domainWholesaleUsd,
                .init(codingPath: c.codingPath, debugDescription: "Missing domainWholesaleUsd / domainFeeUsd")
            )
        }
        domainWholesaleUsd = wholesale
        platformFeeUsd = try c.decode(Double.self, forKey: .platformFeeUsd)
        totalAnnualUsd = try c.decode(Double.self, forKey: .totalAnnualUsd)
        currency = try c.decodeIfPresent(String.self, forKey: .currency) ?? "USD"
        interval = try c.decodeIfPresent(String.self, forKey: .interval)
            ?? c.decodeIfPresent(String.self, forKey: .billingInterval)
            ?? "year"
        lineItems = try c.decodeIfPresent([DomainPricingLineItem].self, forKey: .lineItems)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(domainWholesaleUsd, forKey: .domainWholesaleUsd)
        try c.encode(platformFeeUsd, forKey: .platformFeeUsd)
        try c.encode(totalAnnualUsd, forKey: .totalAnnualUsd)
        try c.encode(currency, forKey: .currency)
        try c.encode(interval, forKey: .interval)
        try c.encodeIfPresent(lineItems, forKey: .lineItems)
    }
}

struct DomainAvailabilityResponse: Codable, Hashable {
    var domain: String
    var available: Bool
    var registered: Bool
    var wholesalePriceUsd: Double
    var retailPriceUsd: Double
    var currency: String
    var tldSupported: Bool
    var alreadyInInboxies: Bool?
    var message: String?
    var pricing: DomainPricingBreakdown?
}

struct DomainCheckoutResponse: Codable {
    var checkoutUrl: String
    var sessionId: String
    var domain: String
    var priceUsd: Double
    var mock: Bool?
    var pricing: DomainPricingBreakdown?
}

struct DomainAliasItem: Codable, Hashable, Identifiable {
    var id: String { aliasLocal }
    var aliasLocal: String
    var aliasEmail: String
    var targetMailboxId: String
    var createdAt: String
}

struct DomainAliasesResponse: Codable {
    var domain: String
    var aliases: [DomainAliasItem]
}

struct ExportJobProgress: Codable, Hashable {
    var processedCount: Int
    var totalCount: Int
    var percent: Int

    init(processedCount: Int, totalCount: Int, percent: Int) {
        self.processedCount = processedCount
        self.totalCount = totalCount
        self.percent = percent
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        processedCount = (try? c.decodeIfPresent(Int.self, forKey: .processedCount)) ?? 0
        totalCount = (try? c.decodeIfPresent(Int.self, forKey: .totalCount)) ?? 0
        // Percent may be fractional; clamp for ProgressView.
        let raw = (try? c.decodeIfPresent(Double.self, forKey: .percent)) ?? 0
        percent = min(100, max(0, Int(raw.rounded())))
    }
}

/// `GET /api/v1/exports/:id` and `POST …/export`. The Worker sends `id` plus a
/// legacy `exportId`, and `domain` or `mailboxId` depending on the target.
struct ExportJob: Codable, Identifiable, Hashable {
    var id: String
    var domain: String?
    var mailboxId: String?
    var status: String
    var progress: ExportJobProgress?
    var totalEmails: Int?
    var fileSizeBytes: Int64?
    var downloadUrl: String?
    var expiresAt: String?
    var createdAt: String?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case id, exportId, domain, mailboxId, status, progress, totalEmails, fileSizeBytes
        case downloadUrl, expiresAt, createdAt, error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let jobId = try c.decodeIfPresent(String.self, forKey: .id)
            ?? c.decodeIfPresent(String.self, forKey: .exportId) else {
            throw DecodingError.keyNotFound(
                CodingKeys.id,
                .init(codingPath: c.codingPath, debugDescription: "Missing id / exportId")
            )
        }
        id = jobId
        domain = try c.decodeIfPresent(String.self, forKey: .domain)
        mailboxId = try c.decodeIfPresent(String.self, forKey: .mailboxId)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "pending"
        progress = try? c.decodeIfPresent(ExportJobProgress.self, forKey: .progress)
        totalEmails = try? c.decodeIfPresent(Int.self, forKey: .totalEmails)
        fileSizeBytes = try? c.decodeIfPresent(Int64.self, forKey: .fileSizeBytes)
        downloadUrl = try c.decodeIfPresent(String.self, forKey: .downloadUrl)
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encodeIfPresent(domain, forKey: .domain)
        try c.encodeIfPresent(mailboxId, forKey: .mailboxId)
        try c.encode(status, forKey: .status)
        try c.encodeIfPresent(progress, forKey: .progress)
        try c.encodeIfPresent(totalEmails, forKey: .totalEmails)
        try c.encodeIfPresent(fileSizeBytes, forKey: .fileSizeBytes)
        try c.encodeIfPresent(downloadUrl, forKey: .downloadUrl)
        try c.encodeIfPresent(expiresAt, forKey: .expiresAt)
        try c.encodeIfPresent(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(error, forKey: .error)
    }
}

struct DecommissionLastExport: Codable, Hashable {
    var id: String
    var createdAt: String
    var downloadUrl: String?
    var totalEmails: Int
}

struct DecommissionPreflightResponse: Codable {
    var domain: String
    var status: String
    var activeMailboxCount: Int
    var activeMailboxes: [String]
    var hasRecentExport: Bool
    var lastExport: DecommissionLastExport?
    var isRegistrarDomain: Bool
    var transferLocked: Bool
}

struct DecommissionResponse: Codable {
    var success: Bool
    var domain: String
    var status: String
    var eppCode: String?
    var message: String
    /// When the domain's data is deleted unless finalized sooner (ISO 8601).
    var finalizeAfter: String?
}

/// Where a decommissioned domain's offboarding stands: the grace period and finalize-now.
struct DomainOffboardingState: Codable, Hashable {
    var decommissionedAt: String
    /// Scheduled deletion (ISO 8601).
    var finalizeAfter: String
    var graceDays: Int
    var warningSentAt: String?
    var finalizeRequestedAt: String?
    var finalizeStartedAt: String?
    var finalizedAt: String?
    var step: String?
    var lastError: String?
    var canFinalizeNow: Bool
    var scheduledFinalizeDue: Bool
}

struct OffboardingDomain: Codable, Hashable, Identifiable {
    var domain: String
    var offboarding: DomainOffboardingState
    var id: String { domain }
}

struct OffboardingDomainsResponse: Codable {
    var domains: [OffboardingDomain]
}

struct FinalizeDomainResponse: Codable {
    var success: Bool
    var domain: String
    var finalized: Bool
    /// "in_progress" or "will_retry" when it didn't finish now; the hourly run does.
    var status: String?
    var mailboxesPurged: Int?
    var subscriptionCanceled: Bool?
    var error: String?
}

/// Formats an ISO 8601 offboarding date as "October 20, 2026"; the raw string if it doesn't parse.
func formatOffboardingDate(_ iso: String) -> String {
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return iso }
    let out = DateFormatter()
    out.dateStyle = .long
    out.timeStyle = .none
    return out.string(from: date)
}

struct DomainEppCodeResponse: Codable {
    var domain: String
    var eppCode: String
}

struct DomainTransferLockResponse: Codable {
    var success: Bool?
    var domain: String
    var locked: Bool
}

/// `DELETE /api/v1/me` — account deletion result.
struct DeleteAccountResponse: Codable {
    var ok: Bool?
    var deletedMailboxes: [String]?
    var leftMailboxes: [String]?
}

struct AdminDomainConnectResponse: Codable {
    var domain: AdminDomainInfo
    var audit: EmailHealthAudit?
}

/// Private email: a random address on the mailbox's own domain that delivers
/// into the mailbox. Replies in its conversations go out from it.
struct MaskedAlias: Identifiable, Codable, Hashable {
    let id: String
    let aliasEmail: String
    var label: String?
    var isActive: Bool
    /// What inbound mail gets while paused: `drop` (silent) or `reject` (bounce).
    var pausedAction: String
    var expiresAt: String?
    var createdAt: String?
    var statsReceived: Int
    var statsBlocked: Int

    enum CodingKeys: String, CodingKey {
        case id, label
        case aliasEmail = "alias_email"
        case isActive = "is_active"
        case pausedAction = "paused_action"
        case expiresAt = "expires_at"
        case createdAt = "created_at"
        case statsReceived = "stats_received"
        case statsBlocked = "stats_blocked"
    }

    init(
        id: String,
        aliasEmail: String,
        label: String? = nil,
        isActive: Bool = true,
        pausedAction: String = "drop",
        expiresAt: String? = nil,
        createdAt: String? = nil,
        statsReceived: Int = 0,
        statsBlocked: Int = 0
    ) {
        self.id = id
        self.aliasEmail = aliasEmail
        self.label = label
        self.isActive = isActive
        self.pausedAction = pausedAction
        self.expiresAt = expiresAt
        self.createdAt = createdAt
        self.statsReceived = statsReceived
        self.statsBlocked = statsBlocked
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        aliasEmail = try container.decode(String.self, forKey: .aliasEmail)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        // SQLite rows send 0/1; tolerate a JSON bool too.
        if let boolVal = try? container.decode(Bool.self, forKey: .isActive) {
            isActive = boolVal
        } else if let intVal = try? container.decode(Int.self, forKey: .isActive) {
            isActive = intVal != 0
        } else {
            isActive = true
        }
        pausedAction = try container.decodeIfPresent(String.self, forKey: .pausedAction) ?? "drop"
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        statsReceived = (try? container.decodeIfPresent(Int.self, forKey: .statsReceived)) ?? 0
        statsBlocked = (try? container.decodeIfPresent(Int.self, forKey: .statsBlocked)) ?? 0
    }

    var expiryDate: Date? {
        guard let expiresAt, !expiresAt.isEmpty else { return nil }
        return Self.parseISODate(expiresAt)
    }

    /// Past its expiry: mail is refused and replies are blocked even if not paused.
    func isExpired(now: Date = Date()) -> Bool {
        guard let expiryDate else { return false }
        return expiryDate <= now
    }

    static func parseISODate(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}

/// Expiry edit for a private email; `.never` clears it (sent as JSON null).
enum AliasExpiry: Hashable {
    case never
    case at(Date)

    /// ISO 8601 UTC with `Z`, the shape the API's `datetime()` check accepts.
    var isoString: String? {
        guard case .at(let date) = self else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// JSON body value: the ISO string, or null to clear.
    var apiValue: Any {
        if let isoString { return isoString }
        return NSNull()
    }
}

struct AliasesResponse: Codable {
    var aliases: [MaskedAlias]
}

struct CreateAliasResponse: Codable {
    var alias: MaskedAlias
}



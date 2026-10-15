import Foundation

/// A private email as the AutoFill extension lists it (compiled into both targets).
struct PrivateEmail: Identifiable, Hashable, Decodable {
    let id: String
    let address: String
    let label: String?
    let isActive: Bool
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id, label
        case address = "alias_email"
        case isActive = "is_active"
        case expiresAt = "expires_at"
    }

    init(id: String, address: String, label: String? = nil, isActive: Bool = true, expiresAt: String? = nil) {
        self.id = id
        self.address = address
        self.label = label
        self.isActive = isActive
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        address = try container.decode(String.self, forKey: .address)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        // The API sends a bool; older rows may still send 0/1.
        if let flag = try? container.decode(Bool.self, forKey: .isActive) {
            isActive = flag
        } else if let number = try? container.decode(Int.self, forKey: .isActive) {
            isActive = number != 0
        } else {
            isActive = true
        }
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
    }

    /// Paused or expired addresses don't deliver, so AutoFill never offers them.
    func isUsable(now: Date = Date()) -> Bool {
        guard isActive else { return false }
        guard let expiresAt, !expiresAt.isEmpty else { return true }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        return expiry.map { $0 > now } ?? true
    }
}

/// Splits private emails into the ones that belong to the site being filled
/// and the rest. New addresses are labelled with the site's host, so the
/// label is the main signal; the site's name also matches free-form labels
/// ("Netflix") and the address itself.
struct PrivateEmailMatcher: Equatable {
    /// Registrable domain, e.g. `netflix.com` for `www.accounts.netflix.com`.
    let domain: String
    /// Site name, e.g. `netflix`.
    let name: String

    /// Two-letter country suffixes that sit under a short second level (`co.uk`, `com.au`).
    private static let shortSecondLevels: Set<String> = ["co", "com", "net", "org", "gov", "edu", "ac", "ne", "or"]

    init?(host: String?) {
        guard var host = host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !host.isEmpty else { return nil }
        if host.hasSuffix(".") { host.removeLast() }
        let labels = host.split(separator: ".").map(String.init).filter { !$0.isEmpty }
        guard let last = labels.last else { return nil }
        if labels.count == 1 {
            domain = last
            name = last
            return
        }
        let secondLevel = labels[labels.count - 2]
        if labels.count >= 3, last.count == 2, Self.shortSecondLevels.contains(secondLevel) {
            name = labels[labels.count - 3]
            domain = labels.suffix(3).joined(separator: ".")
        } else {
            name = secondLevel
            domain = labels.suffix(2).joined(separator: ".")
        }
    }

    func matches(_ email: PrivateEmail) -> Bool {
        if let label = email.label?.lowercased(), !label.isEmpty {
            if label.contains(domain) { return true }
            if name.count >= 3, label.contains(name) { return true }
        }
        let localPart = email.address.lowercased().split(separator: "@").first.map(String.init) ?? ""
        return name.count >= 3 && localPart.contains(name)
    }
}

enum PrivateEmailSearch {
    /// Case-insensitive match on the label or the address; an empty query matches all.
    static func filter(_ emails: [PrivateEmail], query: String) -> [PrivateEmail] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return emails }
        return emails.filter { email in
            email.address.localizedCaseInsensitiveContains(needle)
                || (email.label?.localizedCaseInsensitiveContains(needle) ?? false)
        }
    }
}

#if DEBUG
extension PrivateEmail {
    /// Fixture data while the app was launched with `-previewAutofill`. The app
    /// also registers these as QuickType identities.
    static let previewFixtures: [PrivateEmail] = [
        PrivateEmail(id: "a1", address: "m2xk7d@private.inboxies.dev", label: "localhost"),
        PrivateEmail(id: "a2", address: "netflix.r8q1@private.inboxies.dev", label: "Netflix"),
        PrivateEmail(id: "a3", address: "p0w3nb@private.inboxies.dev", label: "github.com"),
        PrivateEmail(id: "a4", address: "t7hs2c@private.inboxies.dev", label: "Newsletter: Stratechery"),
        PrivateEmail(id: "a5", address: "z9c4ve@private.inboxies.dev", label: "shop.example.co.uk"),
        PrivateEmail(id: "a6", address: "j5dl0a@private.inboxies.dev", label: nil),
        PrivateEmail(id: "a7", address: "q1ub8f@private.inboxies.dev", label: "airbnb.com"),
        PrivateEmail(id: "a8", address: "paused.x3@private.inboxies.dev", label: "Old store", isActive: false),
    ]
}
#endif

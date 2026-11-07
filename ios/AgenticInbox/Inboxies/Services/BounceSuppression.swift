import Foundation

/// One recipient a send was refused for: the server's `SuppressionView` (AVE-37).
struct SuppressedRecipient: Equatable, Identifiable {
    enum Reason: String, Equatable {
        case hardBounce = "hard_bounce"
        case complaint
    }

    let address: String
    let domain: String
    let reason: Reason
    let source: String
    let detail: String?
    /// ISO 8601.
    let suppressedAt: String
    /// False when another mailbox's send caused it and the caller isn't a domain admin.
    let canUnsuppress: Bool

    var id: String { address }
}

/// The suppression list a mailbox can see (AVE-157): its own sends' suppressions, or
/// every mailbox's on the domain for a domain admin (`scope == .domain`).
struct SuppressionList: Equatable {
    enum Scope: String, Equatable {
        case domain
        case mailbox
    }

    let domain: String
    let scope: Scope
    var suppressions: [SuppressedRecipient]
}

/// Bounce / complaint suppressions on iOS (AVE-84). Mirrors `app/lib/suppression.ts`.
///
/// A send, reply or forward to a suppressed recipient comes back as
/// `409 { error, code: "recipient_suppressed", suppressed: [SuppressionView] }`.
/// Compose shows each address with its reason and offers Un-suppress
/// (`DELETE /api/v1/mailboxes/:id/suppressions/:address`) followed by a retry
/// with the same `Idempotency-Key`.
enum BounceSuppression {
    /// Same value as the server's `RECIPIENT_SUPPRESSED_CODE`.
    static let recipientSuppressedCode = "recipient_suppressed"

    /// The suppressed recipients a failed send reports, or nil for any other response.
    static func suppressedRecipients(statusCode: Int, data: Data) -> [SuppressedRecipient]? {
        guard statusCode == 409,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["code"] as? String) == recipientSuppressedCode,
              let rows = obj["suppressed"] as? [[String: Any]] else { return nil }
        let list = rows.compactMap(recipient(from:))
        return list.isEmpty ? nil : list
    }

    /// One `SuppressionView` row; nil without an address.
    static func recipient(from row: [String: Any]) -> SuppressedRecipient? {
        guard let address = row["address"] as? String, !address.isEmpty else { return nil }
        let detail = (row["detail"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return SuppressedRecipient(
            address: address.lowercased(),
            domain: row["domain"] as? String ?? "",
            reason: (row["reason"] as? String) == "complaint" ? .complaint : .hardBounce,
            source: row["source"] as? String ?? "",
            detail: detail,
            suppressedAt: row["suppressedAt"] as? String ?? "",
            canUnsuppress: (row["canUnsuppress"] as? Bool) == true
        )
    }

    /// `GET /api/v1/mailboxes/:id/suppressions` (AVE-157); nil when the body isn't that shape.
    static func list(data: Data) -> SuppressionList? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["suppressions"] as? [Any] else { return nil }
        let domain = (obj["domain"] as? String) ?? ""
        return SuppressionList(
            domain: domain,
            scope: (obj["scope"] as? String) == "domain" ? .domain : .mailbox,
            suppressions: rows.compactMap { ($0 as? [String: Any]).flatMap(recipient(from:)) }
        )
    }

    // MARK: Settings → Bounced addresses (web `SuppressionsSettings.tsx`)

    static let pageTitle = "Bounced addresses"

    /// Short label for a reason, for lists: "Bounced" / "Marked as spam".
    static func reasonLabel(_ reason: SuppressedRecipient.Reason) -> String {
        reason == .complaint ? "Marked as spam" : "Bounced"
    }

    /// "Bounced · Oct 1, 2026".
    static func metaLine(
        _ recipient: SuppressedRecipient,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let when = formatDate(recipient.suppressedAt, locale: locale, timeZone: timeZone)
        return when.isEmpty ? reasonLabel(recipient.reason) : "\(reasonLabel(recipient.reason)) · \(when)"
    }

    /// The page's intro. Before the list loads (`list == nil`) it reads like a member's.
    static func introText(_ list: SuppressionList?) -> String {
        let domain = list.map(\.domain).flatMap { $0.isEmpty ? nil : $0 } ?? "this domain"
        let scope = list?.scope == .domain
            ? "As a domain admin you see every mailbox's."
            : "You see the ones this mailbox's sends caused."
        return "After a hard bounce or a spam report, mail from \(domain) stops going to that address, which protects your sending reputation. \(scope)"
    }

    static let emptyTitle = "No bounced addresses"
    static let emptyMessage = "Addresses that hard-bounce or report your mail as spam show up here."
    static let loadFailedTitle = "Couldn’t load bounced addresses"
    static let adminOnlyText = "Domain admin only"
    static let confirmTitle = "Un-suppress this address?"

    static func confirmMessage(_ recipient: SuppressedRecipient) -> String {
        let again = recipient.reason == .complaint ? "reports spam" : "bounces"
        return "Mail will go to \(recipient.address) again. If it \(again) again, it's suppressed again."
    }

    static func unsuppressedToast(_ address: String) -> String { "\(address) un-suppressed" }

    /// A 404 on un-suppress: the suppression is already gone, so the row just goes away.
    static func isAlreadyLifted(_ error: Error) -> Bool {
        if case APIError.http(404, _) = error { return true }
        return false
    }

    /// The 409 as an `APIError`, or nil when the response isn't a suppression block.
    static func error(statusCode: Int, data: Data) -> APIError? {
        guard let list = suppressedRecipients(statusCode: statusCode, data: data) else { return nil }
        return .recipientSuppressed(message: httpErrorMessage(from: data), suppressed: list)
    }

    /// "Oct 1, 2026"; the raw value when it isn't an ISO date.
    static func formatDate(_ iso: String, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        guard !iso.isEmpty else { return "" }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    /// "This address bounced on Oct 1, 2026" / "This address marked earlier mail as spam on …".
    static func reasonText(
        _ recipient: SuppressedRecipient,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let when = formatDate(recipient.suppressedAt, locale: locale, timeZone: timeZone)
        let on = when.isEmpty ? "" : " on \(when)"
        switch recipient.reason {
        case .complaint: return "This address marked earlier mail as spam\(on)"
        case .hardBounce: return "This address bounced\(on)"
        }
    }

    /// The suppressions still among the compose's recipients: removing an address
    /// from To / Cc / Bcc clears its notice without another send attempt.
    static func stillAddressed(_ suppressed: [SuppressedRecipient], recipients: [String]) -> [SuppressedRecipient] {
        guard !suppressed.isEmpty else { return [] }
        let current = Set(recipients.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        return suppressed.filter { current.contains($0.address.lowercased()) }
    }

    /// Copy for the notice's footer, depending on whether every address can be lifted here.
    static func footerText(canLiftAll: Bool) -> String {
        canLiftAll
            ? "Or remove the address to send to everyone else."
            : "Remove the address to send to everyone else."
    }

    static let askAdminText = "Another mailbox on this domain suppressed it. Ask a domain admin to un-suppress it."

    static func buttonTitle(count: Int) -> String {
        count > 1 ? "Un-suppress all and send" : "Un-suppress and send"
    }
}

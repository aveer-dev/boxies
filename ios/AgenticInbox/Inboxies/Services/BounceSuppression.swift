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
        let list = rows.compactMap { row -> SuppressedRecipient? in
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
        return list.isEmpty ? nil : list
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

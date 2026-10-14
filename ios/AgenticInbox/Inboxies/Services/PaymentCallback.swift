import Foundation

/// Classifies the Stripe checkout return deep link. The Worker sends
/// `inboxies://onboarding/domain-ready?domain=…&session_id=…[&token=…&mailbox_id=…]`
/// on success and `inboxies://onboarding/cancelled?domain=…` when the buyer backs out.
/// Renewals of a domain whose subscription ended come back on
/// `inboxies://billing/renewed?domain=…` and `inboxies://billing/renew-cancelled?domain=…`.
enum PaymentCallback: Equatable {
    case domainReady(domain: String?, sessionId: String?, token: String?, mailboxId: String?)
    case cancelled(domain: String?)
    /// Renewal paid; the webhook restores the domain within seconds.
    case renewed(domain: String?)
    case renewCancelled(domain: String?)
    /// Not a payment return (or an unknown route); callers ignore it.
    case unrecognized

    static func parse(_ url: URL) -> PaymentCallback {
        guard url.scheme?.lowercased() == "inboxies" else { return .unrecognized }
        let host = url.host?.lowercased() ?? ""
        let segments = url.pathComponents.filter { $0 != "/" }.map { $0.lowercased() }

        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? {
            guard let raw = items.first(where: { $0.name == name })?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                  !raw.isEmpty else { return nil }
            return raw
        }

        if host == "billing" {
            switch segments.first {
            case "renewed":
                return .renewed(domain: value("domain")?.lowercased())
            case "renew-cancelled", "renew-canceled":
                return .renewCancelled(domain: value("domain")?.lowercased())
            default:
                return .unrecognized
            }
        }

        // `inboxies://onboarding/<route>`, plus the bare `inboxies://<route>` form.
        let route: String?
        if host == "onboarding" {
            route = segments.first
        } else {
            route = host.isEmpty ? segments.first : host
        }

        switch route {
        case "domain-ready":
            return .domainReady(
                domain: value("domain"),
                sessionId: value("session_id"),
                token: value("token"),
                mailboxId: value("mailbox_id")
            )
        case "cancelled", "canceled":
            return .cancelled(domain: value("domain"))
        default:
            return .unrecognized
        }
    }
}

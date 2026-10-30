import Foundation

/// Classifies the Stripe checkout return deep link. The Worker sends
/// `inboxies://onboarding/domain-ready?domain=…[&code=…]` on success. `code` is a
/// one-time, 60-second exchange code (never a session token): the app trades it,
/// with the checkout session id it started, at `POST /api/v1/auth/exchange`.
/// The link never carries the session id, so an app that intercepts it can't redeem it.
/// `inboxies://onboarding/cancelled?domain=…` is sent when the buyer backs out.
/// Renewals of a domain whose subscription ended come back on
/// `inboxies://billing/renewed?domain=…` and `inboxies://billing/renew-cancelled?domain=…`.
enum PaymentCallback: Equatable {
    case domainReady(domain: String?, code: String?)
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
            return .domainReady(domain: value("domain"), code: value("code"))
        case "cancelled", "canceled":
            return .cancelled(domain: value("domain"))
        default:
            return .unrecognized
        }
    }
}

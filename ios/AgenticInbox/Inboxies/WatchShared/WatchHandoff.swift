import Foundation

/// The WatchConnectivity contract between the iPhone app and the Apple Watch app
/// (AVE-144, docs/watch-companion-plan.md phase 2). Compiled into both.
///
/// - The watch asks with `requestSession`; the phone mints a `watch`-scoped session
///   (`POST /api/v1/me/extension-session { client: "watchos" }`) and replies with a
///   `session` grant. The phone may also push a grant once after sign-in.
/// - `clear` tells the watch to wipe its token (phone sign-out, or the watch was
///   signed out from Devices & sessions).
/// - The application context carries only non-secret state: signed in or not, the
///   active mailbox and the API origin. Tokens never go in it, because the system
///   keeps the last context on disk.
///
/// The phone's own full session is never part of any message.
enum WatchHandoff {
    static let kindKey = "kind"

    enum Kind: String {
        /// Watch → phone: "mint me a watch session" (sent with a reply handler).
        case requestSession
        /// Phone → watch: a `WatchSessionGrant`.
        case session
        /// Phone → watch: wipe the token.
        case clear
        /// Phone → watch, as the application context: `WatchPhoneContext`.
        case context
        /// Phone → watch reply: no signed-in session on the phone.
        case signedOut
        /// Phone → watch reply: the phone couldn't mint one right now (offline, server error).
        case unavailable
    }

    static func kind(of message: [String: Any]) -> Kind? {
        (message[kindKey] as? String).flatMap(Kind.init(rawValue:))
    }

    static func message(_ kind: Kind) -> [String: Any] {
        [kindKey: kind.rawValue]
    }

    /// Only https origins, plus plain http to a local dev server in DEBUG builds.
    static func acceptedOrigin(_ raw: String?) -> URL? {
        guard let raw, let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if scheme == "https" { return url }
        #if DEBUG
        if scheme == "http", host == "localhost" || host == "127.0.0.1" { return url }
        #endif
        return nil
    }
}

/// A `watch`-scoped session for the watch, plus where to use it.
struct WatchSessionGrant: Equatable {
    static let tokenKey = "token"
    static let apiBaseURLKey = "apiBaseURL"
    static let mailboxIdKey = "mailboxId"

    let token: String
    let apiBaseURL: URL
    let mailboxId: String?

    var message: [String: Any] {
        var message = WatchHandoff.message(.session)
        message[Self.tokenKey] = token
        message[Self.apiBaseURLKey] = apiBaseURL.absoluteString
        if let mailboxId, !mailboxId.isEmpty { message[Self.mailboxIdKey] = mailboxId }
        return message
    }

    init(token: String, apiBaseURL: URL, mailboxId: String?) {
        self.token = token
        self.apiBaseURL = apiBaseURL
        self.mailboxId = mailboxId
    }

    init?(message: [String: Any]) {
        guard WatchHandoff.kind(of: message) == .session,
              let token = message[Self.tokenKey] as? String, !token.isEmpty,
              let origin = WatchHandoff.acceptedOrigin(message[Self.apiBaseURLKey] as? String) else { return nil }
        self.token = token
        self.apiBaseURL = origin
        self.mailboxId = (message[Self.mailboxIdKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }
}

/// Non-secret phone state, sent as the WatchConnectivity application context.
struct WatchPhoneContext: Equatable {
    static let signedInKey = "signedIn"

    let signedIn: Bool
    let mailboxId: String?
    let apiBaseURL: URL?

    var message: [String: Any] {
        var message = WatchHandoff.message(.context)
        message[Self.signedInKey] = signedIn
        if let mailboxId, !mailboxId.isEmpty { message[WatchSessionGrant.mailboxIdKey] = mailboxId }
        if let apiBaseURL { message[WatchSessionGrant.apiBaseURLKey] = apiBaseURL.absoluteString }
        return message
    }

    init(signedIn: Bool, mailboxId: String?, apiBaseURL: URL?) {
        self.signedIn = signedIn
        self.mailboxId = mailboxId
        self.apiBaseURL = apiBaseURL
    }

    init?(message: [String: Any]) {
        guard WatchHandoff.kind(of: message) == .context,
              let signedIn = message[Self.signedInKey] as? Bool else { return nil }
        self.signedIn = signedIn
        self.mailboxId = (message[WatchSessionGrant.mailboxIdKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
        self.apiBaseURL = WatchHandoff.acceptedOrigin(message[WatchSessionGrant.apiBaseURLKey] as? String)
    }
}

import Foundation
import Observation

/// Step-up re-authentication (AVE-113 on the Worker, AVE-170 here).
///
/// Sensitive account changes (recovery email, sign-in methods, passkeys, the
/// password with 2FA on, deleting the account) answer 403
/// `{ code: "reauth_required", methods, twoFactor, emailCodeTo, maxAgeSeconds }`
/// unless this session signed in or re-authenticated in the last 5 minutes.
///
/// `APIClient` turns that 403 into `APIError.reauthRequired`, asks
/// `ReauthCoordinator` to show the "Confirm it's you" sheet, and retries the
/// original request once when the user confirmed (`ReauthRetry`). Same flow as
/// the web `ReauthDialog` / `requestReauth`.
enum ReauthMethod: String, CaseIterable, Sendable {
    /// The account password, plus an authenticator or backup code when `twoFactor`.
    case password
    /// An assertion from one of the user's passkeys.
    case passkey
    /// A 6-digit code mailed to `emailCodeTo` (accounts without a password).
    case emailCode = "email_code"
    /// Sign out and sign in again; a new session is fresh for 5 minutes.
    case signIn = "sign_in"
}

/// The `reauth_required` 403 body.
struct ReauthChallenge: Equatable, Sendable {
    static let code = "reauth_required"

    /// What the account can confirm with, in server order. `signIn` is always offered.
    var methods: [ReauthMethod]
    /// A password re-auth also needs a TOTP or backup code.
    var twoFactor: Bool
    /// Masked address an emailed code goes to (`a•••p@gmail.com`).
    var emailCodeTo: String?
    /// How long the confirmation lasts.
    var maxAgeSeconds: Int
    /// The server's sentence, written for builds without this sheet ("sign out and back in").
    var message: String

    /// Methods with an inline form, i.e. everything but `signIn`.
    var usableMethods: [ReauthMethod] {
        methods.filter { $0 != .signIn }
    }

    /// The challenge in an error reply, or nil for any other error.
    static func parse(statusCode: Int, data: Data) -> ReauthChallenge? {
        guard statusCode == 403,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["code"] as? String) == code else { return nil }
        var methods: [ReauthMethod] = []
        for raw in (obj["methods"] as? [Any]) ?? [] {
            if let name = raw as? String, let method = ReauthMethod(rawValue: name), !methods.contains(method) {
                methods.append(method)
            }
        }
        if !methods.contains(.signIn) {
            methods.append(.signIn)
        }
        let emailCodeTo = (obj["emailCodeTo"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        // An emailed code needs somewhere to go.
        if emailCodeTo == nil {
            methods.removeAll { $0 == .emailCode }
        }
        return ReauthChallenge(
            methods: methods,
            twoFactor: (obj["twoFactor"] as? Bool) == true,
            emailCodeTo: emailCodeTo,
            maxAgeSeconds: (obj["maxAgeSeconds"] as? Int) ?? 300,
            message: (obj["error"] as? String) ?? (obj["message"] as? String) ?? ""
        )
    }
}

/// `POST /api/v1/me/reauth` → `{ ok, freshUntil }`.
struct ReauthResponse: Decodable {
    var ok: Bool?
    var freshUntil: String?
}

/// `POST /api/v1/me/reauth/email-code` → `{ ok, sentTo, devCode? }`.
struct ReauthEmailCodeResponse: Decodable {
    var ok: Bool?
    var sentTo: String?
    /// Local dev Worker only.
    var devCode: String?
}

enum ReauthRetry {
    /// Runs `operation`; on `reauthRequired`, asks `confirm` and, when the user
    /// confirmed, runs it exactly once more. A second `reauthRequired` (or a
    /// declined prompt) is thrown as is, so it never loops.
    static func run<T>(
        confirm: (ReauthChallenge) async -> Bool,
        _ operation: () async throws -> T
    ) async throws -> T {
        do {
            return try await operation()
        } catch APIError.reauthRequired(let challenge) {
            guard await confirm(challenge) else {
                throw APIError.reauthRequired(challenge)
            }
            return try await operation()
        }
    }
}

/// Owns the one "Confirm it's you" prompt. `ReauthPromptHost` (a view modifier
/// on the settings sheet) presents it; requests that hit the gate wait here.
@MainActor
@Observable
final class ReauthCoordinator {
    static let shared = ReauthCoordinator()

    /// The prompt on screen, if any.
    private(set) var challenge: ReauthChallenge?
    /// Bumped per prompt so the sheet starts clean each time.
    private(set) var promptID = UUID()

    @ObservationIgnored private var waiters: [CheckedContinuation<Bool, Never>] = []
    /// Mounted hosts, innermost last. Only the last one presents.
    private var hosts: [UUID] = []

    init() {}

    var activeHost: UUID? { hosts.last }

    /// Requests waiting on the prompt.
    var waitingCount: Int { waiters.count }

    /// Shows the prompt and resolves true once the session is fresh again, false
    /// when the user closed it (or nothing on screen can show it).
    func confirm(_ challenge: ReauthChallenge) async -> Bool {
        guard !hosts.isEmpty else { return false }
        return await withCheckedContinuation { continuation in
            // Several requests may hit the gate at once: one prompt answers them all.
            if self.challenge == nil {
                self.challenge = challenge
                self.promptID = UUID()
            }
            waiters.append(continuation)
        }
    }

    /// Closes the prompt; `ok` says whether the session is fresh now.
    func finish(_ ok: Bool) {
        let pending = waiters
        waiters = []
        challenge = nil
        for waiter in pending {
            waiter.resume(returning: ok)
        }
    }

    func register(host: UUID) {
        hosts.removeAll { $0 == host }
        hosts.append(host)
    }

    func unregister(host: UUID) {
        hosts.removeAll { $0 == host }
        // Its sheet went away with it: nobody can answer the prompt now.
        if hosts.isEmpty, challenge != nil {
            finish(false)
        }
    }

    #if DEBUG
    /// DEBUG previews: open the prompt without a request behind it.
    func presentForPreview(_ challenge: ReauthChallenge) {
        self.challenge = challenge
        promptID = UUID()
    }
    #endif
}

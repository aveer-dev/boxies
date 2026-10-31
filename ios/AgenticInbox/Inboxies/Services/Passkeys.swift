import AuthenticationServices
import Foundation
import UIKit

/// Passkeys (WebAuthn) against Better Auth's passkey plugin at `/api/auth/passkey/*`.
///
/// - The relying party is the web app's host (`rp.id` / `rpId` in the server's
///   options, `inboxies.app` in production). The app needs a matching
///   `webcredentials:` associated domain, and that host must serve an
///   apple-app-site-association file naming this app.
/// - The WebAuthn challenge rides in a short-lived signed cookie between the
///   options call and the verify call. The API session doesn't keep cookies,
///   so it is read from the first reply and sent back by hand, with an
///   `Origin` of `https://<rpID>` (Better Auth checks the origin of any POST
///   that carries a cookie, and the assertion's client data says the same).
/// - Signing in with a passkey skips the two-factor step: the authenticator is
///   the second factor.
enum Passkeys {
    /// What signing in with a passkey hands back.
    struct SignIn {
        let token: String
        let email: String?
    }

    enum Failure: LocalizedError {
        /// The user dismissed the system sheet, or the device has no passkey for us.
        case cancelled
        case badOptions
        case message(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: return "Cancelled."
            case .badOptions: return "Passkeys aren't available right now. Sign in another way."
            case .message(let text): return text
            }
        }
    }

    // MARK: - Sign in

    /// Shows the system passkey sheet and signs in with the passkey picked.
    @MainActor
    static func signIn() async throws -> SignIn {
        let api = APIClient.shared
        let options: AuthenticationOptions
        let http: HTTPURLResponse
        do {
            (options, http) = try await api.requestWithResponse(
                path: "/api/auth/passkey/generate-authenticate-options",
                authed: false
            )
        } catch {
            throw friendly(error, fallback: "Passkey sign-in failed. Try again or sign in another way.")
        }
        guard let rpID = options.rpId, !rpID.isEmpty,
              let challenge = Base64URL.decode(options.challenge),
              let cookie = challengeCookie(from: http) else {
            throw Failure.badOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .preferred
        let allowed = (options.allowCredentials ?? []).compactMap { Base64URL.decode($0.id) }
        if !allowed.isEmpty {
            request.allowedCredentials = allowed.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        }

        let authorization = try await PasskeyCeremony().perform(request)
        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw Failure.message("Passkey sign-in failed. Try again or sign in another way.")
        }
        let body: [String: Any] = ["response": assertionJSON(assertion)]

        do {
            let (session, verifyHTTP): (SessionReply, HTTPURLResponse) = try await api.requestWithResponse(
                path: "/api/auth/passkey/verify-authentication",
                method: "POST",
                body: body,
                authed: false,
                headers: ceremonyHeaders(cookie: cookie, rpID: rpID)
            )
            guard let token = session.session?.token ?? bearerToken(from: verifyHTTP), !token.isEmpty else {
                throw Failure.message("Passkey sign-in failed. Try again or sign in another way.")
            }
            return SignIn(token: token, email: session.user?.email)
        } catch let failure as Failure {
            throw failure
        } catch {
            throw friendly(error, fallback: "Passkey sign-in failed. Try again or sign in another way.")
        }
    }

    // MARK: - Confirm it's you (signed in)

    /// Step-up re-auth with a passkey (`POST /api/v1/me/reauth`, AVE-113): the
    /// same ceremony as sign-in, but the assertion goes to `/me/reauth` with the
    /// challenge cookie echoed back, and no new session comes out of it.
    @MainActor
    static func reauthenticate() async throws {
        let fallback = "That passkey couldn't confirm it's you. Try again or use another way."
        let api = APIClient.shared
        let options: AuthenticationOptions
        let http: HTTPURLResponse
        do {
            // Signed in, so the options list only this account's passkeys.
            (options, http) = try await api.requestWithResponse(
                path: "/api/auth/passkey/generate-authenticate-options"
            )
        } catch {
            throw friendly(error, fallback: fallback)
        }
        guard let rpID = options.rpId, !rpID.isEmpty,
              let challenge = Base64URL.decode(options.challenge),
              let cookie = challengeCookie(from: http) else {
            throw Failure.badOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .preferred
        let allowed = (options.allowCredentials ?? []).compactMap { Base64URL.decode($0.id) }
        if !allowed.isEmpty {
            request.allowedCredentials = allowed.map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        }

        let authorization = try await PasskeyCeremony().perform(request)
        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw Failure.message(fallback)
        }
        do {
            let _: ReauthResponse = try await api.request(
                path: "/api/v1/me/reauth",
                method: "POST",
                body: ["method": "passkey", "response": assertionJSON(assertion)],
                headers: ceremonyHeaders(cookie: cookie, rpID: rpID)
            )
        } catch let apiError as APIError {
            // The Worker's own sentence ("That passkey couldn't confirm it's you…", too many tries).
            if case .http(_, let message) = apiError, !message.isEmpty, !message.hasPrefix("{") {
                throw Failure.message(message)
            }
            throw friendly(apiError, fallback: fallback)
        }
    }

    // MARK: - Manage (signed in)

    /// Creates a passkey for the signed-in account on this device (saved to
    /// the user's password manager, usually iCloud Keychain).
    @MainActor
    static func register(name: String) async throws {
        let api = APIClient.shared
        let options: RegistrationOptions
        let http: HTTPURLResponse
        do {
            (options, http) = try await api.requestWithResponse(path: "/api/auth/passkey/generate-register-options")
        } catch {
            throw friendly(error, fallback: "Couldn't add the passkey.")
        }
        guard let rpID = options.rp.id, !rpID.isEmpty,
              let challenge = Base64URL.decode(options.challenge),
              let userID = Base64URL.decode(options.user.id),
              let cookie = challengeCookie(from: http) else {
            throw Failure.badOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user.name,
            userID: userID
        )
        request.userVerificationPreference = .preferred
        if #available(iOS 17.4, *) {
            // Don't make a second passkey where this account already has one.
            request.excludedCredentials = (options.excludeCredentials ?? [])
                .compactMap { Base64URL.decode($0.id) }
                .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        }

        let authorization = try await PasskeyCeremony().perform(request)
        guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = registration.rawAttestationObject else {
            throw Failure.message("Couldn't add the passkey.")
        }

        let credentialID = Base64URL.encode(registration.credentialID)
        let body: [String: Any] = [
            "name": name,
            "response": [
                "id": credentialID,
                "rawId": credentialID,
                "type": "public-key",
                "response": [
                    "clientDataJSON": Base64URL.encode(registration.rawClientDataJSON),
                    "attestationObject": Base64URL.encode(attestation),
                    "transports": ["internal", "hybrid"],
                ] as [String: Any],
                "clientExtensionResults": [String: Any](),
                "authenticatorAttachment": "platform",
            ] as [String: Any],
        ]
        do {
            let _: PasskeyRow = try await api.request(
                path: "/api/auth/passkey/verify-registration",
                method: "POST",
                body: body,
                headers: ceremonyHeaders(cookie: cookie, rpID: rpID)
            )
        } catch {
            throw friendly(error, fallback: "Couldn't add the passkey.")
        }
    }

    static func list() async throws -> [PasskeyRow] {
        do {
            return try await APIClient.shared.request(path: "/api/auth/passkey/list-user-passkeys")
        } catch {
            throw friendly(error, fallback: "Couldn't load passkeys.")
        }
    }

    static func delete(id: String) async throws {
        do {
            let _: DeleteReply = try await APIClient.shared.request(
                path: "/api/auth/passkey/delete-passkey",
                method: "POST",
                body: ["id": id]
            )
        } catch {
            throw friendly(error, fallback: "Couldn't remove the passkey.")
        }
    }

    /// Default name for a passkey made on this device ("iPhone", "iPad").
    @MainActor
    static var deviceName: String {
        "Inboxies on \(UIDevice.current.model)"
    }

    // MARK: - Wire helpers

    /// The signed WebAuthn challenge cookie (`…better-auth-passkey`) as a `Cookie` pair.
    static func challengeCookie(from http: HTTPURLResponse) -> String? {
        guard let url = http.url else { return nil }
        var fields: [String: String] = [:]
        for (key, value) in http.allHeaderFields {
            if let key = key as? String, let value = value as? String {
                fields[key] = value
            }
        }
        let cookie = HTTPCookie.cookies(withResponseHeaderFields: fields, for: url)
            .first { $0.name.hasSuffix("passkey") }
        guard let cookie, !cookie.value.isEmpty else { return nil }
        return "\(cookie.name)=\(cookie.value)"
    }

    /// An assertion as WebAuthn `AuthenticationResponseJSON`.
    static func assertionJSON(_ assertion: ASAuthorizationPlatformPublicKeyCredentialAssertion) -> [String: Any] {
        let credentialID = Base64URL.encode(assertion.credentialID)
        var response: [String: Any] = [
            "clientDataJSON": Base64URL.encode(assertion.rawClientDataJSON),
            "authenticatorData": Base64URL.encode(assertion.rawAuthenticatorData),
            "signature": Base64URL.encode(assertion.signature),
        ]
        if let userHandle = assertion.userID, !userHandle.isEmpty {
            response["userHandle"] = Base64URL.encode(userHandle)
        }
        return [
            "id": credentialID,
            "rawId": credentialID,
            "type": "public-key",
            "response": response,
            "clientExtensionResults": [String: Any](),
            "authenticatorAttachment": "platform",
        ]
    }

    static func ceremonyHeaders(cookie: String, rpID: String) -> [String: String] {
        ["Cookie": cookie, "Origin": "https://\(rpID)"]
    }

    /// Better Auth's bearer plugin echoes the new session as `set-auth-token`
    /// (`token.signature`); the API takes the bare token as well.
    static func bearerToken(from http: HTTPURLResponse) -> String? {
        guard let value = http.value(forHTTPHeaderField: "set-auth-token"), !value.isEmpty else { return nil }
        return value.split(separator: ".").first.map(String.init)
    }

    /// Better Auth errors are `{ code, message }`; ours are `{ error }`.
    static func friendly(_ error: Error, fallback: String) -> Error {
        if let failure = error as? Failure { return failure }
        guard let apiError = error as? APIError else { return Failure.message(fallback) }
        switch apiError {
        case .http(let status, let body):
            if status == 429 { return Failure.message("Too many attempts. Wait a minute and try again.") }
            let code = (try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])?["code"] as? String
            switch code {
            case "PASSKEY_NOT_FOUND":
                return Failure.message("That passkey isn't registered with Inboxies. Sign in another way.")
            case "SESSION_NOT_FRESH":
                return Failure.message("For your security, sign out and sign in again, then add the passkey.")
            case "CHALLENGE_NOT_FOUND":
                return Failure.message("That took too long. Try again.")
            case "PREVIOUSLY_REGISTERED":
                return Failure.message("This device already has a passkey for your account.")
            default:
                return Failure.message(fallback)
            }
        case .transport, .sessionExpired, .cloudflareAccess, .reauthRequired:
            return apiError
        default:
            return Failure.message(fallback)
        }
    }

    // MARK: - Payloads

    private struct CredentialRef: Decodable {
        let id: String
    }

    /// PublicKeyCredentialRequestOptionsJSON (the parts we use).
    private struct AuthenticationOptions: Decodable {
        let challenge: String
        let rpId: String?
        let allowCredentials: [CredentialRef]?
    }

    /// PublicKeyCredentialCreationOptionsJSON (the parts we use).
    private struct RegistrationOptions: Decodable {
        struct RelyingParty: Decodable {
            let id: String?
        }

        struct User: Decodable {
            let id: String
            let name: String
        }

        let challenge: String
        let rp: RelyingParty
        let user: User
        let excludeCredentials: [CredentialRef]?
    }

    private struct SessionReply: Decodable {
        struct Session: Decodable {
            let token: String?
        }

        struct User: Decodable {
            let email: String?
        }

        let session: Session?
        let user: User?
    }

    private struct DeleteReply: Decodable {
        let status: Bool?
    }
}

/// base64url without padding, as WebAuthn JSON uses it.
enum Base64URL {
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decode(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        return Data(base64Encoded: base64)
    }
}

/// One passkey request through `ASAuthorizationController`, as async/await.
@MainActor
final class PasskeyCeremony: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?

    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            // Retained until the delegate answers.
            self.controller = controller
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow)
        return window ?? scenes.first?.windows.first ?? UIWindow()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        finish(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            // Also what iOS reports when there's no passkey for this site on the device.
            finish(.failure(Passkeys.Failure.cancelled))
            return
        }
        finish(.failure(Passkeys.Failure.message(Self.message(for: error))))
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        continuation?.resume(with: result)
        continuation = nil
        controller = nil
    }

    private static func message(for error: Error) -> String {
        let nsError = error as NSError
        // An app without the associated domain (or an AASA the device couldn't
        // fetch) fails with "not associated with domain".
        if nsError.localizedDescription.localizedCaseInsensitiveContains("associated domain")
            || nsError.localizedDescription.localizedCaseInsensitiveContains("not associated") {
            return "Passkeys aren't set up for this app yet. Sign in another way."
        }
        if #available(iOS 18.0, *), let authError = error as? ASAuthorizationError, authError.code == .matchedExcludedCredential {
            return "This device already has a passkey for your account."
        }
        return "Passkey request failed. Try again or sign in another way."
    }
}

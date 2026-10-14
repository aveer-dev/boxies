import AuthenticationServices
import CryptoKit
import Foundation

/// Sign in with Apple helpers shared by sign-in and Settings → Connect Apple.
///
/// Each request carries the SHA-256 of a fresh random nonce; the server gets the
/// raw nonce and checks it against the identity token, so a token lifted from
/// another app's flow can't be replayed here.
enum AppleSignInNonce {
    static func make(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var bytes = [UInt8](repeating: 0, count: length)
        if SecRandomCopyBytes(kSecRandomDefault, length, &bytes) != errSecSuccess {
            // SecRandom doesn't fail in practice; fall back to the system RNG.
            return String((0..<length).map { _ in charset.randomElement()! })
        }
        return String(bytes.map { charset[Int($0) % charset.count] })
    }

    static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// What the server needs from a completed Apple authorization.
struct AppleSignInCredential {
    let identityToken: String
    /// One-time code the server exchanges for a refresh token, so account
    /// deletion can revoke the Apple grant (App Store requirement).
    let authorizationCode: String?
    let nonce: String
    let email: String?
    let givenName: String?
    let familyName: String?

    init?(authorization: ASAuthorization, nonce: String) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else { return nil }
        identityToken = token
        authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        self.nonce = nonce
        email = credential.email
        givenName = credential.fullName?.givenName
        familyName = credential.fullName?.familyName
    }

    /// Body for `POST /api/v1/auth/apple` and `/api/v1/me/identities/attach`.
    var requestBody: [String: Any] {
        var body: [String: Any] = ["identityToken": identityToken, "nonce": nonce]
        if let authorizationCode, !authorizationCode.isEmpty {
            body["authorizationCode"] = authorizationCode
        }
        var name: [String: String] = [:]
        if let givenName, !givenName.isEmpty { name["givenName"] = givenName }
        if let familyName, !familyName.isEmpty { name["familyName"] = familyName }
        if !name.isEmpty { body["fullName"] = name }
        return body
    }
}

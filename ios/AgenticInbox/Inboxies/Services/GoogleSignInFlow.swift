import GoogleSignIn
import UIKit

/// What the server needs from a completed Google sign-in.
struct GoogleSignInCredential {
    let idToken: String
    /// Sent raw to Google (it lands in the ID token) and to the server, which
    /// checks they match, so a token lifted from another app can't be replayed.
    let nonce: String
    let email: String?

    /// Body for `POST /api/v1/auth/google` and `/api/v1/me/identities/attach`.
    var requestBody: [String: Any] {
        ["idToken": idToken, "nonce": nonce]
    }
}

/// Google Sign-In helpers shared by sign-in and Settings → Connect Google.
///
/// The SDK reads `GIDClientID` (the iOS client) and `GIDServerClientID` (the
/// Web client) from Info.plist, which `project.yml` fills in. The ID token's
/// audience is the Web client — the Worker's `GOOGLE_CLIENT_ID`.
@MainActor
enum GoogleSignInFlow {
    enum FlowError: LocalizedError {
        case notConfigured
        case noPresenter
        case missingIDToken

        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Google Sign-In isn't set up in this build."
            case .noPresenter, .missingIDToken: return "Google Sign-In failed"
            }
        }
    }

    static var isConfigured: Bool {
        guard let clientID = GIDSignIn.sharedInstance.configuration?.clientID else { return false }
        return !clientID.isEmpty
    }

    /// Shows Google's account picker. Returns nil when the user cancels.
    static func signIn() async throws -> GoogleSignInCredential? {
        guard isConfigured else { throw FlowError.notConfigured }
        guard let presenter = topViewController() else { throw FlowError.noPresenter }
        let nonce = AppleSignInNonce.make()
        let result: GIDSignInResult
        do {
            result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter,
                hint: nil,
                additionalScopes: nil,
                nonce: nonce
            )
        } catch GIDSignInError.canceled {
            return nil
        }
        // The server session is what keeps the user signed in; drop the SDK's
        // own so the next attempt shows the account picker again.
        defer { GIDSignIn.sharedInstance.signOut() }
        guard let idToken = result.user.idToken?.tokenString else { throw FlowError.missingIDToken }
        return GoogleSignInCredential(idToken: idToken, nonce: nonce, email: result.user.profile?.email)
    }

    /// Hands the OAuth redirect back to the SDK. True when it was Google's.
    static func handle(_ url: URL) -> Bool {
        GIDSignIn.sharedInstance.handle(url)
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

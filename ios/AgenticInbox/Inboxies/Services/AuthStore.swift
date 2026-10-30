import Foundation
import Observation

/// Session store ≈ React context / Capacitor Preferences for the auth token.
@Observable
@MainActor
final class AuthStore {
    /// The app's full session token, in the app-only keychain group.
    nonisolated static let tokenKey = "mobileSessionToken"
    private let tokenKey = AuthStore.tokenKey
    private let emailKey = "mobileUserEmail"

    var token: String?
    var userEmail: String?
    var isAuthenticated: Bool { token != nil && !(token?.isEmpty ?? true) }
    var isBusy = false
    var errorMessage: String?
    /// Set when a password sign-in (or reset) needs a second factor; cleared by
    /// `verifyTwoFactor` succeeding or `cancelTwoFactor`. No session until then.
    var twoFactorChallenge: TwoFactorChallenge?
    /// Preview hosts keep session in memory so Canvas cannot wipe the real Keychain.
    var persistsSession: Bool

    init(persistsSession: Bool = true) {
        self.persistsSession = persistsSession
        // Older builds kept the full session in the shared group the AutoFill
        // extension reads; the extension now gets its own scoped session.
        if persistsSession {
            KeychainStore.moveToAppGroup(tokenKey)
        }
        token = KeychainStore.read(tokenKey, in: .app)
        userEmail = UserDefaults.standard.string(forKey: emailKey)
        APIClient.shared.authToken = token
    }

    func signInWithApple(_ credential: AppleSignInCredential) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response: AuthResponse = try await APIClient.shared.request(
                path: "/api/v1/auth/apple",
                method: "POST",
                body: credential.requestBody,
                authed: false
            )
            persist(token: response.token, email: response.user.email ?? credential.email)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signInWithGoogle(_ credential: GoogleSignInCredential) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response: AuthResponse = try await APIClient.shared.request(
                path: "/api/v1/auth/google",
                method: "POST",
                body: credential.requestBody,
                authed: false
            )
            persist(token: response.token, email: response.user.email ?? credential.email)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Local-dev shortcut when Apple Sign In isn't configured in the simulator.
    func signInDev(email: String = "dev@example.com") async {
        guard AppConfig.isLocalDevelopmentAPI else {
            errorMessage = "Dev login only works against a local Worker (http://127.0.0.1:5173). Use Sign in with Apple against your deployed API."
            return
        }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response: AuthResponse = try await APIClient.shared.request(
                path: "/api/v1/auth/dev",
                method: "POST",
                body: ["email": email],
                authed: false
            )
            persist(token: response.token, email: response.user.email ?? email)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signInWithPassword(email: String, password: String) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        twoFactorChallenge = nil
        do {
            let response = try await APIClient.shared.passwordLogin(email: email, password: password)
            persist(token: response.token, email: response.email ?? email)
        } catch APIError.twoFactorRequired(let challenge) {
            var challenge = challenge
            challenge.email = email
            twoFactorChallenge = challenge
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Finishes a password sign-in that answered with a two-factor challenge.
    /// Returns false (with `errorMessage` set) when the code didn't work; an
    /// expired challenge also clears `twoFactorChallenge`, so the user signs in again.
    @discardableResult
    func verifyTwoFactor(code: String, useBackupCode: Bool) async -> Bool {
        guard let challenge = twoFactorChallenge else { return false }
        let trimmed = useBackupCode
            ? code.trimmingCharacters(in: .whitespacesAndNewlines)
            : code.filter { !$0.isWhitespace }
        guard !trimmed.isEmpty else { return false }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response = try await APIClient.shared.verifyTwoFactor(
                challengeToken: challenge.token,
                code: trimmed,
                method: useBackupCode ? "backup_code" : "totp"
            )
            twoFactorChallenge = nil
            persist(token: response.token, email: response.email ?? challenge.email)
            return true
        } catch APIError.http(let status, let message) {
            if status == 401, message.localizedCaseInsensitiveContains("expired") {
                twoFactorChallenge = nil
            }
            errorMessage = status == 401 && message == "Invalid code"
                ? (useBackupCode ? "That backup code didn't work." : "That code didn't work. Check your authenticator app and try again.")
                : message
            return false
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func cancelTwoFactor() {
        twoFactorChallenge = nil
    }

    /// Signs in with a passkey from the system sheet. Dismissing the sheet is not an error.
    func signInWithPasskey() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let result = try await Passkeys.signIn()
            persist(token: result.token, email: result.email)
        } catch Passkeys.Failure.cancelled {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func forgotPassword(email: String) async throws -> ForgotPasswordResponse {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            return try await APIClient.shared.forgotPassword(email: email)
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func resetPassword(token: String? = nil, email: String? = nil, code: String? = nil, newPassword: String) async throws {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        twoFactorChallenge = nil
        do {
            let response = try await APIClient.shared.resetPassword(token: token, email: email, code: code, newPassword: newPassword)
            if var challenge = response.twoFactorChallenge {
                // A reset proves the recovery email, not the second factor.
                challenge.email = challenge.email ?? email
                twoFactorChallenge = challenge
            } else if let sessionToken = response.token, !sessionToken.isEmpty {
                persist(token: sessionToken, email: response.email)
            } else {
                // Password changed, but no session came back: sign in with it.
                errorMessage = "Password updated. Sign in with your new password."
            }
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func applySession(token: String, email: String?) {
        persist(token: token, email: email)
    }

    func signOut() {
        twoFactorChallenge = nil
        token = nil
        userEmail = nil
        APIClient.shared.authToken = nil
        guard persistsSession else { return }
        KeychainStore.deleteEverywhere(tokenKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
        SharedSession.clear()
        InboxWidgetPublisher.clear()
    }

    private func persist(token: String, email: String?) {
        self.token = token
        self.userEmail = email
        // Set before any view reacts to `token`, so follow-up calls in the same flow are authed.
        APIClient.shared.authToken = token
        guard persistsSession else { return }
        KeychainStore.write(tokenKey, value: token, in: .app)
        if let email {
            UserDefaults.standard.set(email, forKey: emailKey)
        }
    }
}

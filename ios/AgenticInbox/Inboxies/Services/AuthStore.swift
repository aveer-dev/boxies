import Foundation
import Observation

/// Session store ≈ React context / Capacitor Preferences for the auth token.
@Observable
@MainActor
final class AuthStore {
    private let tokenKey = SharedSession.tokenKey
    private let emailKey = "mobileUserEmail"

    var token: String?
    var userEmail: String?
    var isAuthenticated: Bool { token != nil && !(token?.isEmpty ?? true) }
    var isBusy = false
    var errorMessage: String?
    /// Preview hosts keep session in memory so Canvas cannot wipe the real Keychain.
    var persistsSession: Bool

    init(persistsSession: Bool = true) {
        self.persistsSession = persistsSession
        // The token moved to the shared keychain group the AutoFill extension reads.
        if persistsSession {
            KeychainStore.migrateToSharedGroup(tokenKey)
        }
        token = KeychainStore.read(tokenKey)
        userEmail = UserDefaults.standard.string(forKey: emailKey)
    }

    func signInWithApple(identityToken: String, email: String?) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response: AuthResponse = try await APIClient.shared.request(
                path: "/api/v1/auth/apple",
                method: "POST",
                body: ["identityToken": identityToken],
                authed: false
            )
            persist(token: response.token, email: response.user.email ?? email)
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
        do {
            let response = try await APIClient.shared.passwordLogin(email: email, password: password)
            persist(token: response.token, email: response.email ?? email)
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

    func resetPassword(token: String? = nil, code: String? = nil, newPassword: String) async throws {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response = try await APIClient.shared.resetPassword(token: token, code: code, newPassword: newPassword)
            persist(token: response.token, email: response.email)
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func applySession(token: String, email: String?) {
        persist(token: token, email: email)
    }

    func signOut() {
        token = nil
        userEmail = nil
        guard persistsSession else { return }
        KeychainStore.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
        SharedSession.clear()
    }

    private func persist(token: String, email: String?) {
        self.token = token
        self.userEmail = email
        guard persistsSession else { return }
        KeychainStore.write(tokenKey, value: token)
        if let email {
            UserDefaults.standard.set(email, forKey: emailKey)
        }
    }
}

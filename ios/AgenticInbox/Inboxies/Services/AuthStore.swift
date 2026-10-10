import Security
import Foundation
import Observation

/// Session store ≈ React context / Capacitor Preferences for the auth token.
@Observable
@MainActor
final class AuthStore {
    private let tokenKey = KeychainStore.sessionTokenKey
    private let emailKey = "mobileUserEmail"

    var token: String?
    var userEmail: String?
    var isAuthenticated: Bool { token != nil && !(token?.isEmpty ?? true) }
    var isBusy = false
    var errorMessage: String?
    /// Preview hosts keep session in memory so Canvas cannot wipe the real Keychain.
    var persistsSession = true

    init() {
        token = KeychainStore.read(tokenKey)
        userEmail = UserDefaults.standard.string(forKey: emailKey)
        APIClient.shared.authToken = token
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

    func resetPassword(token: String? = nil, code: String? = nil, email: String? = nil, newPassword: String) async throws {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let response = try await APIClient.shared.resetPassword(token: token, code: code, email: email, newPassword: newPassword)
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
        APIClient.shared.authToken = nil
        guard persistsSession else { return }
        KeychainStore.delete(tokenKey)
        UserDefaults.standard.removeObject(forKey: emailKey)
    }

    private func persist(token: String, email: String?) {
        self.token = token
        self.userEmail = email
        // Set before any view reacts to `token`, so follow-up calls in the same flow are authed.
        APIClient.shared.authToken = token
        guard persistsSession else { return }
        KeychainStore.write(tokenKey, value: token)
        if let email {
            UserDefaults.standard.set(email, forKey: emailKey)
        }
    }
}

enum KeychainStore {
    static let sessionTokenKey = "mobileSessionToken"

    /// Readable after the first unlock so background push sync works while the
    /// device is locked.
    private static let accessibility = kSecAttrAccessibleAfterFirstUnlock

    static func write(_ key: String, value: String) {
        let data = Data(value.utf8)
        let match: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(match as CFDictionary)
        var add = match
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = accessibility
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let attributes = item as? [String: Any],
              let data = attributes[kSecValueData as String] as? Data,
              let value = String(data: data, encoding: .utf8) else { return nil }
        // Items saved by older builds used the default (WhenUnlocked) class; re-save once.
        if (attributes[kSecAttrAccessible as String] as? String) != (accessibility as String) {
            write(key, value: value)
        }
        return value
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

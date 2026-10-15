import AuthenticationServices
import Foundation

/// The AutoFill extension's own session: scoped to private emails, listed (and
/// revocable) under Settings → Devices & sessions. The app mints it while signed
/// in, hands it over through the shared keychain group, and revokes it on sign-out.
/// The app's full session never leaves the app's keychain group.
@MainActor
enum AutofillSession {
    private static let idKey = "autofillSessionId"
    private static let expiresAtKey = "autofillSessionExpiresAt"
    /// Rotate well before the 30-day expiry; the extension can't refresh itself.
    private static let renewWithin: TimeInterval = 7 * 24 * 60 * 60

    static var storedId: String? {
        UserDefaults.standard.string(forKey: idKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Mint the extension's session if it is missing, close to expiring, or was
    /// revoked (for example from Devices & sessions on another device).
    static func refreshIfNeeded(now: Date = Date()) async {
        if let token = SharedSession.token,
           storedId != nil,
           let expires = UserDefaults.standard.object(forKey: expiresAtKey) as? Date,
           expires.timeIntervalSince(now) > renewWithin,
           await isAlive(token) {
            return
        }
        let previousToken = SharedSession.token
        do {
            let session = try await APIClient.shared.createAutofillSession()
            SharedSession.setToken(session.token)
            UserDefaults.standard.set(session.id, forKey: idKey)
            if let expires = ISO8601DateFormatter.withFractionalSeconds.date(from: session.expiresAt)
                ?? ISO8601DateFormatter().date(from: session.expiresAt) {
                UserDefaults.standard.set(expires, forKey: expiresAtKey)
            }
            if let previousToken, previousToken != session.token {
                await end(previousToken)
            }
        } catch {
            // AutoFill shows "Open Inboxies and sign in" until the next try.
        }
    }

    /// Only a definite rejection counts as dead; offline keeps the current token.
    private static func isAlive(_ token: String) async -> Bool {
        do {
            let _: EmptyResponse = try await APIClient.shared.request(path: "/api/v1/me", bearerToken: token)
            return true
        } catch APIError.http(let status, _) where status == 401 || status == 403 {
            return false
        } catch {
            return true
        }
    }

    /// Drops the extension's session locally and returns its token, so the
    /// caller can end it on the server with `end(_:)`. Also empties the
    /// QuickType identities: every sign-out path comes through here.
    @discardableResult
    static func forget() -> String? {
        let token = SharedSession.token
        SharedSession.setToken(nil)
        UserDefaults.standard.removeObject(forKey: idKey)
        UserDefaults.standard.removeObject(forKey: expiresAtKey)
        enqueueIdentityUpdate { await PrivateEmailIdentities.removeAll() }
        return token
    }

    // MARK: QuickType identities

    /// Store writes run one after another, so a late snapshot can't overwrite
    /// a newer one or refill the store after sign-out.
    private static var identityUpdate: Task<Void, Never>?

    private static func enqueueIdentityUpdate(_ update: @escaping @MainActor () async -> Void) {
        let previous = identityUpdate
        identityUpdate = Task {
            await previous?.value
            await update()
        }
    }

    /// Registers the active mailbox's private emails as QuickType suggestions.
    static func publishIdentities(_ aliases: [MaskedAlias]) {
        #if DEBUG
        // `-previewAutofill` keeps the fixture identities from launch.
        if SharedSession.previewAutofill { return }
        #endif
        let emails = aliases.map(PrivateEmail.init(alias:))
        enqueueIdentityUpdate { await PrivateEmailIdentities.replace(with: emails) }
    }

    /// Launch and mailbox switch: reloads the mailbox's private emails for the
    /// store. Skips the request while Inboxies isn't the AutoFill provider.
    static func refreshIdentities(mailboxId: String?) async {
        #if DEBUG
        if SharedSession.previewAutofill { return }
        #endif
        guard let mailboxId,
              await ASCredentialIdentityStore.shared.state().isEnabled,
              let aliases = try? await APIClient.shared.listAliases(mailboxId: mailboxId) else { return }
        publishIdentities(aliases)
    }

    /// Ends a forgotten extension session on the server. The session logs
    /// itself out, so this works even when the app's own session is gone.
    nonisolated static func end(_ token: String?) async {
        guard let token else { return }
        try? await APIClient.shared.logout(sessionToken: token)
    }
}

extension PrivateEmail {
    init(alias: MaskedAlias) {
        self.init(
            id: alias.id,
            address: alias.aliasEmail,
            label: alias.label,
            isActive: alias.isActive,
            expiresAt: alias.expiresAt
        )
    }
}

extension ISO8601DateFormatter {
    /// Server timestamps come from `Date.toISOString()` (milliseconds).
    static let withFractionalSeconds: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

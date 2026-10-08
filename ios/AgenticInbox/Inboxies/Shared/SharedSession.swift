import Foundation
import Security

/// Session state the app shares with the AutoFill extension (compiled into both).
/// The token lives in the shared keychain group; the active mailbox and a
/// non-default API origin live in the app group. The app writes, the extension reads.
enum SharedSession {
    static let appGroupId = "group.co.inboxies.app"
    static let tokenKey = "mobileSessionToken"

    private static let mailboxIdKey = "activeMailboxId"
    private static let apiBaseURLKey = "apiBaseURL"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static var token: String? {
        KeychainStore.read(tokenKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    static var activeMailboxId: String? {
        defaults?.string(forKey: mailboxIdKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    static var apiBaseURL: URL {
        defaults?.string(forKey: apiBaseURLKey).flatMap(AppConfig.parseAPIBaseURL)
            ?? AppConfig.defaultAPIBaseURL
    }

    /// App only: mirrors the selected mailbox, plus the API origin when it isn't the default.
    static func publish(mailboxId: String?, apiBaseURL: URL) {
        guard let defaults else { return }
        if let mailboxId, !mailboxId.isEmpty {
            defaults.set(mailboxId, forKey: mailboxIdKey)
        } else {
            defaults.removeObject(forKey: mailboxIdKey)
        }
        if apiBaseURL == AppConfig.defaultAPIBaseURL {
            defaults.removeObject(forKey: apiBaseURLKey)
        } else {
            defaults.set(apiBaseURL.absoluteString, forKey: apiBaseURLKey)
        }
    }

    /// App only: sign-out leaves nothing for the extension to act on.
    static func clear() {
        defaults?.removeObject(forKey: mailboxIdKey)
        defaults?.removeObject(forKey: apiBaseURLKey)
    }
}

/// Generic-password items in the shared access group `<TeamID>.co.inboxies.shared`.
/// Falls back to the default group when the build has no expanded group (unsigned builds).
enum KeychainStore {
    /// From the `KeychainAccessGroup` Info.plist key (`$(AppIdentifierPrefix)co.inboxies.shared`),
    /// so the team id is never hardcoded.
    static let accessGroup: String? = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
            return nil
        }
        let group = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !group.isEmpty, !group.contains("$(") else { return nil }
        return group
    }()

    static func write(_ key: String, value: String) {
        var query = baseQuery(key, group: accessGroup)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(value.utf8)
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecMissingEntitlement, accessGroup != nil {
            var fallback = baseQuery(key, group: nil)
            SecItemDelete(fallback as CFDictionary)
            fallback[kSecValueData as String] = Data(value.utf8)
            SecItemAdd(fallback as CFDictionary, nil)
        }
    }

    static func read(_ key: String) -> String? {
        if let accessGroup, let value = readData(baseQuery(key, group: accessGroup)) {
            return String(data: value, encoding: .utf8)
        }
        return readData(baseQuery(key, group: nil)).flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Without an access group this removes the item from every group the caller can see.
    static func delete(_ key: String) {
        SecItemDelete(baseQuery(key, group: nil) as CFDictionary)
    }

    /// One-time move of an item saved before the shared group existed (it sits in the
    /// app's own application-identifier group, which the extension can't read).
    static func migrateToSharedGroup(_ key: String) {
        guard let accessGroup else { return }
        if readData(baseQuery(key, group: accessGroup)) != nil { return }

        var legacyQuery = baseQuery(key, group: nil)
        legacyQuery[kSecReturnAttributes as String] = true
        legacyQuery[kSecReturnData as String] = true
        legacyQuery[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(legacyQuery as CFDictionary, &item) == errSecSuccess,
              let attributes = item as? [String: Any],
              let data = attributes[kSecValueData as String] as? Data,
              let legacyGroup = attributes[kSecAttrAccessGroup as String] as? String,
              legacyGroup != accessGroup else { return }

        var shared = baseQuery(key, group: accessGroup)
        shared[kSecValueData as String] = data
        let status = SecItemAdd(shared as CFDictionary, nil)
        guard status == errSecSuccess || status == errSecDuplicateItem else { return }
        SecItemDelete(baseQuery(key, group: legacyGroup) as CFDictionary)
    }

    private static func baseQuery(_ key: String, group: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        if let group {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    private static func readData(_ base: [String: Any]) -> Data? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }
}

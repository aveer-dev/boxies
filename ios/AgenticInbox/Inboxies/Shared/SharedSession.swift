import Foundation
import Security

/// Session state the app shares with the AutoFill extension (compiled into both).
/// The extension gets its own scoped token (private emails only) in the shared
/// keychain group; the app's full session stays in the app's own group. The
/// active mailbox and a non-default API origin live in the app group. The app
/// writes, the extension reads.
enum SharedSession {
    static let appGroupId = "group.co.inboxies.app"
    /// The AutoFill extension's scoped session token (shared keychain group).
    static let tokenKey = "autofillSessionToken"

    private static let mailboxIdKey = "activeMailboxId"
    private static let apiBaseURLKey = "apiBaseURL"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static var token: String? {
        KeychainStore.read(tokenKey, in: .shared).flatMap { $0.isEmpty ? nil : $0 }
    }

    static var activeMailboxId: String? {
        defaults?.string(forKey: mailboxIdKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    static var apiBaseURL: URL {
        defaults?.string(forKey: apiBaseURLKey).flatMap(AppConfig.parseAPIBaseURL)
            ?? AppConfig.defaultAPIBaseURL
    }

    /// App only: hands the extension its scoped token.
    static func setToken(_ token: String?) {
        if let token, !token.isEmpty {
            KeychainStore.write(tokenKey, value: token, in: .shared)
        } else {
            KeychainStore.delete(tokenKey, in: .shared)
        }
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
        setToken(nil)
        defaults?.removeObject(forKey: mailboxIdKey)
        defaults?.removeObject(forKey: apiBaseURLKey)
    }
}

/// Generic-password items in an explicit keychain access group:
/// - `.shared`: `<TeamID>.co.inboxies.shared`, readable by the AutoFill extension.
/// - `.app`: the app's own `<TeamID>.<bundle id>` group, which no extension can read.
/// Both fall back to the default group when the build has no expanded team prefix
/// (unsigned simulator builds).
enum KeychainStore {
    enum Group {
        case shared
        case app
    }

    /// From the `KeychainAccessGroup` Info.plist key (`$(AppIdentifierPrefix)co.inboxies.shared`),
    /// so the team id is never hardcoded.
    static let accessGroup: String? = {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "KeychainAccessGroup") as? String else {
            return nil
        }
        let group = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !group.isEmpty, !group.contains("$("), group.contains(".") else { return nil }
        return group
    }()

    /// `<TeamID>.<bundle id>`: always in the app's access groups (application-identifier).
    /// Named explicitly because writes without a group land in the *first*
    /// keychain-access-groups entry, which is the shared one.
    static let appAccessGroup: String? = {
        guard let accessGroup, let bundleId = Bundle.main.bundleIdentifier,
              let suffix = accessGroup.range(of: "co.inboxies.shared", options: .backwards) else { return nil }
        let prefix = String(accessGroup[..<suffix.lowerBound])
        guard !prefix.isEmpty else { return nil }
        return prefix + bundleId
    }()

    /// Readable after the first unlock so background push sync works while the
    /// device is locked.
    private static let accessibility = kSecAttrAccessibleAfterFirstUnlock

    private static func groupName(_ group: Group) -> String? {
        switch group {
        case .shared: return accessGroup
        case .app: return appAccessGroup
        }
    }

    static func write(_ key: String, value: String, in group: Group) {
        let name = groupName(group)
        var query = baseQuery(key, group: name)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = accessibility
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecMissingEntitlement, name != nil {
            var fallback = baseQuery(key, group: nil)
            SecItemDelete(fallback as CFDictionary)
            fallback[kSecValueData as String] = Data(value.utf8)
            fallback[kSecAttrAccessible as String] = accessibility
            SecItemAdd(fallback as CFDictionary, nil)
        }
    }

    static func read(_ key: String, in group: Group) -> String? {
        let name = groupName(group)
        // With a group name, look only there: a group-less query would also
        // match the same key in the other group.
        let item = name.flatMap { readItem(baseQuery(key, group: $0)) }
            ?? (name == nil || !entitled ? readItem(baseQuery(key, group: nil)) : nil)
        guard let item, let value = String(data: item.data, encoding: .utf8) else { return nil }
        // Items saved by older builds used the default (WhenUnlocked) class; re-save once.
        if item.accessible != (accessibility as String) {
            write(key, value: value, in: group)
        }
        return value
    }

    static func delete(_ key: String, in group: Group) {
        let name = groupName(group)
        SecItemDelete(baseQuery(key, group: name) as CFDictionary)
        if name == nil || !entitled {
            SecItemDelete(baseQuery(key, group: nil) as CFDictionary)
        }
    }

    /// Removes the item from every group the caller can see.
    static func deleteEverywhere(_ key: String) {
        SecItemDelete(baseQuery(key, group: nil) as CFDictionary)
    }

    /// One-time move of the app session out of the shared group, where builds
    /// before scoped AutoFill sessions kept it (the extension could read it).
    static func moveToAppGroup(_ key: String) {
        guard let shared = accessGroup, let app = appAccessGroup,
              let data = readData(baseQuery(key, group: shared)) else { return }
        if readData(baseQuery(key, group: app)) == nil {
            var moved = baseQuery(key, group: app)
            moved[kSecValueData as String] = data
            moved[kSecAttrAccessible as String] = accessibility
            let status = SecItemAdd(moved as CFDictionary, nil)
            guard status == errSecSuccess || status == errSecDuplicateItem else { return }
        }
        SecItemDelete(baseQuery(key, group: shared) as CFDictionary)
    }

    /// False on hosts without keychain access groups (unsigned builds), where
    /// every item lives in the default group.
    private static let entitled: Bool = {
        guard let accessGroup else { return false }
        let probe = "inboxies-keychain-probe"
        var query = baseQuery(probe, group: accessGroup)
        query[kSecValueData as String] = Data()
        let status = SecItemAdd(query as CFDictionary, nil)
        SecItemDelete(baseQuery(probe, group: accessGroup) as CFDictionary)
        return status != errSecMissingEntitlement
    }()

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

    private static func readItem(_ base: [String: Any]) -> (data: Data, accessible: String?)? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecReturnAttributes as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let attributes = item as? [String: Any],
              let data = attributes[kSecValueData as String] as? Data else { return nil }
        return (data, attributes[kSecAttrAccessible as String] as? String)
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

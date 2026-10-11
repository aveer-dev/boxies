import Foundation
import Security

/// Session values in the Keychain. Compiled into the app and the Private email
/// AutoFill extension: items live in a keychain group both can read, so the
/// extension creates addresses with the signed-in session.
enum KeychainStore {
    static let sessionTokenKey = "mobileSessionToken"
    /// API origin the session token was issued by (DEBUG `-apiBase` builds differ from production).
    static let apiBaseKey = "mobileAPIBase"
    /// Mailbox the AutoFill extension creates private addresses for by default.
    static let autofillMailboxIdKey = "autofillMailboxId"

    /// Readable after the first unlock so background push sync works while the
    /// device is locked.
    private static let accessibility = kSecAttrAccessibleAfterFirstUnlock

    /// `<team prefix>co.inboxies.shared`, from the `AppIdentifierPrefix` Info.plist key both targets set.
    static let sharedAccessGroup: String? = {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String,
              !prefix.isEmpty, !prefix.contains("$(") else { return nil }
        return prefix + "co.inboxies.shared"
    }()

    static func write(_ key: String, value: String) {
        delete(key)
        var add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: accessibility,
        ]
        if let sharedAccessGroup {
            add[kSecAttrAccessGroup as String] = sharedAccessGroup
            if SecItemAdd(add as CFDictionary, nil) == errSecSuccess { return }
            // Builds without the keychain-sharing entitlement (unsigned simulator
            // builds) keep the item in the app's own group; only AutoFill loses it.
            add.removeValue(forKey: kSecAttrAccessGroup as String)
        }
        SecItemAdd(add as CFDictionary, nil)
    }

    /// Searches every group this target can read, so items saved by older builds
    /// (app-private group) are still found.
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
        // Items saved by older builds used the default (WhenUnlocked) class and the
        // app-private group; re-save once so background sync and AutoFill can read them.
        let staleAccessibility = (attributes[kSecAttrAccessible as String] as? String) != (accessibility as String)
        let outsideSharedGroup = sharedAccessGroup.map { $0 != attributes[kSecAttrAccessGroup as String] as? String } ?? false
        if staleAccessibility || outsideSharedGroup {
            write(key, value: value)
        }
        return value
    }

    /// Removes the item from every group this target can read.
    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

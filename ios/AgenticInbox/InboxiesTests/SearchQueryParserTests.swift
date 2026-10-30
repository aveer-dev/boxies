import XCTest
@testable import Inboxies

final class SearchQueryParserTests: XCTestCase {
    func testParsesMixedFreeTextAndOperators() {
        let parsed = SearchQueryParser.parse("hello from:alice@x.com is:unread")
        XCTAssertEqual(parsed.query, "hello")
        XCTAssertEqual(parsed.from, "alice@x.com")
        XCTAssertEqual(parsed.isRead, false)
        XCTAssertTrue(parsed.hasStructuredFilters)
        XCTAssertEqual(
            parsed.apiQueryItems,
            [
                "query": "hello",
                "from": "alice@x.com",
                "is_read": "false",
            ]
        )
    }

    func testParsesQuotedValuesAndDates() {
        let parsed = SearchQueryParser.parse(#"from:"John Doe" has:attachment before:2025-01-01"#)
        XCTAssertEqual(parsed.query, "")
        XCTAssertEqual(parsed.from, "John Doe")
        XCTAssertEqual(parsed.hasAttachment, true)
        XCTAssertEqual(parsed.dateEnd, "2025-01-01T00:00:00Z")
        XCTAssertEqual(parsed.apiQueryItems["has_attachment"], "true")
        XCTAssertEqual(parsed.apiQueryItems["date_end"], "2025-01-01T00:00:00Z")
    }

    func testParsesSlashDatesLikeWeb() {
        let parsed = SearchQueryParser.parse("before:01/01/2025 after:12/31/2024")
        XCTAssertEqual(parsed.dateEnd, "2025-01-01T00:00:00Z")
        XCTAssertEqual(parsed.dateStart, "2024-12-31T00:00:00Z")
    }

    func testLastDuplicateOperatorWins() {
        let parsed = SearchQueryParser.parse("from:a from:b is:starred in:sent")
        XCTAssertEqual(parsed.from, "b")
        XCTAssertEqual(parsed.isStarred, true)
        XCTAssertEqual(parsed.folder, "sent")
    }

    func testStripsInvalidHasButKeepsFreeText() {
        let parsed = SearchQueryParser.parse("has:foo leftover")
        XCTAssertEqual(parsed.query, "leftover")
        XCTAssertNil(parsed.hasAttachment)
        XCTAssertFalse(parsed.hasStructuredFilters)
    }

    func testParsesReplyLaterOperator() {
        let parsed = SearchQueryParser.parse("is:reply-later meeting")
        XCTAssertEqual(parsed.query, "meeting")
        XCTAssertEqual(parsed.isReplyLater, true)
        XCTAssertEqual(parsed.apiQueryItems["is_reply_later"], "true")
        let alias = SearchQueryParser.parse("is:reply_later is:starred")
        XCTAssertEqual(alias.isReplyLater, true)
        XCTAssertEqual(alias.isStarred, true)
    }
}

final class DeliveryStatusTests: XCTestCase {
    func testFailureOnly() {
        XCTAssertTrue(DeliveryStatusHelpers.isFailure("failed"))
        XCTAssertTrue(DeliveryStatusHelpers.isFailure("bounced"))
        XCTAssertTrue(DeliveryStatusHelpers.isFailure("complained"))
        XCTAssertFalse(DeliveryStatusHelpers.isFailure("queued"))
        XCTAssertFalse(DeliveryStatusHelpers.isFailure("accepted"))
        XCTAssertFalse(DeliveryStatusHelpers.isFailure(nil))
    }

    func testLabelsMatchWeb() {
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "failed"), "Send failed")
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "bounced"), "Bounced")
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "complained"), "Marked as spam")
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "queued"), "Sending")
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "accepted"), "Sent")
    }
}

final class UserEmailsFromAclTests: XCTestCase {
    func testFiltersOutSubAndAccountAndUserKeys() {
        let keys = [
            "email:admin@example.com",
            "sub:google-oauth2|1029384756",
            "user:uuid-1234",
            "account:acc-5678",
            "direct@inboxies.email",
            "invalid_no_at_sign",
        ]
        let extracted = userEmailsFromAcl(keys)
        XCTAssertEqual(extracted, ["admin@example.com", "direct@inboxies.email"])
    }

    func testHandlesNilAndEmpty() {
        XCTAssertEqual(userEmailsFromAcl(nil), [])
        XCTAssertEqual(userEmailsFromAcl([]), [])
    }

    func testDeduplicatesCaseInsensitively() {
        let keys = ["email:Admin@example.com", "email:admin@example.com"]
        XCTAssertEqual(userEmailsFromAcl(keys), ["Admin@example.com"])
    }
}

final class AccountSecurityTests: XCTestCase {
    func testAppleNonceIsRandomAndHashedAsLowercaseHex() {
        let first = AppleSignInNonce.make()
        let second = AppleSignInNonce.make()
        XCTAssertEqual(first.count, 32)
        XCTAssertNotEqual(first, second)
        // SHA-256("abc"), as the server compares it.
        XCTAssertEqual(
            AppleSignInNonce.sha256("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testSessionTitlesFromLabelsAndUserAgents() {
        func session(label: String? = nil, agent: String?) -> AccountSession {
            AccountSession(
                id: "s", label: label, scope: nil, userAgent: agent, ipAddress: nil,
                createdAt: "", lastActiveAt: "", expiresAt: "", current: false
            )
        }
        XCTAssertEqual(SessionsSettingsView.title(session(label: "iPhone AutoFill", agent: nil)), "iPhone AutoFill")
        XCTAssertEqual(SessionsSettingsView.title(session(agent: "Inboxies/1 CFNetwork/1490 Darwin/24.0.0")), "Inboxies for iPhone")
        XCTAssertEqual(SessionsSettingsView.title(session(agent: "okhttp/4.12.0")), "Inboxies for Android")
        XCTAssertEqual(
            SessionsSettingsView.title(session(agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15")),
            "Safari on Mac"
        )
        XCTAssertEqual(
            SessionsSettingsView.title(session(agent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36")),
            "Chrome on Windows"
        )
        XCTAssertEqual(SessionsSettingsView.title(session(agent: nil)), "Unknown device")
    }

    func testSettingsSaveNeverSendsAcl() throws {
        var settings = MailboxSettings()
        settings.fromName = "Alex"
        settings.acl = MailboxAcl(owners: ["email:a@example.com"], members: [])
        let payload = try APIClient.settingsPayload(settings)
        XCTAssertNil(payload["acl"])
        XCTAssertEqual(payload["fromName"] as? String, "Alex")
    }

    func testInviteAcceptDecodesWithoutTokenWhenSignedIn() throws {
        let json = Data(#"{"mailboxId":"team@inboxies.email","userId":"u1","accountId":"u1"}"#.utf8)
        let decoded = try JSONDecoder().decode(InviteAcceptResponse.self, from: json)
        XCTAssertNil(decoded.token)
        XCTAssertEqual(decoded.mailboxId, "team@inboxies.email")
    }
}

final class SharedSessionTests: XCTestCase {
    /// The app session saved by builds that kept it in the shared group (where
    /// the AutoFill extension could read it) moves into the app's own group.
    func testAppSessionMovesOutOfSharedGroup() throws {
        let shared = try XCTUnwrap(KeychainStore.accessGroup, "KeychainAccessGroup was not expanded in this build")
        // Unsigned builds (CI) have no team prefix, so there is no named app group.
        // Throw the skip directly: inside XCTUnwrap's autoclosure it is reported as a failure.
        guard let appGroup = KeychainStore.appAccessGroup else {
            throw XCTSkip("No team prefix in this build")
        }
        let key = "test-migration-\(UUID().uuidString)"
        defer { KeychainStore.deleteEverywhere(key) }

        let legacy: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: shared,
            kSecValueData as String: Data("legacy-token".utf8),
        ]
        let status = SecItemAdd(legacy as CFDictionary, nil)
        try XCTSkipIf(status == errSecMissingEntitlement, "Keychain access groups are unavailable on this host")
        XCTAssertEqual(status, errSecSuccess)

        KeychainStore.moveToAppGroup(key)

        XCTAssertEqual(stored(key, group: appGroup), "legacy-token")
        XCTAssertNil(stored(key, group: shared))
        XCTAssertEqual(KeychainStore.read(key, in: .app), "legacy-token")
        XCTAssertNil(KeychainStore.read(key, in: .shared))
    }

    /// Items saved with the old backup-able class are moved to ThisDeviceOnly
    /// on read, keeping the token (nobody is signed out by the update).
    func testReadMigratesLegacyAccessibilityInPlace() throws {
        let key = "test-accessibility-\(UUID().uuidString)"
        defer { KeychainStore.deleteEverywhere(key) }

        var legacy: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: Data("legacy-token".utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        if let shared = KeychainStore.accessGroup {
            legacy[kSecAttrAccessGroup as String] = shared
        }
        var status = SecItemAdd(legacy as CFDictionary, nil)
        if status == errSecMissingEntitlement {
            // Unsigned host: KeychainStore falls back to the default group.
            legacy.removeValue(forKey: kSecAttrAccessGroup as String)
            status = SecItemAdd(legacy as CFDictionary, nil)
        }
        XCTAssertEqual(status, errSecSuccess)
        XCTAssertEqual(accessibility(key), kSecAttrAccessibleAfterFirstUnlock as String)

        XCTAssertEqual(KeychainStore.read(key, in: .shared), "legacy-token")

        XCTAssertEqual(accessibility(key), kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertEqual(KeychainStore.read(key, in: .shared), "legacy-token")
        XCTAssertEqual(itemCount(key), 1)
    }

    func testWriteStoresThisDeviceOnly() throws {
        let key = "test-write-\(UUID().uuidString)"
        defer { KeychainStore.deleteEverywhere(key) }

        KeychainStore.write(key, value: "fresh-token", in: .app)
        XCTAssertEqual(KeychainStore.read(key, in: .app), "fresh-token")
        XCTAssertEqual(accessibility(key), kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)

        KeychainStore.write(key, value: "fresh-token", in: .shared)
        XCTAssertEqual(KeychainStore.read(key, in: .shared), "fresh-token")
    }

    func testPublishMirrorsMailboxAndOnlyNonDefaultAPIOrigin() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: SharedSession.appGroupId))
        let savedMailbox = defaults.object(forKey: "activeMailboxId")
        let savedOrigin = defaults.object(forKey: "apiBaseURL")
        defer {
            defaults.set(savedMailbox, forKey: "activeMailboxId")
            defaults.set(savedOrigin, forKey: "apiBaseURL")
        }

        SharedSession.publish(mailboxId: "me@inboxies.email", apiBaseURL: AppConfig.defaultAPIBaseURL)
        XCTAssertEqual(SharedSession.activeMailboxId, "me@inboxies.email")
        XCTAssertNil(defaults.string(forKey: "apiBaseURL"))
        XCTAssertEqual(SharedSession.apiBaseURL, AppConfig.defaultAPIBaseURL)

        let staging = URL(string: "https://staging.inboxies.email")!
        SharedSession.publish(mailboxId: "me@inboxies.email", apiBaseURL: staging)
        XCTAssertEqual(SharedSession.apiBaseURL, staging)

        SharedSession.clear()
        XCTAssertNil(SharedSession.activeMailboxId)
        XCTAssertEqual(SharedSession.apiBaseURL, AppConfig.defaultAPIBaseURL)
    }

    /// `kSecAttrAccessible` of the single item for `key`, in any group.
    private func accessibility(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let attributes = item as? [String: Any] else { return nil }
        return attributes[kSecAttrAccessible as String] as? String
    }

    private func itemCount(_ key: String) -> Int {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var items: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &items) == errSecSuccess else { return 0 }
        return (items as? [[String: Any]])?.count ?? 0
    }

    private func stored(_ key: String, group: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: group,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

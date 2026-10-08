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

final class SharingSettingsViewTests: XCTestCase {
    func testIsUserAccountKeyFiltersOutSubAndUser() {
        XCTAssertTrue(SharingSettingsView.isUserAccountKey("email:admin@example.com"))
        XCTAssertTrue(SharingSettingsView.isUserAccountKey("account:acc-1234"))
        XCTAssertTrue(SharingSettingsView.isUserAccountKey("ada@example.com"))
        XCTAssertFalse(SharingSettingsView.isUserAccountKey("sub:google-oauth2|1029384756"))
        XCTAssertFalse(SharingSettingsView.isUserAccountKey("sub:apple|001122"))
        XCTAssertFalse(SharingSettingsView.isUserAccountKey("user:usr-5678"))
    }
}

final class SharedSessionTests: XCTestCase {
    /// A token saved before the shared keychain group existed moves into it,
    /// and the copy in the app's own group is removed.
    func testKeychainMigrationMovesLegacyItemIntoSharedGroup() throws {
        let shared = try XCTUnwrap(KeychainStore.accessGroup, "KeychainAccessGroup was not expanded in this build")
        let prefix = String(shared.dropLast("co.inboxies.shared".count))
        let legacyGroup = prefix + "co.inboxies.app"
        let key = "test-migration-\(UUID().uuidString)"
        defer { KeychainStore.delete(key) }

        let legacy: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: legacyGroup,
            kSecValueData as String: Data("legacy-token".utf8),
        ]
        let status = SecItemAdd(legacy as CFDictionary, nil)
        try XCTSkipIf(status == errSecMissingEntitlement, "Keychain access groups are unavailable on this host")
        XCTAssertEqual(status, errSecSuccess)

        KeychainStore.migrateToSharedGroup(key)

        XCTAssertEqual(stored(key, group: shared), "legacy-token")
        XCTAssertNil(stored(key, group: legacyGroup))
        XCTAssertEqual(KeychainStore.read(key), "legacy-token")
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

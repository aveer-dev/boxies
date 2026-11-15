import XCTest
@testable import Inboxies

/// Watch phase 3a (AVE-146): the complication's snapshot store and the phone → watch
/// glance update sent after a new-mail push.
final class WatchGlanceTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "WatchGlanceTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testAppGroupMatchesTheAppAndWidgets() {
        XCTAssertEqual(WatchGlanceStore.appGroupId, SharedSession.appGroupId)
    }

    func testSnapshotClampsAndDropsTheSenderAtInboxZero() {
        XCTAssertEqual(WatchGlanceSnapshot(mailboxId: "m", unreadCount: -2, newestSender: "Maya").unreadCount, 0)
        XCTAssertNil(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 0, newestSender: "Maya").newestSender)
        XCTAssertNil(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 2, newestSender: "  ").newestSender)
        XCTAssertEqual(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 2, newestSender: " Maya Chen ").newestSender, "Maya Chen")
    }

    func testRelevanceIsZeroAtInboxZeroAndCapped() {
        XCTAssertEqual(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 0, newestSender: nil).relevanceScore, 0)
        XCTAssertEqual(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 3, newestSender: "A").relevanceScore, 3)
        XCTAssertEqual(WatchGlanceSnapshot(mailboxId: "m", unreadCount: 500, newestSender: "A").relevanceScore, 20)
    }

    func testStoreWritesOnlyChangedContentAndClears() {
        let store = WatchGlanceStore(defaults: defaults)
        XCTAssertNil(store.read())
        XCTAssertFalse(store.clear())

        let first = WatchGlanceSnapshot(mailboxId: "m", unreadCount: 3, newestSender: "Maya Chen", updatedAt: Date(timeIntervalSince1970: 100))
        XCTAssertTrue(store.write(first))
        XCTAssertEqual(store.read(), first)

        // Only the stamp moved: no write, so no widget reload.
        let restamped = WatchGlanceSnapshot(mailboxId: "m", unreadCount: 3, newestSender: "Maya Chen", updatedAt: Date(timeIntervalSince1970: 200))
        XCTAssertFalse(store.write(restamped))
        XCTAssertEqual(store.read()?.updatedAt, first.updatedAt)

        let fewer = WatchGlanceSnapshot(mailboxId: "m", unreadCount: 2, newestSender: "Maya Chen")
        XCTAssertTrue(store.write(fewer))
        XCTAssertEqual(store.read()?.unreadCount, 2)

        XCTAssertTrue(store.clear())
        XCTAssertNil(store.read())
    }

    func testUpdateRoundTripsAndNeverCarriesAToken() {
        let update = WatchGlanceUpdate(mailboxId: "hello@ada.studio", unreadCount: 4, newestSender: "Maya Chen")
        let message = update.message
        XCTAssertEqual(Set(message.keys), ["kind", "mailboxId", "unreadCount", "newestSender"])
        XCTAssertEqual(WatchHandoff.kind(of: message), .glance)
        XCTAssertEqual(WatchGlanceUpdate(message: message), update)
        XCTAssertEqual(update.snapshot(now: Date(timeIntervalSince1970: 5))?.unreadCount, 4)
    }

    func testHintOnlyUpdateHasNoSnapshot() {
        let hint = WatchGlanceUpdate(mailboxId: "m", unreadCount: nil, newestSender: nil)
        XCTAssertEqual(Set(hint.message.keys), ["kind", "mailboxId"])
        XCTAssertEqual(WatchGlanceUpdate(message: hint.message), hint)
        XCTAssertNil(hint.snapshot())
    }

    func testUpdateRejectsWrongKindAndMissingMailbox() {
        var wrongKind = WatchGlanceUpdate(mailboxId: "m", unreadCount: 1, newestSender: nil).message
        wrongKind["kind"] = WatchHandoff.Kind.session.rawValue
        XCTAssertNil(WatchGlanceUpdate(message: wrongKind))
        var noMailbox = WatchGlanceUpdate(mailboxId: "m", unreadCount: 1, newestSender: nil).message
        noMailbox["mailboxId"] = ""
        XCTAssertNil(WatchGlanceUpdate(message: noMailbox))
        // A glance is never mistaken for a session grant.
        XCTAssertNil(WatchSessionGrant(message: WatchGlanceUpdate(mailboxId: "m", unreadCount: 1, newestSender: nil).message))
    }

    func testPhoneWidgetSnapshotFeedsTheComplication() {
        let update = InboxWidgetSnapshot.sampleHasMail.watchGlanceUpdate
        XCTAssertEqual(update.mailboxId, InboxWidgetSnapshot.sampleHasMail.mailboxId)
        XCTAssertEqual(update.unreadCount, InboxWidgetSnapshot.sampleHasMail.newCount)
        XCTAssertEqual(update.newestSender, InboxWidgetSnapshot.sampleHasMail.threads.first?.senderName)

        let zero = InboxWidgetSnapshot.sampleInboxZero.watchGlanceUpdate
        XCTAssertEqual(zero.unreadCount, 0)
        XCTAssertNil(zero.snapshot()?.newestSender)
    }
}

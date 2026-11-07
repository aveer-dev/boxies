import XCTest
@testable import Inboxies

/// "Today's inbox" widget (AVE-149): snapshot encoding, the App Group store, the ›
/// flip intent, deep links, relevance and building a snapshot from the Inbox.
final class InboxWidgetTests: XCTestCase {
    private var directory: URL!
    private var defaults: UserDefaults!
    private var suiteName: String!
    private var store: InboxWidgetStore!

    override func setUp() {
        super.setUp()
        suiteName = "InboxWidgetTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("InboxWidgetTests-\(UUID().uuidString)", isDirectory: true)
        store = InboxWidgetStore(defaults: defaults, directory: directory)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func snapshot(
        mailboxId: String = "you@acme.com",
        newCount: Int = 3,
        threadIds: [String] = ["t-1", "t-2", "t-3"],
        updatedAt: Date = Date(timeIntervalSince1970: 1_800_000_000)
    ) -> InboxWidgetSnapshot {
        InboxWidgetSnapshot(
            mailboxId: mailboxId,
            mailboxAddress: mailboxId,
            newCount: newCount,
            replyLaterCount: 2,
            threads: threadIds.enumerated().map { index, id in
                .init(
                    id: id,
                    senderName: "Sender \(index)",
                    subject: "Subject \(index)",
                    receivedAt: Date(timeIntervalSince1970: 1_799_999_000).addingTimeInterval(-Double(index) * 60.5)
                )
            },
            updatedAt: updatedAt
        )
    }

    // MARK: - Encoding

    func testSnapshotRoundTripsThroughJSON() throws {
        let original = InboxWidgetSnapshot.sampleHasMail
        let decoded = try InboxWidgetSnapshot.decode(original.encoded())
        XCTAssertEqual(decoded, original)
        XCTAssertEqual(decoded.threads.count, InboxWidgetSnapshot.maxThreads)
    }

    func testSnapshotWireShapeIsStable() throws {
        // The widget extension can ship ahead of or behind the app; keep the keys stable.
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: snapshot(threadIds: ["t-1"]).encoded()) as? [String: Any]
        )
        XCTAssertEqual(
            Set(json.keys),
            ["mailboxId", "mailboxAddress", "newCount", "replyLaterCount", "threads", "updatedAt"]
        )
        let thread = try XCTUnwrap((json["threads"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(thread.keys), ["id", "senderName", "subject", "receivedAt"])
        XCTAssertEqual(json["updatedAt"] as? Double, 1_800_000_000)
    }

    func testSnapshotDecodesSecondsSince1970() throws {
        let data = Data("""
        {"mailboxId":"m","mailboxAddress":"m@x.com","newCount":0,"replyLaterCount":0,
         "threads":[],"updatedAt":1800000000}
        """.utf8)
        let decoded = try InboxWidgetSnapshot.decode(data)
        XCTAssertTrue(decoded.isInboxZero)
        XCTAssertEqual(decoded.updatedAt, Date(timeIntervalSince1970: 1_800_000_000))
    }

    // MARK: - Store

    func testStoreWritesAndReadsPerMailbox() {
        XCTAssertNil(store.snapshot(mailboxId: "you@acme.com"))
        XCTAssertTrue(store.write(snapshot()))
        XCTAssertTrue(store.write(snapshot(mailboxId: "team@acme.com", newCount: 1, threadIds: ["x"])))
        XCTAssertEqual(store.snapshot(mailboxId: "you@acme.com")?.newCount, 3)
        XCTAssertEqual(store.snapshot(mailboxId: "team@acme.com")?.threads.map(\.id), ["x"])
    }

    func testFileNamesStayInASafeAlphabet() {
        let name = store.snapshotURL(mailboxId: "a/../b@acme.com").lastPathComponent
        XCTAssertFalse(name.contains("/"))
        XCTAssertEqual(name, "snapshot-a%2F%2E%2E%2Fb%40acme%2Ecom.json")
    }

    func testRewritingTheSameContentIsANoOp() {
        XCTAssertTrue(store.write(snapshot()))
        // Only the timestamp moved: no write, so no widget reload.
        XCTAssertFalse(store.write(snapshot(updatedAt: Date(timeIntervalSince1970: 1_800_000_900))))
        XCTAssertTrue(store.write(snapshot(newCount: 4)))
    }

    func testMailboxListRoundTrips() {
        let refs = [
            InboxWidgetStore.MailboxRef(id: "a", address: "a@acme.com"),
            InboxWidgetStore.MailboxRef(id: "b", address: "b@acme.com"),
        ]
        XCTAssertTrue(store.writeMailboxes(refs))
        XCTAssertFalse(store.writeMailboxes(refs))
        XCTAssertEqual(store.mailboxes(), refs)
    }

    func testRemoveAllClearsEverything() {
        store.write(snapshot())
        store.writeMailboxes([.init(id: "a", address: "a@acme.com")])
        ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store)
        store.removeAll()
        XCTAssertNil(store.snapshot(mailboxId: "you@acme.com"))
        XCTAssertEqual(store.mailboxes(), [])
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 0)
        XCTAssertNil(store.newCountRoseAt(mailboxId: "you@acme.com"))
    }

    // MARK: - Flip intent

    func testNextFlipsThroughTheDeckAndWraps() {
        store.write(snapshot())
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 0)
        XCTAssertEqual(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store), 1)
        XCTAssertEqual(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store), 2)
        XCTAssertEqual(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store), 0)
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 0)
    }

    func testNextIsPerMailbox() {
        store.write(snapshot())
        store.write(snapshot(mailboxId: "team@acme.com"))
        ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store)
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 1)
        XCTAssertEqual(store.frontIndex(mailboxId: "team@acme.com", threadCount: 3), 0)
    }

    func testNextDoesNothingWithoutADeck() {
        XCTAssertNil(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store))
        store.write(snapshot(newCount: 1, threadIds: ["only"]))
        XCTAssertNil(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store))
        store.write(snapshot(newCount: 0, threadIds: []))
        XCTAssertNil(ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store))
    }

    func testNewSnapshotPutsTheDeckBackOnItsFirstCard() {
        store.write(snapshot())
        ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store)
        ShowNextThreadIntent.advance(mailboxId: "you@acme.com", in: store)
        // Same content, new timestamp: the reader keeps their place.
        store.write(snapshot(updatedAt: Date(timeIntervalSince1970: 1_800_000_500)))
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 2)
        // New mail arrived: back to the newest.
        store.write(snapshot(newCount: 4, threadIds: ["t-0", "t-1", "t-2", "t-3"]))
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 4), 0)
    }

    func testFrontIndexStaysInsideAShrunkDeck() {
        defaults.set(4, forKey: "inboxWidget.frontIndex.you@acme.com")
        XCTAssertEqual(store.frontIndex(mailboxId: "you@acme.com", threadCount: 3), 1)
    }

    func testIntentCarriesItsMailbox() {
        XCTAssertEqual(ShowNextThreadIntent(mailboxId: "you@acme.com").mailboxId, "you@acme.com")
    }

    // MARK: - Relevance

    func testRelevanceRisesWhenNewGrows() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        store.write(snapshot(newCount: 2), now: now.addingTimeInterval(-600))
        store.write(snapshot(newCount: 1, threadIds: ["t-1"]), now: now.addingTimeInterval(-300))
        // Shrinking doesn't move the "rose at" stamp.
        XCTAssertEqual(store.newCountRoseAt(mailboxId: "you@acme.com"), now.addingTimeInterval(-600))
        store.write(snapshot(newCount: 5), now: now)
        XCTAssertEqual(store.newCountRoseAt(mailboxId: "you@acme.com"), now)

        let boosted = InboxWidgetRelevance.score(newCount: 5, roseAt: now, now: now)
        let calm = InboxWidgetRelevance.score(newCount: 5, roseAt: nil, now: now)
        XCTAssertGreaterThan(boosted.score, calm.score)
        XCTAssertEqual(boosted.duration, InboxWidgetRelevance.boostDuration)
        let later = InboxWidgetRelevance.score(newCount: 5, roseAt: now, now: now.addingTimeInterval(3 * 3600))
        XCTAssertEqual(later.score, calm.score)
        XCTAssertEqual(InboxWidgetRelevance.score(newCount: 0, roseAt: now, now: now).score, 0)
    }

    // MARK: - Deep links

    func testDeepLinksRoundTrip() {
        let thread = InboxWidgetLink.thread(mailboxId: "you@acme.com", threadId: "e 1&2")
        XCTAssertEqual(thread.url.scheme, "inboxies")
        XCTAssertEqual(thread.url.host, "thread")
        XCTAssertEqual(InboxWidgetLink.parse(thread.url), thread)

        let inbox = InboxWidgetLink.inbox(mailboxId: "you@acme.com")
        XCTAssertEqual(inbox.url.absoluteString, "inboxies://inbox?mailbox=you@acme.com")
        XCTAssertEqual(InboxWidgetLink.parse(inbox.url), inbox)
        XCTAssertEqual(InboxWidgetLink.parse(URL(string: "inboxies://inbox")!), .inbox(mailboxId: nil))
    }

    func testOtherAppLinksAreNotWidgetLinks() {
        XCTAssertNil(InboxWidgetLink.parse(URL(string: "inboxies://invite/abc")!))
        XCTAssertNil(InboxWidgetLink.parse(URL(string: "inboxies://onboarding/domain-ready")!))
        XCTAssertNil(InboxWidgetLink.parse(URL(string: "inboxies://thread?mailbox=m")!))
        XCTAssertNil(InboxWidgetLink.parse(URL(string: "https://inboxies.email/inbox")!))
    }

    // MARK: - Building from the Inbox

    private func inboxEmail(_ id: String, date: String, unread: Bool, sender: String = "Maya Chen") throws -> Email {
        try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"\(id)","folder_id":"inbox","subject":"Subject \(id)","sender":"maya@x.com",
         "sender_name":"\(sender)","recipient":"b@x.com",
         "date":"\(date)","read":\(unread ? "false" : "true"),"starred":false}
        """.utf8))
    }

    func testMakeTakesTheNewestNewThreads() throws {
        let rows = try [
            inboxEmail("seen", date: "2026-10-28T09:00:00Z", unread: false),
            inboxEmail("n1", date: "2026-10-28T08:00:00Z", unread: true),
            inboxEmail("n2", date: "2026-10-28T08:30:00Z", unread: true),
        ] + (3...8).map { try inboxEmail("n\($0)", date: "2026-10-27T0\($0):00:00Z", unread: true) }
        let mailbox = Mailbox(id: "m1", email: "you@acme.com", name: "You")
        let snapshot = InboxWidgetSnapshot.make(
            mailbox: mailbox,
            inboxRows: rows,
            serverNewCount: 12,
            replyLaterCount: 3,
            now: Date(timeIntervalSince1970: 1_800_000_000)
        )
        XCTAssertEqual(snapshot.mailboxId, "m1")
        XCTAssertEqual(snapshot.mailboxAddress, "you@acme.com")
        XCTAssertEqual(snapshot.newCount, 12)
        XCTAssertEqual(snapshot.replyLaterCount, 3)
        XCTAssertEqual(snapshot.threads.map(\.id), ["n2", "n1", "n8", "n7", "n6"])
        XCTAssertEqual(snapshot.threads.first?.subject, "Subject n2")
        XCTAssertFalse(snapshot.threads.contains { $0.id == "seen" })
    }

    func testMakeCountsLocalNewWithoutAServerTotal() throws {
        let rows = try [
            inboxEmail("n1", date: "2026-10-28T08:00:00Z", unread: true),
            inboxEmail("s1", date: "2026-10-28T07:00:00Z", unread: false),
        ]
        let snapshot = InboxWidgetSnapshot.make(
            mailbox: Mailbox(id: "m1", email: "you@acme.com", name: "You"),
            inboxRows: rows,
            serverNewCount: nil,
            replyLaterCount: 0
        )
        XCTAssertEqual(snapshot.newCount, 1)
        XCTAssertFalse(snapshot.isInboxZero)

        let zero = InboxWidgetSnapshot.make(
            mailbox: Mailbox(id: "m1", email: "you@acme.com", name: "You"),
            inboxRows: [rows[1]],
            serverNewCount: 0,
            replyLaterCount: 0
        )
        XCTAssertTrue(zero.isInboxZero)
        XCTAssertEqual(zero.threads, [])
    }
}

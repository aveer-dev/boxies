import XCTest
@testable import Inboxies

/// Pure logic behind pagination, the mailbox load gate, pending-send persistence and
/// off-main body sanitizing.
final class HardeningTests: XCTestCase {
    private func email(_ id: String, date: String = "2026-10-10T10:00:00Z") throws -> Email {
        try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"\(id)","folder_id":"inbox","subject":"S","sender":"a@x.com","recipient":"b@x.com",
         "date":"\(date)","read":false,"starred":false}
        """.utf8))
    }

    // MARK: - Pagination

    func testHasMoreStopsOnShortPageAndTotalCount() {
        XCTAssertFalse(EmailListPaging.hasMore(page: 1, receivedCount: 10, totalCount: 100))
        XCTAssertTrue(EmailListPaging.hasMore(page: 1, receivedCount: 25, totalCount: 100))
        XCTAssertFalse(EmailListPaging.hasMore(page: 4, receivedCount: 25, totalCount: 100))
        // No total from the server: a full page means "maybe more".
        XCTAssertTrue(EmailListPaging.hasMore(page: 2, receivedCount: 25, totalCount: 0))
    }

    func testPagingSequenceAndCacheWindow() {
        var paging = EmailListPaging(key: "mb|inbox")
        XCTAssertNil(paging.nextPage, "No load-more before page 1 lands")
        XCTAssertEqual(paging.cacheWindow.limit, EmailListPaging.initialCacheLimit)
        XCTAssertNil(paging.cacheWindow.since)

        paging.apply(page: 1, receivedCount: 25, totalCount: 60, oldestDate: "2026-10-09")
        XCTAssertEqual(paging.nextPage, 2)
        XCTAssertNil(paging.cacheWindow.limit, "Loaded window is never capped at 50")
        XCTAssertEqual(paging.cacheWindow.since, "2026-10-09")

        paging.isLoadingMore = true
        XCTAssertNil(paging.nextPage, "No duplicate concurrent page loads")
        paging.isLoadingMore = false

        XCTAssertTrue(paging.apply(page: 2, receivedCount: 25, totalCount: 60, oldestDate: "2026-10-01"))
        XCTAssertEqual(paging.cacheWindow.since, "2026-10-01")
        XCTAssertFalse(paging.apply(page: 2, receivedCount: 25, totalCount: 60, oldestDate: "2026-09-01"),
                       "A late duplicate page is ignored")
        XCTAssertEqual(paging.loadedPages, 2)

        paging.apply(page: 3, receivedCount: 10, totalCount: 60, oldestDate: "2026-09-20")
        XCTAssertFalse(paging.hasMore)
        XCTAssertNil(paging.nextPage)
        XCTAssertNil(paging.cacheWindow.since, "Exhausted list reads every cached row")

        // Pull-to-refresh: page 1 restarts the window.
        paging.apply(page: 1, receivedCount: 25, totalCount: 60, oldestDate: "2026-10-09")
        XCTAssertEqual(paging.loadedPages, 1)
        XCTAssertEqual(paging.cacheWindow.since, "2026-10-09")
    }

    func testFailedLoadMoreClearsOnNextPage() {
        var paging = EmailListPaging(key: "mb|inbox")
        paging.apply(page: 1, receivedCount: 25, totalCount: 100, oldestDate: nil)
        paging.loadMoreFailed = true
        paging.apply(page: 2, receivedCount: 25, totalCount: 100, oldestDate: nil)
        XCTAssertFalse(paging.loadMoreFailed)
    }

    func testAppendingSkipsDuplicates() throws {
        let merged = EmailListPaging.appending(
            [try email("b"), try email("c")],
            to: [try email("a"), try email("b")]
        )
        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
    }

    // MARK: - Mailbox gate

    func testMailboxGate() {
        XCTAssertEqual(MailboxGate.resolve(isMailboxLoading: true, hasMailboxes: false, loadFailed: false), .home)
        XCTAssertEqual(MailboxGate.resolve(isMailboxLoading: false, hasMailboxes: false, loadFailed: false), .onboarding)
        XCTAssertEqual(MailboxGate.resolve(isMailboxLoading: false, hasMailboxes: false, loadFailed: true), .loadFailed)
        // A retry in flight keeps the error screen (it owns the spinner).
        XCTAssertEqual(MailboxGate.resolve(isMailboxLoading: true, hasMailboxes: false, loadFailed: true), .loadFailed)
        // Cached mailboxes win over a failed refresh.
        XCTAssertEqual(MailboxGate.resolve(isMailboxLoading: false, hasMailboxes: true, loadFailed: true), .home)
    }

    @MainActor
    func testFailedFirstLoadIsNotOnboarding() {
        let app = AppModel()
        app.persistsPreferences = false
        app.isMailboxLoading = false
        app.mailboxesLoadFailed = true
        XCTAssertEqual(app.mailboxGate, .loadFailed)
        app.mailboxesLoadFailed = false
        XCTAssertEqual(app.mailboxGate, .onboarding)
    }

    // MARK: - Pending send

    private func tempStore() throws -> PendingSendStore {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        return PendingSendStore(root: dir)
    }

    private func record(
        id: UUID = UUID(),
        account: String = "me@x.com",
        mailbox: String = "mb-1",
        createdAt: Date = Date()
    ) -> PendingSendRecord {
        PendingSendRecord(
            id: id,
            accountKey: account,
            mailboxId: mailbox,
            mode: ComposeMode.reply.rawValue,
            to: [.init(name: "Jordan", email: "jordan@example.com")],
            cc: [],
            bcc: [.init(name: nil, email: "audit@example.com")],
            subject: "Re: Plans",
            body: "Sounds good",
            originalEmailId: "orig-1",
            threadId: "t-1",
            draftId: "d-1",
            attachments: [.init(filename: "a.txt", mimeType: "text/plain", size: 3, base64: "YWJj")],
            // Whole seconds: the store encodes ISO 8601 without fractions.
            createdAt: Date(timeIntervalSince1970: createdAt.timeIntervalSince1970.rounded(.down))
        )
    }

    func testPendingSendStoreRoundTrip() throws {
        let store = try tempStore()
        XCTAssertTrue(store.loadAll().isEmpty)
        let saved = record()
        store.save(saved)
        XCTAssertEqual(store.loadAll(), [saved])

        store.markSendStarted(id: saved.id)
        XCTAssertEqual(store.loadAll().first?.sendStarted, true, "Started marker is read back")
        XCTAssertNotEqual(store.loadAll().first?.restoreToastMessage, saved.restoreToastMessage)
        store.clearSendStarted(id: saved.id)
        XCTAssertEqual(store.loadAll().first?.sendStarted, false)

        store.clear(id: saved.id)
        XCTAssertTrue(store.loadAll().isEmpty)
    }

    /// A killed launch's record survives a new send's save and that send's clear.
    func testPendingSendStoreNeverClobbersAnotherRecord() throws {
        let store = try tempStore()
        let leftover = record(createdAt: Date(timeIntervalSinceNow: -60))
        store.save(leftover)
        let newSend = record()
        store.save(newSend)
        XCTAssertEqual(store.loadAll().map(\.id), [leftover.id, newSend.id])

        store.markSendStarted(id: newSend.id)
        store.clear(id: newSend.id)
        XCTAssertEqual(store.loadAll(), [leftover], "Clearing one id leaves the other record intact")
        store.markSendStarted(id: newSend.id)
        XCTAssertFalse(store.loadAll().contains { $0.id == newSend.id }, "A late marker never resurrects a record")
    }

    /// Writes from several threads land in call order per id and never touch other ids.
    func testPendingSendStoreConcurrentWrites() throws {
        let store = try tempStore()
        let keep = (0..<5).map { _ in record() }
        let drop = (0..<5).map { _ in record() }
        for r in keep + drop { store.save(r) }
        DispatchQueue.concurrentPerform(iterations: drop.count) { i in
            store.markSendStarted(id: drop[i].id)
            store.clear(id: drop[i].id)
        }
        store.flush()
        XCTAssertEqual(Set(store.loadAll().map(\.id)), Set(keep.map(\.id)))
    }

    func testPendingSendRestoreDecision() {
        let r = record()
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: ["mb-1"]), .restore)
        XCTAssertEqual(r.restoreDecision(accountKey: "other@x.com", mailboxIds: ["mb-1"]), .keep,
                       "Another account's message waits for that account")
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: ["mb-2"]), .discard)
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: []), .keep,
                       "Unloaded mailboxes never discard the message")
        let stale = record(createdAt: Date(timeIntervalSinceNow: -(PendingSendRecord.maxAge + 60)))
        XCTAssertEqual(stale.restoreDecision(accountKey: "me@x.com", mailboxIds: ["mb-1"]), .discard)
    }

    func testRecordJSONLeavesStartedFlagOut() throws {
        var r = record()
        r.sendStarted = true
        let json = String(decoding: try JSONEncoder().encode(r), as: UTF8.self)
        XCTAssertFalse(json.contains("sendStarted"))
    }

    // MARK: - Inbox sections across pages

    private func inboxEmail(_ id: String, date: String, unread: Bool) throws -> Email {
        try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"\(id)","folder_id":"inbox","subject":"S","sender":"a@x.com","recipient":"b@x.com",
         "date":"\(date)","read":\(unread ? "false" : "true"),"starred":false}
        """.utf8))
    }

    func testLaterPagesNeverJumpIntoNew() throws {
        let rows = [
            try inboxEmail("p1-seen", date: "2026-10-10", unread: false),
            try inboxEmail("p1-new", date: "2026-10-09", unread: true),
            try inboxEmail("p2-new", date: "2026-10-01", unread: true),
            try inboxEmail("p2-seen", date: "2026-09-30", unread: false),
        ]
        // One page loaded: everything is sectioned as before.
        XCTAssertEqual(EmailListPaging.inboxSections(rows, sectionFloor: nil).new.map(\.id), ["p1-new", "p2-new"])

        var paging = EmailListPaging(key: "mb|inbox")
        paging.apply(page: 1, receivedCount: 25, totalCount: 60, oldestDate: "2026-10-09")
        XCTAssertNil(paging.sectionFloor)
        paging.apply(page: 2, receivedCount: 25, totalCount: 60, oldestDate: "2026-09-30")
        XCTAssertEqual(paging.sectionFloor, "2026-10-09")

        let sections = EmailListPaging.inboxSections(rows, sectionFloor: paging.sectionFloor)
        XCTAssertEqual(sections.new.map(\.id), ["p1-new"])
        XCTAssertEqual(sections.seen.map(\.id), ["p1-seen", "p2-new", "p2-seen"],
                       "Page 2 rows append by date at the end of Seen")
        XCTAssertEqual(EmailListPaging.inboxOrder(rows, sectionFloor: paging.sectionFloor).map(\.id),
                       ["p1-new", "p1-seen", "p2-new", "p2-seen"])
    }

    func testInboxNewPreviewCapsNewAndCountsTheRest() throws {
        let newRows = try (0..<7).map { try inboxEmail("n\($0)", date: "2026-10-\(String(format: "%02d", 20 - $0))", unread: true) }
        // Server sent 5 New (new_limit) but reports 12 in total.
        let capped = EmailListPaging.inboxNewPreview(Array(newRows.prefix(5)), serverNewCount: 12)
        XCTAssertEqual(capped.shown.map(\.id), ["n0", "n1", "n2", "n3", "n4"])
        XCTAssertEqual(capped.hiddenCount, 7)
        // Extra cached New rows are hidden, newest first kept.
        let local = EmailListPaging.inboxNewPreview(newRows.reversed(), serverNewCount: nil)
        XCTAssertEqual(local.shown.first?.id, "n0")
        XCTAssertEqual(local.shown.count, EmailListPaging.inboxNewPreviewLimit)
        XCTAssertEqual(local.hiddenCount, 2)
        // At or under the cap: nothing hidden.
        XCTAssertEqual(EmailListPaging.inboxNewPreview(Array(newRows.prefix(3)), serverNewCount: 3).hiddenCount, 0)
    }

    // MARK: - Pruning later pages

    func testPruneWindowForLaterPages() {
        XCTAssertNil(EmailListPaging.pruneWindow(receivedCount: 25, oldestDate: "b", previousOldestDate: nil))
        let full = EmailListPaging.pruneWindow(receivedCount: 25, oldestDate: "2026-09-01", previousOldestDate: "2026-09-10")
        XCTAssertEqual(full?.olderThan, "2026-09-10")
        XCTAssertEqual(full?.notOlderThan, "2026-09-01")
        let short = EmailListPaging.pruneWindow(receivedCount: 3, oldestDate: "2026-09-05", previousOldestDate: "2026-09-10")
        XCTAssertEqual(short?.olderThan, "2026-09-10")
        XCTAssertNil(short?.notOlderThan, "Final short page prunes everything older")
    }

    func testPruneRemovesOnlyStaleRowsInWindow() throws {
        let db = DatabaseService.shared
        let mailbox = "mb-prune-\(UUID().uuidString)"
        func row(_ id: String, _ date: String) throws -> Email { try inboxEmail("\(mailbox)-\(id)", date: date, unread: false) }
        let rows = [
            try row("page1", "2026-09-20"),
            try row("p2-kept", "2026-09-08"),
            try row("p2-moved", "2026-09-07"),
            try row("older", "2026-08-01"),
        ]
        db.upsertEmails(mailboxId: mailbox, emails: rows, defaultFolder: "inbox")
        addTeardownBlock { for r in rows { db.deleteEmail(id: r.id) } }

        db.pruneRemovedEmails(
            mailboxId: mailbox, folderId: "inbox",
            keeping: ["\(mailbox)-p2-kept"],
            olderThan: "2026-09-10", notOlderThan: "2026-09-01"
        )
        XCTAssertEqual(
            Set(db.getEmails(mailboxId: mailbox, folderId: "inbox", limit: nil).map(\.id)),
            Set(["page1", "p2-kept", "older"].map { "\(mailbox)-\($0)" })
        )

        db.pruneRemovedEmails(
            mailboxId: mailbox, folderId: "inbox",
            keeping: ["\(mailbox)-p2-kept"],
            olderThan: "2026-09-10", notOlderThan: nil
        )
        XCTAssertEqual(
            Set(db.getEmails(mailboxId: mailbox, folderId: "inbox", limit: nil).map(\.id)),
            Set(["page1", "p2-kept"].map { "\(mailbox)-\($0)" })
        )
    }

    // MARK: - Reply Later merge

    func testReplyLaterMergeIsById() throws {
        let existing = [try email("a"), try email("b"), try email("c"), try email("d")]
        // Old first page was a, b; c, d came from page 2. "b" was removed, "new" arrived on top.
        let merged = EmailListPaging.mergingFirstPage(
            [try email("new"), try email("a")],
            into: existing,
            previousFirstPageIds: ["a", "b"]
        )
        XCTAssertEqual(merged.map(\.id), ["new", "a", "c", "d"])
    }

    @MainActor
    func testComposeFormRoundTripsThroughRecord() {
        let mailbox = Mailbox(id: "mb-1", email: "me@x.com", name: "Me", settings: nil)
        let form = ComposeFormModel(mode: .new, mailbox: mailbox)
        form.toTokens = [MailAddress(name: "Jordan", email: "jordan@example.com")]
        form.ccTokens = [MailAddress(name: nil, email: "cc@example.com")]
        form.subject = "Plans"
        form.body = "Hello there"
        form.addPreparedAttachment(ComposePendingAttachment(filename: "a.txt", mimeType: "text/plain", size: 3, base64: "YWJj"))
        form.cancelAutoSave()

        let saved = form.pendingSendRecord(accountKey: "me@x.com")
        XCTAssertEqual(saved.mailboxId, "mb-1")
        XCTAssertEqual(saved.composeMode, .new)

        let restored = ComposeFormModel(mode: saved.composeMode, mailbox: mailbox)
        restored.restore(from: saved)
        restored.cancelAutoSave()
        XCTAssertEqual(restored.toTokens.map(\.email), ["jordan@example.com"])
        XCTAssertEqual(restored.ccTokens.map(\.email), ["cc@example.com"])
        XCTAssertTrue(restored.showCcBcc)
        XCTAssertEqual(restored.subject, "Plans")
        XCTAssertEqual(restored.body, "Hello there")
        XCTAssertEqual(restored.attachments.map(\.base64), ["YWJj"])
        XCTAssertTrue(restored.hasUnsavedChanges, "Restored message is saved as a draft next")
    }

    // MARK: - Body sanitizing

    func testMailCSPRunsNoPageScript() {
        for policy in [EmailHTMLSanitizer.contentSecurityPolicy, EmailHTMLSanitizer.remoteImagesBlockedPolicy] {
            XCTAssertTrue(policy.contains("script-src 'none'"))
            XCTAssertFalse(policy.contains("script-src 'unsafe-inline'"))
        }
    }

    func testPrepareOffMainMatchesSyncPrepare() async {
        let html = """
        <p>Hi</p><img src="https://t.example.com/p.gif"><script>alert(1)</script>
        <blockquote type="cite">On Tue, Alex wrote:<br>old</blockquote>
        """
        let sync = EmailHTMLSanitizer.prepare(html)
        let key = EmailHTMLSanitizer.cacheKey(emailId: "e-\(UUID())", html: html)
        let prepared = await EmailHTMLSanitizer.prepareOffMain(html, key: key)
        XCTAssertEqual(prepared.main, sync.main)
        XCTAssertEqual(prepared.quote, sync.quote)
        XCTAssertTrue(prepared.hasRemoteImages)
        XCTAssertFalse(prepared.main.lowercased().contains("<script"))
        let cached = await EmailHTMLSanitizer.prepareOffMain("<p>ignored</p>", key: key)
        XCTAssertEqual(cached, prepared, "Same key is served from the cache")
    }
}

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
        return PendingSendStore(directory: dir)
    }

    private func record(id: UUID = UUID(), account: String = "me@x.com", mailbox: String = "mb-1") -> PendingSendRecord {
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
            createdAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    func testPendingSendStoreRoundTrip() throws {
        let store = try tempStore()
        XCTAssertNil(store.load())
        let saved = record()
        store.save(saved)
        XCTAssertEqual(store.load(), saved)

        store.markSendStarted(id: saved.id)
        XCTAssertEqual(store.load()?.sendStarted, true)
        XCTAssertNotEqual(store.load()?.restoreToastMessage, saved.restoreToastMessage)

        store.clear(id: UUID())
        XCTAssertNotNil(store.load(), "Clearing another send's id keeps this record")
        store.clear(id: saved.id)
        XCTAssertNil(store.load())
    }

    func testPendingSendRestoreDecision() {
        let r = record()
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: ["mb-1"]), .restore)
        XCTAssertEqual(r.restoreDecision(accountKey: "other@x.com", mailboxIds: ["mb-1"]), .discard)
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: ["mb-2"]), .discard)
        XCTAssertEqual(r.restoreDecision(accountKey: "me@x.com", mailboxIds: []), .wait,
                       "Unloaded mailboxes never discard the message")
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

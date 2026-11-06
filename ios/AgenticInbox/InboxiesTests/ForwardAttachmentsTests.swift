import XCTest
@testable import Inboxies

/// "Include N attachments" on forward (AVE-181).
final class ForwardAttachmentsTests: XCTestCase {
    private struct Fixture: Decodable {
        struct File: Decodable {
            let id: String
            let filename: String?
            let mimetype: String?
            let content_id: String?
            let disposition: String?
        }
        let name: String
        let body: String
        let attachments: [File]
        let forwardable: [String]
    }

    /// Same fixtures as web (`workers/test/forward-attachments.test.mjs`) and Android.
    func testForwardableMatchesSharedFixtures() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // InboxiesTests
            .deletingLastPathComponent() // AgenticInbox
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
            .appendingPathComponent("shared/forward-attachments.fixtures.json")
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        XCTAssertGreaterThanOrEqual(fixtures.count, 10)
        for fixture in fixtures {
            let files = fixture.attachments.map {
                Attachment(
                    id: $0.id,
                    filename: $0.filename ?? "",
                    mimetype: $0.mimetype ?? "",
                    size: 10,
                    contentId: $0.content_id,
                    disposition: $0.disposition
                )
            }
            let picked = ForwardAttachments.forwardable(files, body: fixture.body).map(\.id)
            XCTAssertEqual(picked, fixture.forwardable, fixture.name)
        }
    }

    func testIncludeLabel() {
        XCTAssertEqual(ForwardAttachments.includeLabel(count: 1), "Include 1 attachment")
        XCTAssertEqual(ForwardAttachments.includeLabel(count: 4), "Include 4 attachments")
    }

    private func original(attachments: String, body: String = "<p>Hi</p>") throws -> Email {
        try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"orig-1","folder_id":"inbox","subject":"Pack","sender":"a@x.com","recipient":"me@x.com",
         "date":"2026-11-01T10:00:00.000Z","read":true,"starred":false,"body":\(String(reflecting: body)),
         "attachments":\(attachments)}
        """.utf8))
    }

    private let mailbox = Mailbox(id: "mb-1", email: "me@x.com", name: "Me", settings: nil)

    @MainActor
    func testForwardCarriesOnlyRealAttachmentsAndIsOnByDefault() throws {
        let email = try original(
            attachments: """
            [{"id":"f1","filename":"pack.pdf","mimetype":"application/pdf","size":2000000,"disposition":"attachment"},
             {"id":"logo","filename":"logo.png","mimetype":"image/png","size":300,"content_id":"<logo@x>","disposition":"inline"}]
            """
        )
        let form = ComposeFormModel(mode: .forward, mailbox: mailbox, original: email)
        form.cancelAutoSave()
        XCTAssertEqual(form.forwardedAttachments.map(\.id), ["f1"])
        XCTAssertTrue(form.includeForwardedAttachments)
        XCTAssertEqual(form.sentForwardedAttachments.map(\.id), ["f1"])

        form.includeForwardedAttachments = false
        XCTAssertTrue(form.sentForwardedAttachments.isEmpty)
    }

    @MainActor
    func testReplyNeverCarriesTheOriginalsFiles() throws {
        let email = try original(
            attachments: #"[{"id":"f1","filename":"pack.pdf","mimetype":"application/pdf","size":10}]"#
        )
        let form = ComposeFormModel(mode: .reply, mailbox: mailbox, original: email)
        form.cancelAutoSave()
        XCTAssertTrue(form.forwardedAttachments.isEmpty)
    }

    @MainActor
    func testForwardedFilesCountTowardTheSizeLimitOnlyWhileIncluded() throws {
        let email = try original(
            attachments: #"[{"id":"big","filename":"video-still.tiff","mimetype":"image/tiff","size":5300000}]"#
        )
        let form = ComposeFormModel(mode: .forward, mailbox: mailbox, original: email)
        form.cancelAutoSave()
        XCTAssertTrue(form.exceedsOutboundLimit, "5.3 MB is over the 5 MiB limit")
        form.includeForwardedAttachments = false
        XCTAssertFalse(form.exceedsOutboundLimit)
    }

    @MainActor
    func testSwitchStateSurvivesThePendingSendRecord() throws {
        let email = try original(
            attachments: #"[{"id":"f1","filename":"pack.pdf","mimetype":"application/pdf","size":10}]"#
        )
        let form = ComposeFormModel(mode: .forward, mailbox: mailbox, original: email)
        form.cancelAutoSave()
        form.includeForwardedAttachments = false
        let record = form.pendingSendRecord(accountKey: "me@x.com")
        XCTAssertEqual(record.includesForwardedAttachments, false)

        let decoded = try JSONDecoder().decode(PendingSendRecord.self, from: JSONEncoder().encode(record))
        let restored = ComposeFormModel(mode: .forward, mailbox: mailbox, original: email)
        restored.cancelAutoSave()
        restored.restore(from: decoded)
        XCTAssertFalse(restored.includeForwardedAttachments)
    }
}

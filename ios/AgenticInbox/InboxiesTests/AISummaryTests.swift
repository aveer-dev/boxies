import XCTest
@testable import Inboxies

/// AI summary card (AVE-218): `AiSummaryResponse` decoding, the web eligibility rule
/// (`EmailPanel` `summaryEnabled`) and the daily-limit note.
final class AISummaryTests: XCTestCase {
    private func decode(_ json: String) throws -> AISummaryResponse {
        try JSONDecoder().decode(AISummaryResponse.self, from: Data(json.utf8))
    }

    private func email(_ id: String, folder: String? = "inbox", body: String?) -> Email {
        var email = Email(id: id, subject: "", sender: "", recipient: "", date: "", read: true, starred: false)
        email.folderId = folder
        email.body = body
        return email
    }

    func testDecodesReady() throws {
        let response = try decode("""
        {"status":"ready","cached":false,"summary":{"target_type":"thread","target_id":"t1",
        "summary":"Dana wants owners by Friday.","key_points":["Reply by Friday"],"model":"m",
        "message_count":2,"last_email_id":"e2","created_at":"x","updated_at":"y"}}
        """)
        guard case .ready(let summary, let cached) = response else { return XCTFail("not ready") }
        XCTAssertFalse(cached)
        XCTAssertEqual(summary.summary, "Dana wants owners by Friday.")
        XCTAssertEqual(summary.keyPoints, ["Reply by Friday"])
        XCTAssertEqual(summary.messageCount, 2)
    }

    func testDecodesNotEligibleAndUnknown() throws {
        XCTAssertEqual(try decode(#"{"status":"not_eligible","reason":"too_short"}"#), .notEligible(reason: "too_short"))
        XCTAssertEqual(try decode(#"{"status":"missing"}"#), .missing)
        XCTAssertNil(try decode(#"{"status":"later"}"#).summary)
    }

    func testEligibilityNeedsEnoughTextAcrossTheThread() {
        let half = String(repeating: "a", count: 260)
        let first = email("a", body: "<p>\(half)</p>")
        let second = email("b", body: half)
        XCTAssertFalse(AISummaryEligibility.isEnabled(email: first, thread: [first]))
        XCTAssertTrue(AISummaryEligibility.isEnabled(email: second, thread: [first, second]))
    }

    func testEligibilitySkipsExcludedFoldersAndDrafts() {
        let long = String(repeating: "word ", count: 150)
        XCTAssertTrue(AISummaryEligibility.isEnabled(email: email("a", body: long), thread: []))
        for folder in ["screener", "screened_out", "spam", "trash", "draft"] {
            let mail = email("a", folder: folder, body: long)
            XCTAssertFalse(AISummaryEligibility.isEnabled(email: mail, thread: [mail]), folder)
        }
        // A draft reply's text doesn't count toward the thread.
        let short = email("a", body: "Short note")
        let draft = email("d", folder: "draft", body: long)
        XCTAssertFalse(AISummaryEligibility.isEnabled(email: short, thread: [short, draft]))
    }

    func testPlainTextMatchesWebStripHtml() {
        XCTAssertEqual(
            AISummaryEligibility.plainText("<style>p{}</style><p>Hi&nbsp;there</p>\n\n<b>Dana</b>"),
            "Hi there Dana"
        )
    }

    func testQuotaNote() {
        let now = ISO8601DateFormatter().date(from: "2026-06-01T18:00:00Z")!
        XCTAssertEqual(AISummaryQuota.text(now: now), "Daily AI limit reached. Resets in 6h.")
        XCTAssertTrue(AISummaryQuota.isQuotaError(APIError.http(429, "limit")))
        XCTAssertFalse(AISummaryQuota.isQuotaError(APIError.http(502, "failed")))
    }
}

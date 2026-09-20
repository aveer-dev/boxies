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

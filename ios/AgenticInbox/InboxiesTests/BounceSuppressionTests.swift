import XCTest
@testable import Inboxies

/// 409 `recipient_suppressed` parsing and the composer's reason copy (AVE-84).
final class BounceSuppressionTests: XCTestCase {
    private let body = """
    {"error":"Not sent: bob@example.com bounced on 2026-10-01 (and 1 more suppressed address). Remove the address or un-suppress it to send again.",
     "code":"recipient_suppressed",
     "suppressed":[
       {"address":"Bob@Example.com","domain":"acme.com","reason":"hard_bounce","source":"dsn","detail":"550 5.1.1 user unknown","suppressedAt":"2026-10-01T12:00:00.000Z","canUnsuppress":true},
       {"address":"carol@example.com","domain":"acme.com","reason":"complaint","source":"event","detail":null,"suppressedAt":"2026-10-02T09:30:00Z","canUnsuppress":false},
       {"domain":"acme.com"}
     ]}
    """

    private let utc = TimeZone(identifier: "UTC")!
    private let enUS = Locale(identifier: "en_US")

    func testParsesSuppressedRecipientsFrom409() throws {
        let list = try XCTUnwrap(BounceSuppression.suppressedRecipients(statusCode: 409, data: Data(body.utf8)))
        XCTAssertEqual(list.count, 2, "rows without an address are dropped")
        XCTAssertEqual(list[0].address, "bob@example.com")
        XCTAssertEqual(list[0].reason, .hardBounce)
        XCTAssertEqual(list[0].detail, "550 5.1.1 user unknown")
        XCTAssertTrue(list[0].canUnsuppress)
        XCTAssertEqual(list[1].reason, .complaint)
        XCTAssertNil(list[1].detail)
        XCTAssertFalse(list[1].canUnsuppress)
    }

    func testIgnoresOtherResponses() {
        XCTAssertNil(BounceSuppression.suppressedRecipients(statusCode: 400, data: Data(body.utf8)))
        XCTAssertNil(BounceSuppression.suppressedRecipients(
            statusCode: 409,
            data: Data(#"{"error":"Private email is paused","code":"alias_inactive"}"#.utf8)
        ))
        XCTAssertNil(BounceSuppression.suppressedRecipients(
            statusCode: 409,
            data: Data(#"{"code":"recipient_suppressed","suppressed":[]}"#.utf8)
        ))
        XCTAssertNil(BounceSuppression.suppressedRecipients(statusCode: 409, data: Data("<html>".utf8)))
    }

    func testErrorCarriesServerSentence() throws {
        let error = try XCTUnwrap(BounceSuppression.error(statusCode: 409, data: Data(body.utf8)))
        guard case .recipientSuppressed(let message, let suppressed) = error else {
            return XCTFail("expected recipientSuppressed, got \(error)")
        }
        XCTAssertTrue(message.hasPrefix("Not sent: bob@example.com bounced on 2026-10-01"))
        XCTAssertEqual(error.errorDescription, message)
        XCTAssertEqual(suppressed.count, 2)
    }

    func testReasonText() throws {
        let list = try XCTUnwrap(BounceSuppression.suppressedRecipients(statusCode: 409, data: Data(body.utf8)))
        XCTAssertEqual(
            BounceSuppression.reasonText(list[0], locale: enUS, timeZone: utc),
            "This address bounced on Oct 1, 2026"
        )
        XCTAssertEqual(
            BounceSuppression.reasonText(list[1], locale: enUS, timeZone: utc),
            "This address marked earlier mail as spam on Oct 2, 2026"
        )
        let undated = SuppressedRecipient(
            address: "x@y.z", domain: "y.z", reason: .hardBounce, source: "dsn",
            detail: nil, suppressedAt: "", canUnsuppress: true
        )
        XCTAssertEqual(BounceSuppression.reasonText(undated), "This address bounced")
        XCTAssertEqual(BounceSuppression.formatDate("yesterday"), "yesterday")
    }

    func testRemovingARecipientClearsItsNotice() throws {
        let list = try XCTUnwrap(BounceSuppression.suppressedRecipients(statusCode: 409, data: Data(body.utf8)))
        XCTAssertEqual(
            BounceSuppression.stillAddressed(list, recipients: ["BOB@example.com", "carol@example.com"]).map(\.address),
            ["bob@example.com", "carol@example.com"]
        )
        XCTAssertEqual(
            BounceSuppression.stillAddressed(list, recipients: ["carol@example.com", "dave@example.com"]).map(\.address),
            ["carol@example.com"]
        )
        XCTAssertTrue(BounceSuppression.stillAddressed(list, recipients: []).isEmpty)
    }

    func testButtonAndFooterCopy() {
        XCTAssertEqual(BounceSuppression.buttonTitle(count: 1), "Un-suppress and send")
        XCTAssertEqual(BounceSuppression.buttonTitle(count: 2), "Un-suppress all and send")
        XCTAssertEqual(BounceSuppression.footerText(canLiftAll: false), "Remove the address to send to everyone else.")
    }

    func testDeliveryStatusLabelsForSentRows() {
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "bounced"), "Bounced")
        XCTAssertEqual(DeliveryStatusHelpers.label(for: "complained"), "Marked as spam")
        XCTAssertTrue(DeliveryStatusHelpers.isFailure("complained"))
        XCTAssertFalse(DeliveryStatusHelpers.isFailure("accepted"))
    }

    // MARK: Settings → Bounced addresses (AVE-157)

    private let listBody = """
    {"domain":"acme.com","scope":"domain","suppressions":[
       {"address":"Bob@Example.com","domain":"acme.com","reason":"hard_bounce","source":"dsn","detail":"550 5.1.1 user unknown","suppressedAt":"2026-10-01T12:00:00.000Z","canUnsuppress":true},
       {"address":"carol@example.com","domain":"acme.com","reason":"complaint","source":"event","detail":"","suppressedAt":"2026-10-02T09:30:00Z","canUnsuppress":false},
       {"domain":"acme.com"},
       "junk"
    ]}
    """

    func testParsesSuppressionList() throws {
        let list = try XCTUnwrap(BounceSuppression.list(data: Data(listBody.utf8)))
        XCTAssertEqual(list.domain, "acme.com")
        XCTAssertEqual(list.scope, .domain)
        XCTAssertEqual(list.suppressions.map(\.address), ["bob@example.com", "carol@example.com"])
        XCTAssertEqual(list.suppressions[0].reason, .hardBounce)
        XCTAssertTrue(list.suppressions[0].canUnsuppress)
        XCTAssertEqual(list.suppressions[1].reason, .complaint)
        XCTAssertNil(list.suppressions[1].detail, "an empty detail is dropped")
        XCTAssertFalse(list.suppressions[1].canUnsuppress)
    }

    func testSuppressionListDefaultsAndRejects() throws {
        let empty = try XCTUnwrap(BounceSuppression.list(data: Data(#"{"domain":"acme.com","scope":"mailbox","suppressions":[]}"#.utf8)))
        XCTAssertEqual(empty.scope, .mailbox)
        XCTAssertTrue(empty.suppressions.isEmpty)
        let unknownScope = try XCTUnwrap(BounceSuppression.list(data: Data(#"{"suppressions":[]}"#.utf8)))
        XCTAssertEqual(unknownScope.scope, .mailbox)
        XCTAssertEqual(unknownScope.domain, "")
        XCTAssertNil(BounceSuppression.list(data: Data(#"{"error":"Invalid mailbox email address"}"#.utf8)))
        XCTAssertNil(BounceSuppression.list(data: Data("<html>".utf8)))
    }

    func testListRowCopy() throws {
        let list = try XCTUnwrap(BounceSuppression.list(data: Data(listBody.utf8)))
        XCTAssertEqual(BounceSuppression.metaLine(list.suppressions[0], locale: enUS, timeZone: utc), "Bounced · Oct 1, 2026")
        XCTAssertEqual(BounceSuppression.metaLine(list.suppressions[1], locale: enUS, timeZone: utc), "Marked as spam · Oct 2, 2026")
        XCTAssertEqual(
            BounceSuppression.confirmMessage(list.suppressions[0]),
            "Mail will go to bob@example.com again. If it bounces again, it's suppressed again."
        )
        XCTAssertEqual(
            BounceSuppression.confirmMessage(list.suppressions[1]),
            "Mail will go to carol@example.com again. If it reports spam again, it's suppressed again."
        )
        XCTAssertEqual(BounceSuppression.unsuppressedToast("bob@example.com"), "bob@example.com un-suppressed")
    }

    func testIntroTextFollowsScope() throws {
        let admin = try XCTUnwrap(BounceSuppression.list(data: Data(listBody.utf8)))
        XCTAssertEqual(
            BounceSuppression.introText(admin),
            "After a hard bounce or a spam report, mail from acme.com stops going to that address, which protects your sending reputation. As a domain admin you see every mailbox's."
        )
        let member = SuppressionList(domain: "acme.com", scope: .mailbox, suppressions: [])
        XCTAssertTrue(BounceSuppression.introText(member).hasSuffix("You see the ones this mailbox's sends caused."))
        XCTAssertTrue(BounceSuppression.introText(nil).contains("mail from this domain stops"))
    }

    func testAlreadyLiftedIsA404() {
        XCTAssertTrue(BounceSuppression.isAlreadyLifted(APIError.http(404, "Not suppressed")))
        XCTAssertFalse(BounceSuppression.isAlreadyLifted(APIError.http(403, "Ask a domain admin")))
        XCTAssertFalse(BounceSuppression.isAlreadyLifted(APIError.invalidURL))
    }
}

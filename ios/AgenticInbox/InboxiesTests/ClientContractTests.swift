import XCTest
@testable import Inboxies

/// Wire-shape and pure-helper checks for the Worker contract (Phase 4).
final class ClientContractTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    // MARK: - Email

    func testEmailDecodesWithoutReplyLater() throws {
        let email = try decode(Email.self, """
        {"id":"e1","folder_id":"inbox","subject":"Hi","sender":"a@x.com","recipient":"b@x.com",
         "date":"2026-10-10T10:00:00Z","read":false,"starred":false,"snippet":"Hello"}
        """)
        XCTAssertEqual(email.id, "e1")
        XCTAssertFalse(email.replyLater)
        XCTAssertNil(email.aliasId)
        XCTAssertEqual(email.snippet, "Hello")
    }

    func testEmailDecodesSSEPayloadWithIntBooleans() throws {
        let email = try decode(Email.self, """
        {"id":"e2","folder_id":"inbox","subject":"Hi","sender":"a@x.com","sender_name":null,
         "recipient":"b@x.com","date":"2026-10-10T10:00:00Z","read":1,"starred":0,
         "reply_later":true,"alias_id":"al_1","auth":null}
        """)
        XCTAssertTrue(email.read)
        XCTAssertFalse(email.starred)
        XCTAssertTrue(email.replyLater)
        XCTAssertEqual(email.aliasId, "al_1")
    }

    // MARK: - Export / registrar

    func testExportJobDecodesServerShape() throws {
        let job = try decode(ExportJob.self, """
        {"id":"exp_1","exportId":"exp_1","domain":"acme.com","status":"processing",
         "progress":{"processedCount":5,"totalCount":10,"percent":50},
         "totalEmails":10,"fileSizeBytes":null,"downloadUrl":null,"expiresAt":null,"createdAt":"2026-10-10T10:00:00Z"}
        """)
        XCTAssertEqual(job.id, "exp_1")
        XCTAssertEqual(job.domain, "acme.com")
        XCTAssertEqual(job.progress?.percent, 50)
        XCTAssertNil(job.fileSizeBytes)
    }

    func testExportJobFallsBackToExportId() throws {
        let job = try decode(ExportJob.self, """
        {"exportId":"exp_2","mailboxId":"mb@x.com","status":"completed","progress":{"processedCount":3,"totalCount":3,"percent":100}}
        """)
        XCTAssertEqual(job.id, "exp_2")
        XCTAssertEqual(job.mailboxId, "mb@x.com")
    }

    func testTransferLockSuccessOptional() throws {
        let res = try decode(DomainTransferLockResponse.self, #"{"domain":"acme.com","locked":true}"#)
        XCTAssertNil(res.success)
        XCTAssertTrue(res.locked)
    }

    func testPricingAcceptsEitherFieldNames() throws {
        let newer = try decode(DomainPricingBreakdown.self, """
        {"domainFeeUsd":10.44,"platformFeeUsd":9.56,"totalAnnualUsd":20,"currency":"USD","billingInterval":"year"}
        """)
        XCTAssertEqual(newer.domainWholesaleUsd, 10.44, accuracy: 0.001)
        XCTAssertEqual(newer.interval, "year")
        let both = try decode(DomainPricingBreakdown.self, """
        {"domainFeeUsd":10.44,"domainWholesaleUsd":10.44,"platformFeeUsd":9.56,"totalAnnualUsd":20,
         "currency":"USD","billingInterval":"year","interval":"year",
         "lineItems":[{"name":"Domain","description":"acme.com","amountUsd":10.44}]}
        """)
        XCTAssertEqual(both.lineItems?.count, 1)
    }

    func testMaskedAliasDecodesSnakeCaseRow() throws {
        let alias = try decode(MaskedAlias.self, """
        {"id":"al_1","mailbox_id":"me@x.com","alias_email":"k3j@alias.x.com","is_active":false,"paused_action":"reject"}
        """)
        XCTAssertEqual(alias.mailboxId, "me@x.com")
        XCTAssertFalse(alias.isActive)
        XCTAssertEqual(alias.pausedAction, "reject")
    }

    // MARK: - Payment return deep links

    func testPaymentCallbackDomainReady() {
        let url = URL(string: "inboxies://onboarding/domain-ready?domain=acme.com&session_id=cs_1&token=tok&mailbox_id=me%40acme.com")!
        XCTAssertEqual(
            PaymentCallback.parse(url),
            .domainReady(domain: "acme.com", sessionId: "cs_1", token: "tok", mailboxId: "me@acme.com")
        )
    }

    func testPaymentCallbackCancelledIsNotSuccess() {
        let url = URL(string: "inboxies://onboarding/cancelled?domain=acme.com")!
        XCTAssertEqual(PaymentCallback.parse(url), .cancelled(domain: "acme.com"))
    }

    func testPaymentCallbackIgnoresOtherLinks() {
        XCTAssertEqual(PaymentCallback.parse(URL(string: "inboxies://invite/abc")!), .unrecognized)
        XCTAssertEqual(PaymentCallback.parse(URL(string: "https://inboxies.email/onboarding/domain-ready")!), .unrecognized)
    }

    // MARK: - APIClient helpers

    func testMakeURLDoesNotDoubleEncodeSegments() {
        let base = URL(string: "https://api.example.com")!
        let url = APIClient.makeURL(
            base: base,
            path: "/api/v1/mailboxes/\("a b@x.com".urlPathEncoded)/emails/\("id/1".urlPathEncoded)"
        )
        XCTAssertEqual(url?.absoluteString, "https://api.example.com/api/v1/mailboxes/a%20b@x.com/emails/id%2F1")
    }

    func testMakeURLPutsFiltersInQuery() {
        let base = URL(string: "https://api.example.com/")!
        let url = APIClient.makeURL(
            base: base,
            path: "/api/v1/admin/domains/acme.com/dns/records",
            query: ["type": "MX", "name": "acme.com"]
        )
        XCTAssertEqual(url?.absoluteString, "https://api.example.com/api/v1/admin/domains/acme.com/dns/records?name=acme.com&type=MX")
    }

    func testExpiredSessionDetectionOnlyMatchesSessionMessage() {
        XCTAssertTrue(APIClient.isExpiredSessionResponse(statusCode: 403, message: "Invalid or expired mobile session token"))
        XCTAssertFalse(APIClient.isExpiredSessionResponse(statusCode: 403, message: "Forbidden"))
        XCTAssertFalse(APIClient.isExpiredSessionResponse(statusCode: 404, message: "Invalid or expired mobile session token"))
    }

    func testDomainVerificationErrorSurfacesRecord() {
        let body = Data(#"{"code":"domain_verification_required","verification":{"recordName":"_inboxies.acme.com","recordType":"TXT","recordValue":"abc"}}"#.utf8)
        let message = httpErrorMessage(from: body)
        XCTAssertTrue(message.contains("_inboxies.acme.com"))
        XCTAssertTrue(message.contains("abc"))
    }

    func testExportFilenameFromContentDisposition() {
        XCTAssertEqual(
            APIClient.exportFilename(contentDisposition: #"attachment; filename="inboxies-export-1.mbox""#, fallback: "x.mbox"),
            "inboxies-export-1.mbox"
        )
        XCTAssertEqual(
            APIClient.exportFilename(contentDisposition: #"attachment; filename="../../etc/passwd""#, fallback: "x.mbox"),
            "passwd"
        )
        XCTAssertEqual(APIClient.exportFilename(contentDisposition: nil, fallback: "x.mbox"), "x.mbox")
    }

    // MARK: - Remote images

    func testRemoteImageDetection() {
        XCTAssertTrue(EmailHTMLSanitizer.containsRemoteImages(#"<img src="https://t.example.com/p.gif">"#))
        XCTAssertTrue(EmailHTMLSanitizer.containsRemoteImages(#"<td style="background: url('//cdn.example.com/bg.png')">"#))
        XCTAssertFalse(EmailHTMLSanitizer.containsRemoteImages(#"<img src="data:image/png;base64,AAAA">"#))
        XCTAssertFalse(EmailHTMLSanitizer.containsRemoteImages(#"<a href="https://example.com">link</a>"#))
        XCTAssertFalse(EmailHTMLSanitizer.remoteImagesBlockedPolicy.contains("https:"))
    }
}

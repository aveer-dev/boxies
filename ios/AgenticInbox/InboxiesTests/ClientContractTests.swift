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

    // AVE-111: these fields were declared and keyed but never read by `init(from:)`.

    /// Threaded list row: `LIST_EMAIL_COLUMNS` (workers/lib/conversation-index.ts)
    /// through `#withDecodedAuth`, with SQLite 0/1 flags already coerced.
    func testEmailDecodesExplainabilityFieldsOnListRow() throws {
        let email = try decode(Email.self, """
        {"id":"e3","subject":"Win","sender":"promo@x.com","sender_name":"Promo","recipient":"me@x.com",
         "date":"2026-10-10T10:00:00Z","read":false,"starred":false,"reply_later":false,"reply_later_at":null,
         "thread_id":"t3","folder_id":"spam","in_reply_to":null,"email_references":null,
         "provider_message_id":null,"delivery_status":null,"delivery_error":null,"snippet":"Act now",
         "auth":{"spf":"fail","dkim":"none","dmarc":"fail","aligned":false,"spoofed":true,"authTier":"failed"},
         "auth_tier":"failed","classification_reason":"auth-failed","matched_rule_id":null,
         "thread_count":1,"thread_unread_count":1,"participants":"promo@x.com",
         "needs_reply":0,"has_draft":0,"has_attachment":false,"list_section":"new",
         "has_sticky_note":false,"sticky_note_text":null,"inline_note_count":0}
        """)
        XCTAssertEqual(email.authTier, "failed")
        XCTAssertEqual(email.classificationReason, "auth-failed")
        XCTAssertNil(email.matchedRuleId)
        XCTAssertNil(email.aliasEmail)
        XCTAssertEqual(email.spamReasonLine, SpamReason.line(for: "auth-failed", folderId: "spam"))
        XCTAssertNotNil(email.spamReasonLine)
    }

    /// Detail row: every `emails` column plus `#aliasFields` and
    /// `one_click_unsubscribe` (workers/durableObject/index.ts getEmail).
    func testEmailDecodesAliasAndRuleFieldsOnDetailRow() throws {
        let email = try decode(Email.self, """
        {"id":"e4","thread_id":"t4","folder_id":"inbox","subject":"Order","sender":"shop@x.com",
         "sender_name":"Shop","recipient":"shop.k3@relay.example","cc":null,"bcc":null,
         "date":"2026-10-10T10:00:00Z","read":true,"starred":false,"reply_later":false,
         "body":"<p>Thanks</p>","snippet":"Thanks","in_reply_to":null,"message_id":"<m4@x.com>",
         "raw_headers":"[]","alias_id":"al_4","auth":null,"auth_tier":"verified",
         "classification_reason":"personal-ham","matched_rule_id":"sr_9",
         "alias_email":"shop.k3@relay.example","alias_active":false,
         "one_click_unsubscribe":true,"attachments":[],"delivery_recipients":[]}
        """)
        XCTAssertEqual(email.aliasId, "al_4")
        XCTAssertEqual(email.aliasEmail, "shop.k3@relay.example")
        XCTAssertEqual(email.aliasActive, false)
        XCTAssertEqual(email.authTier, "verified")
        XCTAssertEqual(email.classificationReason, "personal-ham")
        XCTAssertEqual(email.matchedRuleId, "sr_9")
        XCTAssertEqual(email.oneClickUnsubscribe, true)
    }

    func testEmailDecodesAliasActiveAsSQLiteInteger() throws {
        let email = try decode(Email.self, """
        {"id":"e5","alias_id":"al_5","alias_email":"a@relay.example","alias_active":1}
        """)
        XCTAssertEqual(email.aliasActive, true)
    }

    /// SSE `new_email` broadcast (workers/durableObject/index.ts).
    func testEmailDecodesExplainabilityFieldsOnNewEmailEvent() throws {
        let email = try decode(Email.self, """
        {"id":"e6","folder_id":"spam","subject":"Hi","sender":"a@x.com","sender_name":null,
         "recipient":"b@x.com","date":"2026-10-10T10:00:00Z","read":false,"starred":false,
         "snippet":"Hello","thread_id":null,"provider_message_id":null,"delivery_status":null,
         "delivery_error":null,"auth":null,"auth_tier":"unverified",
         "classification_reason":"sender-rejected","matched_rule_id":"sr_2",
         "reply_later":false,"alias_id":null}
        """)
        XCTAssertEqual(email.authTier, "unverified")
        XCTAssertEqual(email.classificationReason, "sender-rejected")
        XCTAssertEqual(email.matchedRuleId, "sr_2")
        XCTAssertNil(email.aliasActive)
    }

    func testCacheRoundTripsExplainabilityAndAliasFields() throws {
        let db = DatabaseService(inMemory: true)
        let decoded = try decode(Email.self, """
        {"id":"e7","thread_id":"t7","folder_id":"spam","subject":"S","sender":"a@x.com",
         "recipient":"b@relay.example","date":"2026-10-10T10:00:00Z","read":false,"starred":false,
         "alias_id":"al_7","alias_email":"b@relay.example","alias_active":true,
         "auth_tier":"failed","classification_reason":"auth-failed","matched_rule_id":"sr_7"}
        """)
        db.upsertEmails(mailboxId: "mb@x.com", emails: [decoded])

        // A later payload without the fields (e.g. a list row) keeps the cached ones.
        var listRow = decoded
        listRow.aliasEmail = nil
        listRow.aliasActive = nil
        listRow.matchedRuleId = nil
        db.upsertEmails(mailboxId: "mb@x.com", emails: [listRow])

        let cached = try XCTUnwrap(db.getEmail(id: "e7"))
        XCTAssertEqual(cached.aliasEmail, "b@relay.example")
        XCTAssertEqual(cached.aliasActive, true)
        XCTAssertEqual(cached.authTier, "failed")
        XCTAssertEqual(cached.classificationReason, "auth-failed")
        XCTAssertEqual(cached.matchedRuleId, "sr_7")
        XCTAssertEqual(db.getEmails(mailboxId: "mb@x.com", folderId: "spam").first?.classificationReason, "auth-failed")
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
        XCTAssertEqual(alias.aliasEmail, "k3j@alias.x.com")
        XCTAssertFalse(alias.isActive)
        XCTAssertEqual(alias.pausedAction, "reject")
    }

    // MARK: - Payment return deep links

    func testPaymentCallbackDomainReady() {
        let url = URL(string: "inboxies://onboarding/domain-ready?domain=acme.com&code=abc123")!
        XCTAssertEqual(PaymentCallback.parse(url), .domainReady(domain: "acme.com", code: "abc123"))
    }

    func testPaymentCallbackDomainReadyWithoutCode() {
        let url = URL(string: "inboxies://onboarding/domain-ready?domain=acme.com")!
        XCTAssertEqual(PaymentCallback.parse(url), .domainReady(domain: "acme.com", code: nil))
    }

    /// AVE-118: links from older Workers carried the session token; the app no longer reads it.
    func testPaymentCallbackIgnoresLegacySessionToken() {
        let url = URL(string: "inboxies://onboarding/domain-ready?domain=acme.com&session_id=cs_1&token=tok&mailbox_id=me%40acme.com")!
        XCTAssertEqual(PaymentCallback.parse(url), .domainReady(domain: "acme.com", code: nil))
    }

    func testCheckoutExchangeResponseDecodes() throws {
        let res = try decode(CheckoutExchangeResponse.self, """
        {"token":"s1","expiresAt":"2026-11-01T00:00:00.000Z","email":"me@acme.com","sub":"u","keys":[],"mailboxId":"me@acme.com"}
        """)
        XCTAssertEqual(res.token, "s1")
        XCTAssertEqual(res.mailboxId, "me@acme.com")
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

    /// AVE-132: remote images load by default; only Spam blocks them until "Load images".
    func testRemoteImagesBlockedOnlyInSpam() {
        XCTAssertTrue(EmailHTMLSanitizer.blocksRemoteImages(folderId: "spam"))
        for folder in ["inbox", "screener", "promotions", "updates", "sent", "draft", "archive", "screened_out", "trash"] {
            XCTAssertFalse(EmailHTMLSanitizer.blocksRemoteImages(folderId: folder), folder)
        }
        XCTAssertFalse(EmailHTMLSanitizer.blocksRemoteImages(folderId: nil))

        let inbox = EmailHTMLSanitizer.contentSecurityPolicy(blocksRemoteImages: false, loadedRemoteImages: false)
        XCTAssertEqual(inbox, EmailHTMLSanitizer.contentSecurityPolicy)
        XCTAssertTrue(inbox.contains("img-src data: cid: https:"))

        let spam = EmailHTMLSanitizer.contentSecurityPolicy(blocksRemoteImages: true, loadedRemoteImages: false)
        XCTAssertEqual(spam, EmailHTMLSanitizer.remoteImagesBlockedPolicy)
        XCTAssertFalse(spam.contains("https:"))

        let spamLoaded = EmailHTMLSanitizer.contentSecurityPolicy(blocksRemoteImages: true, loadedRemoteImages: true)
        XCTAssertEqual(spamLoaded, EmailHTMLSanitizer.contentSecurityPolicy)
    }

    // MARK: - Service end (read-only domains)

    func testMailboxDecodesWithoutServiceFields() throws {
        let mailbox = try decode(Mailbox.self, #"{"id":"a@acme.com","email":"a@acme.com","name":"a@acme.com","canManage":true}"#)
        XCTAssertFalse(mailbox.isReadOnly)
        XCTAssertNil(mailbox.service)
        XCTAssertEqual(mailbox.domain, "acme.com")
    }

    func testMailboxDecodesReadOnlyAndService() throws {
        let mailbox = try decode(Mailbox.self, """
        {"id":"a@acme.com","email":"a@acme.com","name":"A","readOnly":true,
         "service":{"domain":"acme.com","status":"ended","endedAt":"2026-10-01T00:00:00.000Z",
                    "registrarManaged":true,"renewBy":"2026-11-10T00:00:00.000Z","daysLeftToRenew":27,"canRenew":true}}
        """)
        XCTAssertTrue(mailbox.isReadOnly)
        XCTAssertEqual(mailbox.service?.isEnded, true)
        XCTAssertEqual(mailbox.service?.daysLeftToRenew, 27)
        XCTAssertNotNil(mailbox.service?.renewByDate)
        XCTAssertNil(mailbox.service?.canManage)
    }

    func testMalformedServiceNeverDropsTheMailbox() throws {
        let mailbox = try decode(Mailbox.self, #"{"id":"a@acme.com","email":"a@acme.com","name":"A","readOnly":"yes","service":"ended"}"#)
        XCTAssertEqual(mailbox.id, "a@acme.com")
        XCTAssertFalse(mailbox.isReadOnly)
        XCTAssertNil(mailbox.service)
    }

    func testServiceEndedErrorIsDistinct() {
        let body = Data(#"{"error":"The subscription for acme.com has ended.","code":"service_ended","domain":"acme.com"}"#.utf8)
        guard case .serviceEnded(let domain, let message)? = APIClient.serviceEndedError(statusCode: 403, data: body) else {
            return XCTFail("expected serviceEnded")
        }
        XCTAssertEqual(domain, "acme.com")
        XCTAssertEqual(message, "The subscription for acme.com has ended.")
        XCTAssertNil(APIClient.serviceEndedError(statusCode: 403, data: Data(#"{"error":"Forbidden"}"#.utf8)))
        XCTAssertNil(APIClient.serviceEndedError(statusCode: 409, data: body))
    }

    func testRenewResponseShapes() throws {
        let resumed = try decode(DomainRenewResponse.self, #"{"resumed":true,"service":{"domain":"acme.com","status":"active","registrarManaged":false,"canRenew":false}}"#)
        XCTAssertEqual(resumed.resumed, true)
        XCTAssertEqual(resumed.service?.status, "active")
        let checkout = try decode(DomainRenewResponse.self, #"{"checkoutUrl":"https://checkout.stripe.com/x","sessionId":"cs_1","pricing":{"totalAnnualUsd":30}}"#)
        XCTAssertEqual(checkout.checkoutUrl, "https://checkout.stripe.com/x")
        XCTAssertNil(checkout.resumed)
    }

    func testBillingRenewalCallbacks() {
        XCTAssertEqual(
            PaymentCallback.parse(URL(string: "inboxies://billing/renewed?domain=Acme.com")!),
            .renewed(domain: "acme.com")
        )
        XCTAssertEqual(
            PaymentCallback.parse(URL(string: "inboxies://billing/renew-cancelled?domain=acme.com")!),
            .renewCancelled(domain: "acme.com")
        )
        XCTAssertEqual(PaymentCallback.parse(URL(string: "inboxies://billing/other")!), .unrecognized)
    }

    func testServiceNoticeCopy() {
        let mailbox = Mailbox(id: "a@acme.com", email: "a@acme.com", name: "A", readOnly: true)
        let admin = DomainService(domain: "acme.com", status: "ended", registrarManaged: true,
                                  renewBy: "2026-11-10T00:00:00.000Z", daysLeftToRenew: 12,
                                  canRenew: true, canManage: true, billed: true)
        let adminNotice = ServiceNotice.make(mailbox: mailbox, service: admin)
        XCTAssertEqual(adminNotice?.title, "Your subscription for acme.com ended. Mail is read-only.")
        XCTAssertEqual(adminNotice?.actionTitle, "Renew")
        XCTAssertTrue(adminNotice?.detail?.contains("12 days left") == true)

        var member = admin
        member.canManage = false
        let memberNotice = ServiceNotice.make(mailbox: mailbox, service: member)
        XCTAssertNil(memberNotice?.actionTitle)
        XCTAssertTrue(memberNotice?.detail?.contains("Ask an admin of acme.com to renew.") == true)

        var closed = admin
        closed.canRenew = false
        XCTAssertEqual(
            ServiceNotice.make(mailbox: mailbox, service: closed)?.detail,
            "This domain can no longer be renewed. You can still read and export your mail."
        )

        let active = Mailbox(id: "a@acme.com", email: "a@acme.com", name: "A")
        let ending = DomainService(domain: "acme.com", status: "ending", endsAt: "2026-11-01T00:00:00.000Z",
                                   canRenew: true, canManage: true, billed: true)
        XCTAssertEqual(ServiceNotice.make(mailbox: active, service: ending)?.actionTitle, "Keep subscription")
        var endingMember = ending
        endingMember.canManage = false
        XCTAssertNil(ServiceNotice.make(mailbox: active, service: endingMember))
        XCTAssertNil(ServiceNotice.make(mailbox: active, service: nil))
    }

    func testReadOnlySwipesKeepOnlyFlags() {
        let layout = EmailSwipeLayout(
            trailingActions: [.delete, .archive],
            trailingAllowsFullSwipe: true,
            leadingActions: [.toggleRead, .reply],
            leadingAllowsFullSwipe: true,
            showsMore: true
        ).readOnly()
        XCTAssertEqual(layout.trailingActions, [])
        XCTAssertFalse(layout.trailingAllowsFullSwipe)
        XCTAssertEqual(layout.leadingActions, [.toggleRead])
    }

    // MARK: - Spam verdicts (AVE-98)

    func testMoveResponseDecodesRescueAndUndo() throws {
        let response = try decode(MoveEmailResponse.self, """
        {"status":"moved","senderStatus":"allowed","triage":{"sender":"a@x.com"},
         "rescuedCount":3,"undoToken":"tok-1"}
        """)
        XCTAssertEqual(response.rescuedCount, 3)
        XCTAssertEqual(response.undoToken, "tok-1")
        let plain = try decode(MoveEmailResponse.self, #"{"status":"moved"}"#)
        XCTAssertNil(plain.senderStatus)
        XCTAssertNil(SpamVerdictToast.title(for: plain, folderId: "archive", sender: "a@x.com"))
    }

    func testSpamVerdictToastCopyMatchesWeb() {
        XCTAssertEqual(
            SpamVerdictToast.title(
                for: MoveEmailResponse(senderStatus: "allowed", rescuedCount: 3),
                folderId: "inbox",
                sender: "ada@x.example"
            ),
            "Moved to Inbox · future mail from ada@x.example will skip Spam · 3 more moved"
        )
        XCTAssertEqual(
            SpamVerdictToast.title(for: MoveEmailResponse(senderStatus: "rejected", rescuedCount: 2), folderId: "spam", sender: nil),
            "Reported as spam · 2 more moved"
        )
        XCTAssertEqual(
            SpamVerdictToast.title(
                for: MoveEmailResponse(senderStatus: "rejected", unsubscribe: "sent", rescuedCount: 0),
                folderId: "spam",
                sender: nil
            ),
            "Reported as spam and unsubscribed"
        )
        XCTAssertEqual(
            SpamVerdictToast.title(for: MoveEmailResponse(senderStatus: "allowed"), folderId: "custom", sender: nil),
            "Moved out of Spam"
        )
    }

    // MARK: - Screener Undo (AVE-159)

    func testSenderTriageDecisionDecodesMovedIds() throws {
        let response = try decode(SenderTriageDecisionResponse.self, """
        {"triage":{"sender":"a@x.com","status":"rejected"},"moved":{"moved":2,"ids":["e1","e2"]}}
        """)
        XCTAssertEqual(response.moved?.ids, ["e1", "e2"])
        XCTAssertEqual(ScreenerDecision.restoreIds(response: response, emailId: "e2"), ["e1", "e2"])
        XCTAssertEqual(ScreenerDecision.restoreIds(response: response, emailId: "e3"), ["e1", "e2", "e3"])
        let bare = try decode(SenderTriageDecisionResponse.self, #"{"triage":null}"#)
        XCTAssertEqual(ScreenerDecision.restoreIds(response: bare, emailId: "e9"), ["e9"])
    }

    func testScreenerDecisionToastCopy() {
        XCTAssertEqual(ScreenerDecision.toastTitle(destinationFolderId: nil), "Declined")
        XCTAssertEqual(ScreenerDecision.toastTitle(destinationFolderId: "inbox"), "Accepted")
        XCTAssertEqual(
            ScreenerDecision.toastTitle(destinationFolderId: "promotions"),
            "Accepted · future mail goes to Promotions"
        )
        XCTAssertEqual(
            ScreenerDecision.toastTitle(destinationFolderId: "updates"),
            "Accepted · future mail goes to Updates"
        )
    }

    func testSenderTriagePathEncodesTheAddress() {
        XCTAssertEqual(
            APIClient.senderTriagePath(mailboxId: "me@acme.com", sender: "ada+news@x.example"),
            "/api/v1/mailboxes/me@acme.com/sender-triage/ada+news@x.example"
        )
        XCTAssertEqual(
            APIClient.senderTriagePath(mailboxId: "me@acme.com", sender: "a/b?c@x.example"),
            "/api/v1/mailboxes/me@acme.com/sender-triage/a%2Fb%3Fc@x.example"
        )
    }

    // MARK: - Custom folders / tags (AVE-158)

    func testFolderCreateResponseDecodes() throws {
        // POST /folders: `{ ...row, unreadCount: 0 }` (Durable Object createFolder).
        let folder = try decode(Folder.self, #"{"id":"engineering-prs","name":"Engineering-PRs","unreadCount":0}"#)
        XCTAssertEqual(folder.id, "engineering-prs")
        XCTAssertEqual(folder.unreadCount, 0)
    }

    func testFolderRenameResponseDecodesWithoutUnreadCount() throws {
        // PUT /folders/:id answers `{ id, name }` only.
        let renamed = try decode(RenamedFolder.self, #"{"id":"receipts","name":"Bills"}"#)
        XCTAssertEqual(renamed.id, "receipts")
        XCTAssertEqual(renamed.name, "Bills")
    }

    func testCustomFolderSlugMatchesWorker() {
        XCTAssertEqual(CustomFolders.slug("Engineering PRs"), "engineering-prs")
        XCTAssertEqual(CustomFolders.slug("  Q3 -- Plans!  "), "q3-plans")
        XCTAssertEqual(CustomFolders.slug("snake_case"), "snake_case")
        // JS `\w` is ASCII: accented letters drop out, like the Worker.
        XCTAssertEqual(CustomFolders.slug("Café"), "caf")
        XCTAssertEqual(CustomFolders.slug("🎉🎉"), "")
    }

    func testCustomFoldersExcludeSystemFolders() {
        let folders = [
            Folder(id: "inbox", name: "Inbox", unreadCount: 1),
            Folder(id: "travel", name: "Travel", unreadCount: 0),
            Folder(id: "screened_out", name: "Screened out", unreadCount: 0),
            Folder(id: "receipts", name: "Receipts", unreadCount: 2),
        ]
        XCTAssertEqual(CustomFolders.custom(in: folders).map(\.id), ["receipts", "travel"])
    }

    func testCreateValidationUsesWorkerCopy() {
        let existing = [
            Folder(id: "inbox", name: "Inbox", unreadCount: 0),
            Folder(id: "receipts", name: "Receipts", unreadCount: 0),
        ]
        XCTAssertEqual(CustomFolders.validateCreate("   ", existing: existing), CustomFolders.nameRequired)
        XCTAssertEqual(CustomFolders.validateCreate("#", existing: existing), CustomFolders.nameRequired)
        XCTAssertEqual(CustomFolders.validateCreate("!!!", existing: existing), "Folder name must contain alphanumeric characters")
        XCTAssertEqual(CustomFolders.validateCreate("receipts", existing: existing), "Folder with this name already exists")
        XCTAssertEqual(CustomFolders.validateCreate("#Receipts", existing: existing), CustomFolders.duplicateName)
        // System ids are reserved even when the list doesn't carry them.
        XCTAssertEqual(CustomFolders.validateCreate("Trash", existing: existing), CustomFolders.duplicateName)
        XCTAssertNil(CustomFolders.validateCreate("Travel", existing: existing))
    }

    func testRenameValidationIgnoresTheFolderItself() {
        let receipts = Folder(id: "receipts", name: "Receipts", unreadCount: 0)
        let existing = [Folder(id: "inbox", name: "Inbox", unreadCount: 0), receipts,
                        Folder(id: "travel", name: "Trips", unreadCount: 0)]
        XCTAssertNil(CustomFolders.validateRename("RECEIPTS", folder: receipts, existing: existing))
        XCTAssertEqual(CustomFolders.validateRename("", folder: receipts, existing: existing), "Folder name is required")
        XCTAssertEqual(CustomFolders.validateRename("trips", folder: receipts, existing: existing), CustomFolders.duplicateName)
        // Lookups resolve by id too, so another folder's id is taken.
        XCTAssertEqual(CustomFolders.validateRename("Travel", folder: receipts, existing: existing), CustomFolders.duplicateName)
        XCTAssertEqual(CustomFolders.validateRename("inbox", folder: receipts, existing: existing), CustomFolders.duplicateName)
        XCTAssertNil(CustomFolders.validateRename("Bills", folder: receipts, existing: existing))
    }

    func testTagCopy() {
        let tag = Folder(id: "receipts", name: "#Receipts", unreadCount: 0)
        XCTAssertEqual(CustomFolders.displayName(tag), "#Receipts")
        XCTAssertEqual(CustomFolders.normalizedName("  #Receipts "), "Receipts")
        XCTAssertEqual(CustomFolders.deleteConfirmTitle(tag), "Delete #Receipts?")
    }
}

import XCTest
@testable import Inboxies

/// Domain Admin → Aliases (AVE-219): request shapes, local-part rules and error copy.
/// Android twin: `DomainAliasesTest.kt`.
final class DomainAliasesTests: XCTestCase {
    private func row(_ email: String) -> AdminMailboxRow {
        AdminMailboxRow(id: email, email: email, name: email, acl: nil, claimed: true, fromName: nil)
    }

    func testPathsEncodeDomainAndLocal() {
        XCTAssertEqual(DomainAliases.path(domain: "acme.com"), "/api/v1/admin/domains/acme.com/aliases")
        XCTAssertEqual(
            DomainAliases.deletePath(domain: "acme.com", aliasLocal: "sales"),
            "/api/v1/admin/domains/acme.com/aliases/sales"
        )
    }

    func testCreateBodyUsesWorkerKeys() {
        XCTAssertEqual(
            DomainAliases.createBody(aliasLocal: "sales", targetMailboxId: "you@acme.com"),
            ["aliasLocal": "sales", "targetMailboxId": "you@acme.com"]
        )
    }

    func testListResponseDecodesWorkerShape() throws {
        let json = """
        {"domain":"acme.com","aliases":[{"aliasLocal":"sales","aliasEmail":"sales@acme.com",
         "targetMailboxId":"you@acme.com","createdAt":"2026-11-09T10:00:00.000Z"}]}
        """
        let res = try JSONDecoder().decode(DomainAliasesResponse.self, from: Data(json.utf8))
        XCTAssertEqual(res.aliases.first?.aliasEmail, "sales@acme.com")
        XCTAssertEqual(res.aliases.first?.targetMailboxId, "you@acme.com")
    }

    func testCreateResponseDecodes() throws {
        let json = """
        {"success":true,"alias":{"aliasLocal":"sales","aliasEmail":"sales@acme.com","targetMailboxId":"you@acme.com","createdAt":"x"}}
        """
        let res = try JSONDecoder().decode(DomainAliasCreateResponse.self, from: Data(json.utf8))
        XCTAssertEqual(res.alias?.aliasLocal, "sales")
    }

    func testNormalizedLocalMatchesWorker() {
        XCTAssertEqual(DomainAliases.normalizedLocal("  @@Sales "), "sales")
        XCTAssertEqual(DomainAliases.normalizedLocal("sales@acme.com"), "sales")
        XCTAssertTrue(DomainAliases.isValidLocal("first.last_2-x"))
        XCTAssertFalse(DomainAliases.isValidLocal(""))
        XCTAssertFalse(DomainAliases.isValidLocal("sales team"))
        XCTAssertFalse(DomainAliases.isValidLocal("sales+1"))
    }

    func testTargetsPreferTheDomainsMailboxes() {
        let rows = [row("you@acme.com"), row("ops@other.com")]
        XCTAssertEqual(DomainAliases.targets(rows, domain: "ACME.com").map(\.email), ["you@acme.com"])
        XCTAssertEqual(DomainAliases.targets(rows, domain: "nope.com").count, 2)
    }

    func testConflictCatchesAliasesAndMailboxes() {
        let aliases = [DomainAliasItem(aliasLocal: "sales", aliasEmail: "sales@acme.com", targetMailboxId: "you@acme.com")]
        let rows = [row("you@acme.com")]
        XCTAssertEqual(
            DomainAliases.conflict(local: "sales", domain: "acme.com", aliases: aliases, mailboxes: rows),
            "sales@acme.com is already an alias"
        )
        XCTAssertEqual(
            DomainAliases.conflict(local: "you", domain: "acme.com", aliases: aliases, mailboxes: rows),
            "you@acme.com is already a mailbox"
        )
        XCTAssertNil(DomainAliases.conflict(local: "hello", domain: "acme.com", aliases: aliases, mailboxes: rows))
    }

    func testAddErrorCopyForWorkerStatuses() {
        XCTAssertEqual(DomainAliases.addErrorMessage(status: 400, serverMessage: "Invalid alias local part"), DomainAliases.invalidLocal)
        XCTAssertEqual(DomainAliases.addErrorMessage(status: 400, serverMessage: "Target mailbox is required"), "Target mailbox is required")
        XCTAssertEqual(DomainAliases.addErrorMessage(status: 403, serverMessage: ""), DomainAliases.forbiddenTarget)
        XCTAssertEqual(
            DomainAliases.addErrorMessage(status: 409, serverMessage: "sales@acme.com is already a mailbox"),
            "sales@acme.com is already a mailbox"
        )
        XCTAssertEqual(DomainAliases.addErrorMessage(status: 500, serverMessage: nil), DomainAliases.addFailed)
        XCTAssertEqual(
            DomainAliases.addErrorMessage(for: APIError.http(409, "sales@acme.com is in use by a private email")),
            "sales@acme.com is in use by a private email"
        )
    }
}

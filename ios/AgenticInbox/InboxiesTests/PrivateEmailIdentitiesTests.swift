import AuthenticationServices
import XCTest
@testable import Inboxies

/// QuickType identities: which private emails register, under which domain.
final class PrivateEmailIdentitiesTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-14T12:00:00Z")!

    func testServiceDomainReducesSiteLabelsToTheRegistrableDomain() {
        XCTAssertEqual(PrivateEmailIdentities.serviceDomain(forLabel: "github.com"), "github.com")
        XCTAssertEqual(PrivateEmailIdentities.serviceDomain(forLabel: "signup.netflix.com"), "netflix.com")
        XCTAssertEqual(PrivateEmailIdentities.serviceDomain(forLabel: " Shop.Example.co.uk. "), "example.co.uk")
        XCTAssertEqual(PrivateEmailIdentities.serviceDomain(forLabel: "https://www.airbnb.com/signup?x=1"), "airbnb.com")
        XCTAssertEqual(PrivateEmailIdentities.serviceDomain(forLabel: "localhost"), "localhost")
    }

    func testServiceDomainSkipsFreeFormLabels() {
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: nil))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: ""))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "Netflix"))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "Newsletter: Stratechery"))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "shop.com signup"))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "192.168.1.10"))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "shop..com"))
        XCTAssertNil(PrivateEmailIdentities.serviceDomain(forLabel: "bücher.de"))
    }

    func testIdentitiesCarryDomainAddressAndId() throws {
        let emails = [PrivateEmail(id: "a1", address: "k4v9@private.inboxies.dev", label: "accounts.github.com")]
        let identity = try XCTUnwrap(PrivateEmailIdentities.identities(for: emails, now: now).first)
        XCTAssertEqual(identity.serviceIdentifier.identifier, "github.com")
        XCTAssertEqual(identity.serviceIdentifier.type, .domain)
        XCTAssertEqual(identity.user, "k4v9@private.inboxies.dev")
        XCTAssertEqual(identity.recordIdentifier, "a1")
    }

    func testOnlyUsableSiteLabelledEmailsRegister() {
        let emails = [
            PrivateEmail(id: "live", address: "a@p.dev", label: "github.com"),
            PrivateEmail(id: "paused", address: "b@p.dev", label: "github.com", isActive: false),
            PrivateEmail(id: "expired", address: "c@p.dev", label: "github.com", expiresAt: "2026-10-01T00:00:00.000Z"),
            PrivateEmail(id: "later", address: "d@p.dev", label: "airbnb.com", expiresAt: "2026-11-01T00:00:00Z"),
            PrivateEmail(id: "freeform", address: "e@p.dev", label: "Netflix"),
            PrivateEmail(id: "unlabelled", address: "f@p.dev"),
        ]
        let ids = PrivateEmailIdentities.identities(for: emails, now: now).map(\.recordIdentifier)
        XCTAssertEqual(ids, ["live", "later"])
    }

    func testNewerEmailsRankHigher() {
        // The server lists newest first.
        let emails = [
            PrivateEmail(id: "new", address: "a@p.dev", label: "github.com"),
            PrivateEmail(id: "old", address: "b@p.dev", label: "github.com"),
        ]
        let identities = PrivateEmailIdentities.identities(for: emails, now: now)
        XCTAssertEqual(identities.map(\.recordIdentifier), ["new", "old"])
        XCTAssertGreaterThan(identities[0].rank, identities[1].rank)
    }

    func testMaskedAliasConvertsWithStatusAndExpiry() {
        let alias = MaskedAlias(id: "m1", aliasEmail: "x@p.dev", label: "shop.com", isActive: false, expiresAt: "2027-01-01T00:00:00Z")
        let email = PrivateEmail(alias: alias)
        XCTAssertEqual(email, PrivateEmail(id: "m1", address: "x@p.dev", label: "shop.com", isActive: false, expiresAt: "2027-01-01T00:00:00Z"))
    }
}

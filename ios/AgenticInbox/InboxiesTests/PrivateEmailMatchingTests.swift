import XCTest
@testable import Inboxies

/// AutoFill's site matching, search and decoding for private emails.
final class PrivateEmailMatchingTests: XCTestCase {
    private func email(_ address: String, label: String? = nil) -> PrivateEmail {
        PrivateEmail(id: address, address: address, label: label)
    }

    func testMatcherReducesHostToDomainAndName() throws {
        let plain = try XCTUnwrap(PrivateEmailMatcher(host: "www.accounts.netflix.com"))
        XCTAssertEqual(plain.domain, "netflix.com")
        XCTAssertEqual(plain.name, "netflix")

        let country = try XCTUnwrap(PrivateEmailMatcher(host: "shop.example.co.uk"))
        XCTAssertEqual(country.domain, "example.co.uk")
        XCTAssertEqual(country.name, "example")

        let local = try XCTUnwrap(PrivateEmailMatcher(host: "localhost"))
        XCTAssertEqual(local.domain, "localhost")

        XCTAssertNil(PrivateEmailMatcher(host: nil))
        XCTAssertNil(PrivateEmailMatcher(host: "  "))
    }

    func testMatchesLabelByDomainOrNameAndAddressByName() throws {
        let matcher = try XCTUnwrap(PrivateEmailMatcher(host: "signup.netflix.com"))
        XCTAssertTrue(matcher.matches(email("a@p.dev", label: "netflix.com")))
        XCTAssertTrue(matcher.matches(email("b@p.dev", label: "Netflix")))
        XCTAssertTrue(matcher.matches(email("netflix.x1@p.dev")))
        XCTAssertFalse(matcher.matches(email("c@p.dev", label: "github.com")))
        XCTAssertFalse(matcher.matches(email("d@p.dev")))
    }

    func testShortNamesOnlyMatchTheFullDomain() throws {
        // "x" would otherwise match every label containing the letter.
        let matcher = try XCTUnwrap(PrivateEmailMatcher(host: "x.com"))
        XCTAssertTrue(matcher.matches(email("a@p.dev", label: "x.com")))
        XCTAssertFalse(matcher.matches(email("b@p.dev", label: "Xbox")))
        XCTAssertFalse(matcher.matches(email("x9@p.dev")))
    }

    func testSearchMatchesLabelOrAddressCaseInsensitively() {
        let emails = [
            email("k4v@p.dev", label: "Airbnb"),
            email("travel.q1@p.dev"),
            email("z9@p.dev", label: "github.com"),
        ]
        XCTAssertEqual(PrivateEmailSearch.filter(emails, query: "AIR").map(\.address), ["k4v@p.dev"])
        XCTAssertEqual(PrivateEmailSearch.filter(emails, query: "travel").map(\.address), ["travel.q1@p.dev"])
        XCTAssertEqual(PrivateEmailSearch.filter(emails, query: "  ").count, 3)
    }

    func testDecodesServerRowsAndSkipsUnusableOnes() throws {
        let json = Data("""
        {"aliases":[
          {"id":"1","alias_email":"a@p.dev","label":"shop.com","is_active":true,"expires_at":null},
          {"id":"2","alias_email":"b@p.dev","label":null,"is_active":0},
          {"id":"3","alias_email":"c@p.dev","is_active":true,"expires_at":"2020-01-01T00:00:00.000Z"},
          {"id":"4","alias_email":"d@p.dev","is_active":true,"expires_at":"2999-01-01T00:00:00Z"}
        ]}
        """.utf8)
        struct List: Decodable { let aliases: [PrivateEmail] }
        let list = try JSONDecoder().decode(List.self, from: json)
        XCTAssertEqual(list.aliases.count, 4)
        XCTAssertEqual(list.aliases.filter { $0.isUsable() }.map(\.id), ["1", "4"])
    }
}

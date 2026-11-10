import XCTest
@testable import Inboxies

/// The mailbox signature in compose (AVE-204): a custom signature replaces the
/// fixed line, web HTML reads as words with link addresses, and a body holding
/// only the signature is not draft content.
final class SignatureTests: XCTestCase {
    private func settings(_ signature: SignatureSettings?) -> MailboxSettings {
        var settings = MailboxSettings()
        settings.signature = signature
        return settings
    }

    func testFixedLineWhenOnWithoutWords() {
        XCTAssertEqual(ComposeHTML.signatureText(settings: settings(nil), fromName: nil), "Sent with Inboxies Email")
        XCTAssertEqual(
            ComposeHTML.signatureText(settings: settings(SignatureSettings(enabled: true, text: "")), fromName: nil),
            "Sent with Inboxies Email"
        )
        XCTAssertEqual(
            ComposeHTML.signatureText(settings: settings(SignatureSettings(enabled: false, text: "Ada")), fromName: nil),
            ""
        )
    }

    func testCustomSignatureReplacesFixedLine() {
        XCTAssertEqual(
            ComposeHTML.signatureText(settings: settings(SignatureSettings(enabled: true, text: "Ada\nCEO")), fromName: nil),
            "Ada\nCEO"
        )
        let web = SignatureSettings(
            enabled: true,
            text: "stale",
            html: "<p><strong>Ada</strong></p><p>CEO, <a href=\"https://ada.example\">Ada &amp; Co</a></p>"
        )
        XCTAssertEqual(
            ComposeHTML.signatureText(settings: settings(web), fromName: nil),
            "Ada\nCEO, Ada & Co (https://ada.example)"
        )
    }

    func testHTMLToTextMatchesWeb() {
        XCTAssertEqual(
            ComposeHTML.signatureHTMLToText("<p><a href=\"https://ada.example\">https://ada.example</a></p>"),
            "https://ada.example"
        )
        XCTAssertEqual(
            ComposeHTML.signatureHTMLToText("<a href=\"mailto:ada@example.com\">ada@example.com</a>"),
            "ada@example.com"
        )
        XCTAssertEqual(
            ComposeHTML.signatureHTMLToText("<p>Ada<br>Line two</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>"),
            "Ada\nLine two\n• One\n• Two"
        )
    }

    func testSignatureOnlyBodyIsNotContent() {
        let signature = "Ada\nCEO"
        XCTAssertFalse(ComposeHTML.bodyHasUserContent(ComposeHTML.bodyWithSignature(signature), signature: signature))
        // What the rich editor emits for that body: one paragraph per line.
        XCTAssertFalse(ComposeHTML.bodyHasUserContent("<p><br></p><p><br></p><p>Ada</p><p>CEO</p>", signature: signature))
        XCTAssertTrue(ComposeHTML.bodyHasUserContent("<p>Hello</p><p><br></p><p>Ada</p><p>CEO</p>", signature: signature))
    }
}

import SwiftUI
import UIKit
import XCTest
@testable import Inboxies

/// Watch phase 2b (AVE-144): the WatchConnectivity contract, the watch palette and the
/// watch's plain-text bodies.
final class WatchCompanionTests: XCTestCase {
    // MARK: Handoff

    func testGrantRoundTripsAndCarriesOnlyTheWatchToken() {
        let grant = WatchSessionGrant(
            token: "watch-token",
            apiBaseURL: URL(string: "https://inboxies.email")!,
            mailboxId: "hello@ada.studio"
        )
        let message = grant.message
        XCTAssertEqual(Set(message.keys), ["kind", "token", "apiBaseURL", "mailboxId"])
        XCTAssertEqual(WatchHandoff.kind(of: message), .session)
        XCTAssertEqual(WatchSessionGrant(message: message), grant)
    }

    func testGrantRejectsMissingTokenWrongKindAndPlainHTTPOrigin() {
        let good = WatchSessionGrant(token: "t", apiBaseURL: URL(string: "https://inboxies.email")!, mailboxId: nil).message
        var noToken = good
        noToken["token"] = ""
        XCTAssertNil(WatchSessionGrant(message: noToken))
        var wrongKind = good
        wrongKind["kind"] = WatchHandoff.Kind.context.rawValue
        XCTAssertNil(WatchSessionGrant(message: wrongKind))
        var http = good
        http["apiBaseURL"] = "http://inboxies.email"
        XCTAssertNil(WatchSessionGrant(message: http))
        var garbage = good
        garbage["apiBaseURL"] = "not a url"
        XCTAssertNil(WatchSessionGrant(message: garbage))
    }

    func testContextNeverCarriesAToken() {
        let context = WatchPhoneContext(
            signedIn: true,
            mailboxId: "hello@ada.studio",
            apiBaseURL: URL(string: "https://inboxies.email")!
        )
        XCTAssertNil(context.message[WatchSessionGrant.tokenKey])
        XCTAssertEqual(WatchPhoneContext(message: context.message), context)
        XCTAssertNil(WatchSessionGrant(message: context.message))
        let signedOut = WatchPhoneContext(signedIn: false, mailboxId: nil, apiBaseURL: nil)
        XCTAssertEqual(WatchPhoneContext(message: signedOut.message), signedOut)
    }

    // MARK: Palette

    func testWatchPaletteIsAppThemeDark() {
        let pairs: [(WatchPalette.RGB, UIColor, String)] = [
            (WatchPalette.backgroundRGB, AppTheme.uiBackground, "background"),
            (WatchPalette.surfaceRGB, AppTheme.uiSurface, "surface"),
            (WatchPalette.inkRGB, AppTheme.uiInk, "ink"),
            (WatchPalette.mutedRGB, AppTheme.uiMuted, "muted"),
            (WatchPalette.lineRGB, AppTheme.uiLine, "line"),
            (WatchPalette.pillFillRGB, AppTheme.uiPillFill, "pillFill"),
            (WatchPalette.accentRGB, AppTheme.uiAccent, "accent"),
            (WatchPalette.destructiveRGB, AppTheme.uiDeepDarkRed, "deepDarkRed"),
        ]
        let dark = UITraitCollection(userInterfaceStyle: .dark)
        for (rgb, color, name) in pairs {
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            XCTAssertTrue(color.resolvedColor(with: dark).getRed(&red, green: &green, blue: &blue, alpha: &alpha), name)
            XCTAssertEqual(rgb.red, Double(red), accuracy: 0.001, name)
            XCTAssertEqual(rgb.green, Double(green), accuracy: 0.001, name)
            XCTAssertEqual(rgb.blue, Double(blue), accuracy: 0.001, name)
        }
    }

    // MARK: Plain text

    func testHTMLBodyBecomesReadableText() {
        let html = """
        <html><head><style>p { color: red }</style><title>x</title></head>
        <body><p>Hi&nbsp;Ada,</p><p>Revenue is up &amp; on track.<br>Thanks &#8212; Maya</p>
        <script>alert(1)</script><!-- tracking --><ul><li>One</li><li>Two</li></ul></body></html>
        """
        let text = WatchMailText.plainText(from: html)
        XCTAssertEqual(text, "Hi Ada,\nRevenue is up & on track.\nThanks — Maya\n\n• One\n• Two")
    }

    func testPlainTextIsKeptAndTrimmed() {
        XCTAssertEqual(WatchMailText.plainText(from: "  a < b\n\n\n\nc  "), "a < b\n\nc")
        XCTAssertEqual(WatchMailText.plainText(from: nil), "")
        let long = String(repeating: "word ", count: 1_000)
        let trimmed = WatchMailText.plainText(from: long)
        XCTAssertLessThanOrEqual(trimmed.count, WatchMailText.bodyLimit + 1)
        XCTAssertTrue(trimmed.hasSuffix("…"))
    }

    func testSenderName() {
        XCTAssertEqual(WatchMailText.senderName(name: "Maya Chen", address: "maya@northwind.co"), "Maya Chen")
        XCTAssertEqual(WatchMailText.senderName(name: " ", address: "\"Maya\" <maya@northwind.co>"), "Maya")
        XCTAssertEqual(WatchMailText.senderName(name: nil, address: "maya@northwind.co"), "maya@northwind.co")
    }

    func testCannedRepliesMatchNotificationPlan() {
        XCTAssertEqual(WatchMailText.cannedReplies, MailNotificationActions.cannedReplies)
    }
}

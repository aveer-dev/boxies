import SwiftUI
import UIKit
import XCTest
@testable import Inboxies

/// Watch phase 2b (AVE-144): the WatchConnectivity contract, the watch's silent
/// reconnect, the watch palette and the watch's plain-text bodies.
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

    func testSessionRequestCarriesTheConnectTap() {
        let automatic = WatchHandoff.requestSession(manual: false)
        XCTAssertEqual(WatchHandoff.kind(of: automatic), .requestSession)
        XCTAssertFalse(WatchHandoff.isManualRequest(automatic))
        XCTAssertTrue(WatchHandoff.isManualRequest(WatchHandoff.requestSession(manual: true)))
        // An older watch build sends no flag: treated as automatic.
        XCTAssertFalse(WatchHandoff.isManualRequest(WatchHandoff.message(.requestSession)))
        XCTAssertEqual(WatchHandoff.kind(of: WatchHandoff.message(.revoked)), .revoked)
    }

    // MARK: Silent reconnect

    private static let grant = WatchSessionGrant(
        token: "watch-token",
        apiBaseURL: URL(string: "https://inboxies.email")!,
        mailboxId: nil
    )

    func testDefaultBackoffStartsNowAndGrows() {
        let delays = WatchReconnector.defaultDelays
        XCTAssertEqual(delays.first, .zero)
        XCTAssertGreaterThanOrEqual(delays.count, 4)
        XCTAssertEqual(delays, delays.sorted())
        XCTAssertEqual(Set(delays).count, delays.count)
    }

    @MainActor
    func testReconnectRetriesWithBackoffUntilThePhoneAnswers() async {
        let phone = PhoneStub(answers: [.unreachable, .unavailable, .grant(Self.grant)])
        let reconnector = phone.reconnector(delays: [.zero, .seconds(2), .seconds(5), .seconds(10)])
        let outcome = await reconnector.reconnect()
        XCTAssertEqual(outcome, .connected(Self.grant))
        XCTAssertEqual(reconnector.attempts, 3)
        XCTAssertEqual(phone.slept, [.seconds(2), .seconds(5)])
        XCTAssertEqual(phone.requests, [false, false, false])
        XCTAssertFalse(reconnector.isRunning)
    }

    @MainActor
    func testReconnectGivesUpAfterEveryAttempt() async {
        let phone = PhoneStub(answers: [])
        let reconnector = phone.reconnector(delays: [.zero, .seconds(1), .seconds(2), .seconds(4)])
        let outcome = await reconnector.reconnect()
        XCTAssertEqual(outcome, .gaveUp(.unreachable))
        XCTAssertEqual(reconnector.attempts, 4)
        XCTAssertEqual(phone.slept, [.seconds(1), .seconds(2), .seconds(4)])

        // A later trigger (app active, phone reachable) starts a fresh run.
        phone.answers = [.grant(Self.grant)]
        let retry = await reconnector.reconnect()
        XCTAssertEqual(retry, .connected(Self.grant))
        XCTAssertEqual(reconnector.attempts, 1)
    }

    @MainActor
    func testReconnectStopsAtTheFirstSignedOutAnswer() async {
        let phone = PhoneStub(answers: [.unreachable, .signedOut, .grant(Self.grant)])
        let reconnector = phone.reconnector(delays: [.zero, .seconds(1), .seconds(2), .seconds(4)])
        let outcome = await reconnector.reconnect()
        XCTAssertEqual(outcome, .stopped(.signedOut))
        XCTAssertEqual(reconnector.attempts, 2)
        XCTAssertEqual(phone.requests.count, 2)
        XCTAssertEqual(phone.slept, [.seconds(1)])
    }

    @MainActor
    func testReconnectStopsWhenThePhoneRevokedTheWatch() async {
        let phone = PhoneStub(answers: [.revoked, .grant(Self.grant)])
        let reconnector = phone.reconnector(delays: [.zero, .seconds(1)])
        let outcome = await reconnector.reconnect()
        XCTAssertEqual(outcome, .stopped(.revoked))
        XCTAssertEqual(phone.requests, [false])
    }

    @MainActor
    func testConcurrentReconnectsShareOneRequest() async {
        let phone = PhoneStub(answers: [.grant(Self.grant)])
        phone.holdNext = true
        let reconnector = phone.reconnector(delays: [.zero, .seconds(1)])
        let first = Task { await reconnector.reconnect() }
        while phone.requests.isEmpty { await Task.yield() }
        let second = Task { await reconnector.reconnect() }
        let third = Task { await reconnector.reconnect() }
        for _ in 0..<50 { await Task.yield() }
        phone.release()
        let outcomes = [await first.value, await second.value, await third.value]
        XCTAssertEqual(outcomes, Array(repeating: .connected(Self.grant), count: 3))
        XCTAssertEqual(phone.requests.count, 1)
    }

    @MainActor
    func testConnectTapSkipsTheWaitAndAsksAsTheUser() async {
        let phone = PhoneStub(answers: [.unreachable, .grant(Self.grant)])
        // A real (long) wait, so only the Connect tap can end it.
        let reconnector = WatchReconnector(
            delays: [.zero, .seconds(600)],
            sleep: { try await Task.sleep(for: $0) },
            request: { await phone.request(manual: $0) }
        )
        let automatic = Task { await reconnector.reconnect() }
        while phone.requests.isEmpty { await Task.yield() }
        for _ in 0..<10 { await Task.yield() }
        let tap = await reconnector.reconnect(manual: true)
        XCTAssertEqual(tap, .connected(Self.grant))
        let joined = await automatic.value
        XCTAssertEqual(joined, .connected(Self.grant))
        XCTAssertEqual(phone.requests, [false, true])
    }

    @MainActor
    func testConnectTapDuringAnAutomaticRequestAsksAgainAsTheUser() async {
        let phone = PhoneStub(answers: [.revoked, .grant(Self.grant)])
        phone.holdNext = true
        let reconnector = phone.reconnector(delays: [.zero])
        let automatic = Task { await reconnector.reconnect() }
        while phone.requests.isEmpty { await Task.yield() }
        let tap = Task { await reconnector.reconnect(manual: true) }
        for _ in 0..<50 { await Task.yield() }
        phone.release()
        let outcomes = [await automatic.value, await tap.value]
        XCTAssertEqual(outcomes, [.connected(Self.grant), .connected(Self.grant)])
        XCTAssertEqual(phone.requests, [false, true])
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

/// Stands in for the phone in the reconnect tests: answers in order (then
/// `unreachable`), records each request's Connect flag and each backoff wait.
@MainActor
private final class PhoneStub {
    var answers: [WatchSessionRequestResult]
    private(set) var requests: [Bool] = []
    private(set) var slept: [Duration] = []
    /// Hold the next request until `release()`.
    var holdNext = false
    private var held: CheckedContinuation<Void, Never>?

    init(answers: [WatchSessionRequestResult]) {
        self.answers = answers
    }

    func request(manual: Bool) async -> WatchSessionRequestResult {
        requests.append(manual)
        if holdNext {
            holdNext = false
            await withCheckedContinuation { held = $0 }
        }
        return answers.isEmpty ? .unreachable : answers.removeFirst()
    }

    func release() {
        held?.resume()
        held = nil
    }

    func reconnector(delays: [Duration]) -> WatchReconnector {
        WatchReconnector(
            delays: delays,
            sleep: { [weak self] in self?.slept.append($0) },
            request: { [weak self] manual in await self?.request(manual: manual) ?? .unreachable }
        )
    }
}

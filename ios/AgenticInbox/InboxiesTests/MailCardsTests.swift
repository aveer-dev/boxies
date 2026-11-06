import EventKit
import XCTest
@testable import Inboxies

/// Reader Code card / Invite card (AVE-176): `otp` / `invite` decoding
/// (`shared/mail-cards.ts`) and invite time handling.
final class MailCardsTests: XCTestCase {
    private let newYork = TimeZone(identifier: "America/New_York")!
    private let tokyo = TimeZone(identifier: "Asia/Tokyo")!
    private let enUS = Locale(identifier: "en_US")
    /// Mid-2026, so 2026 dates print without a year.
    private let now = ISO8601DateFormatter().date(from: "2026-06-01T12:00:00Z")!

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    /// ICU uses narrow / thin spaces around times and range dashes.
    private func plain(_ text: String?) -> String? {
        text?.replacingOccurrences(of: "\u{202F}", with: " ")
            .replacingOccurrences(of: "\u{2009}", with: " ")
            .replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    private func utc(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: - Decoding

    func testEmailDecodesOtpAndInvite() throws {
        let email = try decode(Email.self, """
        {"id":"e1","folder_id":"inbox","subject":"Design review","sender":"pat@x.com","recipient":"me@x.com",
         "date":"2026-11-04T10:00:00Z","read":0,"starred":0,
         "otp":{"code":"482913"},
         "invite":{"method":"REQUEST","status":null,"cancelled":false,"uid":"u1","sequence":3,
           "title":"Design review","start":"2026-11-05T15:00:00.000Z","end":"2026-11-05T16:00:00.000Z",
           "allDay":false,"timezone":"America/New_York","location":"Room 4B",
           "organizer":{"email":"pat@x.com","name":"Pat"},"meetingUrl":"https://meet.google.com/abc-defg-hij",
           "recurrence":"FREQ=WEEKLY;BYDAY=TU","description":"Agenda"}}
        """)
        XCTAssertEqual(email.otp?.code, "482913")
        let invite = try XCTUnwrap(email.invite)
        XCTAssertEqual(invite.method, "REQUEST")
        XCTAssertFalse(invite.cancelled)
        XCTAssertEqual(invite.sequence, 3)
        XCTAssertEqual(invite.title, "Design review")
        XCTAssertEqual(invite.start, "2026-11-05T15:00:00.000Z")
        XCTAssertEqual(invite.end, "2026-11-05T16:00:00.000Z")
        XCTAssertFalse(invite.allDay)
        XCTAssertEqual(invite.timezone, "America/New_York")
        XCTAssertEqual(invite.organizer?.label, "Pat")
        XCTAssertEqual(invite.meetingLink?.host, "meet.google.com")
        XCTAssertEqual(invite.recurrence, "FREQ=WEEKLY;BYDAY=TU")
        XCTAssertEqual(invite.description, "Agenda")
    }

    func testEmailDecodesNullAndMissingCards() throws {
        let nulls = try decode(Email.self, """
        {"id":"e2","subject":"Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T10:00:00Z",
         "read":true,"starred":false,"otp":null,"invite":null}
        """)
        XCTAssertNil(nulls.otp)
        XCTAssertNil(nulls.invite)
        let missing = try decode(Email.self, """
        {"id":"e3","subject":"Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T10:00:00Z","read":true,"starred":false}
        """)
        XCTAssertNil(missing.otp)
        XCTAssertNil(missing.invite)
    }

    func testMalformedCardDoesNotFailTheEmail() throws {
        let email = try decode(Email.self, """
        {"id":"e4","subject":"Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T10:00:00Z",
         "read":true,"starred":false,"otp":{"nope":1},"invite":{"title":"No start"}}
        """)
        XCTAssertEqual(email.id, "e4")
        XCTAssertNil(email.otp)
        XCTAssertNil(email.invite)
    }

    func testCardsSurviveTheCacheRoundTrip() throws {
        var email = try decode(Email.self, """
        {"id":"e5","subject":"Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T10:00:00Z","read":true,"starred":false}
        """)
        email.otp = EmailOtp(code: "A1B2C3")
        email.invite = EmailInvite(cancelled: true, title: "Sync", start: "2026-11-05", end: "2026-11-06", allDay: true)
        let back = try JSONDecoder().decode(Email.self, from: JSONEncoder().encode(email))
        XCTAssertEqual(back.otp, email.otp)
        XCTAssertEqual(back.invite, email.invite)
    }

    func testThreadPayloadDecodesCardsPerMessage() throws {
        let thread = try decode([Email].self, """
        [{"id":"m1","subject":"Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T10:00:00Z","read":true,"starred":false,"otp":null,"invite":null},
         {"id":"m2","subject":"Re: Hi","sender":"a@x.com","recipient":"b@x.com","date":"2026-11-04T11:00:00Z","read":true,"starred":false,"otp":{"code":"1234"},"invite":null}]
        """)
        XCTAssertEqual(MailCards.card(for: thread), .code(EmailOtp(code: "1234"), emailId: "m2"))
    }

    // MARK: - Which card

    func testCardHiddenInSpamAndForFailedAuth() {
        var email = Email(id: "e", subject: "", sender: "", recipient: "", date: "", read: true, starred: false)
        email.otp = EmailOtp(code: "123456")
        XCTAssertNotNil(MailCards.card(for: [email]))
        email.folderId = "spam"
        XCTAssertNil(MailCards.card(for: [email]))
        email.folderId = "inbox"
        email.authTier = "failed"
        XCTAssertNil(MailCards.card(for: [email]))
    }

    func testNewestMessageWithACardWins() {
        var older = Email(id: "a", subject: "", sender: "", recipient: "", date: "", read: true, starred: false)
        older.otp = EmailOtp(code: "111111")
        var newer = Email(id: "b", subject: "", sender: "", recipient: "", date: "", read: true, starred: false)
        newer.otp = EmailOtp(code: "222222")
        let plain = Email(id: "c", subject: "", sender: "", recipient: "", date: "", read: true, starred: false)
        XCTAssertEqual(MailCards.card(for: [older, newer, plain]), .code(EmailOtp(code: "222222"), emailId: "b"))
    }

    // MARK: - Time parsing

    func testUTCInstantIsAbsolute() {
        let date = InviteTime.parse("2026-11-05T15:00:00.000Z", timeZone: tokyo)
        XCTAssertEqual(date, utc("2026-11-05T15:00:00Z"))
        XCTAssertEqual(InviteTime.parse("2026-11-05T15:00:00Z", timeZone: newYork), utc("2026-11-05T15:00:00Z"))
    }

    func testFloatingTimeIsWallTimeInTheViewersZone() {
        // 15:00 floating → 15:00 New York (EST, UTC-5) = 20:00Z; 15:00 Tokyo = 06:00Z.
        XCTAssertEqual(InviteTime.parse("2026-11-05T15:00:00", timeZone: newYork), utc("2026-11-05T20:00:00Z"))
        XCTAssertEqual(InviteTime.parse("2026-11-05T15:00:00", timeZone: tokyo), utc("2026-11-05T06:00:00Z"))
        XCTAssertTrue(InviteTime.isFloating("2026-11-05T15:00:00"))
        XCTAssertFalse(InviteTime.isFloating("2026-11-05T15:00:00.000Z"))
        XCTAssertFalse(InviteTime.isFloating("2026-11-05"))
    }

    func testAllDayEndIsExclusive() throws {
        let oneDay = EmailInvite(start: "2026-11-05", end: "2026-11-06", allDay: true)
        let span = try XCTUnwrap(InviteTime.span(for: oneDay, timeZone: newYork))
        XCTAssertTrue(span.allDay)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = newYork
        XCTAssertTrue(calendar.isDate(try XCTUnwrap(span.lastDay), inSameDayAs: span.start))
        XCTAssertEqual(calendar.component(.day, from: span.start), 5)

        let threeDays = EmailInvite(start: "2026-11-05", end: "2026-11-08", allDay: true)
        let multi = try XCTUnwrap(InviteTime.span(for: threeDays, timeZone: newYork))
        XCTAssertEqual(calendar.component(.day, from: try XCTUnwrap(multi.lastDay)), 7)
    }

    // MARK: - Time formatting

    func testSummaryForUTCInstantUsesTheViewersZone() {
        let invite = EmailInvite(start: "2026-11-05T15:00:00.000Z", end: "2026-11-05T16:00:00.000Z", timezone: "UTC")
        XCTAssertEqual(
            plain(InviteTime.summary(for: invite, timeZone: newYork, locale: enUS, now: now)),
            "Thu, Nov 5 · 10:00 – 11:00 AM"
        )
        // Same instant in Tokyo is the next morning.
        XCTAssertEqual(
            plain(InviteTime.summary(for: invite, timeZone: tokyo, locale: enUS, now: now)),
            "Fri, Nov 6 · 12:00 – 1:00 AM"
        )
    }

    func testSummaryForFloatingTimeKeepsTheWallClock() {
        let invite = EmailInvite(start: "2026-11-05T15:00:00", end: "2026-11-05T16:30:00")
        XCTAssertEqual(plain(InviteTime.summary(for: invite, timeZone: newYork, locale: enUS, now: now)), "Thu, Nov 5 · 3:00 – 4:30 PM")
        XCTAssertEqual(plain(InviteTime.summary(for: invite, timeZone: tokyo, locale: enUS, now: now)), "Thu, Nov 5 · 3:00 – 4:30 PM")
    }

    func testSummaryForAllDayEvents() {
        let oneDay = EmailInvite(start: "2026-11-05", end: "2026-11-06", allDay: true)
        XCTAssertEqual(plain(InviteTime.summary(for: oneDay, timeZone: newYork, locale: enUS, now: now)), "Thu, Nov 5 · All day")
        let noEnd = EmailInvite(start: "2026-11-05", allDay: true)
        XCTAssertEqual(plain(InviteTime.summary(for: noEnd, timeZone: tokyo, locale: enUS, now: now)), "Thu, Nov 5 · All day")
        let threeDays = EmailInvite(start: "2026-11-05", end: "2026-11-08", allDay: true)
        XCTAssertEqual(
            plain(InviteTime.summary(for: threeDays, timeZone: newYork, locale: enUS, now: now)),
            "Thu, Nov 5 – Sat, Nov 7 · All day"
        )
    }

    func testSummaryAddsTheYearOutsideThisYear() {
        let invite = EmailInvite(start: "2027-01-04", end: "2027-01-05", allDay: true)
        XCTAssertEqual(plain(InviteTime.summary(for: invite, timeZone: newYork, locale: enUS, now: now)), "Mon, Jan 4, 2027 · All day")
    }

    func testSummaryWithoutEnd() {
        let invite = EmailInvite(start: "2026-11-05T15:00:00.000Z")
        XCTAssertEqual(plain(InviteTime.summary(for: invite, timeZone: newYork, locale: enUS, now: now)), "Thu, Nov 5 · 10:00 AM")
    }

    // MARK: - Recurrence + EventKit

    func testSimpleRecurrenceMaps() throws {
        let weekly = try XCTUnwrap(InviteRecurrence.parse("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=10"))
        XCTAssertEqual(weekly.frequency, .weekly)
        XCTAssertEqual(weekly.weekdays, [.tuesday, .thursday])
        XCTAssertEqual(weekly.count, 10)
        XCTAssertEqual(InviteRecurrence.parse("FREQ=DAILY;INTERVAL=2")?.interval, 2)
        XCTAssertNotNil(InviteRecurrence.parse("RRULE:FREQ=MONTHLY;UNTIL=20270101T000000Z")?.until)
        XCTAssertEqual(InviteRecurrence.label("FREQ=WEEKLY;BYDAY=TU"), "Repeats weekly")
        XCTAssertEqual(InviteRecurrence.label("FREQ=WEEKLY;INTERVAL=2"), "Repeats every 2 weeks")
        XCTAssertNil(InviteRecurrence.label(nil))
    }

    func testComplexRecurrenceIsLeftOut() {
        XCTAssertNil(InviteRecurrence.parse("FREQ=MONTHLY;BYDAY=2TU"))
        XCTAssertNil(InviteRecurrence.parse("FREQ=MONTHLY;BYMONTHDAY=15"))
        XCTAssertNil(InviteRecurrence.parse("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1"))
        XCTAssertEqual(InviteRecurrence.label("FREQ=MONTHLY;BYDAY=2TU"), "Repeats")
    }

    func testEventPrefill() throws {
        let store = EKEventStore()
        let timed = EmailInvite(
            title: "Design review", start: "2026-11-05T15:00:00.000Z", end: "2026-11-05T16:00:00.000Z",
            timezone: "America/New_York", location: "Room 4B", meetingUrl: "https://meet.google.com/abc",
            recurrence: "FREQ=WEEKLY;BYDAY=TH"
        )
        let event = try XCTUnwrap(timed.makeEvent(store: store, timeZone: tokyo))
        XCTAssertEqual(event.title, "Design review")
        XCTAssertEqual(event.startDate, utc("2026-11-05T15:00:00Z"))
        XCTAssertEqual(event.endDate, utc("2026-11-05T16:00:00Z"))
        XCTAssertEqual(event.timeZone?.identifier, "America/New_York")
        XCTAssertEqual(event.location, "Room 4B")
        XCTAssertEqual(event.url?.absoluteString, "https://meet.google.com/abc")
        XCTAssertEqual(event.recurrenceRules?.first?.frequency, .weekly)

        let floating = EmailInvite(start: "2026-11-05T15:00:00", end: "2026-11-05T16:00:00")
        XCTAssertNil(try XCTUnwrap(floating.makeEvent(store: store, timeZone: newYork)).timeZone)

        let allDay = EmailInvite(start: "2026-11-05", end: "2026-11-06", allDay: true)
        // EventKit floats all-day dates in the device zone, which is what the app passes.
        let allDayEvent = try XCTUnwrap(allDay.makeEvent(store: store, timeZone: .current))
        XCTAssertTrue(allDayEvent.isAllDay)
        let calendar = Calendar.current
        XCTAssertTrue(calendar.isDate(allDayEvent.endDate, inSameDayAs: allDayEvent.startDate))
    }
}

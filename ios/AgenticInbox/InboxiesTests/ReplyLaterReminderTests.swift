import XCTest
@testable import Inboxies

/// Reply Later reminders (AVE-86): preset math, wire shape, due state, inbox order.
final class ReplyLaterReminderTests: XCTestCase {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }

    private func date(_ y: Int, _ mo: Int, _ d: Int, _ h: Int, _ mi: Int, _ s: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi, second: s))!
    }

    private func parts(_ date: Date) -> DateComponents {
        calendar.dateComponents([.year, .month, .day, .hour, .minute, .second, .weekday], from: date)
    }

    // MARK: Later today

    func testLaterTodayRoundsUpToNextFiveMinutes() {
        // 13:02:30 + 3h = 16:02:30 → 16:05:00
        let result = ReplyLaterReminder.laterToday(now: date(2026, 10, 28, 13, 2, 30), calendar: calendar)
        XCTAssertEqual(result, date(2026, 10, 28, 16, 5))
    }

    func testLaterTodayKeepsExactFiveMinuteMark() {
        let result = ReplyLaterReminder.laterToday(now: date(2026, 10, 28, 13, 5, 0), calendar: calendar)
        XCTAssertEqual(result, date(2026, 10, 28, 16, 5))
    }

    func testLaterTodayZeroesSecondsBeforeRounding() {
        // 13:10:45 → 16:10:45 → seconds zeroed → 16:10, already a multiple of 5.
        let result = ReplyLaterReminder.laterToday(now: date(2026, 10, 28, 13, 10, 45), calendar: calendar)
        XCTAssertEqual(result, date(2026, 10, 28, 16, 10))
        XCTAssertEqual(parts(result).second, 0)
    }

    func testLaterTodayRollsOverHourAndDay() {
        // 20:58 + 3h = 23:58 → 00:00 next day.
        let result = ReplyLaterReminder.laterToday(now: date(2026, 10, 28, 20, 58), calendar: calendar)
        XCTAssertEqual(result, date(2026, 10, 29, 0, 0))
    }

    // MARK: Tomorrow

    func testTomorrowIsNineAMNextDay() {
        let result = ReplyLaterReminder.tomorrowMorning(now: date(2026, 10, 28, 22, 47), calendar: calendar)
        XCTAssertEqual(result, date(2026, 10, 29, 9, 0))
    }

    func testTomorrowCrossesMonthEnd() {
        let result = ReplyLaterReminder.tomorrowMorning(now: date(2026, 10, 31, 1, 0), calendar: calendar)
        XCTAssertEqual(result, date(2026, 11, 1, 9, 0))
    }

    // MARK: Next week

    func testNextWeekFromWednesdayIsComingMonday() {
        // 2026-10-28 is a Wednesday.
        let result = ReplyLaterReminder.nextWeekMonday(now: date(2026, 10, 28, 10, 0), calendar: calendar)
        XCTAssertEqual(result, date(2026, 11, 2, 9, 0))
        XCTAssertEqual(parts(result).weekday, 2)
    }

    func testNextWeekFromMondayIsTheFollowingMonday() {
        // 2026-11-02 is a Monday, even before 9:00.
        let result = ReplyLaterReminder.nextWeekMonday(now: date(2026, 11, 2, 7, 30), calendar: calendar)
        XCTAssertEqual(result, date(2026, 11, 9, 9, 0))
    }

    func testNextWeekFromSundayIsTomorrow() {
        // 2026-11-01 is a Sunday: the next Monday strictly after today is the 2nd.
        let result = ReplyLaterReminder.nextWeekMonday(now: date(2026, 11, 1, 18, 0), calendar: calendar)
        XCTAssertEqual(result, date(2026, 11, 2, 9, 0))
    }

    func testPresetDispatch() {
        let now = date(2026, 10, 28, 13, 2, 30)
        XCTAssertEqual(ReplyLaterReminder.date(for: .laterToday, now: now, calendar: calendar), date(2026, 10, 28, 16, 5))
        XCTAssertEqual(ReplyLaterReminder.date(for: .tomorrow, now: now, calendar: calendar), date(2026, 10, 29, 9, 0))
        XCTAssertEqual(ReplyLaterReminder.date(for: .nextWeek, now: now, calendar: calendar), date(2026, 11, 2, 9, 0))
    }

    // MARK: ISO + labels

    func testISOStringIsUTCWithMilliseconds() {
        // 10:00 New York (EDT, UTC-4) on Oct 29.
        let iso = ReplyLaterReminder.isoString(date(2026, 10, 29, 10, 0))
        XCTAssertEqual(iso, "2026-10-29T14:00:00.000Z")
        XCTAssertEqual(ReplyLaterReminder.parseISO(iso), date(2026, 10, 29, 10, 0))
        XCTAssertEqual(ReplyLaterReminder.parseISO("2026-10-29T14:00:00Z"), date(2026, 10, 29, 10, 0))
        XCTAssertNil(ReplyLaterReminder.parseISO(nil))
    }

    func testShortLabels() {
        let us = Locale(identifier: "en_US")
        let now = date(2026, 10, 28, 13, 0)
        XCTAssertEqual(ReplyLaterReminder.shortLabel(date(2026, 10, 28, 16, 5), now: now, calendar: calendar, locale: us), "Today 4:05\u{202F}PM")
        XCTAssertEqual(ReplyLaterReminder.shortLabel(date(2026, 10, 29, 9, 0), now: now, calendar: calendar, locale: us), "Tomorrow 9:00\u{202F}AM")
        XCTAssertTrue(ReplyLaterReminder.shortLabel(date(2026, 11, 2, 9, 0), now: now, calendar: calendar, locale: us).hasPrefix("Mon"))
        XCTAssertTrue(ReplyLaterReminder.shortLabel(date(2026, 11, 9, 9, 0), now: now, calendar: calendar, locale: us).hasPrefix("Nov 9"))
    }

    // MARK: Wire shape + due state

    func testEmailDecodesReminderFields() throws {
        let email = try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"e1","folder_id":"inbox","subject":"Hi","sender":"a@x.com","recipient":"b@x.com",
         "date":"2026-10-10T10:00:00Z","read":false,"starred":false,"reply_later":1,
         "reply_later_remind_at":"2026-10-29T14:00:00.000Z","reply_later_reminded_at":null}
        """.utf8))
        XCTAssertEqual(email.replyLaterRemindAt, "2026-10-29T14:00:00.000Z")
        XCTAssertNil(email.replyLaterRemindedAt)
        XCTAssertNotNil(email.replyLaterRemindDate)
        XCTAssertFalse(email.isReplyLaterDue)
    }

    func testOlderWorkersOmitReminderFields() throws {
        let email = try JSONDecoder().decode(Email.self, from: Data("""
        {"id":"e1","subject":"Hi","sender":"a@x.com","recipient":"b@x.com",
         "date":"2026-10-10T10:00:00Z","read":false,"starred":false,"reply_later":true}
        """.utf8))
        XCTAssertNil(email.replyLaterRemindAt)
        XCTAssertNil(email.replyLaterRemindedAt)
        XCTAssertFalse(email.isReplyLaterDue)
    }

    func testDueNeedsReplyLaterFiredAndUnread() {
        var email = Email(
            id: "e1", subject: "Hi", sender: "a@x.com", recipient: "b@x.com",
            date: "2026-10-10T10:00:00.000Z", read: false, starred: false,
            replyLater: true, replyLaterRemindedAt: "2026-10-28T09:00:00.000Z"
        )
        XCTAssertTrue(email.isReplyLaterDue)
        email.read = true
        XCTAssertFalse(email.isReplyLaterDue)
        email.read = false
        email.replyLater = false
        XCTAssertFalse(email.isReplyLaterDue)
    }

    func testPilesDecodeDueCountWhenPresent() throws {
        let response = try JSONDecoder().decode(WorkflowPilesResponse.self, from: Data("""
        {"piles":[{"id":"reply_later","count":4,"due_count":2}]}
        """.utf8))
        XCTAssertEqual(response.piles.first?.dueCount, 2)
        let old = try JSONDecoder().decode(WorkflowPilesResponse.self, from: Data("""
        {"piles":[{"id":"reply_later","count":4}]}
        """.utf8))
        XCTAssertNil(old.piles.first?.dueCount)
    }

    // MARK: Inbox order

    @MainActor
    func testFiredReminderSortsToTopOfNew() {
        let fresh = Email(
            id: "fresh", subject: "New", sender: "a@x.com", recipient: "b@x.com",
            date: "2026-10-28T08:00:00.000Z", read: false, starred: false
        )
        let reminded = Email(
            id: "reminded", subject: "Old", sender: "a@x.com", recipient: "b@x.com",
            date: "2026-09-01T08:00:00.000Z", read: false, starred: false,
            replyLater: true, replyLaterRemindedAt: "2026-10-28T09:00:00.000Z"
        )
        let ordered = AppModel.orderNewThenSeen([fresh, reminded])
        XCTAssertEqual(ordered.map(\.id), ["reminded", "fresh"])
        let sections = EmailListPaging.inboxSections([fresh, reminded], sectionFloor: nil)
        XCTAssertEqual(sections.new.map(\.id), ["reminded", "fresh"])
    }
}

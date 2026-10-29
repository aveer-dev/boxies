import Foundation

/// Reply Later reminder presets (AVE-86). Twins: web + Android compute the same times
/// from the device's local clock; the result goes to the server as UTC ISO.
enum ReplyLaterReminderPreset: String, CaseIterable, Identifiable {
    case laterToday
    case tomorrow
    case nextWeek

    var id: String { rawValue }

    var title: String {
        switch self {
        case .laterToday: return "Later today"
        case .tomorrow: return "Tomorrow"
        case .nextWeek: return "Next week"
        }
    }

    var systemImage: String {
        switch self {
        case .laterToday: return "clock"
        case .tomorrow: return "sunrise"
        case .nextWeek: return "calendar"
        }
    }
}

/// Pure preset math + formatting. `now` and `calendar` are injected so tests can pin a
/// time zone and clock.
enum ReplyLaterReminder {
    /// Morning hour for Tomorrow / Next week.
    static let morningHour = 9
    /// Later today = now + this, rounded up to the next `roundingMinutes`.
    static let laterTodayOffset: TimeInterval = 3 * 60 * 60
    static let roundingMinutes = 5
    /// Server refuses reminders further out than this.
    static let maxDaysAhead = 366

    static func date(
        for preset: ReplyLaterReminderPreset,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> Date {
        switch preset {
        case .laterToday: return laterToday(now: now, calendar: calendar)
        case .tomorrow: return tomorrowMorning(now: now, calendar: calendar)
        case .nextWeek: return nextWeekMonday(now: now, calendar: calendar)
        }
    }

    /// now + 3h with seconds zeroed, then the minute rounded up to a multiple of 5.
    static func laterToday(now: Date = Date(), calendar: Calendar = .current) -> Date {
        let target = now.addingTimeInterval(laterTodayOffset)
        let floored = calendar.dateInterval(of: .minute, for: target)?.start ?? target
        let minute = calendar.component(.minute, from: floored)
        let add = (roundingMinutes - minute % roundingMinutes) % roundingMinutes
        return calendar.date(byAdding: .minute, value: add, to: floored) ?? floored
    }

    /// Tomorrow at 09:00 local.
    static func tomorrowMorning(now: Date = Date(), calendar: Calendar = .current) -> Date {
        let startOfToday = calendar.startOfDay(for: now)
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? now
        return morning(of: tomorrow, calendar: calendar)
    }

    /// The next Monday strictly after today, 09:00 local (today Monday → a week out).
    static func nextWeekMonday(now: Date = Date(), calendar: Calendar = .current) -> Date {
        let startOfToday = calendar.startOfDay(for: now)
        let weekday = calendar.component(.weekday, from: startOfToday) // 1 = Sunday … 2 = Monday
        var daysAhead = (2 - weekday + 7) % 7
        if daysAhead == 0 { daysAhead = 7 }
        let monday = calendar.date(byAdding: .day, value: daysAhead, to: startOfToday) ?? now
        return morning(of: monday, calendar: calendar)
    }

    private static func morning(of day: Date, calendar: Calendar) -> Date {
        calendar.date(bySettingHour: morningHour, minute: 0, second: 0, of: day) ?? day
    }

    // MARK: ISO

    /// UTC ISO 8601 with milliseconds, e.g. "2026-10-29T14:00:00.000Z".
    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }

    static func parseISO(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }

    // MARK: Formatting

    /// Toast / picker header: "Tue, 9:00 AM" (adds the month and day past a week).
    static func longLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let days = dayDistance(from: now, to: date, calendar: calendar)
        let template = (0..<7).contains(days) ? "EEEjmm" : "EEEMMMdjmm"
        return format(date, template: template, calendar: calendar, locale: locale)
    }

    /// Trailing time on a preset row: "4:35 PM" today, "Thu 9:00 AM" this week,
    /// "Mon, Nov 9, 9:00 AM" further out.
    static func presetLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let days = dayDistance(from: now, to: date, calendar: calendar)
        if days == 0 { return format(date, template: "jmm", calendar: calendar, locale: locale) }
        if (1..<7).contains(days) { return format(date, template: "EEEjmm", calendar: calendar, locale: locale) }
        return format(date, template: "EEEMMMdjmm", calendar: calendar, locale: locale)
    }

    /// Row chip: "Today 4:35 PM" / "Tomorrow 9:00 AM" / "Mon 9:00 AM" / "Oct 30, 9:00 AM".
    static func shortLabel(_ date: Date, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String {
        let days = dayDistance(from: now, to: date, calendar: calendar)
        let time = format(date, template: "jmm", calendar: calendar, locale: locale)
        switch days {
        case 0: return "Today \(time)"
        case 1: return "Tomorrow \(time)"
        case 2..<7: return format(date, template: "EEEjmm", calendar: calendar, locale: locale)
        default: return format(date, template: "MMMdjmm", calendar: calendar, locale: locale)
        }
    }

    /// Whole local days between the two dates' calendar days (negative = past).
    static func dayDistance(from now: Date, to date: Date, calendar: Calendar = .current) -> Int {
        let start = calendar.startOfDay(for: now)
        let end = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: start, to: end).day ?? 0
    }

    private static func format(_ date: Date, template: String, calendar: Calendar, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}

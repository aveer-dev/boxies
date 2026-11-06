import EventKit
import Foundation

// Reader cards for one-time codes and calendar invites (AVE-174 / AVE-176).
// Contract: `shared/mail-cards.ts`. The Worker returns `otp` and `invite` on the
// single-email and thread reader payloads; null (or absent) means "no card".
// List payloads never carry them.

/// A one-time / verification code found in the message (separators already removed).
struct EmailOtp: Codable, Hashable {
    let code: String
}

struct EmailInviteOrganizer: Codable, Hashable {
    var email: String?
    var name: String?

    /// "Pat Lee", else the address.
    var label: String? {
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        if let email, !email.isEmpty { return email }
        return nil
    }
}

/// A calendar event parsed from a real `text/calendar` part or `.ics` attachment.
struct EmailInvite: Codable, Hashable {
    var method: String?
    var status: String?
    /// METHOD:CANCEL or STATUS:CANCELLED. Show "Cancelled" and hide Add to Calendar.
    var cancelled: Bool
    var uid: String?
    var sequence: Int?
    var title: String?
    /// UTC instant ("2026-11-05T15:00:00.000Z"), floating wall time
    /// ("2026-11-05T15:00:00", device zone) or an all-day date ("2026-11-05").
    var start: String
    /// Same format as `start`; exclusive for all-day events. Nil when unknown.
    var end: String?
    var allDay: Bool
    /// IANA zone the organizer scheduled in; nil for floating and all-day events.
    var timezone: String?
    var location: String?
    var organizer: EmailInviteOrganizer?
    var meetingUrl: String?
    /// Raw RRULE ("FREQ=WEEKLY;BYDAY=TU"), else nil.
    var recurrence: String?
    var description: String?

    init(
        method: String? = nil, status: String? = nil, cancelled: Bool = false, uid: String? = nil,
        sequence: Int? = nil, title: String? = nil, start: String, end: String? = nil, allDay: Bool = false,
        timezone: String? = nil, location: String? = nil, organizer: EmailInviteOrganizer? = nil,
        meetingUrl: String? = nil, recurrence: String? = nil, description: String? = nil
    ) {
        self.method = method; self.status = status; self.cancelled = cancelled; self.uid = uid
        self.sequence = sequence; self.title = title; self.start = start; self.end = end; self.allDay = allDay
        self.timezone = timezone; self.location = location; self.organizer = organizer
        self.meetingUrl = meetingUrl; self.recurrence = recurrence; self.description = description
    }

    private enum CodingKeys: String, CodingKey {
        case method, status, cancelled, uid, sequence, title, start, end, allDay, timezone, location
        case organizer, meetingUrl, recurrence, description
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        method = try? c.decodeIfPresent(String.self, forKey: .method)
        status = try? c.decodeIfPresent(String.self, forKey: .status)
        cancelled = c.decodeLenientBool(forKey: .cancelled) ?? false
        uid = try? c.decodeIfPresent(String.self, forKey: .uid)
        sequence = try? c.decodeIfPresent(Int.self, forKey: .sequence)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
        start = try c.decode(String.self, forKey: .start)
        end = try? c.decodeIfPresent(String.self, forKey: .end)
        allDay = c.decodeLenientBool(forKey: .allDay) ?? false
        timezone = try? c.decodeIfPresent(String.self, forKey: .timezone)
        location = try? c.decodeIfPresent(String.self, forKey: .location)
        organizer = try? c.decodeIfPresent(EmailInviteOrganizer.self, forKey: .organizer)
        meetingUrl = try? c.decodeIfPresent(String.self, forKey: .meetingUrl)
        recurrence = try? c.decodeIfPresent(String.self, forKey: .recurrence)
        description = try? c.decodeIfPresent(String.self, forKey: .description)
    }

    var displayTitle: String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? "Untitled event" : trimmed
    }

    /// The https join link, when there is one.
    var meetingLink: URL? {
        guard let meetingUrl, let url = URL(string: meetingUrl),
              url.scheme?.lowercased() == "https", url.host != nil else { return nil }
        return url
    }

    /// Location, unless it is only the meeting link again.
    var displayLocation: String? {
        guard let location = location?.trimmingCharacters(in: .whitespacesAndNewlines), !location.isEmpty else { return nil }
        if let meetingUrl, location == meetingUrl { return nil }
        return location
    }
}

// MARK: - Times

/// Parses and formats invite times (`shared/mail-cards.ts` formats). Zone and
/// locale are parameters so tests are deterministic; the app uses the device's.
enum InviteTime {
    /// A resolved event span in absolute time. For all-day events `start` is
    /// local midnight of the first day and `lastDay` the inclusive last day.
    struct Span: Equatable {
        var start: Date
        var end: Date?
        var allDay: Bool
        /// Inclusive last day of an all-day event (exclusive `end` minus one day).
        var lastDay: Date?
    }

    /// One value: a UTC instant (has "Z" or an offset), a floating wall time
    /// (read in `timeZone`), or a date-only all-day day (midnight in `timeZone`).
    static func parse(_ value: String, timeZone: TimeZone = .current) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if isDateOnly(trimmed) {
            return fixedFormatter("yyyy-MM-dd", timeZone: timeZone).date(from: trimmed)
        }
        if hasZoneDesignator(trimmed) {
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: trimmed) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            return plain.date(from: trimmed)
        }
        // Floating: wall time in the viewer's zone.
        for format in ["yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm"] {
            if let date = fixedFormatter(format, timeZone: timeZone).date(from: trimmed) { return date }
        }
        return nil
    }

    static func span(for invite: EmailInvite, timeZone: TimeZone = .current) -> Span? {
        let allDay = invite.allDay || isDateOnly(invite.start)
        guard let start = parse(invite.start, timeZone: timeZone) else { return nil }
        let end = invite.end.flatMap { parse($0, timeZone: timeZone) }
        guard allDay else {
            return Span(start: start, end: end.flatMap { $0 > start ? $0 : nil }, allDay: false, lastDay: nil)
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        // All-day end is exclusive: Nov 5 → Nov 6 is the single day Nov 5.
        var lastDay = start
        if let end, end > start, let previous = calendar.date(byAdding: .day, value: -1, to: end) {
            lastDay = max(start, previous)
        }
        return Span(start: start, end: end, allDay: true, lastDay: lastDay)
    }

    /// "Thu, Nov 5 · 10:00 – 11:00 AM", "Thu, Nov 5 · All day",
    /// "Thu, Nov 5 – Sat, Nov 7 · All day". Adds the year when it is not this year.
    static func summary(
        for invite: EmailInvite,
        timeZone: TimeZone = .current,
        locale: Locale = .current,
        now: Date = Date()
    ) -> String? {
        guard let span = span(for: invite, timeZone: timeZone) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = locale
        let showYear = calendar.component(.year, from: span.start) != calendar.component(.year, from: now)
            || calendar.component(.year, from: span.lastDay ?? span.end ?? span.start) != calendar.component(.year, from: now)
        let dayTemplate = showYear ? "EEEMMMdy" : "EEEMMMd"

        let interval = DateIntervalFormatter()
        interval.locale = locale
        interval.calendar = calendar
        interval.timeZone = timeZone

        if span.allDay {
            let lastDay = span.lastDay ?? span.start
            let days: String
            if calendar.isDate(lastDay, inSameDayAs: span.start) {
                days = dayFormatter(template: dayTemplate, timeZone: timeZone, locale: locale).string(from: span.start)
            } else {
                interval.dateTemplate = dayTemplate
                days = interval.string(from: span.start, to: lastDay)
            }
            return "\(days) · All day"
        }

        guard let end = span.end else {
            let day = dayFormatter(template: dayTemplate, timeZone: timeZone, locale: locale).string(from: span.start)
            let time = dayFormatter(template: "jmm", timeZone: timeZone, locale: locale).string(from: span.start)
            return "\(day) · \(time)"
        }
        interval.dateTemplate = dayTemplate + "jmm"
        if calendar.isDate(end, inSameDayAs: span.start) {
            // "Thu, Nov 5 · 10:00 – 11:00 AM": day once, then the time range.
            let day = dayFormatter(template: dayTemplate, timeZone: timeZone, locale: locale).string(from: span.start)
            interval.dateTemplate = "jmm"
            return "\(day) · \(interval.string(from: span.start, to: end))"
        }
        return interval.string(from: span.start, to: end)
    }

    static func isDateOnly(_ value: String) -> Bool {
        value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    static func hasZoneDesignator(_ value: String) -> Bool {
        value.hasSuffix("Z") || value.hasSuffix("z")
            || value.range(of: #"[+-]\d{2}:?\d{2}$"#, options: .regularExpression) != nil
    }

    private static func fixedFormatter(_ format: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = format
        return formatter
    }

    private static func dayFormatter(template: String, timeZone: TimeZone, locale: Locale) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }
}

// MARK: - Recurrence

/// Maps the simple RRULE shapes to EventKit: FREQ with optional INTERVAL,
/// COUNT / UNTIL and plain BYDAY weekdays. Anything else (BYMONTHDAY,
/// BYSETPOS, ordinal BYDAY like "2TU", …) returns nil and the event is added
/// without a repeat rule rather than with a wrong one.
enum InviteRecurrence {
    struct Rule: Equatable {
        var frequency: EKRecurrenceFrequency
        var interval: Int
        var count: Int?
        var until: Date?
        var weekdays: [EKWeekday]
    }

    static func parse(_ rrule: String?) -> Rule? {
        guard var raw = rrule?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.uppercased().hasPrefix("RRULE:") { raw = String(raw.dropFirst(6)) }
        var parts: [String: String] = [:]
        for piece in raw.split(separator: ";") {
            let pair = piece.split(separator: "=", maxSplits: 1).map(String.init)
            guard pair.count == 2 else { return nil }
            parts[pair[0].uppercased()] = pair[1].uppercased()
        }
        let frequency: EKRecurrenceFrequency
        switch parts.removeValue(forKey: "FREQ") {
        case "DAILY": frequency = .daily
        case "WEEKLY": frequency = .weekly
        case "MONTHLY": frequency = .monthly
        case "YEARLY": frequency = .yearly
        default: return nil
        }
        var interval = 1
        if let value = parts.removeValue(forKey: "INTERVAL") {
            guard let n = Int(value), n > 0 else { return nil }
            interval = n
        }
        var count: Int?
        if let value = parts.removeValue(forKey: "COUNT") {
            guard let n = Int(value), n > 0 else { return nil }
            count = n
        }
        var until: Date?
        if let value = parts.removeValue(forKey: "UNTIL") {
            guard let date = parseUntil(value) else { return nil }
            until = date
        }
        var weekdays: [EKWeekday] = []
        if let value = parts.removeValue(forKey: "BYDAY") {
            for token in value.split(separator: ",") {
                guard let day = weekday(String(token)) else { return nil }
                weekdays.append(day)
            }
        }
        parts.removeValue(forKey: "WKST")
        // Any other part changes the meaning; don't approximate it.
        guard parts.isEmpty, count == nil || until == nil else { return nil }
        if !weekdays.isEmpty, frequency != .weekly { return nil }
        return Rule(frequency: frequency, interval: interval, count: count, until: until, weekdays: weekdays)
    }

    static func ekRule(_ rule: Rule) -> EKRecurrenceRule {
        let end: EKRecurrenceEnd?
        if let count = rule.count {
            end = EKRecurrenceEnd(occurrenceCount: count)
        } else if let until = rule.until {
            end = EKRecurrenceEnd(end: until)
        } else {
            end = nil
        }
        return EKRecurrenceRule(
            recurrenceWith: rule.frequency,
            interval: rule.interval,
            daysOfTheWeek: rule.weekdays.isEmpty ? nil : rule.weekdays.map { EKRecurrenceDayOfWeek($0) },
            daysOfTheMonth: nil,
            monthsOfTheYear: nil,
            weeksOfTheYear: nil,
            daysOfTheYear: nil,
            setPositions: nil,
            end: end
        )
    }

    /// "Repeats weekly", "Repeats every 2 weeks". Nil when the rule is not one we map.
    static func label(_ rrule: String?) -> String? {
        guard let rule = parse(rrule) else { return rrule == nil ? nil : "Repeats" }
        let unit: (String, String)
        switch rule.frequency {
        case .daily: unit = ("daily", "days")
        case .weekly: unit = ("weekly", "weeks")
        case .monthly: unit = ("monthly", "months")
        case .yearly: unit = ("yearly", "years")
        @unknown default: return "Repeats"
        }
        return rule.interval == 1 ? "Repeats \(unit.0)" : "Repeats every \(rule.interval) \(unit.1)"
    }

    private static func weekday(_ token: String) -> EKWeekday? {
        switch token {
        case "SU": return .sunday
        case "MO": return .monday
        case "TU": return .tuesday
        case "WE": return .wednesday
        case "TH": return .thursday
        case "FR": return .friday
        case "SA": return .saturday
        default: return nil
        }
    }

    private static func parseUntil(_ value: String) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        if value.hasSuffix("Z") {
            formatter.timeZone = TimeZone(identifier: "UTC")
            formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
            return formatter.date(from: value)
        }
        formatter.timeZone = .current
        formatter.dateFormat = value.contains("T") ? "yyyyMMdd'T'HHmmss" : "yyyyMMdd"
        return formatter.date(from: value)
    }
}

// MARK: - EventKit

extension EmailInvite {
    /// A prefilled, unsaved event for `EKEventEditViewController`. On iOS 17+ the
    /// sheet runs out of process, so no calendar access prompt is needed to add.
    func makeEvent(store: EKEventStore, timeZone: TimeZone = .current) -> EKEvent? {
        guard let span = InviteTime.span(for: self, timeZone: timeZone) else { return nil }
        let event = EKEvent(eventStore: store)
        event.title = displayTitle
        event.location = displayLocation ?? meetingUrl
        event.url = meetingLink
        event.notes = description
        if span.allDay {
            event.isAllDay = true
            event.startDate = span.start
            event.endDate = span.lastDay ?? span.start
            event.timeZone = nil
        } else {
            event.startDate = span.start
            event.endDate = span.end ?? span.start.addingTimeInterval(3600)
            // Floating events stay floating (nil zone); zoned ones keep the organizer's zone.
            event.timeZone = InviteTime.isFloating(start) ? nil : (timezone.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: "UTC"))
        }
        if let rule = InviteRecurrence.parse(recurrence) {
            event.recurrenceRules = [InviteRecurrence.ekRule(rule)]
        }
        return event
    }
}

extension InviteTime {
    /// Wall time without a zone designator ("2026-11-05T15:00:00").
    static func isFloating(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !isDateOnly(trimmed) && trimmed.contains("T") && !hasZoneDesignator(trimmed)
    }
}

// MARK: - Which card the reader shows

enum MailCards {
    /// Mirrors `mailCardsAllowed` in `shared/mail-cards.ts`. The Worker already
    /// nulls the fields; this keeps cached rows honest after a move to Spam.
    static func allowed(_ email: Email) -> Bool {
        email.folderId != "spam" && email.authTier != "failed"
    }

    enum Card: Equatable {
        case code(EmailOtp, emailId: String)
        case invite(EmailInvite, emailId: String)
    }

    /// The newest message in the conversation that carries a card.
    static func card(for messages: [Email]) -> Card? {
        for message in messages.reversed() where !message.isDraft && allowed(message) {
            if let invite = message.invite { return .invite(invite, emailId: message.id) }
            if let otp = message.otp, !otp.code.isEmpty { return .code(otp, emailId: message.id) }
        }
        return nil
    }
}

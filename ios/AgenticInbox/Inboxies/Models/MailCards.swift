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

    /// "Pat Lee <pat@x.com>", or whichever half there is.
    var fullLabel: String? {
        let name = name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let email = email?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        if let name, let email, name.lowercased() != email.lowercased() { return "\(name) <\(email)>" }
        return name ?? email
    }
}

/// What the invite card says about who organized it (AVE-220).
enum InviteOrganizerLine: Equatable {
    case none
    /// The organizer lines up with the From (or an older server didn't say).
    case organizer(String)
    /// It doesn't: the real sender leads; the organizer is only a claim.
    case claimed(sender: String?, claimed: String)
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
    /// AVE-220: false when ORGANIZER doesn't line up with the message's From
    /// (it is free text in the .ics). Nil from older servers: show it as before.
    var organizerMatchesSender: Bool?
    var meetingUrl: String?
    /// Raw RRULE ("FREQ=WEEKLY;BYDAY=TU"), else nil.
    var recurrence: String?
    var description: String?
    /// The message's real From, filled in by `MailCards.card(for:)`; not part of the payload.
    var sentBy: EmailInviteOrganizer?

    init(
        method: String? = nil, status: String? = nil, cancelled: Bool = false, uid: String? = nil,
        sequence: Int? = nil, title: String? = nil, start: String, end: String? = nil, allDay: Bool = false,
        timezone: String? = nil, location: String? = nil, organizer: EmailInviteOrganizer? = nil,
        organizerMatchesSender: Bool? = nil, meetingUrl: String? = nil, recurrence: String? = nil,
        description: String? = nil, sentBy: EmailInviteOrganizer? = nil
    ) {
        self.method = method; self.status = status; self.cancelled = cancelled; self.uid = uid
        self.sequence = sequence; self.title = title; self.start = start; self.end = end; self.allDay = allDay
        self.timezone = timezone; self.location = location; self.organizer = organizer
        self.organizerMatchesSender = organizerMatchesSender; self.sentBy = sentBy
        self.meetingUrl = meetingUrl; self.recurrence = recurrence; self.description = description
    }

    private enum CodingKeys: String, CodingKey {
        case method, status, cancelled, uid, sequence, title, start, end, allDay, timezone, location
        case organizer, organizerMatchesSender, meetingUrl, recurrence, description
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
        organizerMatchesSender = c.decodeLenientBool(forKey: .organizerMatchesSender)
        meetingUrl = try? c.decodeIfPresent(String.self, forKey: .meetingUrl)
        recurrence = try? c.decodeIfPresent(String.self, forKey: .recurrence)
        description = try? c.decodeIfPresent(String.self, forKey: .description)
    }

    /// Organizer as is when it matches the From; else the real sender and a claim.
    var organizerLine: InviteOrganizerLine {
        guard let organizer else { return .none }
        if organizerMatchesSender != false {
            return organizer.label.map(InviteOrganizerLine.organizer) ?? .none
        }
        guard let claimed = organizer.fullLabel else { return .none }
        return .claimed(sender: sentBy?.fullLabel, claimed: claimed)
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

    /// Where the event happens, which decides the card's primary action: a
    /// meeting link (Join), a physical address (Directions) or nothing to open.
    /// A meeting link wins over an address; the address stays in the details.
    var venue: InviteVenue {
        if let link = joinLink { return .link(link) }
        if let address { return .address(address) }
        return .none
    }

    /// The https `meetingUrl`, else an https link in the location ("Zoom: https://…").
    var joinLink: URL? {
        meetingLink ?? location.flatMap(InviteVenue.httpsLink(in:))
    }

    /// The location when it is a place you can get directions to: not a link and
    /// not just the name of a call platform ("Microsoft Teams Meeting").
    var address: String? {
        guard let location = displayLocation,
              InviteVenue.httpsLink(in: location) == nil,
              !InviteVenue.isVirtualPlaceName(location) else { return nil }
        return location
    }
}

/// Classification of an invite's location (AVE-176 review). Android twin: AVE-177.
enum InviteVenue: Equatable {
    case link(URL)
    case address(String)
    case none

    /// The first https link in `text`, when it has a host. Other schemes are ignored.
    static func httpsLink(in text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), isHTTPS(url) { return url }
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        for match in detector.matches(in: trimmed, options: [], range: range) {
            if let url = match.url, isHTTPS(url) { return url }
        }
        return nil
    }

    /// Call-platform names organizers put in the location field instead of a place.
    static func isVirtualPlaceName(_ text: String) -> Bool {
        var name = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for suffix in [" meeting", " call", " video call"] where name.hasSuffix(suffix) {
            name = String(name.dropLast(suffix.count))
        }
        return virtualPlaceNames.contains(name)
    }

    private static let virtualPlaceNames: Set<String> = [
        "zoom", "google meet", "meet", "microsoft teams", "teams", "webex", "cisco webex",
        "facetime", "skype", "slack huddle", "whereby", "jitsi", "online", "virtual",
        "remote", "video", "phone", "tbd", "tba",
    ]

    private static func isHTTPS(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && !(url.host ?? "").isEmpty
    }
}

/// Map apps the Directions button can hand an address to. Apple Maps is always
/// there; Google Maps and Waze are offered when installed (needs their schemes
/// in `LSApplicationQueriesSchemes`).
enum MapProvider: String, CaseIterable, Identifiable {
    case apple, google, waze

    var id: String { rawValue }

    var title: String {
        switch self {
        case .apple: "Apple Maps"
        case .google: "Google Maps"
        case .waze: "Waze"
        }
    }

    /// Probe for `canOpenURL`; Apple Maps needs none.
    var probeURL: URL? {
        switch self {
        case .apple: nil
        case .google: URL(string: "comgooglemaps://")
        case .waze: URL(string: "waze://")
        }
    }

    /// Driving directions to `address` from the current location.
    func directionsURL(to address: String) -> URL? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&+=?#")
        guard let value = address.addingPercentEncoding(withAllowedCharacters: allowed) else { return nil }
        switch self {
        case .apple: return URL(string: "https://maps.apple.com/?daddr=\(value)")
        case .google: return URL(string: "comgooglemaps://?daddr=\(value)&directionsmode=driving")
        case .waze: return URL(string: "waze://?q=\(value)&navigate=yes")
        }
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

    /// The collapsed card's one-line time: "Nov 5 · 10:00 AM", "Nov 5" for all-day.
    /// Adds the year when it is not this year.
    static func compact(
        for invite: EmailInvite,
        timeZone: TimeZone = .current,
        locale: Locale = .current,
        now: Date = Date()
    ) -> String? {
        guard let span = span(for: invite, timeZone: timeZone) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let showYear = calendar.component(.year, from: span.start) != calendar.component(.year, from: now)
        let day = dayFormatter(template: showYear ? "MMMdy" : "MMMd", timeZone: timeZone, locale: locale).string(from: span.start)
        guard !span.allDay else { return day }
        let time = dayFormatter(template: "jmm", timeZone: timeZone, locale: locale).string(from: span.start)
        return "\(day) · \(time)"
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
            if var invite = message.invite {
                invite.sentBy = EmailInviteOrganizer(email: message.sender, name: message.senderName)
                return .invite(invite, emailId: message.id)
            }
            if let otp = message.otp, !otp.code.isEmpty { return .code(otp, emailId: message.id) }
        }
        return nil
    }
}

// MARK: - Free/busy (AVE-206)

/// Another event on the phone's calendars, reduced to what free/busy needs.
/// Android twin: `CalendarBusyEvent` in `MailCards.kt`.
struct CalendarBusyEvent: Equatable {
    var title: String
    var start: Date
    var end: Date
    var allDay: Bool = false
    /// Availability "free" (transparent): it doesn't block the time.
    var showsAsFree: Bool = false
    /// You declined it.
    var declined: Bool = false
    var cancelled: Bool = false
}

/// Whether you're free for an invite, read from the phone's own calendars.
enum InviteAvailability: Equatable {
    case free
    /// The earliest overlapping event, plus how many more overlap.
    case conflict(title: String, others: Int)
    /// The invite itself is already on a calendar (same title, same start and end).
    case inCalendar

    /// The span to check: timed, not cancelled. All-day invites are skipped: an
    /// all-day event rarely means "busy all day", so free/busy would mostly mislead.
    /// An invite without an end counts as one hour, like the event it adds.
    static func window(for invite: EmailInvite, timeZone: TimeZone = .current) -> DateInterval? {
        guard !invite.cancelled,
              let span = InviteTime.span(for: invite, timeZone: timeZone),
              !span.allDay else { return nil }
        let end = span.end ?? span.start.addingTimeInterval(3600)
        guard end > span.start else { return nil }
        return DateInterval(start: span.start, end: end)
    }

    /// Busy, timed events that overlap the invite. Free (transparent), declined,
    /// cancelled and all-day events don't count. Only the first occurrence of a
    /// repeating invite is checked. Nil when the invite has no window to check.
    static func check(
        _ invite: EmailInvite,
        against events: [CalendarBusyEvent],
        timeZone: TimeZone = .current
    ) -> InviteAvailability? {
        guard let window = window(for: invite, timeZone: timeZone) else { return nil }
        let inviteTitle = normalized(invite.displayTitle)
        var blocking: [CalendarBusyEvent] = []
        for event in events {
            if event.cancelled || event.declined || event.showsAsFree || event.allDay { continue }
            // Half-open overlap: back-to-back meetings don't conflict.
            let overlaps = event.start < window.end && window.start < event.end
                || (event.start == event.end && event.start == window.start)
            guard overlaps else { continue }
            if event.start == window.start, event.end == window.end, normalized(event.title) == inviteTitle {
                return .inCalendar
            }
            blocking.append(event)
        }
        guard !blocking.isEmpty else { return .free }
        let sorted = blocking.sorted { lhs, rhs in
            lhs.start != rhs.start ? lhs.start < rhs.start : lhs.title < rhs.title
        }
        let title = sorted[0].title.trimmingCharacters(in: .whitespacesAndNewlines)
        return .conflict(title: title.isEmpty ? "another event" : title, others: sorted.count - 1)
    }

    /// "You're free", "Conflicts with Team sync", "Conflicts with Team sync +2 more",
    /// "In your calendar".
    var label: String {
        switch self {
        case .free: return "You’re free"
        case .inCalendar: return "In your calendar"
        case .conflict(let title, let others):
            return others > 0 ? "Conflicts with \(title) +\(others) more" : "Conflicts with \(title)"
        }
    }

    private static func normalized(_ title: String) -> String {
        title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

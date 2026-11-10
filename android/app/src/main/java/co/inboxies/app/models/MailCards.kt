package co.inboxies.app.models

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import java.net.URI
import java.net.URLEncoder
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

// Reader cards for one-time codes and calendar invites (AVE-174 / AVE-177).
// Contract: `shared/mail-cards.ts`. The Worker returns `otp` and `invite` on the
// single-email and thread reader payloads; null (or absent) means "no card".
// List payloads never carry them. iOS twin: `Models/MailCards.swift` (AVE-176).

/** A one-time / verification code found in the message (separators already removed). */
@Serializable
data class EmailOtp(val code: String = "")

@Serializable
data class EmailInviteOrganizer(
    val email: String? = null,
    val name: String? = null,
) {
    /** "Pat Lee", else the address. */
    val label: String?
        get() = name?.trim()?.takeIf { it.isNotEmpty() } ?: email?.takeIf { it.isNotEmpty() }

    /** "Pat Lee <pat@x.com>", or whichever half there is. */
    val fullLabel: String?
        get() {
            val n = name?.trim()?.takeIf { it.isNotEmpty() }
            val e = email?.trim()?.takeIf { it.isNotEmpty() }
            return if (n != null && e != null && !n.equals(e, ignoreCase = true)) "$n <$e>" else n ?: e
        }
}

/** What the invite card says about who organized it (AVE-220). iOS twin: `InviteOrganizerLine`. */
sealed interface InviteOrganizerLine {
    data object None : InviteOrganizerLine

    /** The organizer lines up with the From (or an older server didn't say). */
    data class Organizer(val label: String) : InviteOrganizerLine

    /** It doesn't: the real sender leads; the organizer is only a claim. */
    data class Claimed(val sender: String?, val claimed: String) : InviteOrganizerLine
}

/** A calendar event parsed from a real `text/calendar` part or `.ics` attachment. */
@Serializable
data class EmailInvite(
    val method: String? = null,
    val status: String? = null,
    /** METHOD:CANCEL or STATUS:CANCELLED. Show "Cancelled" and hide Add to calendar. */
    val cancelled: Boolean = false,
    val uid: String? = null,
    val sequence: Int? = null,
    val title: String? = null,
    /**
     * UTC instant ("2026-11-05T15:00:00.000Z"), floating wall time
     * ("2026-11-05T15:00:00", device zone) or an all-day date ("2026-11-05").
     */
    val start: String,
    /** Same format as [start]; exclusive for all-day events. Null when unknown. */
    val end: String? = null,
    val allDay: Boolean = false,
    /** IANA zone the organizer scheduled in; null for floating and all-day events. */
    val timezone: String? = null,
    val location: String? = null,
    val organizer: EmailInviteOrganizer? = null,
    /**
     * AVE-220: false when ORGANIZER doesn't line up with the message's From (it
     * is free text in the .ics). Null from older servers: show it as before.
     */
    val organizerMatchesSender: Boolean? = null,
    val meetingUrl: String? = null,
    /** Raw RRULE ("FREQ=WEEKLY;BYDAY=TU"), else null. */
    val recurrence: String? = null,
    val description: String? = null,
    /** The message's real From, filled in by [MailCards.card]; not part of the payload. */
    @Transient val sentBy: EmailInviteOrganizer? = null,
) {
    /** Organizer as is when it matches the From; else the real sender and a claim. */
    val organizerLine: InviteOrganizerLine
        get() {
            val organizer = organizer ?: return InviteOrganizerLine.None
            if (organizerMatchesSender != false) {
                return organizer.label?.let { InviteOrganizerLine.Organizer(it) } ?: InviteOrganizerLine.None
            }
            val claimed = organizer.fullLabel ?: return InviteOrganizerLine.None
            return InviteOrganizerLine.Claimed(sender = sentBy?.fullLabel, claimed = claimed)
        }

    val displayTitle: String
        get() = title?.trim()?.takeIf { it.isNotEmpty() } ?: "Untitled event"

    /** The [meetingUrl] when it is https on a known meeting host (AVE-216). */
    val meetingLink: String?
        get() = meetingUrl?.let { MeetingLinks.knownUrl(it) }

    /** Location, unless it is only the meeting link again. */
    val displayLocation: String?
        get() {
            val trimmed = location?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            if (meetingUrl != null && trimmed == meetingUrl.trim()) return null
            return trimmed
        }

    /**
     * The [meetingUrl], else a link in the location ("Zoom: https://…"), only when it
     * is https on a known meeting host (AVE-216). A stranger's link to any other site
     * stays location text: no Join, and not the calendar entry's link.
     */
    val joinLink: String?
        get() = meetingLink ?: location?.let { MeetingLinks.firstKnownUrl(it) }

    /**
     * The location when it is a place you can get directions to: not a link and
     * not just the name of a call platform ("Microsoft Teams Meeting").
     */
    val address: String?
        get() {
            val place = displayLocation ?: return null
            if (InviteVenue.httpsLink(place) != null) return null
            if (InviteVenue.isVirtualPlaceName(place)) return null
            return place
        }

    /**
     * Where the event happens, which decides the card's primary action: a meeting
     * link (Join), a physical address (Directions) or nothing to open. A meeting
     * link wins over an address; the address stays tappable in the details.
     */
    val venue: InviteVenue
        get() {
            joinLink?.let { return InviteVenue.Link(it) }
            address?.let { return InviteVenue.Address(it) }
            return InviteVenue.None
        }
}

/**
 * Known video-meeting links (AVE-216): the only links the Invite card offers Join
 * for. Mirrors `shared/meeting-links.ts` (the Worker's list) and is checked against
 * `shared/meeting-links.fixtures.json`. iOS twin: `MeetingLinks`.
 */
object MeetingLinks {
    /** Only this exact host. */
    val exactHosts = listOf(
        "meet.google.com", "teams.microsoft.com", "teams.live.com", "meet.jit.si",
        "whereby.com", "facetime.apple.com", "chime.aws", "meet.goto.com", "app.slack.com",
    )

    /** This host or any subdomain of it ("us02web.zoom.us"). */
    val subdomainHosts = listOf("zoom.us", "zoomgov.com", "webex.com", "gotomeeting.com")

    private val linkPattern = Regex("""https://[^\s<>"'\\)\]]+""", RegexOption.IGNORE_CASE)
    private val trailingPunctuation = charArrayOf('.', ',', ';', ':', '!', '?')

    fun isMeetingHost(host: String): Boolean {
        val h = host.lowercase(Locale.ROOT)
        return h in exactHosts || subdomainHosts.any { h == it || h.endsWith(".$it") }
    }

    /**
     * [value] when it is https on a known meeting host with no user info
     * ("https://zoom.us@evil.test" is a link to evil.test); else null.
     */
    fun knownUrl(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() || it == '\\' }) return null
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.rawUserInfo != null) return null
        val host = uri.host ?: return null
        return if (isMeetingHost(host)) trimmed else null
    }

    /** The first known meeting link in free text ("Zoom: https://…"), skipping other sites. */
    fun firstKnownUrl(text: String): String? {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return null
        knownUrl(trimmed)?.let { return it }
        for (match in linkPattern.findAll(trimmed)) {
            knownUrl(match.value.trimEnd(*trailingPunctuation))?.let { return it }
        }
        return null
    }
}

/** Classification of an invite's location (AVE-176 review). */
sealed interface InviteVenue {
    data class Link(val url: String) : InviteVenue
    data class Address(val address: String) : InviteVenue
    data object None : InviteVenue

    companion object {
        private val linkPattern = Regex("""https://[^\s<>"']+""", RegexOption.IGNORE_CASE)
        private val trailingPunctuation = charArrayOf('.', ',', ';', ':', ')', ']', '!', '?', '>')

        /** True for an absolute https URL with a host. */
        fun isHttps(value: String): Boolean {
            val uri = runCatching { URI(value.trim()) }.getOrNull() ?: return false
            return uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty()
        }

        /** The first https link in [text], when it has a host. Other schemes are ignored. */
        fun httpsLink(text: String): String? {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return null
            if (isHttps(trimmed)) return trimmed
            for (match in linkPattern.findAll(trimmed)) {
                val candidate = match.value.trimEnd(*trailingPunctuation)
                if (isHttps(candidate)) return candidate
            }
            return null
        }

        /** Call-platform names organizers put in the location field instead of a place. */
        fun isVirtualPlaceName(text: String): Boolean {
            var name = text.trim().lowercase(Locale.ROOT)
            for (suffix in listOf(" meeting", " call", " video call")) {
                if (name.endsWith(suffix)) name = name.dropLast(suffix.length)
            }
            return name in virtualPlaceNames
        }

        private val virtualPlaceNames = setOf(
            "zoom", "google meet", "meet", "microsoft teams", "teams", "webex", "cisco webex",
            "facetime", "skype", "slack huddle", "whereby", "jitsi", "online", "virtual",
            "remote", "video", "phone", "tbd", "tba",
        )

        /**
         * `geo:0,0?q=<address>`: the system hands it to the user's maps app (or offers a
         * choice), the Android twin of iOS's Apple Maps / Google Maps / Waze picker.
         */
        fun directionsUri(address: String): String =
            "geo:0,0?q=" + URLEncoder.encode(address.trim(), "UTF-8").replace("+", "%20")
    }
}

// region Times

/**
 * Parses and formats invite times (`shared/mail-cards.ts` formats). Zone, locale,
 * clock and hour cycle are parameters so tests are deterministic; the app passes
 * the device's. [patterns] turns a skeleton ("EEEMMMd") into a localized pattern:
 * the app uses `DateFormat.getBestDateTimePattern`, tests the English fallback.
 */
object InviteTime {
    /** A resolved span. For all-day events [lastDay] is the inclusive last day. */
    data class Span(
        val start: ZonedDateTime,
        val end: ZonedDateTime?,
        val allDay: Boolean,
        val lastDay: LocalDate? = null,
    )

    fun interface Patterns {
        fun pattern(skeleton: String, locale: Locale): String
    }

    /** English shapes matching iOS's templates; used in tests and as a fallback. */
    val FallbackPatterns = Patterns { skeleton, _ ->
        when (skeleton) {
            "EEEMMMd" -> "EEE, MMM d"
            "EEEMMMdy" -> "EEE, MMM d, y"
            "MMMd" -> "MMM d"
            "MMMdy" -> "MMM d, y"
            "Hmm" -> "HH:mm"
            else -> "h:mm a"
        }
    }

    private val dateOnly = Regex("""^\d{4}-\d{2}-\d{2}$""")
    private val zoneDesignator = Regex("""(?:[Zz]|[+-]\d{2}:?\d{2})$""")

    fun isDateOnly(value: String): Boolean = dateOnly.matches(value.trim())

    fun hasZoneDesignator(value: String): Boolean = zoneDesignator.containsMatchIn(value.trim())

    /** Wall time without a zone designator ("2026-11-05T15:00:00"). */
    fun isFloating(value: String): Boolean {
        val trimmed = value.trim()
        return !isDateOnly(trimmed) && trimmed.contains('T') && !hasZoneDesignator(trimmed)
    }

    /**
     * One value: a UTC instant (has "Z" or an offset), a floating wall time (read in
     * [zone]) or a date-only all-day day (midnight in [zone]).
     */
    fun parse(value: String, zone: ZoneId = ZoneId.systemDefault()): ZonedDateTime? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        return runCatching {
            when {
                isDateOnly(trimmed) -> LocalDate.parse(trimmed).atStartOfDay(zone)
                hasZoneDesignator(trimmed) -> {
                    // "+0500" → "+05:00" for the ISO parser.
                    val normalized = trimmed.replace(Regex("""([+-]\d{2})(\d{2})$"""), "$1:$2")
                    OffsetDateTime.parse(normalized).atZoneSameInstant(zone)
                }
                else -> LocalDateTime.parse(trimmed).atZone(zone)
            }
        }.getOrNull()
    }

    fun span(invite: EmailInvite, zone: ZoneId = ZoneId.systemDefault()): Span? {
        val allDay = invite.allDay || isDateOnly(invite.start)
        val start = parse(invite.start, zone) ?: return null
        val end = invite.end?.let { parse(it, zone) }
        if (!allDay) {
            return Span(start = start, end = end?.takeIf { it.isAfter(start) }, allDay = false)
        }
        // All-day end is exclusive: Nov 5 → Nov 6 is the single day Nov 5.
        val first = start.toLocalDate()
        val lastDay = end?.toLocalDate()?.minusDays(1)?.takeIf { !it.isBefore(first) } ?: first
        return Span(start = start, end = end?.takeIf { it.isAfter(start) }, allDay = true, lastDay = lastDay)
    }

    /**
     * "Thu, Nov 5 · 10:00 – 11:00 AM", "Thu, Nov 5 · All day",
     * "Thu, Nov 5 – Sat, Nov 7 · All day". Adds the year when it is not this year.
     */
    fun summary(
        invite: EmailInvite,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
        now: Instant = Instant.now(),
        is24Hour: Boolean = false,
        patterns: Patterns = FallbackPatterns,
    ): String? {
        val span = span(invite, zone) ?: return null
        val thisYear = now.atZone(zone).year
        val lastDate = span.lastDay ?: span.end?.toLocalDate() ?: span.start.toLocalDate()
        val showYear = span.start.year != thisYear || lastDate.year != thisYear
        val day = formatter(if (showYear) "EEEMMMdy" else "EEEMMMd", locale, patterns)
        val time = formatter(if (is24Hour) "Hmm" else "hmm", locale, patterns)

        if (span.allDay) {
            val first = span.start.toLocalDate()
            val last = span.lastDay ?: first
            val days = if (last == first) day.format(first) else "${day.format(first)} – ${day.format(last)}"
            return "$days · All day"
        }
        val end = span.end ?: return "${day.format(span.start)} · ${time.format(span.start)}"
        if (end.toLocalDate() == span.start.toLocalDate()) {
            return "${day.format(span.start)} · ${timeRange(span.start, end, time, locale, is24Hour)}"
        }
        return "${day.format(span.start)}, ${time.format(span.start)} – ${day.format(end)}, ${time.format(end)}"
    }

    /** The collapsed card's one-line time: "Nov 5 · 10:00 AM", "Nov 5" for all-day. */
    fun compact(
        invite: EmailInvite,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
        now: Instant = Instant.now(),
        is24Hour: Boolean = false,
        patterns: Patterns = FallbackPatterns,
    ): String? {
        val span = span(invite, zone) ?: return null
        val showYear = span.start.year != now.atZone(zone).year
        val day = formatter(if (showYear) "MMMdy" else "MMMd", locale, patterns).format(span.start)
        if (span.allDay) return day
        val time = formatter(if (is24Hour) "Hmm" else "hmm", locale, patterns).format(span.start)
        return "$day · $time"
    }

    /** "10:00 – 11:00 AM" when both ends share the day period, else both in full. */
    private fun timeRange(
        start: ZonedDateTime,
        end: ZonedDateTime,
        time: DateTimeFormatter,
        locale: Locale,
        is24Hour: Boolean,
    ): String {
        val from = time.format(start)
        val to = time.format(end)
        if (!is24Hour) {
            val period = DateTimeFormatter.ofPattern("a", locale)
            val marker = period.format(start)
            val spaced = Regex("""[\s  ]""" + Regex.escape(marker) + "$")
            if (marker == period.format(end) && spaced.containsMatchIn(from) && spaced.containsMatchIn(to)) {
                return "${from.replace(spaced, "")} – $to"
            }
        }
        return "$from – $to"
    }

    private fun formatter(skeleton: String, locale: Locale, patterns: Patterns): DateTimeFormatter =
        DateTimeFormatter.ofPattern(patterns.pattern(skeleton, locale), locale)
}

// endregion

// region Recurrence

/**
 * The simple RRULE shapes a calendar insert can carry as-is: FREQ with optional
 * INTERVAL, COUNT or UNTIL, and plain BYDAY weekdays on a weekly rule. Anything
 * else (BYMONTHDAY, BYSETPOS, ordinal BYDAY like "2TU", …) returns null and the
 * event is added without a repeat rule rather than with a wrong one.
 */
object InviteRecurrence {
    enum class Frequency { DAILY, WEEKLY, MONTHLY, YEARLY }

    data class Rule(
        val frequency: Frequency,
        val interval: Int = 1,
        val count: Int? = null,
        /** Raw UNTIL value ("20261231T235959Z" or "20261231"). */
        val until: String? = null,
        val weekdays: List<DayOfWeek> = emptyList(),
    ) {
        /** Canonical RRULE for `CalendarContract.Events.RRULE`. */
        val rrule: String
            get() = buildList {
                add("FREQ=${frequency.name}")
                if (interval != 1) add("INTERVAL=$interval")
                count?.let { add("COUNT=$it") }
                until?.let { add("UNTIL=$it") }
                if (weekdays.isNotEmpty()) add("BYDAY=" + weekdays.joinToString(",") { code(it) })
            }.joinToString(";")
    }

    private val untilPattern = Regex("""^\d{8}(T\d{6}Z?)?$""")

    fun parse(rrule: String?): Rule? {
        var raw = rrule?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (raw.uppercase(Locale.ROOT).startsWith("RRULE:")) raw = raw.substring(6)
        val parts = mutableMapOf<String, String>()
        for (piece in raw.split(';')) {
            if (piece.isEmpty()) continue
            val pair = piece.split('=', limit = 2)
            if (pair.size != 2) return null
            parts[pair[0].trim().uppercase(Locale.ROOT)] = pair[1].trim().uppercase(Locale.ROOT)
        }
        val frequency = when (parts.remove("FREQ")) {
            "DAILY" -> Frequency.DAILY
            "WEEKLY" -> Frequency.WEEKLY
            "MONTHLY" -> Frequency.MONTHLY
            "YEARLY" -> Frequency.YEARLY
            else -> return null
        }
        val interval = parts.remove("INTERVAL")?.let { it.toIntOrNull()?.takeIf { n -> n > 0 } ?: return null } ?: 1
        val count = parts.remove("COUNT")?.let { it.toIntOrNull()?.takeIf { n -> n > 0 } ?: return null }
        val until = parts.remove("UNTIL")?.let { if (untilPattern.matches(it)) it else return null }
        val weekdays = parts.remove("BYDAY")?.split(',')?.map { weekday(it.trim()) ?: return null }.orEmpty()
        parts.remove("WKST")
        // Any other part changes the meaning; don't approximate it.
        if (parts.isNotEmpty()) return null
        if (count != null && until != null) return null
        if (weekdays.isNotEmpty() && frequency != Frequency.WEEKLY) return null
        return Rule(frequency, interval, count, until, weekdays)
    }

    /** "Repeats weekly", "Repeats every 2 weeks"; "Repeats" for a rule we don't map. */
    fun label(rrule: String?): String? {
        if (rrule.isNullOrBlank()) return null
        val rule = parse(rrule) ?: return "Repeats"
        val (single, plural) = when (rule.frequency) {
            Frequency.DAILY -> "daily" to "days"
            Frequency.WEEKLY -> "weekly" to "weeks"
            Frequency.MONTHLY -> "monthly" to "months"
            Frequency.YEARLY -> "yearly" to "years"
        }
        return if (rule.interval == 1) "Repeats $single" else "Repeats every ${rule.interval} $plural"
    }

    private fun weekday(token: String): DayOfWeek? = when (token) {
        "MO" -> DayOfWeek.MONDAY
        "TU" -> DayOfWeek.TUESDAY
        "WE" -> DayOfWeek.WEDNESDAY
        "TH" -> DayOfWeek.THURSDAY
        "FR" -> DayOfWeek.FRIDAY
        "SA" -> DayOfWeek.SATURDAY
        "SU" -> DayOfWeek.SUNDAY
        else -> null
    }

    private fun code(day: DayOfWeek): String =
        day.getDisplayName(TextStyle.SHORT, Locale.ROOT).take(2).uppercase(Locale.ROOT)
}

// endregion

// region Calendar insert

/**
 * The values an `Intent.ACTION_INSERT` on `CalendarContract.Events.CONTENT_URI`
 * carries (no calendar permission needed; the user's calendar app saves it).
 * Kept free of Android types so it is unit-tested.
 */
data class CalendarInsert(
    val title: String,
    val beginMillis: Long,
    val endMillis: Long,
    val allDay: Boolean,
    val location: String?,
    val description: String?,
    /** Only simple rules (see [InviteRecurrence]); complex ones are left off. */
    val rrule: String?,
) {
    companion object {
        fun of(invite: EmailInvite, zone: ZoneId = ZoneId.systemDefault()): CalendarInsert? {
            if (invite.cancelled) return null
            val span = InviteTime.span(invite, zone) ?: return null
            val begin: Long
            val end: Long
            if (span.allDay) {
                // Local midnights; the end is exclusive, as CalendarContract stores it.
                val first = span.start.toLocalDate()
                val last = span.lastDay ?: first
                begin = first.atStartOfDay(zone).toInstant().toEpochMilli()
                end = last.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            } else {
                begin = span.start.toInstant().toEpochMilli()
                end = (span.end ?: span.start.plusHours(1)).toInstant().toEpochMilli()
            }
            val link = invite.meetingLink
            val notes = invite.description?.trim()?.takeIf { it.isNotEmpty() }
            val description = when {
                link == null -> notes
                notes == null -> "Join: $link"
                notes.contains(link) -> notes
                else -> "Join: $link\n\n$notes"
            }
            return CalendarInsert(
                title = invite.displayTitle,
                beginMillis = begin,
                endMillis = end,
                allDay = span.allDay,
                location = invite.displayLocation ?: invite.meetingLink,
                description = description,
                rrule = InviteRecurrence.parse(invite.recurrence)?.rrule,
            )
        }
    }
}

// endregion

// region Free/busy (AVE-206)

/**
 * Another event on the phone's calendars (CalendarContract instances), reduced to
 * what free/busy needs. iOS twin: `CalendarBusyEvent` in `MailCards.swift`.
 */
data class CalendarBusyEvent(
    val title: String,
    val beginMillis: Long,
    val endMillis: Long,
    val allDay: Boolean = false,
    /** Availability "free" (transparent): it doesn't block the time. */
    val showsAsFree: Boolean = false,
    /** You declined it. */
    val declined: Boolean = false,
    val cancelled: Boolean = false,
)

/** Whether you're free for an invite, read from the phone's own calendars. */
sealed interface InviteAvailability {
    val label: String

    object Free : InviteAvailability {
        override val label = "You\u2019re free"
    }

    /** The earliest overlapping event, plus how many more overlap. */
    data class Conflict(val title: String, val others: Int) : InviteAvailability {
        override val label: String
            get() = if (others > 0) "Conflicts with $title +$others more" else "Conflicts with $title"
    }

    /** The invite itself is already on a calendar (same title, same start and end). */
    object InCalendar : InviteAvailability {
        override val label = "In your calendar"
    }

    /** Half-open millis span to check. */
    data class Window(val beginMillis: Long, val endMillis: Long)

    companion object {
        /**
         * The span to check: timed, not cancelled. All-day invites are skipped: an
         * all-day event rarely means "busy all day", so free/busy would mostly mislead.
         * An invite without an end counts as one hour, like the event it adds.
         */
        fun window(invite: EmailInvite, zone: ZoneId = ZoneId.systemDefault()): Window? {
            if (invite.cancelled) return null
            val span = InviteTime.span(invite, zone) ?: return null
            if (span.allDay) return null
            val begin = span.start.toInstant().toEpochMilli()
            val end = (span.end ?: span.start.plusHours(1)).toInstant().toEpochMilli()
            return if (end > begin) Window(begin, end) else null
        }

        /**
         * Busy, timed events that overlap the invite. Free (transparent), declined,
         * cancelled and all-day events don't count. Only the first occurrence of a
         * repeating invite is checked. Null when the invite has no window to check.
         */
        fun check(
            invite: EmailInvite,
            events: List<CalendarBusyEvent>,
            zone: ZoneId = ZoneId.systemDefault(),
        ): InviteAvailability? {
            val window = window(invite, zone) ?: return null
            val inviteTitle = normalized(invite.displayTitle)
            val blocking = mutableListOf<CalendarBusyEvent>()
            for (event in events) {
                if (event.cancelled || event.declined || event.showsAsFree || event.allDay) continue
                // Half-open overlap: back-to-back meetings don't conflict.
                val overlaps = (event.beginMillis < window.endMillis && window.beginMillis < event.endMillis) ||
                    (event.beginMillis == event.endMillis && event.beginMillis == window.beginMillis)
                if (!overlaps) continue
                if (event.beginMillis == window.beginMillis && event.endMillis == window.endMillis &&
                    normalized(event.title) == inviteTitle
                ) {
                    return InCalendar
                }
                blocking += event
            }
            val first = blocking.minWithOrNull(compareBy<CalendarBusyEvent> { it.beginMillis }.thenBy { it.title })
                ?: return Free
            val title = first.title.trim().ifEmpty { "another event" }
            return Conflict(title, blocking.size - 1)
        }

        private fun normalized(title: String) = title.trim().lowercase()
    }
}

/**
 * Columns for writing the invite straight into a calendar (`CalendarContract.Events`).
 * All-day events are stored at UTC midnights with an exclusive end, and a repeating
 * event needs DURATION instead of DTEND, as the provider requires.
 */
data class CalendarEventValues(
    val title: String,
    val dtStart: Long,
    val dtEnd: Long?,
    val duration: String?,
    val allDay: Boolean,
    val timezone: String,
    val location: String?,
    val description: String?,
    val rrule: String?,
) {
    companion object {
        fun of(invite: EmailInvite, zone: ZoneId = ZoneId.systemDefault()): CalendarEventValues? {
            val insert = CalendarInsert.of(invite, zone) ?: return null
            val start: Long
            val end: Long
            val timezone: String
            if (insert.allDay) {
                val utc = ZoneId.of("UTC")
                val first = Instant.ofEpochMilli(insert.beginMillis).atZone(zone).toLocalDate()
                val lastExclusive = Instant.ofEpochMilli(insert.endMillis).atZone(zone).toLocalDate()
                start = first.atStartOfDay(utc).toInstant().toEpochMilli()
                end = lastExclusive.atStartOfDay(utc).toInstant().toEpochMilli()
                timezone = "UTC"
            } else {
                start = insert.beginMillis
                end = insert.endMillis
                // Floating events stay on the viewer's wall clock; zoned ones keep the organizer's zone.
                val organizerZone = invite.timezone
                    ?.takeIf { !InviteTime.isFloating(invite.start) }
                    ?.let { runCatching { ZoneId.of(it) }.getOrNull() }
                timezone = (organizerZone ?: if (InviteTime.isFloating(invite.start)) zone else ZoneId.of("UTC")).id
            }
            val repeating = insert.rrule != null
            val duration = if (insert.allDay) {
                "P${((end - start) / 86_400_000L).coerceAtLeast(1)}D"
            } else {
                "P${((end - start) / 1000L).coerceAtLeast(0)}S"
            }
            return CalendarEventValues(
                title = insert.title,
                dtStart = start,
                dtEnd = if (repeating) null else end,
                duration = if (repeating) duration else null,
                allDay = insert.allDay,
                timezone = timezone,
                location = insert.location,
                description = insert.description,
                rrule = insert.rrule,
            )
        }
    }
}

// endregion

// region Which card the reader shows

object MailCards {
    /**
     * Mirrors `mailCardsAllowed` in `shared/mail-cards.ts`. The Worker already nulls
     * the fields; this keeps cached rows honest after a move to Spam.
     */
    fun allowed(email: Email): Boolean =
        email.folderId != FolderIds.SPAM && email.effectiveAuthTier != "failed"

    sealed interface Card {
        val emailId: String

        data class Code(val otp: EmailOtp, override val emailId: String) : Card
        data class Invite(val invite: EmailInvite, override val emailId: String) : Card
    }

    /** The newest message in the conversation (oldest first) that carries a card. */
    fun card(messages: List<Email>): Card? {
        for (message in messages.asReversed()) {
            if (message.isDraft || !allowed(message)) continue
            message.invite?.let {
                val sentBy = EmailInviteOrganizer(email = message.sender, name = message.senderName)
                return Card.Invite(it.copy(sentBy = sentBy), message.id)
            }
            message.otp?.takeIf { it.code.isNotBlank() }?.let { return Card.Code(it, message.id) }
        }
        return null
    }
}

// endregion

// region Lenient decoding

/** Decodes the card payloads leniently: a malformed card is dropped and the email still decodes. */
private val CardJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
}

abstract class LenientCardSerializer<T : Any>(private val inner: KSerializer<T>) : KSerializer<T?> {
    override val descriptor: SerialDescriptor = inner.nullable.descriptor

    override fun deserialize(decoder: Decoder): T? {
        val json = decoder as? JsonDecoder ?: return runCatching { inner.deserialize(decoder) }.getOrNull()
        val element = json.decodeJsonElement()
        if (element is JsonNull) return null
        return runCatching { CardJson.decodeFromJsonElement(inner, element) }.getOrNull()
    }

    @OptIn(ExperimentalSerializationApi::class)
    override fun serialize(encoder: Encoder, value: T?) {
        if (value == null) encoder.encodeNull() else encoder.encodeSerializableValue(inner, value)
    }
}

object LenientOtpSerializer : LenientCardSerializer<EmailOtp>(EmailOtp.serializer())

object LenientInviteSerializer : LenientCardSerializer<EmailInvite>(EmailInvite.serializer())

// endregion

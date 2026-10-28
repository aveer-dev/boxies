package co.inboxies.app.services

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** One "Remind me" preset row: title + the resolved local time (AVE-86). */
data class ReplyLaterReminderPreset(
    val id: Id,
    val title: String,
    val time: ZonedDateTime,
) {
    enum class Id { LaterToday, Tomorrow, NextWeek }
}

/**
 * Pure Reply Later reminder math + formatting, shared by the picker, toasts and rows.
 * Presets use the device's local time (same rules on web / iOS):
 * - Later today: now + 3h, rounded up to the next 5 minutes (seconds zeroed).
 * - Tomorrow: tomorrow 09:00.
 * - Next week: the next Monday strictly after today, 09:00.
 */
object ReplyLaterReminderPresets {
    private val MORNING: LocalTime = LocalTime.of(9, 0)

    /** The server rejects reminders further out than this. */
    const val MAX_DAYS_AHEAD = 366L

    fun laterToday(now: ZonedDateTime): ZonedDateTime {
        val target = now.plusHours(3)
        val floored = target.truncatedTo(ChronoUnit.MINUTES)
        val onBoundary = floored == target && floored.minute % 5 == 0
        if (onBoundary) return floored
        val minutesUp = 5 - floored.minute % 5
        return floored.plusMinutes(minutesUp.toLong())
    }

    fun tomorrow(now: ZonedDateTime): ZonedDateTime =
        now.toLocalDate().plusDays(1).atTime(MORNING).atZone(now.zone)

    fun nextWeek(now: ZonedDateTime): ZonedDateTime =
        now.toLocalDate()
            .with(TemporalAdjusters.next(DayOfWeek.MONDAY))
            .atTime(MORNING)
            .atZone(now.zone)

    fun presets(now: ZonedDateTime = ZonedDateTime.now()): List<ReplyLaterReminderPreset> = listOf(
        ReplyLaterReminderPreset(ReplyLaterReminderPreset.Id.LaterToday, "Later today", laterToday(now)),
        ReplyLaterReminderPreset(ReplyLaterReminderPreset.Id.Tomorrow, "Tomorrow", tomorrow(now)),
        ReplyLaterReminderPreset(ReplyLaterReminderPreset.Id.NextWeek, "Next week", nextWeek(now)),
    )

    /** A custom pick is valid when it is in the future and within [MAX_DAYS_AHEAD]. */
    fun isValidCustom(time: ZonedDateTime, now: ZonedDateTime = ZonedDateTime.now()): Boolean =
        time.isAfter(now) && !time.isAfter(now.plusDays(MAX_DAYS_AHEAD))

    // ---- Wire format ----

    private val ISO_UTC: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** UTC ISO 8601 with milliseconds, e.g. `2026-10-29T14:00:00.000Z`. */
    fun toIso(time: ZonedDateTime): String = ISO_UTC.format(time.toInstant())

    /** Lenient parse of a server timestamp; `null` when absent or unreadable. */
    fun parse(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return runCatching { Instant.parse(raw) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(raw).toInstant() }.getOrNull()
            ?: runCatching { Instant.parse(raw.trim().replace(' ', 'T') + "Z") }.getOrNull()
    }

    // ---- Labels ----

    private fun pattern(p: String, locale: Locale) = DateTimeFormatter.ofPattern(p, locale)

    /**
     * Trailing time on a picker preset row: "3:05 PM" today, "Thu 9:00 AM" otherwise.
     */
    fun presetLabel(time: ZonedDateTime, now: ZonedDateTime, locale: Locale = Locale.getDefault()): String =
        if (time.toLocalDate() == now.toLocalDate()) {
            pattern("h:mm a", locale).format(time)
        } else {
            pattern("EEE h:mm a", locale).format(time)
        }

    /**
     * Row chip: "Today 3:05 PM" / "Tomorrow 9:00 AM" / "Mon 9:00 AM" (within a week) /
     * "Oct 30, 9:00 AM".
     */
    fun shortLabel(time: ZonedDateTime, now: ZonedDateTime, locale: Locale = Locale.getDefault()): String {
        val days = ChronoUnit.DAYS.between(now.toLocalDate(), time.toLocalDate())
        val clock = pattern("h:mm a", locale).format(time)
        return when {
            days == 0L -> "Today $clock"
            days == 1L -> "Tomorrow $clock"
            days in 2..6 -> "${pattern("EEE", locale).format(time)} $clock"
            else -> "${pattern("MMM d", locale).format(time)}, $clock"
        }
    }

    /**
     * Toast / picker header: "Tue, 9:00 AM" within a week, "Tue, Nov 3, 9:00 AM" further out
     * (or in the past).
     */
    fun fullLabel(time: ZonedDateTime, now: ZonedDateTime, locale: Locale = Locale.getDefault()): String {
        val days = ChronoUnit.DAYS.between(now.toLocalDate(), time.toLocalDate())
        return if (days in 0..6) {
            pattern("EEE, h:mm a", locale).format(time)
        } else {
            pattern("EEE, MMM d, h:mm a", locale).format(time)
        }
    }

    /** [shortLabel] for a server timestamp in the device zone; `null` when unreadable. */
    fun shortLabel(raw: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
        val instant = parse(raw) ?: return null
        val now = ZonedDateTime.now(zone)
        return shortLabel(instant.atZone(zone), now)
    }

    /** [fullLabel] for a server timestamp in the device zone; `null` when unreadable. */
    fun fullLabel(raw: String?, zone: ZoneId = ZoneId.systemDefault()): String? {
        val instant = parse(raw) ?: return null
        return fullLabel(instant.atZone(zone), ZonedDateTime.now(zone))
    }
}

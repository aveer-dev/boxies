package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.WorkflowPilesResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/** AVE-86: Reply Later reminder presets, labels, decoding and Inbox sort. */
class ReplyLaterRemindersTest {
    private val zone = ZoneId.of("America/New_York")
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int, s: Int = 0) =
        ZonedDateTime.of(y, mo, d, h, mi, s, 0, zone)

    // ---- Later today ----

    @Test
    fun laterTodayRoundsUpToNextFiveMinutes() {
        assertEquals(at(2026, 10, 28, 17, 5), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 14, 2, 30)))
        assertEquals(at(2026, 10, 28, 17, 5), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 14, 1)))
        assertEquals(at(2026, 10, 28, 18, 0), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 14, 57)))
    }

    @Test
    fun laterTodayOnExactBoundaryStays() {
        assertEquals(at(2026, 10, 28, 17, 0), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 14, 0)))
    }

    @Test
    fun laterTodaySecondsOnBoundaryStillRoundUp() {
        assertEquals(at(2026, 10, 28, 17, 5), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 14, 0, 1)))
    }

    @Test
    fun laterTodayCanCrossMidnight() {
        assertEquals(at(2026, 10, 29, 2, 0), ReplyLaterReminderPresets.laterToday(at(2026, 10, 28, 22, 58)))
    }

    // ---- Tomorrow / Next week ----

    @Test
    fun tomorrowIsNineAm() {
        assertEquals(at(2026, 10, 29, 9, 0), ReplyLaterReminderPresets.tomorrow(at(2026, 10, 28, 23, 50)))
        assertEquals(at(2026, 11, 1, 9, 0), ReplyLaterReminderPresets.tomorrow(at(2026, 10, 31, 0, 5)))
    }

    @Test
    fun nextWeekIsFollowingMondayFromMidweek() {
        // 2026-10-28 is a Wednesday.
        assertEquals(DayOfWeek.WEDNESDAY, at(2026, 10, 28, 10, 0).dayOfWeek)
        assertEquals(at(2026, 11, 2, 9, 0), ReplyLaterReminderPresets.nextWeek(at(2026, 10, 28, 10, 0)))
    }

    @Test
    fun nextWeekOnMondayIsSevenDaysOut() {
        val monday = at(2026, 11, 2, 7, 0)
        assertEquals(DayOfWeek.MONDAY, monday.dayOfWeek)
        assertEquals(at(2026, 11, 9, 9, 0), ReplyLaterReminderPresets.nextWeek(monday))
    }

    @Test
    fun nextWeekOnSundayIsTomorrow() {
        val sunday = at(2026, 11, 1, 20, 0)
        assertEquals(DayOfWeek.SUNDAY, sunday.dayOfWeek)
        assertEquals(at(2026, 11, 2, 9, 0), ReplyLaterReminderPresets.nextWeek(sunday))
    }

    @Test
    fun presetsAreInOrder() {
        val ids = ReplyLaterReminderPresets.presets(at(2026, 10, 28, 10, 0)).map { it.id }
        assertEquals(
            listOf(
                ReplyLaterReminderPreset.Id.LaterToday,
                ReplyLaterReminderPreset.Id.Tomorrow,
                ReplyLaterReminderPreset.Id.NextWeek,
            ),
            ids,
        )
    }

    // ---- Wire format ----

    @Test
    fun isoIsUtcWithMillis() {
        assertEquals("2026-10-29T13:00:00.000Z", ReplyLaterReminderPresets.toIso(at(2026, 10, 29, 9, 0)))
    }

    @Test
    fun parseIsLenient() {
        assertEquals(
            ReplyLaterReminderPresets.parse("2026-10-29T13:00:00.000Z"),
            ReplyLaterReminderPresets.parse("2026-10-29T13:00:00Z"),
        )
        assertEquals(
            ReplyLaterReminderPresets.parse("2026-10-29T13:00:00Z"),
            ReplyLaterReminderPresets.parse("2026-10-29 13:00:00"),
        )
        assertNull(ReplyLaterReminderPresets.parse(null))
        assertNull(ReplyLaterReminderPresets.parse("nope"))
    }

    @Test
    fun customMustBeFutureAndWithinAYear() {
        val now = at(2026, 10, 28, 10, 0)
        assertFalse(ReplyLaterReminderPresets.isValidCustom(now.minusMinutes(1), now))
        assertTrue(ReplyLaterReminderPresets.isValidCustom(now.plusMinutes(1), now))
        assertFalse(ReplyLaterReminderPresets.isValidCustom(now.plusDays(367), now))
    }

    // ---- Labels ----

    @Test
    fun labels() {
        val now = at(2026, 10, 28, 10, 0) // Wednesday
        val us = Locale.US
        assertEquals("1:05 PM", ReplyLaterReminderPresets.presetLabel(at(2026, 10, 28, 13, 5), now, us))
        assertEquals("Thu 9:00 AM", ReplyLaterReminderPresets.presetLabel(at(2026, 10, 29, 9, 0), now, us))
        assertEquals("Tomorrow 9:00 AM", ReplyLaterReminderPresets.shortLabel(at(2026, 10, 29, 9, 0), now, us))
        assertEquals("Mon 9:00 AM", ReplyLaterReminderPresets.shortLabel(at(2026, 11, 2, 9, 0), now, us))
        assertEquals("Nov 9, 9:00 AM", ReplyLaterReminderPresets.shortLabel(at(2026, 11, 9, 9, 0), now, us))
        assertEquals("Thu, 9:00 AM", ReplyLaterReminderPresets.fullLabel(at(2026, 10, 29, 9, 0), now, us))
        assertEquals("Mon, Nov 9, 9:00 AM", ReplyLaterReminderPresets.fullLabel(at(2026, 11, 9, 9, 0), now, us))
    }

    // ---- Model ----

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    @Test
    fun emailDecodesReminderFieldsAndOlderWorkers() {
        val withFields = json.decodeFromString<Email>(
            """{"id":"e1","reply_later":true,"read":false,
               "reply_later_remind_at":null,"reply_later_reminded_at":"2026-10-28T13:00:00.000Z"}""",
        )
        assertTrue(withFields.isReplyLaterDue)
        assertFalse(withFields.hasPendingReplyLaterReminder)

        val old = json.decodeFromString<Email>("""{"id":"e2","reply_later":true}""")
        assertNull(old.replyLaterRemindAt)
        assertNull(old.replyLaterRemindedAt)
        assertFalse(old.isReplyLaterDue)
    }

    @Test
    fun dueNeedsUnreadAndReplyLater() {
        val due = Email(id = "a", replyLater = true, read = false, replyLaterRemindedAt = "2026-10-28T13:00:00.000Z")
        assertTrue(due.isReplyLaterDue)
        assertFalse(due.copy(read = true).isReplyLaterDue)
        assertFalse(due.copy(replyLater = false).isReplyLaterDue)
    }

    @Test
    fun pilesDecodeDueCountWithFallback() {
        val piles = json.decodeFromString<WorkflowPilesResponse>(
            """{"piles":[{"id":"reply_later","count":4,"due_count":2}]}""",
        )
        assertEquals(2, piles.piles.first().dueCount)
        val old = json.decodeFromString<WorkflowPilesResponse>("""{"piles":[{"id":"reply_later","count":4}]}""")
        assertEquals(0, old.piles.first().dueCount)
    }

    @Test
    fun setAndClearReminderLocally() {
        val email = Email(id = "a", replyLater = false, replyLaterRemindedAt = "2026-10-01T00:00:00.000Z")
        val set = email.withReplyLaterReminder("2026-10-29T13:00:00.000Z")
        assertTrue(set.replyLater)
        assertEquals("2026-10-29T13:00:00.000Z", set.replyLaterRemindAt)
        assertNull(set.replyLaterRemindedAt)
        val cleared = set.withReplyLaterReminder(null)
        assertTrue(cleared.replyLater)
        assertNull(cleared.replyLaterRemindAt)
    }

    @Test
    fun inboxSortUsesLaterOfDateAndRemindedAt() {
        val older = Email(
            id = "old",
            date = "2026-10-01T09:00:00.000Z",
            replyLater = true,
            replyLaterRemindedAt = "2026-10-28T13:00:00.000Z",
            listSection = "new",
        )
        val newer = Email(id = "new", date = "2026-10-27T09:00:00.000Z", listSection = "new")
        val ordered = EmailPaging.orderNewThenSeen(listOf(newer, older))
        assertEquals(listOf("old", "new"), ordered.map { it.id })
        assertEquals("2026-10-27T09:00:00.000Z", newer.inboxSortDate)
    }
}

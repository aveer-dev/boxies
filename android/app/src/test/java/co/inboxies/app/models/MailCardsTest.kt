package co.inboxies.app.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** Reader Code / Invite cards (AVE-177). Twin of iOS `MailCardsTest.swift` (AVE-176). */
class MailCardsTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    private val newYork = ZoneId.of("America/New_York")
    private val utc = ZoneId.of("UTC")
    private val now = Instant.parse("2026-11-06T12:00:00Z")

    private fun invite(
        start: String = "2026-11-12T15:00:00.000Z",
        end: String? = "2026-11-12T16:00:00.000Z",
        allDay: Boolean = false,
        location: String? = null,
        meetingUrl: String? = null,
        recurrence: String? = null,
        cancelled: Boolean = false,
        description: String? = null,
    ) = EmailInvite(
        title = "Design review",
        start = start,
        end = end,
        allDay = allDay,
        location = location,
        meetingUrl = meetingUrl,
        recurrence = recurrence,
        cancelled = cancelled,
        description = description,
    )

    // region Decoding

    @Test
    fun decodesOtpAndInviteFromReaderPayload() {
        val email = json.decodeFromString<Email>(
            """
            {"id":"e1","folder_id":"inbox","auth_tier":"verified",
             "otp":{"code":"482913"},
             "invite":{"method":"REQUEST","status":null,"cancelled":false,"uid":"u1","sequence":0,
               "title":"Design review","start":"2026-11-12T15:00:00.000Z","end":"2026-11-12T16:00:00.000Z",
               "allDay":false,"timezone":"America/New_York","location":"Room 4B",
               "organizer":{"email":"pat@studio.example","name":"Pat Lee"},
               "meetingUrl":"https://meet.google.com/abc-defg-hij","recurrence":"FREQ=WEEKLY;BYDAY=TH",
               "description":null}}
            """.trimIndent(),
        )
        assertEquals("482913", email.otp?.code)
        assertNotNull(email.invite)
        val invite = email.invite!!
        assertEquals("Design review", invite.title)
        assertEquals("America/New_York", invite.timezone)
        assertEquals("Pat Lee", invite.organizer?.label)
        assertEquals("https://meet.google.com/abc-defg-hij", invite.meetingUrl)
        assertFalse(invite.cancelled)
    }

    @Test
    fun absentOrNullCardsDecodeAsNull() {
        val absent = json.decodeFromString<Email>("""{"id":"e1"}""")
        assertNull(absent.otp)
        assertNull(absent.invite)
        val nulls = json.decodeFromString<Email>("""{"id":"e2","otp":null,"invite":null}""")
        assertNull(nulls.otp)
        assertNull(nulls.invite)
    }

    @Test
    fun malformedCardIsDroppedButEmailStillDecodes() {
        // Invite without its required `start`, otp as a bare string.
        val email = json.decodeFromString<Email>(
            """{"id":"e1","subject":"Hi","otp":"482913","invite":{"title":"No start"}}""",
        )
        assertEquals("Hi", email.subject)
        assertNull(email.otp)
        assertNull(email.invite)
    }

    @Test
    fun cardsSurviveCacheRoundTrip() {
        val email = Email(id = "e1", otp = EmailOtp("482913"), invite = invite(location = "Room 4B"))
        val back = AppJson.decodeFromString<Email>(AppJson.encodeToString(Email.serializer(), email))
        assertEquals(email.otp, back.otp)
        assertEquals(email.invite, back.invite)
    }

    // endregion

    // region Gating

    @Test
    fun spamAndFailedAuthGetNoCard() {
        val ok = Email(id = "a", folderId = "inbox", authTier = "verified", otp = EmailOtp("123456"))
        assertTrue(MailCards.allowed(ok))
        assertEquals(MailCards.Card.Code(EmailOtp("123456"), "a"), MailCards.card(listOf(ok)))

        val spam = ok.copy(folderId = FolderIds.SPAM)
        assertFalse(MailCards.allowed(spam))
        assertNull(MailCards.card(listOf(spam)))

        val failed = ok.copy(authTier = "failed")
        assertFalse(MailCards.allowed(failed))
        assertNull(MailCards.card(listOf(failed)))

        // Cached row: the tier only in the auth snapshot.
        val cachedFailed = ok.copy(authTier = null, auth = EmailAuth(authTier = "failed"))
        assertNull(MailCards.card(listOf(cachedFailed)))

        val unverified = ok.copy(authTier = "unverified")
        assertTrue(MailCards.allowed(unverified))
    }

    @Test
    fun newestMessageWithACardWinsAndDraftsAreSkipped() {
        val older = Email(id = "1", folderId = "inbox", otp = EmailOtp("111111"))
        val newer = Email(id = "2", folderId = "inbox", invite = invite())
        val plain = Email(id = "3", folderId = "inbox")
        val draft = Email(id = "4", folderId = FolderIds.DRAFT, otp = EmailOtp("999999"))
        val card = MailCards.card(listOf(older, newer, plain, draft))
        assertEquals("2", card?.emailId)
        assertTrue(card is MailCards.Card.Invite)

        assertNull(MailCards.card(listOf(Email(id = "x", otp = EmailOtp("  ")))))
    }

    // endregion

    // region Venue

    @Test
    fun meetingLinkWinsOverAddress() {
        val both = invite(location = "Room 4B, 200 Market St", meetingUrl = "https://meet.google.com/abc")
        assertEquals(InviteVenue.Link("https://meet.google.com/abc"), both.venue)
        // The address stays available for the tappable detail row.
        assertEquals("Room 4B, 200 Market St", both.address)
    }

    @Test
    fun linkInsideLocationIsJoin() {
        val zoom = invite(location = "Zoom: https://us02web.zoom.us/j/123?pwd=abc.")
        assertEquals(InviteVenue.Link("https://us02web.zoom.us/j/123?pwd=abc"), zoom.venue)
        assertNull(zoom.address)
    }

    @Test
    fun plainAddressIsDirections() {
        val place = invite(location = "Room 4B, 200 Market St")
        assertEquals(InviteVenue.Address("Room 4B, 200 Market St"), place.venue)
    }

    @Test
    fun noLocationPlatformNameOrNonHttpsIsNone() {
        assertEquals(InviteVenue.None, invite().venue)
        assertEquals(InviteVenue.None, invite(location = "  ").venue)
        assertEquals(InviteVenue.None, invite(location = "Microsoft Teams Meeting").venue)
        assertEquals(InviteVenue.None, invite(location = "Zoom").venue)
        assertEquals(InviteVenue.None, invite(location = "Online").venue)
        assertEquals(InviteVenue.None, invite(meetingUrl = "http://insecure.example/join").venue)
        assertEquals(InviteVenue.None, invite(meetingUrl = "zoommtg://zoom.us/join").venue)
    }

    @Test
    fun locationEqualToMeetingUrlIsNotShownTwice() {
        val same = invite(location = "https://meet.google.com/abc", meetingUrl = "https://meet.google.com/abc")
        assertNull(same.displayLocation)
        assertEquals(InviteVenue.Link("https://meet.google.com/abc"), same.venue)
    }

    @Test
    fun directionsUriEncodesTheAddress() {
        assertEquals(
            "geo:0,0?q=Room%204B%2C%20200%20Market%20St%20%26%20Co%2B",
            InviteVenue.directionsUri(" Room 4B, 200 Market St & Co+ "),
        )
    }

    // endregion

    // region Times

    @Test
    fun utcInstantShowsInViewerZone() {
        val inv = invite()
        assertEquals(
            "Thu, Nov 12 · 10:00 – 11:00 AM",
            InviteTime.summary(inv, newYork, Locale.US, now),
        )
        assertEquals("Nov 12 · 10:00 AM", InviteTime.compact(inv, newYork, Locale.US, now))
        assertEquals("Nov 12 · 15:00", InviteTime.compact(inv, utc, Locale.US, now, is24Hour = true))
    }

    @Test
    fun rangeAcrossNoonKeepsBothPeriods() {
        val inv = invite(start = "2026-11-12T16:30:00Z", end = "2026-11-12T18:00:00Z")
        assertEquals("Thu, Nov 12 · 11:30 AM – 1:00 PM", InviteTime.summary(inv, newYork, Locale.US, now))
    }

    @Test
    fun floatingTimeIsWallClockInAnyZone() {
        val inv = invite(start = "2026-11-12T09:00:00", end = "2026-11-12T09:30:00")
        assertTrue(InviteTime.isFloating(inv.start))
        assertEquals("Thu, Nov 12 · 9:00 – 9:30 AM", InviteTime.summary(inv, newYork, Locale.US, now))
        assertEquals("Thu, Nov 12 · 9:00 – 9:30 AM", InviteTime.summary(inv, utc, Locale.US, now))
    }

    @Test
    fun allDayEndIsExclusive() {
        val oneDay = invite(start = "2026-11-05", end = "2026-11-06", allDay = true)
        assertEquals("Thu, Nov 5 · All day", InviteTime.summary(oneDay, newYork, Locale.US, now))
        assertEquals("Nov 5", InviteTime.compact(oneDay, newYork, Locale.US, now))
        assertEquals(LocalDate.of(2026, 11, 5), InviteTime.span(oneDay, newYork)?.lastDay)

        val threeDays = invite(start = "2026-11-05", end = "2026-11-08", allDay = true)
        assertEquals("Thu, Nov 5 – Sat, Nov 7 · All day", InviteTime.summary(threeDays, newYork, Locale.US, now))
    }

    @Test
    fun yearShownOutsideTheCurrentYear() {
        val next = invite(start = "2027-01-04T15:00:00Z", end = "2027-01-04T16:00:00Z")
        assertEquals("Jan 4, 2027 · 10:00 AM", InviteTime.compact(next, newYork, Locale.US, now))
        assertEquals("Mon, Jan 4, 2027 · 10:00 – 11:00 AM", InviteTime.summary(next, newYork, Locale.US, now))
    }

    @Test
    fun noEndAndMultiDayTimed() {
        val open = invite(end = null)
        assertEquals("Thu, Nov 12 · 10:00 AM", InviteTime.summary(open, newYork, Locale.US, now))
        val overnight = invite(start = "2026-11-13T03:00:00Z", end = "2026-11-13T07:00:00Z")
        assertEquals(
            "Thu, Nov 12, 10:00 PM – Fri, Nov 13, 2:00 AM",
            InviteTime.summary(overnight, newYork, Locale.US, now),
        )
    }

    @Test
    fun parsesOffsetsAndRejectsGarbage() {
        assertEquals(
            Instant.parse("2026-11-12T15:00:00Z"),
            InviteTime.parse("2026-11-12T10:00:00-0500", utc)?.toInstant(),
        )
        assertNull(InviteTime.parse("next Tuesday", utc))
        assertNull(InviteTime.summary(invite(start = "soon"), utc, Locale.US, now))
    }

    // endregion

    // region Recurrence

    @Test
    fun simpleRulesMap() {
        val weekly = InviteRecurrence.parse("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;WKST=MO")
        assertEquals(InviteRecurrence.Frequency.WEEKLY, weekly?.frequency)
        assertEquals(listOf(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY), weekly?.weekdays)
        assertEquals("FREQ=WEEKLY;BYDAY=TU,TH", weekly?.rrule)

        assertEquals("FREQ=DAILY;INTERVAL=2;COUNT=5", InviteRecurrence.parse("FREQ=DAILY;INTERVAL=2;COUNT=5")?.rrule)
        assertEquals(
            "FREQ=MONTHLY;UNTIL=20261231T235959Z",
            InviteRecurrence.parse("freq=monthly;until=20261231T235959Z")?.rrule,
        )
        assertEquals("Repeats weekly", InviteRecurrence.label("FREQ=WEEKLY;BYDAY=TH"))
        assertEquals("Repeats every 2 weeks", InviteRecurrence.label("FREQ=WEEKLY;INTERVAL=2"))
        assertNull(InviteRecurrence.label(null))
    }

    @Test
    fun complexRulesAreLeftOff() {
        assertNull(InviteRecurrence.parse("FREQ=MONTHLY;BYDAY=2TU"))
        assertNull(InviteRecurrence.parse("FREQ=MONTHLY;BYMONTHDAY=15"))
        assertNull(InviteRecurrence.parse("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=-1"))
        assertNull(InviteRecurrence.parse("FREQ=DAILY;COUNT=3;UNTIL=20261231"))
        assertNull(InviteRecurrence.parse("FREQ=HOURLY"))
        assertNull(InviteRecurrence.parse("FREQ=DAILY;INTERVAL=0"))
        assertEquals("Repeats", InviteRecurrence.label("FREQ=MONTHLY;BYDAY=2TU"))
    }

    // endregion

    // region Calendar insert

    @Test
    fun calendarInsertForTimedEvent() {
        val inv = invite(
            location = "Room 4B",
            meetingUrl = "https://meet.google.com/abc",
            recurrence = "FREQ=WEEKLY;BYDAY=TH",
            description = "Bring one screen.",
        )
        val insert = CalendarInsert.of(inv, newYork)!!
        assertEquals(Instant.parse("2026-11-12T15:00:00Z").toEpochMilli(), insert.beginMillis)
        assertEquals(Instant.parse("2026-11-12T16:00:00Z").toEpochMilli(), insert.endMillis)
        assertFalse(insert.allDay)
        assertEquals("Room 4B", insert.location)
        assertEquals("Join: https://meet.google.com/abc\n\nBring one screen.", insert.description)
        assertEquals("FREQ=WEEKLY;BYDAY=TH", insert.rrule)
    }

    @Test
    fun calendarInsertForAllDayUsesExclusiveLocalMidnights() {
        val inv = invite(start = "2026-11-05", end = "2026-11-08", allDay = true, recurrence = "FREQ=MONTHLY;BYDAY=2TU")
        val insert = CalendarInsert.of(inv, newYork)!!
        assertTrue(insert.allDay)
        assertEquals(LocalDate.of(2026, 11, 5).atStartOfDay(newYork).toInstant().toEpochMilli(), insert.beginMillis)
        assertEquals(LocalDate.of(2026, 11, 8).atStartOfDay(newYork).toInstant().toEpochMilli(), insert.endMillis)
        assertNull(insert.rrule)
    }

    @Test
    fun calendarInsertDefaultsToAnHourAndSkipsCancelled() {
        val open = CalendarInsert.of(invite(end = null), utc)!!
        assertEquals(3_600_000L, open.endMillis - open.beginMillis)
        assertNull(CalendarInsert.of(invite(cancelled = true), utc))
        assertNull(CalendarInsert.of(invite(start = "garbage"), utc))
    }

    // endregion
}

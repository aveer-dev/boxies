package co.inboxies.app.models

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
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

    /** AVE-216: same fixtures as web (`workers/test/meeting-links.test.mjs`) and iOS. */
    @Test
    fun joinOnlyForKnownMeetingLinksMatchesSharedFixtures() {
        // Gradle runs unit tests from the module directory (android/app).
        val fixtures = Json.parseToJsonElement(File("../../shared/meeting-links.fixtures.json").readText()).jsonObject
        val hosts = fixtures.getValue("hosts").jsonObject
        assertEquals(hosts.getValue("exact").jsonArray.map { it.jsonPrimitive.content }, MeetingLinks.exactHosts)
        assertEquals(hosts.getValue("withSubdomains").jsonArray.map { it.jsonPrimitive.content }, MeetingLinks.subdomainHosts)
        val urls = fixtures.getValue("urls").jsonArray
        assertTrue(urls.size >= 15)
        for (element in urls) {
            val case = element.jsonObject
            val url = case.getValue("url").jsonPrimitive.content
            val join = case["join"]?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull
            val label = "$url ${case["note"]?.jsonPrimitive?.content ?: ""}"
            assertEquals(label, join, MeetingLinks.knownUrl(url))
            // Even the Worker's meetingUrl is checked again.
            assertEquals("meetingUrl $label", join, invite(meetingUrl = url).joinLink)
        }
        for (element in fixtures.getValue("locations").jsonArray) {
            val case = element.jsonObject
            val location = case.getValue("location").jsonPrimitive.content
            val join = case["join"]?.takeIf { it != JsonNull }?.jsonPrimitive?.contentOrNull
            val inv = invite(location = location)
            assertEquals(location, join, inv.joinLink)
            if (join != null) {
                assertEquals(location, InviteVenue.Link(join), inv.venue)
            } else {
                assertFalse(location, inv.venue is InviteVenue.Link)
            }
        }
    }

    @Test
    fun unknownLocationLinkIsTextNotJoinOrCalendarLink() {
        val evil = "https://zoom-us.evil.test/j/123?login=1"
        val stranger = invite(location = evil)
        assertEquals(InviteVenue.None, stranger.venue)
        val insert = CalendarInsert.of(stranger, newYork)!!
        assertEquals(evil, insert.location)
        assertNull(insert.description)
        // Even as the Worker's meetingUrl, it never becomes the calendar entry's link.
        val claimed = CalendarInsert.of(invite(meetingUrl = evil), newYork)!!
        assertNull(claimed.location)
        assertNull(claimed.description)
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

    // region Free/busy (AVE-206)

    private val tokyo = ZoneId.of("Asia/Tokyo")

    private fun ms(iso: String) = Instant.parse(iso).toEpochMilli()

    private fun timed(
        title: String = "Design review",
        start: String = "2026-11-12T15:00:00.000Z",
        end: String? = "2026-11-12T16:00:00.000Z",
        cancelled: Boolean = false,
        timezone: String? = "America/New_York",
        recurrence: String? = null,
    ) = EmailInvite(
        title = title,
        start = start,
        end = end,
        cancelled = cancelled,
        timezone = timezone,
        recurrence = recurrence,
    )

    private fun busy(
        title: String,
        start: String,
        end: String,
        allDay: Boolean = false,
        free: Boolean = false,
        declined: Boolean = false,
        cancelled: Boolean = false,
    ) = CalendarBusyEvent(title, ms(start), ms(end), allDay, free, declined, cancelled)

    @Test
    fun freeWhenNothingOverlaps() {
        val events = listOf(
            busy("Standup", "2026-11-12T14:00:00Z", "2026-11-12T15:00:00Z"), // ends as the invite starts
            busy("Lunch", "2026-11-12T16:00:00Z", "2026-11-12T17:00:00Z"), // starts as it ends
        )
        assertEquals(InviteAvailability.Free, InviteAvailability.check(timed(), events, utc))
        assertEquals(InviteAvailability.Free, InviteAvailability.check(timed(), emptyList(), utc))
        assertEquals("You\u2019re free", InviteAvailability.Free.label)
    }

    @Test
    fun conflictNamesTheEarliestAndCountsTheRest() {
        val events = listOf(
            busy("1:1 with Sam", "2026-11-12T15:45:00Z", "2026-11-12T16:15:00Z"),
            busy("Team sync", "2026-11-12T15:30:00Z", "2026-11-12T16:00:00Z"),
            busy("All hands", "2026-11-12T14:00:00Z", "2026-11-12T18:00:00Z"),
        )
        val result = InviteAvailability.check(timed(), events, utc)
        assertEquals(InviteAvailability.Conflict("All hands", 2), result)
        assertEquals("Conflicts with All hands +2 more", result?.label)
        assertEquals("Conflicts with Team sync", InviteAvailability.Conflict("Team sync", 0).label)
    }

    @Test
    fun freeDeclinedCancelledAndAllDayEventsDoNotBlock() {
        val events = listOf(
            busy("Focus time", "2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z", free = true),
            busy("Offsite prep", "2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z", declined = true),
            busy("Old sync", "2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z", cancelled = true),
            busy("Holiday", "2026-11-12T00:00:00Z", "2026-11-13T00:00:00Z", allDay = true),
        )
        assertEquals(InviteAvailability.Free, InviteAvailability.check(timed(), events, utc))
    }

    @Test
    fun theInviteItselfReadsAsInCalendar() {
        val events = listOf(
            busy("Team sync", "2026-11-12T15:30:00Z", "2026-11-12T16:00:00Z"),
            busy(" design REVIEW ", "2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z"),
        )
        assertEquals(InviteAvailability.InCalendar, InviteAvailability.check(timed(), events, utc))
        // Same title at another time is a real conflict.
        val moved = listOf(busy("Design review", "2026-11-12T15:30:00Z", "2026-11-12T16:30:00Z"))
        assertEquals(InviteAvailability.Conflict("Design review", 0), InviteAvailability.check(timed(), moved, utc))
    }

    @Test
    fun inviteWithoutEndCountsAsOneHour() {
        val window = InviteAvailability.window(timed(end = null), utc)!!
        assertEquals(3_600_000L, window.endMillis - window.beginMillis)
        val events = listOf(busy("Late call", "2026-11-12T15:50:00Z", "2026-11-12T16:30:00Z"))
        assertEquals(InviteAvailability.Conflict("Late call", 0), InviteAvailability.check(timed(end = null), events, utc))
    }

    @Test
    fun allDayAndCancelledInvitesAreNotChecked() {
        val allDay = EmailInvite(title = "Offsite", start = "2026-11-12", end = "2026-11-13", allDay = true)
        assertNull(InviteAvailability.window(allDay, newYork))
        assertNull(InviteAvailability.check(allDay, emptyList(), newYork))
        assertNull(InviteAvailability.check(timed(cancelled = true), emptyList(), utc))
        assertNull(InviteAvailability.check(timed(start = "garbage"), emptyList(), utc))
    }

    @Test
    fun untitledConflictReadsAsAnotherEvent() {
        val events = listOf(busy("  ", "2026-11-12T15:00:00Z", "2026-11-12T15:30:00Z"))
        assertEquals("Conflicts with another event", InviteAvailability.check(timed(), events, utc)?.label)
    }

    @Test
    fun floatingInviteIsCheckedInTheViewersZone() {
        val invite = EmailInvite(title = "Dentist", start = "2026-11-12T10:00:00", end = "2026-11-12T11:00:00")
        // 10:00 in New York is 15:00Z.
        val events = listOf(busy("Call", "2026-11-12T15:15:00Z", "2026-11-12T15:45:00Z"))
        assertEquals(InviteAvailability.Conflict("Call", 0), InviteAvailability.check(invite, events, newYork))
        assertEquals(InviteAvailability.Free, InviteAvailability.check(invite, events, tokyo))
    }

    @Test
    fun directEventKeepsTheOrganizersZoneAndDtend() {
        val values = CalendarEventValues.of(timed(), newYork)!!
        assertEquals(ms("2026-11-12T15:00:00Z"), values.dtStart)
        assertEquals(ms("2026-11-12T16:00:00Z"), values.dtEnd)
        assertNull(values.duration)
        assertEquals("America/New_York", values.timezone)
        assertFalse(values.allDay)
        assertEquals("Design review", values.title)
    }

    @Test
    fun directRepeatingEventUsesDurationNotDtend() {
        val values = CalendarEventValues.of(timed(recurrence = "FREQ=WEEKLY;BYDAY=TH"), newYork)!!
        assertNull(values.dtEnd)
        assertEquals("P3600S", values.duration)
        assertEquals("FREQ=WEEKLY;BYDAY=TH", values.rrule)
    }

    @Test
    fun directAllDayEventIsStoredAtUtcMidnights() {
        val allDay = EmailInvite(title = "Offsite", start = "2026-11-05", end = "2026-11-07", allDay = true)
        val values = CalendarEventValues.of(allDay, newYork)!!
        assertTrue(values.allDay)
        assertEquals("UTC", values.timezone)
        assertEquals(ms("2026-11-05T00:00:00Z"), values.dtStart)
        assertEquals(ms("2026-11-07T00:00:00Z"), values.dtEnd)
        val repeating = CalendarEventValues.of(allDay.copy(recurrence = "FREQ=YEARLY"), newYork)!!
        assertEquals("P2D", repeating.duration)
        assertNull(repeating.dtEnd)
    }

    @Test
    fun directFloatingEventUsesTheViewersZone() {
        val floating = EmailInvite(title = "Dentist", start = "2026-11-12T10:00:00", end = "2026-11-12T11:00:00", timezone = "Asia/Tokyo")
        assertEquals("America/New_York", CalendarEventValues.of(floating, newYork)!!.timezone)
        val badZone = timed(timezone = "Not/AZone")
        assertEquals("UTC", CalendarEventValues.of(badZone, newYork)!!.timezone)
        assertNull(CalendarEventValues.of(timed(cancelled = true), newYork))
    }

    // endregion
}

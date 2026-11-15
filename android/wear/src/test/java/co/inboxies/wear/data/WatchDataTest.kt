package co.inboxies.wear.data

import co.inboxies.wear.preview.WearPreviewMode
import co.inboxies.wear.ui.ReplyAttempt
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

class WatchMailTextTest {
    @Test
    fun stripsHtmlToReadableText() {
        val html = "<html><head><style>p{}</style><title>x</title></head><body><p>Hi Ada,</p>" +
            "<p>Line one<br>Line two</p><ul><li>One</li><li>Two</li></ul><!-- hidden -->" +
            "<script>alert(1)</script><p>Tom &amp; Jerry &#8212; &#x2603; &nbsp;&hellip;</p></body></html>"
        assertEquals("Hi Ada,\nLine one\nLine two\n• One\n• Two\nTom & Jerry — ☃ …", WatchMailText.plainText(html))
    }

    @Test
    fun keepsPlainTextAndCollapsesBlankLines() {
        assertEquals("a b\n\nc", WatchMailText.plainText("a   b\r\n\r\n\r\n\r\nc  "))
        assertEquals("", WatchMailText.plainText(null))
        assertEquals("5 < 6", WatchMailText.plainText("5 < 6"))
    }

    @Test
    fun trimsLongBodiesOnAWordBoundary() {
        val text = "word ".repeat(1_000)
        val trimmed = WatchMailText.plainText(text)
        assertTrue(trimmed.length <= WatchMailText.BODY_LIMIT + 1)
        assertTrue(trimmed.endsWith("word…"))
    }

    @Test
    fun senderName() {
        assertEquals("Maya Chen", WatchMailText.senderName(" Maya Chen ", "maya@northwind.co"))
        assertEquals("Maya", WatchMailText.senderName(null, "\"Maya\" <maya@northwind.co>"))
        assertEquals("maya@northwind.co", WatchMailText.senderName("", "maya@northwind.co"))
        assertEquals("Unknown sender", WatchMailText.senderName(null, " "))
    }

    @Test
    fun cannedRepliesMatchThePhoneNotification() {
        assertEquals(listOf("Thanks!", "Got it, will reply soon", "Can we talk later?", "👍"), WatchMailText.cannedReplies)
    }

    @Test
    fun shortDates() {
        val zone = ZoneId.of("Europe/London")
        val now = Instant.parse("2026-11-14T15:00:00Z")
        assertEquals("Tue", WatchDates.short("2026-11-10T09:00:00Z", now, zone, Locale.UK))
        assertEquals("12 Oct", WatchDates.short("2026-10-12T09:00:00Z", now, zone, Locale.UK))
        assertTrue(WatchDates.short("2026-11-14T14:05:00Z", now, zone, Locale.UK).contains("14:05"))
        assertEquals("", WatchDates.short("not a date", now, zone, Locale.UK))
        assertEquals("", WatchDates.short(null, now, zone, Locale.UK))
    }
}

class WatchApiTest {
    @Test
    fun sessionEndedOnlyOn401OrTheExpiredTokenMessage() {
        assertTrue(WatchApi.isSessionEnded(401, ""))
        assertTrue(WatchApi.isSessionEnded(403, """{"error":"Invalid or expired mobile session token"}"""))
        assertFalse(WatchApi.isSessionEnded(403, """{"error":"Forbidden"}"""))
        assertFalse(WatchApi.isSessionEnded(500, ""))
    }

    @Test
    fun errorMessageFromTheWorkerBody() {
        assertEquals("Mailbox not found", WatchApi.errorMessage("""{"error":"Mailbox not found"}"""))
        assertEquals("", WatchApi.errorMessage("<html>"))
    }

    @Test
    fun urlsEscapeIdsAndSortQueries() {
        val path = "/api/v1/mailboxes/${"hello@ada.studio".pathSegment()}/emails/${"a/b c".pathSegment()}"
        assertEquals("/api/v1/mailboxes/hello%40ada.studio/emails/a%2Fb%20c", path)
        assertEquals(
            "https://inboxies.email/api/v1/mailboxes/x/emails?folder=inbox&limit=20",
            WatchApi.buildUrl("https://inboxies.email/", "/api/v1/mailboxes/x/emails", mapOf("limit" to "20", "folder" to "inbox")),
        )
        assertNull(WatchApi.buildUrl("not a url", "/x"))
    }

    @Test
    fun spamTeachesTheSenderAndArchiveDoesNot() {
        val spam = WatchApi.moveBody(WatchMoveTarget.SPAM)
        assertEquals("spam", spam["folderId"]!!.jsonPrimitive.content)
        assertEquals("true", spam["setSenderPreference"]!!.jsonPrimitive.content)
        val archive = WatchApi.moveBody(WatchMoveTarget.ARCHIVE)
        assertEquals("archive", archive["folderId"]!!.jsonPrimitive.content)
        assertNull(archive["setSenderPreference"])
        assertNull(archive["unsubscribe"])
    }

    @Test
    fun replyLaterIsTomorrowAtNineLocal() {
        val now = ZonedDateTime.of(2026, 11, 14, 22, 30, 0, 0, ZoneId.of("America/New_York"))
        val body = WatchApi.replyLaterBody(now)
        assertEquals("true", body["reply_later"]!!.jsonPrimitive.content)
        assertEquals("2026-11-15T14:00:00.000Z", body["reply_later_remind_at"]!!.jsonPrimitive.content)
    }

    @Test
    fun quickReplyCarriesTheTimeZone() {
        val body = WatchApi.quickReplyBody("Thanks!", timeZoneId = "Europe/Lagos")
        assertEquals("Thanks!", body["text"]!!.jsonPrimitive.content)
        assertEquals("Europe/Lagos", body["quote_time_zone"]!!.jsonPrimitive.content)
    }

    @Test
    fun decodesServerRows() {
        val list = WatchApi.json.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(WatchEmail.serializer()),
            """[{"id":"e1","thread_id":"t1","subject":" ","sender":"a@b.c","sender_name":null,"date":"2026-11-14T10:00:00Z",
               "read":true,"reply_later":null,"thread_count":3,"thread_unread_count":1,"folder_id":"inbox","extra":{}}]""",
        )
        val row = list.single()
        assertTrue(row.isUnread)
        assertEquals("(No subject)", row.displaySubject)
        assertEquals("a@b.c", row.displaySender)
        assertFalse(row.replyLater)
        assertFalse(row.withRead(true).isUnread)
        assertTrue(row.withRead(false).isUnread)
    }
}

class ReplyAttemptTest {
    @Test
    fun retryingTheSameTextReusesTheKey() {
        val first = ReplyAttempt.next("Thanks!", null)
        assertSame(first, ReplyAttempt.next("Thanks!", first))
        val other = ReplyAttempt.next("Got it", first)
        assertNotEquals(first.key, other.key)
    }
}

class WearPreviewModeTest {
    @Test
    fun parsesTheCliNameOrABooleanExtra() {
        assertEquals(WearPreviewMode.Reply, WearPreviewMode.parse("reply") { false })
        assertEquals(WearPreviewMode.Connect, WearPreviewMode.parse(null) { it == "previewWatchConnect" })
        assertNull(WearPreviewMode.parse(null) { false })
        assertNull(WearPreviewMode.parse("nope") { false })
    }

    @Test
    fun namesAreUnique() {
        assertEquals(WearPreviewMode.entries.size, WearPreviewMode.entries.map { it.wire }.toSet().size)
        assertEquals(WearPreviewMode.entries.size, WearPreviewMode.entries.map { it.extra }.toSet().size)
    }

    /** `run-wear-preview.sh` launches every mode with the extra the app reads. */
    @Test
    fun runWearPreviewScriptCoversEveryMode() {
        val script = listOf(File("../scripts/run-wear-preview.sh"), File("scripts/run-wear-preview.sh"))
            .first { it.exists() }
            .readText()
        val missing = WearPreviewMode.entries.filterNot { mode ->
            Regex("""(^|\|)\s*${Regex.escape(mode.wire)}\|.*extra=${Regex.escape(mode.extra)};""", RegexOption.MULTILINE)
                .containsMatchIn(script)
        }
        assertEquals(emptyList<WearPreviewMode>(), missing)
    }
}

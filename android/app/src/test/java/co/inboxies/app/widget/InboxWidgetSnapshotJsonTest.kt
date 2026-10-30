package co.inboxies.app.widget

import co.inboxies.app.models.Email
import co.inboxies.app.models.Mailbox
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

/** AVE-150: the widget snapshot's JSON (same shape as iOS) and how the app builds it. */
class InboxWidgetSnapshotJsonTest {
    private val utc = ZoneOffset.UTC
    private val now = ZonedDateTime.of(2026, 10, 28, 9, 41, 0, 0, utc)

    private fun snapshot(subject: String = "Q3 roadmap", updatedAt: ZonedDateTime = now) = InboxWidgetSnapshot(
        mailboxId = "mb-1",
        mailboxAddress = "you@inboxies.email",
        newCount = 7,
        replyLaterCount = 2,
        threads = listOf(
            InboxWidgetSnapshot.Thread("t-1", "Maya Chen", subject, now.minusMinutes(4)),
            InboxWidgetSnapshot.Thread("t-2", "Jonas \"JW\" Weber", "Dinner on Friday? ☕️", now.minusMinutes(38)),
        ),
        updatedAt = updatedAt,
    )

    @Test
    fun roundTripsThroughJson() {
        val original = snapshot()
        assertEquals(original, InboxWidgetSnapshotJson.decode(InboxWidgetSnapshotJson.encode(original), utc))
    }

    @Test
    fun sampleRoundTripsInTheSystemZone() {
        val sample = InboxWidgetSnapshot.SampleHasMail
        assertEquals(sample, InboxWidgetSnapshotJson.decode(InboxWidgetSnapshotJson.encode(sample)))
    }

    @Test
    fun encodesTheIosShape() {
        val json = InboxWidgetSnapshotJson.encode(snapshot())
        // Sorted keys, dates as plain seconds since 1970 (Swift JSONEncoder, .secondsSince1970, .sortedKeys).
        assertTrue(json.startsWith("{\"mailboxAddress\":\"you@inboxies.email\",\"mailboxId\":\"mb-1\",\"newCount\":7,\"replyLaterCount\":2,\"threads\":[{\"id\":\"t-1\",\"receivedAt\":1793180220,\"senderName\":\"Maya Chen\""))
        assertTrue(json.endsWith(",\"updatedAt\":1793180460}"))
        assertFalse(json.contains("E9"))
    }

    @Test
    fun decodesWhatIosWrites() {
        val ios = """{"mailboxAddress":"a@b.c","mailboxId":"m","newCount":1,"replyLaterCount":0,""" +
            """"threads":[{"id":"t","receivedAt":1793180220.5,"senderName":"S","subject":"Hi"}],"updatedAt":1793180460}"""
        val decoded = InboxWidgetSnapshotJson.decode(ios, utc)!!
        assertEquals("m", decoded.mailboxId)
        assertEquals(1, decoded.threads.size)
        assertEquals(500_000_000, decoded.threads[0].receivedAt.nano)
        assertEquals(now, decoded.updatedAt)
    }

    @Test
    fun keepsMillisecondPrecision() {
        val precise = snapshot(updatedAt = now.plusNanos(123_000_000))
        val json = InboxWidgetSnapshotJson.encode(precise)
        assertTrue(json.endsWith("\"updatedAt\":1793180460.123}"))
        assertEquals(precise, InboxWidgetSnapshotJson.decode(json, utc))
    }

    @Test
    fun corruptJsonIsNull() {
        assertNull(InboxWidgetSnapshotJson.decode("not json"))
        assertNull(InboxWidgetSnapshotJson.decode("""{"mailboxId":"m"}"""))
    }

    @Test
    fun decodingCapsThreadsAtFive() {
        val many = snapshot().copy(threads = (1..7).map { InboxWidgetSnapshot.Thread("t$it", "S$it", "Hi", now) })
        assertEquals(InboxWidgetSnapshot.MAX_THREADS, InboxWidgetSnapshotJson.decode(InboxWidgetSnapshotJson.encode(many), utc)!!.threads.size)
    }

    @Test
    fun contentKeyIgnoresUpdatedAtOnly() {
        val base = snapshot()
        assertEquals(base.contentKey, snapshot(updatedAt = now.plusHours(1)).contentKey)
        assertTrue(base.hasSameContent(snapshot(updatedAt = now.plusHours(1))))
        assertNotEquals(base.contentKey, snapshot(subject = "Q4 roadmap").contentKey)
        assertNotEquals(base.contentKey, base.copy(newCount = 8).contentKey)
        assertNotEquals(base.contentKey, base.copy(replyLaterCount = 3).contentKey)
        assertNotEquals(base.contentKey, base.copy(threads = base.threads.reversed()).contentKey)
    }

    @Test
    fun makeUsesTheInboxNewSection() {
        val mailbox = Mailbox(id = "mb-1", email = "you@inboxies.email", name = "You")
        val rows = (1..7).map { minute ->
            Email(
                id = "e$minute",
                subject = if (minute == 3) "" else "Subject $minute",
                sender = "sender$minute@example.com",
                senderName = "Sender $minute",
                date = "2026-10-28T09:%02d:00Z".format(minute),
                listSection = "new",
            )
        } + Email(id = "seen", subject = "Old", sender = "old@example.com", date = "2026-10-28T09:59:00Z", listSection = "seen")
        val snapshot = InboxWidgetSnapshot.make(mailbox, rows, serverNewCount = 12, replyLaterCount = -1, now = now)
        assertEquals("mb-1", snapshot.mailboxId)
        assertEquals(12, snapshot.newCount)
        assertEquals(0, snapshot.replyLaterCount)
        // Newest New first, Seen never shows, five at most.
        assertEquals(listOf("e7", "e6", "e5", "e4", "e3"), snapshot.threads.map { it.id })
        assertEquals("(no subject)", snapshot.threads.last().subject)
        assertEquals(ZonedDateTime.of(2026, 10, 28, 9, 7, 0, 0, ZoneId.of("UTC")).toInstant(), snapshot.threads.first().receivedAt.toInstant())
    }

    @Test
    fun makeCountsRowsWhenTheServerTotalIsUnknown() {
        val mailbox = Mailbox(id = "mb-1", email = "you@inboxies.email", name = "You")
        val rows = listOf(Email(id = "e1", sender = "a@b.c", date = "2026-10-28T09:00:00Z", listSection = "new"))
        val snapshot = InboxWidgetSnapshot.make(mailbox, rows, serverNewCount = null, replyLaterCount = 3, now = now)
        assertEquals(1, snapshot.newCount)
        assertEquals(3, snapshot.replyLaterCount)
        assertTrue(InboxWidgetSnapshot.make(mailbox, emptyList(), serverNewCount = 0, replyLaterCount = 0, now = now).isInboxZero)
    }
}

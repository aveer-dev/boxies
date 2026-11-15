package co.inboxies.wear.glance

import co.inboxies.wear.data.WatchApi
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchFolder
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchGlanceTest {
    private fun row(id: String, sender: String, read: Boolean = false, threadUnread: Int? = null) =
        WatchEmail(id = id, sender = sender, read = read, threadUnreadCount = threadUnread)

    @Test
    fun snapshotPrefersTheServerCountAndKeepsTheNewestThreeUnreadSenders() {
        val emails = listOf(
            row("1", "Maya Chen <maya@northwind.co>"),
            row("2", "ops@ada.studio", read = true),
            row("3", "Maya Chen <maya@northwind.co>"),
            row("4", "Lin <lin@x.io>", read = true, threadUnread = 2),
            row("5", "  "),
            row("6", "Sam <sam@y.io>"),
            row("7", "Theo <theo@z.io>"),
        )
        val s = WatchGlance.snapshot("mb", inboxFolderUnread = 40, emails = emails, now = 5)
        assertEquals(40, s.unreadCount)
        // Distinct, display names, blank sender shown as the fallback name.
        assertEquals(listOf("Maya Chen", "Lin", "Unknown sender"), s.senders)
        assertEquals(5L, s.updatedAt)

        assertEquals(6, WatchGlance.snapshot("mb", null, emails, 0).unreadCount)
    }

    @Test
    fun inboxZeroHasNoSendersAndCountsAreClamped() {
        val zero = WatchGlanceSnapshot.of("mb", -3, listOf("Maya"), 0)
        assertEquals(0, zero.unreadCount)
        assertTrue(zero.senders.isEmpty())
        // Never more senders than unread conversations.
        assertEquals(listOf("A"), WatchGlanceSnapshot.of("mb", 1, listOf("A", "B"), 0).senders)
    }

    @Test
    fun formatting() {
        assertEquals("0", WatchGlance.countText(0))
        assertEquals("99", WatchGlance.countText(99))
        assertEquals("99+", WatchGlance.countText(100))
        assertEquals("No unread mail", WatchGlance.summary(0))
        assertEquals("1 unread", WatchGlance.summary(1))
        assertEquals("99+ unread", WatchGlance.summary(250))
    }

    @Test
    fun staleness() {
        val s = WatchGlanceSnapshot.of("mb", 1, emptyList(), updatedAt = 1_000_000)
        assertTrue(WatchGlance.isStale(null, 0))
        assertFalse(WatchGlance.isStale(s, 1_000_000 + WatchGlance.STALE_AFTER_MILLIS))
        assertTrue(WatchGlance.isStale(s, 1_000_001 + WatchGlance.STALE_AFTER_MILLIS))
        // A clock that went backwards: refresh rather than trust it.
        assertTrue(WatchGlance.isStale(s, 0))
    }

    @Test
    fun publisherRedrawsOnlyWhenContentChangesAndClearsOnce() {
        val storage = MemoryWatchGlanceStorage()
        var redraws = 0
        val publisher = WatchGlancePublisher(storage) { redraws += 1 }

        publisher.publish(WatchGlanceSnapshot.of("mb", 2, listOf("A"), 1))
        publisher.publish(WatchGlanceSnapshot.of("mb", 2, listOf("A"), 2))
        assertEquals(1, redraws)
        // The newer time is still written, so it isn't refreshed again as stale.
        assertEquals(2L, publisher.read()?.updatedAt)

        publisher.publish(WatchGlanceSnapshot.of("mb", 3, listOf("A"), 3))
        assertEquals(2, redraws)

        publisher.clear()
        publisher.clear()
        assertNull(publisher.read())
        assertEquals(3, redraws)
    }

    @Test
    fun foldersDecodeThreadCountsWithAMessageCountFallback() {
        val folders = WatchApi.json.decodeFromString(
            ListSerializer(WatchFolder.serializer()),
            """[{"id":"inbox","name":"Inbox","unreadCount":9,"unreadThreadCount":4},{"id":"spam","name":"Spam","unreadCount":2}]""",
        )
        assertEquals(4, folders[0].unread)
        assertEquals(2, folders[1].unread)
    }
}

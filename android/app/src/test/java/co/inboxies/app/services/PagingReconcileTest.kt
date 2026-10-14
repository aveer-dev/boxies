package co.inboxies.app.services

import co.inboxies.app.models.Email
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Paging generations, cache reconciliation and inbox ordering across pages. */
class PagingReconcileTest {
    private val inbox = EmailListScope("a@x.com", "inbox")

    private fun row(
        id: String,
        date: String,
        section: String? = "seen",
        threadId: String? = null,
        threadCount: Int? = null,
        read: Boolean = section != "new",
    ) = Email(
        id = id,
        threadId = threadId,
        subject = id,
        sender = "s@x.com",
        recipient = "r@x.com",
        date = date,
        read = read,
        starred = false,
        threadCount = threadCount,
        listSection = section,
    )

    private fun day(d: Int) = "2026-09-%02dT00:00:00Z".format(d)

    // ── Generation ────────────────────────────────────────────────────

    @Test
    fun restartInvalidatesAnInFlightPage() {
        val page1 = EmailPagingState().restarted(inbox, received = 25, totalCount = 100, loadedCount = 25)
        val generation = page1.generation
        val loading = page1.beginLoadMore()
        assertTrue(loading.accepts(inbox, generation))

        // Pull-to-refresh lands while page 2 is out.
        val refreshed = loading.restarted(inbox, received = 25, totalCount = 100, loadedCount = 25)
        assertFalse(refreshed.accepts(inbox, generation))
        assertFalse(refreshed.isLoadingMore)
        assertFalse(loading.cleared().accepts(inbox, generation))
        // Other list, same generation number: still rejected.
        assertFalse(loading.accepts(EmailListScope("a@x.com", "sent"), generation))
    }

    @Test
    fun inFlightPageCountsAsLoadedForSilentRefreshes() {
        val page1 = EmailPagingState().restarted(inbox, received = 25, totalCount = 100, loadedCount = 25)
        assertFalse(page1.keepsLoadedPages(inbox))
        assertTrue(page1.beginLoadMore().keepsLoadedPages(inbox))
        val page2 = page1.beginLoadMore().afterPage(2, received = 25, totalCount = 100, loadedCount = 50)
        assertTrue(page2.keepsLoadedPages(inbox))
        assertFalse(page2.keepsLoadedPages(EmailListScope("a@x.com", "sent")))
    }

    // ── Page-1 window prune ──────────────────────────────────────────

    @Test
    fun windowPruneDropsOnlyRowsInsideThePage() {
        val fresh = (1..25).map { row("f$it", day(30 - it)) } // dates 29 … 5
        val cached = listOf(
            row("gone-recent", day(20)), // archived elsewhere: inside the window
            row("older-page", day(2)), // a page-2 row: outside the window
            row("f3", day(27)),
        )
        assertEquals(setOf("gone-recent"), EmailPaging.staleRowIds(cached, fresh, sectioned = false))
    }

    @Test
    fun shortFirstPageIsTheWholeFolder() {
        val fresh = listOf(row("f1", day(10)))
        val cached = listOf(row("f1", day(10)), row("old", day(1)))
        assertEquals(setOf("old"), EmailPaging.staleRowIds(cached, fresh, sectioned = false))
    }

    @Test
    fun inboxWindowIsPerSection() {
        // Page 1: 3 New (old dates allowed) then 22 Seen, newest first.
        val fresh = listOf(row("n1", day(28), "new"), row("n2", day(3), "new"), row("n3", day(2), "new")) +
            (1..22).map { row("s$it", day(30 - it)) } // seen 29 … 8
        val cached = listOf(
            row("new-gone", day(1), "new"), // every New row is on page 1 → stale
            row("seen-gone", day(10)), // inside the Seen window → stale
            row("seen-page2", day(5)), // older than the Seen window → kept
        )
        assertEquals(setOf("new-gone", "seen-gone"), EmailPaging.staleRowIds(cached, fresh, sectioned = true))
    }

    // ── Page N > 1 prune ─────────────────────────────────────────────

    @Test
    fun laterPagePrunesInsideItsRange() {
        val page2 = listOf(row("p1", day(20)), row("p2", day(15)), row("p3", day(10)))
        val cached = listOf(
            row("page1-boundary", day(20)), // shares the newest date: previous page, kept
            row("gone", day(12)),
            row("next-page", day(5)),
        )
        assertEquals(setOf("gone"), EmailPaging.pageStaleRowIds(cached, page2, sectioned = false, isLastPage = false))
        // The last (short) page: nothing exists past it.
        assertEquals(
            setOf("gone", "next-page"),
            EmailPaging.pageStaleRowIds(cached, page2, sectioned = false, isLastPage = true),
        )
        assertEquals(emptySet<String>(), EmailPaging.pageStaleRowIds(cached, emptyList(), false, true))
    }

    // ── Thread collapse ──────────────────────────────────────────────

    @Test
    fun openedThreadMessagesDoNotBecomeRows() {
        val listRow = row("m3", day(9), threadId = "t1", threadCount = 3)
        val rows = listOf(
            listRow,
            row("m2", day(8), threadId = "t1"),
            row("m1", day(7), threadId = "t1"),
            row("solo", day(6)),
        )
        assertEquals(listOf("m3", "solo"), EmailPaging.collapseThreads(rows).map { it.id })
        // Same date: the server's list row (threadCount) wins over a detail copy.
        val tie = listOf(row("detail", day(9), threadId = "t2"), row("list", day(9), threadId = "t2", threadCount = 2))
        assertEquals(listOf("list"), EmailPaging.collapseThreads(tie).map { it.id })
    }

    // ── Inbox order across pages ─────────────────────────────────────

    @Test
    fun laterPageUnreadJoinsSeenInDateOrder() {
        val page1 = listOf(row("n1", day(20), "new"), row("s1", day(25)), row("s2", day(18)))
        val page2Unread = row("old-unread", day(4), "new")
        val page2Seen = row("old-seen", day(5))
        val ordered = EmailPaging.orderInbox(
            page1 + page2Unread + page2Seen,
            firstPageIds = page1.map { it.id }.toSet(),
        )
        assertEquals(listOf("n1", "s1", "s2", "old-seen", "old-unread"), ordered.map { it.id })
        // Still unread (dot), just placed in Seen.
        val moved = ordered.first { it.id == "old-unread" }
        assertTrue(moved.isUnread)
        assertEquals("seen", moved.resolvedListSection)
        // Page 1 unknown (cache only): plain New/Seen.
        assertEquals("old-unread", EmailPaging.orderInbox(page1 + page2Unread, null)[1].id)
    }
}

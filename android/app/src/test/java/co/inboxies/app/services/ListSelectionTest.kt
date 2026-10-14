package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.HomeTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListSelectionTest {
    private val inboxA = EmailListScope("a@x.com", "inbox")

    @Test
    fun scopeFollowsMailboxAndTab() {
        assertEquals(inboxA, EmailListScope.of("a@x.com", HomeTab.Folder("inbox")))
        // "For you" renders the inbox list, so it shares the inbox scope.
        assertEquals(inboxA, EmailListScope.of("a@x.com", HomeTab.AiInbox))
        assertEquals(
            EmailListScope("a@x.com", null, replyLater = true),
            EmailListScope.of("a@x.com", HomeTab.ReplyLater),
        )
        assertNull(EmailListScope.of("a@x.com", HomeTab.Chats))
        assertNull(EmailListScope.of(null, HomeTab.Folder("inbox")))
    }

    @Test
    fun guardsOnlyRunForTheCurrentSelection() {
        var writes = 0
        assertEquals(1, ifStillSelected("a", "a") { ++writes })
        assertNull(ifStillSelected("a", "b") { ++writes })
        assertNull(ifStillSelected("a", null) { ++writes })
        assertEquals(1, writes)

        assertEquals("ok", ifStillShowing(inboxA, inboxA) { "ok" })
        // Same mailbox, other folder / other mailbox, same folder: both stale.
        assertNull(ifStillShowing(inboxA, EmailListScope("a@x.com", "sent")) { "stale" })
        assertNull(ifStillShowing(inboxA, EmailListScope("b@x.com", "inbox")) { "stale" })
    }

    @Test
    fun hasMoreUsesShortPagesAndTotalCount() {
        assertFalse(EmailPaging.hasMore(page = 1, received = 10, totalCount = 0, loadedCount = 10))
        assertTrue(EmailPaging.hasMore(page = 1, received = 25, totalCount = 0, loadedCount = 25))
        assertTrue(EmailPaging.hasMore(page = 1, received = 25, totalCount = 60, loadedCount = 25))
        assertTrue(EmailPaging.hasMore(page = 2, received = 25, totalCount = 60, loadedCount = 50))
        assertFalse(EmailPaging.hasMore(page = 2, received = 25, totalCount = 50, loadedCount = 50))
        assertFalse(EmailPaging.hasMore(page = 3, received = 25, totalCount = 60, loadedCount = 60))
    }

    @Test
    fun pagingAllowsOneLoadAtATimeForItsOwnScope() {
        val first = EmailPagingState().restarted(inboxA, received = 25, totalCount = 80, loadedCount = 25)
        assertEquals(2, first.nextPage(inboxA))
        assertNull(first.nextPage(EmailListScope("a@x.com", "sent")))
        assertNull(first.nextPage(null))

        val loading = first.beginLoadMore()
        assertTrue(loading.isLoadingMore)
        assertNull(loading.nextPage(inboxA))
        assertTrue(loading.showsFooter)

        val second = loading.afterPage(2, received = 25, totalCount = 80, loadedCount = 50)
        assertEquals(2, second.page)
        assertEquals(3, second.nextPage(inboxA))

        val last = second.beginLoadMore().afterPage(3, received = 5, totalCount = 80, loadedCount = 55)
        assertFalse(last.hasMore)
        assertNull(last.nextPage(inboxA))
        assertFalse(last.showsFooter)
    }

    @Test
    fun failedPageWaitsForRetry() {
        val failed = EmailPagingState().restarted(inboxA, received = 25, totalCount = 80, loadedCount = 25)
            .beginLoadMore()
            .failLoad()
        assertTrue(failed.loadMoreFailed)
        assertFalse(failed.isLoadingMore)
        assertTrue(failed.showsFooter)
        // No automatic retry while scrolling, but an explicit Retry may fetch the same page.
        assertFalse(failed.shouldAutoLoad(inboxA))
        assertEquals(2, failed.nextPage(inboxA))
        assertFalse(failed.beginLoadMore().loadMoreFailed)
    }

    @Test
    fun prefetchStartsNearTheEnd() {
        assertFalse(EmailPaging.shouldPrefetch(lastVisibleIndex = 10, totalItems = 30))
        assertTrue(EmailPaging.shouldPrefetch(lastVisibleIndex = 24, totalItems = 30))
        assertTrue(EmailPaging.shouldPrefetch(lastVisibleIndex = 29, totalItems = 30))
        assertFalse(EmailPaging.shouldPrefetch(lastVisibleIndex = -1, totalItems = 0))
    }

    @Test
    fun mergeFirstPageKeepsLaterPages() {
        fun row(id: String) = Email(
            id = id,
            subject = id,
            sender = "s@x.com",
            recipient = "r@x.com",
            date = "2026-01-01T00:00:00Z",
            read = true,
            starred = false,
        )
        val loaded = (1..30).map { row("e$it") }
        val fresh = listOf(row("new")) + (1..24).map { row("e$it") }
        val merged = EmailPaging.mergeFirstPage(fresh, loaded, pageSize = 25)
        assertEquals(fresh + (26..30).map { row("e$it") }, merged)
        assertEquals(merged.size, merged.map { it.id }.distinct().size)
    }
}

package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.HomeTab

/**
 * What the shared `emails` list is showing: one folder (or the Reply Later pile) of one
 * mailbox. Async loads capture it before their first await and only apply results while
 * it is still current, so a slow response for mailbox A / folder X can never overwrite
 * B / Y after a fast switch. "For you" and the Inbox folder share a scope on purpose:
 * both render the inbox list.
 */
data class EmailListScope(
    val mailboxId: String,
    val folderId: String?,
    val replyLater: Boolean = false,
) {
    companion object {
        fun of(mailboxId: String?, tab: HomeTab): EmailListScope? {
            if (mailboxId == null) return null
            if (tab is HomeTab.ReplyLater) return EmailListScope(mailboxId, folderId = null, replyLater = true)
            val folderId = tab.syncFolderId ?: return null
            return EmailListScope(mailboxId, folderId)
        }
    }
}

/** Runs [block] only when [expected] is still the selected mailbox; returns null otherwise. */
inline fun <T> ifStillSelected(expected: String, current: String?, block: () -> T): T? =
    if (expected == current) block() else null

/** Runs [block] only when the list still shows [expected]; returns null otherwise. */
inline fun <T> ifStillShowing(expected: EmailListScope, current: EmailListScope?, block: () -> T): T? =
    if (expected == current) block() else null

/**
 * Infinite-scroll cursor for the email list. Page 1 comes from the regular load
 * ([restarted]); later pages go through [beginLoadMore] → [afterPage] / [failLoad].
 * Pure value type so the rules (one load at a time, scope must match, a restart
 * invalidates in-flight pages) are unit-testable.
 */
data class EmailPagingState(
    val scope: EmailListScope? = null,
    val page: Int = 1,
    val hasMore: Boolean = false,
    val isLoadingMore: Boolean = false,
    /** The last next-page request failed: the footer offers Retry and auto-loading pauses. */
    val loadMoreFailed: Boolean = false,
    /**
     * Bumped by every restart (tab / mailbox switch, pull-to-refresh, pruning page-1
     * reload). A next-page response applies only if the generation it started under is
     * still current, so a page can't land on a list that was reset underneath it.
     */
    val generation: Int = 0,
) {
    /** True when another page may be requested for [current] right now. */
    fun canLoadMore(current: EmailListScope?): Boolean =
        current != null && current == scope && hasMore && !isLoadingMore

    /** Next page number to request, or null when a load is already running / nothing is left. */
    fun nextPage(current: EmailListScope?): Int? = if (canLoadMore(current)) page + 1 else null

    /** Scrolling near the end may fetch on its own (not after a failure — that waits for Retry). */
    fun shouldAutoLoad(current: EmailListScope?): Boolean = canLoadMore(current) && !loadMoreFailed

    /** The bottom row (skeleton, or the Retry line) shows while more pages exist. */
    val showsFooter: Boolean
        get() = hasMore || isLoadingMore

    /**
     * A page-1 refresh of [current] must not prune or collapse the list: deeper pages are
     * loaded, or one is in flight (its rows would be pruned / its slot skipped).
     */
    fun keepsLoadedPages(current: EmailListScope?): Boolean =
        current != null && current == scope && (page > 1 || isLoadingMore)

    /** A next-page response started under [generation] for [scope] may still be applied. */
    fun accepts(scope: EmailListScope, generation: Int): Boolean =
        this.scope == scope && this.generation == generation

    fun beginLoadMore(): EmailPagingState = copy(isLoadingMore = true, loadMoreFailed = false)

    fun afterPage(page: Int, received: Int, totalCount: Int, loadedCount: Int): EmailPagingState = copy(
        page = page,
        hasMore = EmailPaging.hasMore(page, received, totalCount, loadedCount),
        isLoadingMore = false,
        loadMoreFailed = false,
    )

    fun cancelLoad(): EmailPagingState = copy(isLoadingMore = false)

    fun failLoad(): EmailPagingState = copy(isLoadingMore = false, loadMoreFailed = true)

    /** The list (re)started at page 1 for [scope]; in-flight pages are invalidated. */
    fun restarted(scope: EmailListScope, received: Int, totalCount: Int, loadedCount: Int) =
        EmailPagingState(
            scope = scope,
            page = 1,
            hasMore = EmailPaging.hasMore(1, received, totalCount, loadedCount),
            generation = generation + 1,
        )

    /** No list yet (switching tab / mailbox); in-flight pages are invalidated. */
    fun cleared() = EmailPagingState(generation = generation + 1)
}

object EmailPaging {
    /** Matches the `limit` ApiClient sends for list endpoints. */
    const val PAGE_SIZE = 25

    /** Start fetching the next page when the last visible row is this close to the end. */
    const val PREFETCH_DISTANCE = 5

    /**
     * Inbox shows at most this many New rows; the rest open on the "All new" screen so Seen
     * always stays in view right below (AVE-23). Sent to the server as `new_limit`.
     */
    const val INBOX_NEW_PREVIEW_LIMIT = 5

    /** The capped New rows plus how many New conversations sit behind "Show all". */
    data class InboxNewPreview(val shown: List<Email>, val hiddenCount: Int)

    /**
     * Inbox New preview: the newest [limit] New rows, and how many more there are
     * ([serverNewCount] when known — page 1 only holds a few).
     */
    fun inboxNewPreview(
        newRows: List<Email>,
        serverNewCount: Int?,
        limit: Int = INBOX_NEW_PREVIEW_LIMIT,
    ): InboxNewPreview {
        val sorted = newRows.sortedByDescending { it.date }
        val shown = sorted.take(limit)
        val total = maxOf(serverNewCount ?: 0, sorted.size)
        return InboxNewPreview(shown, maxOf(0, total - shown.size))
    }

    /**
     * A short page is the end. Otherwise trust `totalCount` when the server sent one
     * (threads for threaded folders, messages for Reply Later); without it, assume more.
     */
    fun hasMore(page: Int, received: Int, totalCount: Int, loadedCount: Int, pageSize: Int = PAGE_SIZE): Boolean {
        if (received < pageSize) return false
        if (totalCount <= 0) return true
        return page * pageSize < totalCount && loadedCount < totalCount
    }

    /**
     * A refreshed page 1 over a list that already holds later pages: fresh rows first,
     * then the previously loaded rows past the old first page (minus duplicates).
     */
    fun mergeFirstPage(
        freshFirstPage: List<Email>,
        loaded: List<Email>,
        pageSize: Int = PAGE_SIZE,
    ): List<Email> {
        val freshIds = freshFirstPage.map { it.id }.toSet()
        return freshFirstPage + loaded.drop(pageSize).filterNot { it.id in freshIds }
    }

    /**
     * Cached rows a fresh page 1 proves stale while deeper pages stay loaded: missing from
     * the page but inside the window it covers (dated at or after its oldest row). A short
     * page is the whole folder, so everything missing goes. With [sectioned] (Inbox: all
     * New rows sort before Seen ones) each section gets its own window, and once the page
     * reaches Seen rows every New row was on it.
     */
    fun staleRowIds(
        cached: List<Email>,
        freshFirstPage: List<Email>,
        sectioned: Boolean,
        pageSize: Int = PAGE_SIZE,
    ): Set<String> {
        val freshIds = freshFirstPage.map { it.id }.toSet()
        val missing = cached.filter { it.id !in freshIds }
        if (freshFirstPage.size < pageSize) return missing.map { it.id }.toSet()
        if (!sectioned) {
            val oldest = freshFirstPage.minOf { it.date }
            return missing.filter { it.date >= oldest }.map { it.id }.toSet()
        }
        val freshNew = freshFirstPage.filter { it.resolvedListSection == "new" }
        val freshSeen = freshFirstPage.filter { it.resolvedListSection == "seen" }
        return missing.filter { row ->
            if (row.resolvedListSection == "new") {
                freshSeen.isNotEmpty() || (freshNew.isNotEmpty() && row.date >= freshNew.minOf { it.date })
            } else {
                freshSeen.isNotEmpty() && row.date >= freshSeen.minOf { it.date }
            }
        }.map { it.id }.toSet()
    }

    /**
     * One row per conversation for threaded lists: opening a thread caches its individual
     * messages, which must not show up as extra rows. Newest wins; on a tie, prefer the
     * server's list row (it carries `threadCount`). Order is preserved.
     */
    fun collapseThreads(rows: List<Email>): List<Email> {
        val winners = HashMap<String, Email>()
        for (row in rows) {
            val key = row.threadId ?: row.id
            val current = winners[key]
            if (current == null || isBetterThreadRow(row, current)) winners[key] = row
        }
        val keep = winners.values.map { it.id }.toSet()
        return rows.filter { it.id in keep }
    }

    private fun isBetterThreadRow(candidate: Email, current: Email): Boolean {
        if (candidate.date != current.date) return candidate.date > current.date
        return candidate.threadCount != null && current.threadCount == null
    }

    /**
     * Cached rows a fetched later page (N > 1) proves stale: missing from it but inside its
     * date range `[oldest, newest)` (per section with [sectioned]). The upper bound is open
     * so a previous page's row sharing the boundary date survives. A short page is the
     * last one, so everything older than its newest row that it didn't return goes too.
     */
    fun pageStaleRowIds(
        cached: List<Email>,
        page: List<Email>,
        sectioned: Boolean,
        isLastPage: Boolean,
    ): Set<String> {
        if (page.isEmpty()) return emptySet()
        val pageIds = page.map { it.id }.toSet()
        fun sectionOf(e: Email) = if (sectioned) e.resolvedListSection else ""
        val ranges = page.groupBy(::sectionOf).mapValues { (_, rows) ->
            rows.minOf { it.date } to rows.maxOf { it.date }
        }
        return cached.filter { row ->
            if (row.id in pageIds) return@filter false
            val (oldest, newest) = ranges[sectionOf(row)] ?: return@filter false
            row.date < newest && (isLastPage || row.date >= oldest)
        }.map { it.id }.toSet()
    }

    /** Inbox order: New then Seen (by [Email.resolvedListSection]), each newest first. */
    fun orderNewThenSeen(emails: List<Email>): List<Email> {
        val (newEmails, seenEmails) = emails.partition { it.resolvedListSection == "new" }
        return newEmails.sortedByDescending { it.date } + seenEmails.sortedByDescending { it.date }
    }

    /**
     * Inbox with infinite scroll: only page 1 (by [firstPageIds]) takes part in the
     * New/Seen split. Rows from later pages join Seen in date order even when unread, so a
     * load-more never inserts rows above what the reader is looking at. Unknown page 1
     * (cache only, before any sync) orders everything.
     */
    fun orderInbox(emails: List<Email>, firstPageIds: Set<String>?): List<Email> {
        if (firstPageIds == null) return orderNewThenSeen(emails)
        return orderNewThenSeen(
            emails.map { e ->
                if (e.id in firstPageIds || e.resolvedListSection == "seen") e else e.copy(listSection = "seen")
            },
        )
    }

    fun shouldPrefetch(lastVisibleIndex: Int, totalItems: Int, distance: Int = PREFETCH_DISTANCE): Boolean =
        totalItems > 0 && lastVisibleIndex >= totalItems - 1 - distance
}

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
 * (`afterFirstPage`); later pages go through [beginLoadMore] → [afterPage] / [cancelLoad].
 * Pure value type so the rules (one load at a time, scope must match) are unit-testable.
 */
data class EmailPagingState(
    val scope: EmailListScope? = null,
    val page: Int = 1,
    val hasMore: Boolean = false,
    val isLoadingMore: Boolean = false,
    /** The last next-page request failed: the footer offers Retry and auto-loading pauses. */
    val loadMoreFailed: Boolean = false,
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

    fun beginLoadMore(): EmailPagingState = copy(isLoadingMore = true, loadMoreFailed = false)

    fun afterPage(page: Int, received: Int, totalCount: Int, loadedCount: Int): EmailPagingState = copy(
        page = page,
        hasMore = EmailPaging.hasMore(page, received, totalCount, loadedCount),
        isLoadingMore = false,
        loadMoreFailed = false,
    )

    fun cancelLoad(): EmailPagingState = copy(isLoadingMore = false)

    fun failLoad(): EmailPagingState = copy(isLoadingMore = false, loadMoreFailed = true)

    companion object {
        fun afterFirstPage(scope: EmailListScope, received: Int, totalCount: Int, loadedCount: Int) =
            EmailPagingState(
                scope = scope,
                page = 1,
                hasMore = EmailPaging.hasMore(1, received, totalCount, loadedCount),
            )
    }
}

object EmailPaging {
    /** Matches the `limit` ApiClient sends for list endpoints. */
    const val PAGE_SIZE = 25

    /** Start fetching the next page when the last visible row is this close to the end. */
    const val PREFETCH_DISTANCE = 5

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

    fun shouldPrefetch(lastVisibleIndex: Int, totalItems: Int, distance: Int = PREFETCH_DISTANCE): Boolean =
        totalItems > 0 && lastVisibleIndex >= totalItems - 1 - distance
}

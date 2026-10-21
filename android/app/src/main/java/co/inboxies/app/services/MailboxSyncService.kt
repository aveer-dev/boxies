package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.Mailbox

/** One synced page plus every cached row now loaded for the folder. */
data class FolderPage(
    val page: Int,
    /** All cached rows for the folder (every page loaded so far), newest first. */
    val emails: List<Email>,
    /** Rows the server returned for [page] — a short page means the end. */
    val received: Int,
    /** Ids the server returned for [page]. */
    val pageIds: Set<String>,
    val totalCount: Int,
    /** Inbox only: every New conversation on the server (page 1 holds at most a few). */
    val newCount: Int? = null,
)

/** How a page-1 sync reconciles the cache with the fresh page. */
enum class FolderPrune {
    /** The list restarts at page 1: drop every cached row not on the page (older pages too). */
    Full,

    /** Deeper pages stay loaded: drop only rows the page proves stale (its date window). */
    Window,
}

/** Online sync helpers used by AppModel (in-memory cache updated via DatabaseService). */
object MailboxSyncService {
    suspend fun syncMailbox(mailboxId: String): List<Folder> {
        val folders = ApiClient.shared.listFolders(mailboxId)
        DatabaseService.shared.upsertFolders(mailboxId, folders)
        return folders
    }

    /**
     * Fetch one page of [folderId]. Page 1 reconciles the cache per [prune], which is
     * asked **after** the response arrives (on the caller's dispatcher) so it reflects
     * paging state at that moment — e.g. a next page that landed meanwhile. Later pages
     * just append.
     */
    suspend fun syncFolder(
        mailboxId: String,
        folderId: String,
        page: Int = 1,
        prune: () -> FolderPrune = { FolderPrune.Full },
    ): FolderPage {
        // Inbox: newest few New, then Seen, so Seen is never pushed off the first page.
        val response = ApiClient.shared.listEmails(
            mailboxId,
            folder = folderId,
            page = page,
            threaded = true,
            newLimit = if (folderId == "inbox") EmailPaging.INBOX_NEW_PREVIEW_LIMIT else null,
        )
        val db = DatabaseService.shared
        val mode = if (page == 1) prune() else null
        if (mode == FolderPrune.Window) {
            val stale = EmailPaging.staleRowIds(
                cached = db.getEmailRows(mailboxId, folderId),
                freshFirstPage = response.emails,
                sectioned = folderId == "inbox",
            )
            stale.forEach { db.deleteEmail(it) }
        }
        if (page > 1) {
            // Mail archived / deleted elsewhere inside this page's range (or past the end).
            val stale = EmailPaging.pageStaleRowIds(
                cached = db.getEmailRows(mailboxId, folderId),
                page = response.emails,
                sectioned = folderId == "inbox",
                isLastPage = response.emails.size < EmailPaging.PAGE_SIZE,
            )
            stale.forEach { db.deleteEmail(it) }
        }
        db.upsertEmails(mailboxId, response.emails, defaultFolder = folderId)
        if (mode == FolderPrune.Full) {
            // Drop local ghosts that the server no longer lists in this folder.
            val serverIds = response.emails.map { it.id }.toSet()
            db.pruneEmailsNotInFolder(mailboxId, folderId, serverIds)
        } else {
            db.dropSupersededThreadRows(mailboxId, folderId, response.emails)
        }
        return FolderPage(
            page = page,
            emails = DatabaseService.shared.getEmails(mailboxId, folderId),
            received = response.emails.size,
            pageIds = response.emails.map { it.id }.toSet(),
            totalCount = response.totalCount,
            newCount = response.newCount,
        )
    }

    suspend fun syncMailboxes(): List<Mailbox> {
        val list = ApiClient.shared.listMailboxes()
        DatabaseService.shared.upsertMailboxes(list)
        return list
    }
}

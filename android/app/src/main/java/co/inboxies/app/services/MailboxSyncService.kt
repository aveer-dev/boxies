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
    val totalCount: Int,
)

/** Online sync helpers used by AppModel (in-memory cache updated via DatabaseService). */
object MailboxSyncService {
    suspend fun syncMailbox(mailboxId: String): List<Folder> {
        val folders = ApiClient.shared.listFolders(mailboxId)
        DatabaseService.shared.upsertFolders(mailboxId, folders)
        return folders
    }

    /**
     * Fetch one page of [folderId]. With [prune] (page 1 only), cached rows the server no
     * longer lists on that page are dropped — which also drops any older pages, so callers
     * prune only when the list is (re)starting at page 1. Later pages just append.
     */
    suspend fun syncFolder(
        mailboxId: String,
        folderId: String,
        page: Int = 1,
        prune: Boolean = page == 1,
    ): FolderPage {
        val response = ApiClient.shared.listEmails(mailboxId, folder = folderId, page = page, threaded = true)
        DatabaseService.shared.upsertEmails(mailboxId, response.emails, defaultFolder = folderId)
        if (prune && page == 1) {
            // Drop local ghosts that the server no longer lists in this folder.
            val serverIds = response.emails.map { it.id }.toSet()
            DatabaseService.shared.pruneEmailsNotInFolder(mailboxId, folderId, serverIds)
        } else {
            DatabaseService.shared.dropSupersededThreadRows(mailboxId, folderId, response.emails)
        }
        return FolderPage(
            page = page,
            emails = DatabaseService.shared.getEmails(mailboxId, folderId),
            received = response.emails.size,
            totalCount = response.totalCount,
        )
    }

    suspend fun syncMailboxes(): List<Mailbox> {
        val list = ApiClient.shared.listMailboxes()
        DatabaseService.shared.upsertMailboxes(list)
        return list
    }
}

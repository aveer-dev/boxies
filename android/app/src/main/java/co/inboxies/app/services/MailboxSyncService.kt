package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.Mailbox

/** Online sync helpers used by AppModel (Room cache updated via DatabaseService). */
object MailboxSyncService {
    suspend fun syncMailbox(mailboxId: String): List<Folder> {
        val folders = ApiClient.shared.listFolders(mailboxId)
        DatabaseService.shared.upsertFolders(mailboxId, folders)
        return folders
    }

    suspend fun syncFolder(mailboxId: String, folderId: String): List<Email> {
        val response = ApiClient.shared.listEmails(mailboxId, folder = folderId, threaded = true)
        DatabaseService.shared.upsertEmails(mailboxId, response.emails, defaultFolder = folderId)
        // Drop local ghosts that the server no longer lists in this folder.
        val serverIds = response.emails.map { it.id }.toSet()
        DatabaseService.shared.pruneEmailsNotInFolder(mailboxId, folderId, serverIds)
        return DatabaseService.shared.getEmails(mailboxId, folderId, limit = 50)
    }

    suspend fun syncMailboxes(): List<Mailbox> {
        val list = ApiClient.shared.listMailboxes()
        DatabaseService.shared.upsertMailboxes(list)
        return list
    }
}

object OutboxQueueWorker {
    fun trigger() {
        // Online-first: mutations already hit the API. Hook reserved for offline drain.
    }
}

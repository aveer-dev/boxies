package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.Mailbox
import java.util.concurrent.ConcurrentHashMap

/**
 * Lightweight in-memory cache used by [AppModel]. Room schema lives in Database.kt
 * for future persistence; this keeps the app compiling and online-first for v1.
 */
class DatabaseService private constructor() {
    private val mailboxes = ConcurrentHashMap<String, Mailbox>()
    private val folders = ConcurrentHashMap<String, MutableList<Folder>>()
    private val emails = ConcurrentHashMap<String, Email>()
    private val folderUnread = ConcurrentHashMap<String, Int>()

    fun getMailboxes(): List<Mailbox> = mailboxes.values.toList()

    fun upsertMailboxes(list: List<Mailbox>) {
        list.forEach { mailboxes[it.id] = it }
    }

    fun deleteMailbox(id: String) {
        mailboxes.remove(id)
        folders.remove(id)
        emails.entries.removeIf { it.value.folderId != null && it.key.startsWith("$id:") }
    }

    fun getFolders(mailboxId: String): List<Folder> = folders[mailboxId].orEmpty()

    fun upsertFolders(mailboxId: String, list: List<Folder>) {
        folders[mailboxId] = list.toMutableList()
    }

    fun updateFolderUnread(mailboxId: String, folderId: String, delta: Int) {
        val key = "$mailboxId::$folderId"
        folderUnread[key] = (folderUnread[key] ?: 0) + delta
        val current = folders[mailboxId] ?: return
        folders[mailboxId] = current.map {
            if (it.id == folderId) it.copy(unreadCount = (it.unreadCount + delta).coerceAtLeast(0)) else it
        }.toMutableList()
    }

    fun getEmails(mailboxId: String, folderId: String, limit: Int): List<Email> =
        emails.values
            .filter { it.folderId == folderId || (it.folderId == null && folderId == "inbox") }
            .sortedByDescending { it.date }
            .take(limit)

    fun getEmail(id: String): Email? = emails[id]

    fun getThreadEmails(mailboxId: String, threadId: String): List<Email> =
        emails.values.filter { it.threadId == threadId }.sortedBy { it.date }

    fun upsertEmails(mailboxId: String, list: List<Email>, defaultFolder: String? = null) {
        list.forEach { email ->
            val merged = if (email.folderId == null && defaultFolder != null) {
                email.copy(folderId = defaultFolder)
            } else {
                email
            }
            emails[merged.id] = merged
        }
    }

    fun updateEmailFlags(id: String, read: Boolean? = null, starred: Boolean? = null) {
        val existing = emails[id] ?: return
        emails[id] = existing.copy(
            read = read ?: existing.read,
            starred = starred ?: existing.starred,
        )
    }

    fun deleteEmail(id: String) {
        emails.remove(id)
    }

    fun moveEmail(id: String, folderId: String) {
        val existing = emails[id] ?: return
        emails[id] = existing.copy(folderId = folderId)
    }

    /** Remove local rows for this folder that are not on the server page. */
    fun pruneEmailsNotInFolder(mailboxId: String, folderId: String, serverIds: Set<String>) {
        emails.entries.removeIf { (_, email) ->
            email.folderId == folderId && email.id !in serverIds
        }
    }

    fun deleteDrafts(
        mailboxId: String,
        threadId: String?,
        originalEmailId: String?,
        draftId: String?,
    ) {
        if (draftId != null) emails.remove(draftId)
        if (threadId != null) {
            emails.entries.removeIf { (_, e) -> e.isDraft && e.threadId == threadId }
        }
    }

    fun pruneLocalOnlyDrafts(mailboxId: String, threadId: String, remoteIds: Set<String>) {
        emails.entries.removeIf { (_, e) ->
            e.isDraft && e.threadId == threadId && e.id !in remoteIds
        }
    }

    fun enqueueMutation(
        mailboxId: String,
        emailId: String,
        action: String,
        payload: Map<String, Any?> = emptyMap(),
    ) {
        // Online-first v1: mutations go through APIClient; outbox is a no-op cache hook.
    }

    companion object {
        val shared: DatabaseService by lazy { DatabaseService() }
    }
}

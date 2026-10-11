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
    /** Email id → owning mailbox id, so cached rows from different mailboxes never mix. */
    private val emailMailboxIds = ConcurrentHashMap<String, String>()
    private val folderUnread = ConcurrentHashMap<String, Int>()

    fun getMailboxes(): List<Mailbox> = mailboxes.values.toList()

    fun upsertMailboxes(list: List<Mailbox>) {
        list.forEach { mailboxes[it.id] = it }
    }

    fun deleteMailbox(id: String) {
        mailboxes.remove(id)
        folders.remove(id)
        val ids = emailMailboxIds.filterValues { it == id }.keys
        ids.forEach { emailId ->
            emails.remove(emailId)
            emailMailboxIds.remove(emailId)
        }
        folderUnread.keys.removeIf { it.startsWith("$id::") }
    }

    fun clearAll() {
        mailboxes.clear()
        folders.clear()
        emails.clear()
        emailMailboxIds.clear()
        folderUnread.clear()
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

    private fun emailsIn(mailboxId: String): Sequence<Email> =
        emails.values.asSequence().filter { emailMailboxIds[it.id] == mailboxId }

    fun getEmails(mailboxId: String, folderId: String, limit: Int): List<Email> =
        emailsIn(mailboxId)
            .filter { it.folderId == folderId || (it.folderId == null && folderId == "inbox") }
            .sortedByDescending { it.date }
            .take(limit)
            .toList()

    fun getReplyLaterEmails(mailboxId: String, limit: Int = 50): List<Email> =
        emailsIn(mailboxId)
            .filter {
                it.replyLater && it.folderId !in setOf("trash", "spam", "draft", "drafts")
            }
            .sortedWith(
                compareBy<Email> { it.replyLaterAt ?: it.date }
                    .thenByDescending { it.date }
            )
            .take(limit)
            .toList()

    fun getReplyLaterCount(mailboxId: String): Int =
        emailsIn(mailboxId).count {
            it.replyLater && it.folderId !in setOf("trash", "spam", "draft", "drafts")
        }

    fun getEmail(id: String): Email? = emails[id]

    fun getThreadEmails(mailboxId: String, threadId: String): List<Email> =
        emailsIn(mailboxId).filter { it.threadId == threadId }.sortedBy { it.date }.toList()

    fun upsertEmails(mailboxId: String, list: List<Email>, defaultFolder: String? = null) {
        list.forEach { email ->
            val merged = if (email.folderId == null && defaultFolder != null) {
                email.copy(folderId = defaultFolder)
            } else {
                email
            }
            emails[merged.id] = merged
            emailMailboxIds[merged.id] = mailboxId
        }
    }

    fun updateEmailFlags(
        id: String,
        read: Boolean? = null,
        starred: Boolean? = null,
        replyLater: Boolean? = null,
    ) {
        val existing = emails[id] ?: return
        emails[id] = existing.copy(
            read = read ?: existing.read,
            starred = starred ?: existing.starred,
            replyLater = replyLater ?: existing.replyLater,
            replyLaterAt = when {
                replyLater == true && existing.replyLaterAt == null ->
                    java.time.Instant.now().toString()
                replyLater == false -> null
                else -> existing.replyLaterAt
            },
        )
    }

    fun deleteEmail(id: String) {
        emails.remove(id)
        emailMailboxIds.remove(id)
    }

    fun moveEmail(id: String, folderId: String) {
        val existing = emails[id] ?: return
        val clearReplyLater = folderId == "trash" || folderId == "spam"
        emails[id] = existing.copy(
            folderId = folderId,
            replyLater = if (clearReplyLater) false else existing.replyLater,
            replyLaterAt = if (clearReplyLater) null else existing.replyLaterAt,
        )
    }

    /** Remove local rows for this folder that are not on the server page. */
    fun pruneEmailsNotInFolder(mailboxId: String, folderId: String, serverIds: Set<String>) {
        val removed = emails.values.filter { email ->
            emailMailboxIds[email.id] == mailboxId &&
                email.folderId == folderId && email.id !in serverIds
        }
        removed.forEach { deleteEmail(it.id) }
    }

    fun deleteDrafts(
        mailboxId: String,
        threadId: String?,
        originalEmailId: String?,
        draftId: String?,
    ) {
        if (draftId != null) deleteEmail(draftId)
        if (threadId != null) {
            emailsIn(mailboxId)
                .filter { it.isDraft && it.threadId == threadId }
                .toList()
                .forEach { deleteEmail(it.id) }
        }
    }

    fun pruneLocalOnlyDrafts(mailboxId: String, threadId: String, remoteIds: Set<String>) {
        emailsIn(mailboxId)
            .filter { it.isDraft && it.threadId == threadId && it.id !in remoteIds }
            .toList()
            .forEach { deleteEmail(it.id) }
    }

    companion object {
        val shared: DatabaseService by lazy { DatabaseService() }
    }
}

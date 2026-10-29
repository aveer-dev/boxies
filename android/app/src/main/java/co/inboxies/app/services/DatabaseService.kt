package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.Mailbox
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-lifetime, in-memory cache used by [AppModel]. Nothing is persisted to disk:
 * the app is online-first and repopulates this from the API after every cold start.
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

    /**
     * The folder's list rows (all pages loaded so far), newest first, one per conversation:
     * messages cached by opening a thread don't become extra rows. Drafts are grouped per
     * reply target, not per thread, so they are never collapsed.
     */
    fun getEmails(mailboxId: String, folderId: String, limit: Int = Int.MAX_VALUE): List<Email> {
        val rows = getEmailRows(mailboxId, folderId)
        val listRows = if (folderId == "draft" || folderId == "drafts") rows else EmailPaging.collapseThreads(rows)
        return listRows.take(limit)
    }

    /** Every cached message filed in the folder, newest first (not collapsed). */
    fun getEmailRows(mailboxId: String, folderId: String): List<Email> =
        emailsIn(mailboxId)
            .filter { it.folderId == folderId || (it.folderId == null && folderId == "inbox") }
            .sortedByDescending { it.date }
            .toList()

    fun getReplyLaterEmails(mailboxId: String, limit: Int = Int.MAX_VALUE): List<Email> =
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

    /** Reply Later mails whose reminder fired and are still unread (AVE-86). */
    fun getReplyLaterDueCount(mailboxId: String): Int =
        emailsIn(mailboxId).count {
            it.isReplyLaterDue && it.folderId !in setOf("trash", "spam", "draft", "drafts")
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
            // Only list rows carry note fields; detail/thread payloads keep the cached ones.
            val existing = emails[merged.id]
            val withNotes = if (merged.hasStickyNote == null && existing?.hasStickyNote != null) {
                merged.copy(
                    hasStickyNote = existing.hasStickyNote,
                    stickyNoteText = existing.stickyNoteText,
                    inlineNoteCount = merged.inlineNoteCount ?: existing.inlineNoteCount,
                )
            } else {
                merged
            }
            emails[merged.id] = withNotes
            emailMailboxIds[merged.id] = mailboxId
        }
    }

    /**
     * Writes a conversation's note summary onto every cached row of it, so the list
     * shows a note change before the next sync.
     */
    fun updateThreadNoteSummary(mailboxId: String, threadKey: String, summary: ThreadNoteSummary) {
        emailsIn(mailboxId).filter { it.noteThreadKey == threadKey }.toList().forEach { email ->
            emails[email.id] = email.copy(
                hasStickyNote = summary.hasStickyNote,
                stickyNoteText = summary.stickyNoteText,
                inlineNoteCount = summary.inlineNoteCount,
            )
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
            // Leaving Reply Later clears both reminder fields (server does the same).
            replyLaterRemindAt = if (replyLater == false) null else existing.replyLaterRemindAt,
            replyLaterRemindedAt = if (replyLater == false) null else existing.replyLaterRemindedAt,
        )
    }

    /**
     * Set (`remindAt` = UTC ISO) or clear (`null`) the pending reminder. Setting one adds
     * the mail to Reply Later and clears a previous fire; clearing keeps it in the pile.
     */
    fun updateReplyLaterReminder(id: String, remindAt: String?) {
        val existing = emails[id] ?: return
        emails[id] = existing.withReplyLaterReminder(remindAt)
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
            replyLaterRemindAt = if (clearReplyLater) null else existing.replyLaterRemindAt,
            replyLaterRemindedAt = if (clearReplyLater) null else existing.replyLaterRemindedAt,
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

    /**
     * Threaded list rows are keyed by the conversation's latest message, so a thread that
     * got a new message comes back under a new id. When syncing without a prune, drop the
     * cached row it replaces. Drafts are grouped per reply target, not per thread — skip.
     */
    fun dropSupersededThreadRows(mailboxId: String, folderId: String, incoming: List<Email>) {
        if (folderId == "draft" || folderId == "drafts") return
        val latestByThread = incoming.mapNotNull { e -> e.threadId?.let { it to e.id } }.toMap()
        if (latestByThread.isEmpty()) return
        emailsIn(mailboxId)
            .filter { e ->
                e.folderId == folderId &&
                    e.threadId != null &&
                    latestByThread[e.threadId]?.let { it != e.id } == true
            }
            .toList()
            .forEach { deleteEmail(it.id) }
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

/** The mail with its Reply Later reminder set (`remindAt` = UTC ISO) or cleared (`null`). */
fun Email.withReplyLaterReminder(remindAt: String?): Email =
    if (remindAt != null) {
        copy(
            replyLater = true,
            replyLaterAt = replyLaterAt ?: java.time.Instant.now().toString(),
            replyLaterRemindAt = remindAt,
            replyLaterRemindedAt = null,
        )
    } else {
        copy(replyLaterRemindAt = null)
    }

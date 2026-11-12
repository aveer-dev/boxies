package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.PileIds
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

    /**
     * Drops a deleted custom folder and re-files its cached mail under Inbox, where the
     * Worker moved it (AVE-158).
     */
    fun deleteFolder(mailboxId: String, folderId: String) {
        folders[mailboxId]?.let { list -> folders[mailboxId] = list.filterNot { it.id == folderId }.toMutableList() }
        folderUnread.remove("$mailboxId::$folderId")
        emailsIn(mailboxId).filter { it.folderId == folderId }.toList().forEach { email ->
            emails[email.id] = email.copy(folderId = "inbox")
        }
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

    /** Set Aside mails (AVE-201), oldest set aside first like the Worker's `pile=set_aside`. */
    fun getSetAsideEmails(mailboxId: String): List<Email> =
        emailsIn(mailboxId)
            .filter { it.isSetAside && it.folderId !in setOf("trash", "spam", "draft", "drafts") }
            .sortedWith(compareBy<Email> { it.pileAt ?: it.date }.thenByDescending { it.date })
            .toList()

    fun getSetAsideCount(mailboxId: String): Int =
        emailsIn(mailboxId).count {
            it.isSetAside && it.folderId !in setOf("trash", "spam", "draft", "drafts")
        }

    /** Mail in any pile but Reply Later (Set Aside or one people made, AVE-194), oldest first. */
    fun getPileEmails(mailboxId: String, pileId: String): List<Email> =
        emailsIn(mailboxId)
            .filter { it.currentPileId == pileId && it.folderId !in setOf("trash", "spam", "draft", "drafts") }
            .sortedWith(compareBy<Email> { it.pileAt ?: it.date }.thenByDescending { it.date })
            .toList()

    fun getPileCount(mailboxId: String, pileId: String): Int =
        emailsIn(mailboxId).count {
            it.currentPileId == pileId && it.folderId !in setOf("trash", "spam", "draft", "drafts")
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
            // List rows never carry the reader cards; keep the ones a detail load cached.
            val withCards = if (withNotes.otp == null && withNotes.invite == null && existing != null &&
                (existing.otp != null || existing.invite != null)
            ) {
                withNotes.copy(otp = existing.otp, invite = existing.invite)
            } else {
                withNotes
            }
            emails[merged.id] = withCards
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

    /**
     * Cached rows carrying [tagId] outside Trash, Spam and Drafts, one per conversation,
     * newest first: what a tag view shows before its server list lands (AVE-242).
     */
    fun getTaggedEmails(mailboxId: String, tagId: String): List<Email> =
        EmailPaging.collapseThreads(
            emailsIn(mailboxId)
                .filter { email ->
                    email.folderId !in setOf("trash", "spam", "draft", "drafts") &&
                        email.tags.orEmpty().any { it.id == tagId }
                }
                .sortedByDescending { it.date }
                .toList(),
        )

    /** Rewrites the tags of every cached message of conversation [threadKey]. */
    fun updateThreadTags(mailboxId: String, threadKey: String, transform: (List<co.inboxies.app.models.TagRef>?) -> List<co.inboxies.app.models.TagRef>) {
        emailsIn(mailboxId).filter { MailTags.threadKey(it) == threadKey }.toList().forEach { email ->
            emails[email.id] = email.copy(tags = transform(email.tags))
        }
    }

    /** A tag was renamed or deleted: every cached row follows (`name` null drops it). */
    fun updateTagEverywhere(mailboxId: String, tagId: String, name: String?) {
        emailsIn(mailboxId).filter { e -> e.tags.orEmpty().any { it.id == tagId } }.toList().forEach { email ->
            val next = email.tags.orEmpty().mapNotNull { tag ->
                when {
                    tag.id != tagId -> tag
                    name == null -> null
                    else -> tag.copy(name = name)
                }
            }.sortedWith(MailTags.order)
            emails[email.id] = email.copy(tags = next)
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
            // One pile at a time (AVE-201): Reply Later moves a Set Aside mail over.
            pileId = when (replyLater) {
                true -> PileIds.REPLY_LATER
                false -> if (existing.currentPileId == PileIds.REPLY_LATER) null else existing.pileId
                null -> existing.pileId
            },
        )
    }

    /** Move the message into [pileId], or out of any pile with `null` (AVE-201). */
    fun updateEmailPile(id: String, pileId: String?) {
        val existing = emails[id] ?: return
        emails[id] = existing.inPile(pileId)
    }

    /** A deleted pile (AVE-194): its cached mail comes out of it, nothing else changes. */
    fun clearPile(mailboxId: String, pileId: String) {
        emailsIn(mailboxId).filter { it.pileId == pileId }.toList().forEach { email ->
            emails[email.id] = email.copy(pileId = null, pileAt = null)
        }
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
            pileId = if (clearReplyLater) null else existing.pileId,
            pileAt = if (clearReplyLater) null else existing.pileAt,
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

/**
 * The mail moved into [pileId] (or out of any pile with `null`), keeping the one-pile rule
 * (AVE-201): leaving Reply Later drops its reminder; Reply Later itself keeps the flag in sync.
 */
fun Email.inPile(pileId: String?): Email {
    if (currentPileId == pileId) return this
    val now = java.time.Instant.now().toString()
    val toReplyLater = pileId == PileIds.REPLY_LATER
    return copy(
        pileId = pileId,
        pileAt = if (pileId != null) now else null,
        replyLater = toReplyLater,
        replyLaterAt = if (toReplyLater) (replyLaterAt ?: now) else null,
        replyLaterRemindAt = if (toReplyLater) replyLaterRemindAt else null,
        replyLaterRemindedAt = if (toReplyLater) replyLaterRemindedAt else null,
    )
}

/** The mail with its Reply Later reminder set (`remindAt` = UTC ISO) or cleared (`null`). */
fun Email.withReplyLaterReminder(remindAt: String?): Email =
    if (remindAt != null) {
        copy(
            replyLater = true,
            pileId = PileIds.REPLY_LATER,
            replyLaterAt = replyLaterAt ?: java.time.Instant.now().toString(),
            replyLaterRemindAt = remindAt,
            replyLaterRemindedAt = null,
        )
    } else {
        copy(replyLaterRemindAt = null)
    }

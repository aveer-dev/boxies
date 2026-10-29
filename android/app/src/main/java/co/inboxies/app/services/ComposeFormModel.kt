package co.inboxies.app.services

import android.util.Log
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.ComposePresentation
import co.inboxies.app.models.Email
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.util.ComposeHtml
import co.inboxies.app.util.ComposePendingAttachment
import co.inboxies.app.util.QuotedOriginal
import co.inboxies.app.util.OutboundLimits
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

class ComposeSession(
    val form: ComposeFormModel,
    var presentation: ComposePresentation = ComposePresentation.Expanded,
) {
    val dockTitle: String get() = form.displayTitle
    val isExpanded: Boolean get() = presentation == ComposePresentation.Expanded
    val isMinimized: Boolean get() = presentation == ComposePresentation.Minimized

    fun expand() {
        presentation = ComposePresentation.Expanded
    }

    fun minimize() {
        presentation = ComposePresentation.Minimized
    }
}

data class ComposeToast(
    val message: String,
    val isError: Boolean = false,
    val id: String = UUID.randomUUID().toString(),
)

enum class DraftSaveStatus {
    Idle,
    Saving,
}

/** Mutable compose form owned by AppModel (mirrors iOS ComposeFormModel). */
class ComposeFormModel(
    val mode: ComposeMode,
    mailbox: Mailbox,
    original: Email? = null,
    draft: Email? = null,
    initialTo: List<MailAddress> = emptyList(),
) {
    /**
     * Bound to a private email: a reply in a private-email thread, or a reopened reply draft
     * from one. The Worker sends those from the alias with no display name, so From locks
     * and the signature (which could carry the real name) is skipped. Keyed on `alias_id`
     * only; forwards are never bound.
     */
    val isAliasBound: Boolean = aliasSource(mode, original, draft) != null

    /** The bound alias address, when the payload carried `alias_email` (detail / draft rows do). */
    val aliasEmail: String? = aliasSource(mode, original, draft)
        ?.aliasEmail
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

    /**
     * `Idempotency-Key` for this compose: sent on every send attempt (including a retry
     * after a failure) so a send that did reach the server is not repeated; the server
     * answers a repeated key with the original 202. A new compose gets a new key.
     */
    val sendIdempotencyKey: String = UUID.randomUUID().toString()

    var fromMailboxId: String = mailbox.id
    var fromEmail: String = aliasEmail ?: mailbox.email
    var fromName: String? = if (isAliasBound) {
        null
    } else {
        mailbox.settings?.fromName ?: mailbox.name.takeIf { it != mailbox.email }
    }
    val original: Email? = original

    var toTokens: List<MailAddress> = initialTo
    var ccTokens: List<MailAddress> = emptyList()
    var bccTokens: List<MailAddress> = emptyList()
    var toDraft: String = ""
    var ccDraft: String = ""
    var bccDraft: String = ""
    var subject: String = ""
    var body: String = ""
    var attachments: List<ComposePendingAttachment> = emptyList()
    var showCcBcc: Boolean = false
    var draftId: String? = draft?.id
    var originalEmailId: String? = original?.id ?: draft?.inReplyTo
    var threadId: String? = original?.threadId ?: original?.id ?: draft?.threadId
    var isSending: Boolean = false
    var isSavingDraft: Boolean = false
    var saveStatus: DraftSaveStatus = DraftSaveStatus.Idle
    var toast: ComposeToast? = null
    var errorMessage: String? = null

    /**
     * Recipients the last send was refused for (409 `recipient_suppressed`). The sheet
     * shows the ones still addressed ([visibleSuppressedRecipients]) in place of
     * [errorMessage]; the server's sentence goes in the toast.
     */
    var suppressedRecipients: List<SuppressedRecipient> = emptyList()
    var isUnsuppressing: Boolean = false
    val quotedOriginal: QuotedOriginal?

    private val signature: String
    val signatureText: String get() = signature
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var autoSaveJob: Job? = null
    private var toastDismissJob: Job? = null
    /** Set once a save bounces with `service_ended`, so autosave stops retrying. */
    private var writesBlocked = false

    val title: String
        get() = when (mode) {
            ComposeMode.New -> "New Message"
            ComposeMode.Reply -> "Reply"
            ComposeMode.ReplyAll -> "Reply All"
            ComposeMode.Forward -> "Forward"
            ComposeMode.EditDraft -> "Edit Draft"
        }

    val displayTitle: String
        get() {
            val trimmed = subject.trim()
            if (trimmed.isNotEmpty()) return trimmed
            return title
        }

    val bodyHtml: String
        get() = outgoingHtml()

    val isEmpty: Boolean
        get() = toTokens.isEmpty() &&
            ccTokens.isEmpty() &&
            bccTokens.isEmpty() &&
            toDraft.trim().isEmpty() &&
            ccDraft.trim().isEmpty() &&
            bccDraft.trim().isEmpty() &&
            subject.trim().isEmpty() &&
            attachments.isEmpty() &&
            !ComposeHtml.bodyHasUserContent(body, signature)

    val hasUnsavedChanges: Boolean
        get() = ComposeHtml.bodyHasUserContent(body, signature) ||
            subject.isNotBlank() ||
            toTokens.isNotEmpty() ||
            ccTokens.isNotEmpty() ||
            bccTokens.isNotEmpty() ||
            toDraft.isNotBlank() ||
            ccDraft.isNotBlank() ||
            bccDraft.isNotBlank() ||
            attachments.isNotEmpty()

    init {
        signature = if (isAliasBound) {
            ""
        } else {
            ComposeHtml.signatureText(
                settings = mailbox.settings,
                fromName = fromName,
            )
        }
        quotedOriginal = if (quotesOriginal) {
            original?.let { ComposeHtml.quotedOriginal(it, isForward = mode == ComposeMode.Forward) }
        } else {
            null
        }

        // The alias is "us" too, so Reply / Reply All never address it back.
        val selfAddresses = ComposeHtml.selfAddresses(mailbox) +
            listOfNotNull(aliasEmail?.lowercase())

        when {
            draft != null -> {
                toTokens = MailAddress.parseList(draft.recipient)
                ccTokens = MailAddress.parseList(draft.cc)
                bccTokens = MailAddress.parseList(draft.bcc)
                showCcBcc = ccTokens.isNotEmpty() || bccTokens.isNotEmpty()
                subject = draft.subject
                body = ComposeHtml.editableReply(draft.body.orEmpty(), quotedOriginal?.header)
                if (original != null && toTokens.isNotEmpty() &&
                    toTokens.all { ComposeHtml.isSelfAddress(it.email, selfAddresses) } &&
                    ComposeHtml.isSelfAddress(original.fromAddress.email, selfAddresses)
                ) {
                    val corrected = ComposeHtml.replyFields(original, selfAddresses)
                    if (corrected.isNotEmpty()) toTokens = corrected
                }
            }
            original != null && (mode == ComposeMode.Reply || mode == ComposeMode.ReplyAll) -> {
                if (mode == ComposeMode.Reply) {
                    toTokens = ComposeHtml.replyFields(original, selfAddresses)
                } else {
                    val (to, cc) = ComposeHtml.replyAllFields(original, selfAddresses)
                    toTokens = to
                    ccTokens = cc
                    showCcBcc = cc.isNotEmpty()
                }
                subject = ComposeHtml.prefixedSubject(original.subject, "Re")
                body = ComposeHtml.bodyWithSignature(signature)
            }
            mode == ComposeMode.Forward && original != null -> {
                subject = ComposeHtml.prefixedSubject(original.subject, "Fwd")
                // The forwarded message is shown under the editor and appended on send.
                body = ComposeHtml.bodyWithSignature(signature)
            }
            else -> {
                if (initialTo.isNotEmpty()) toTokens = initialTo
                body = ComposeHtml.bodyWithSignature(signature)
            }
        }
    }

    /** Suppressed recipients still in To / Cc / Bcc. Removing one clears its notice. */
    fun visibleSuppressedRecipients(
        to: List<MailAddress> = toTokens,
        cc: List<MailAddress> = ccTokens,
        bcc: List<MailAddress> = bccTokens,
    ): List<SuppressedRecipient> =
        BounceSuppression.stillAddressed(suppressedRecipients, (to + cc + bcc).map { it.email })

    fun toJoined(): String = toTokens.joinToString(", ") { it.email }
    fun ccJoined(): String = ccTokens.joinToString(", ") { it.email }
    fun bccJoined(): String = bccTokens.joinToString(", ") { it.email }

    fun commitPendingTokens() {
        toTokens = mergeTokens(toTokens, toDraft)
        toDraft = ""
        ccTokens = mergeTokens(ccTokens, ccDraft)
        ccDraft = ""
        bccTokens = mergeTokens(bccTokens, bccDraft)
        bccDraft = ""
    }

    fun removeTo(token: MailAddress) {
        toTokens = toTokens.filterNot { it.id == token.id }
    }

    fun removeCc(token: MailAddress) {
        ccTokens = ccTokens.filterNot { it.id == token.id }
    }

    fun removeBcc(token: MailAddress) {
        bccTokens = bccTokens.filterNot { it.id == token.id }
    }

    fun selectFrom(mailbox: Mailbox) {
        if (isAliasBound) return
        fromMailboxId = mailbox.id
        fromEmail = mailbox.email
        fromName = mailbox.settings?.fromName
            ?: mailbox.name.takeIf { it != mailbox.email }
    }

    fun showToast(message: String, isError: Boolean = false) {
        toastDismissJob?.cancel()
        toast = ComposeToast(message = message, isError = isError)
        toastDismissJob = scope.launch {
            delay(2500)
            toast = null
        }
    }

    /**
     * Reply / forward: the Worker appends the original as a sanitised, formatted
     * quote (`quote_original`, AVE-133), so it is never part of the body or the
     * saved draft. Also true for a reopened draft whose original didn't load.
     */
    val quotesOriginal: Boolean
        get() = mode == ComposeMode.Reply || mode == ComposeMode.ReplyAll || mode == ComposeMode.Forward

    /** What the user wrote; the quote is appended server-side. */
    fun outgoingHtml(): String =
        if (body.contains('<')) body else ComposeHtml.textToHtml(body)

    fun outgoingPlainText(): String = ComposeHtml.stripHtml(body)

    /** The outgoing HTML plus the quoted original, for the 5 MiB estimate. */
    fun sizedHtml(): String = outgoingHtml() + (quotedOriginal?.email?.body.orEmpty())

    fun remainingAttachmentBudget(): Int =
        OutboundLimits.remainingBudget(
            html = sizedHtml(),
            text = outgoingPlainText(),
            attachmentBytes = attachments.map { it.size },
        )

    fun exceedsOutboundLimit(): Boolean =
        OutboundLimits.estimateMessageBytes(
            html = sizedHtml(),
            text = outgoingPlainText(),
            attachmentBytes = attachments.map { it.size },
        ) > OutboundLimits.MAX_MESSAGE_BYTES

    fun addAttachment(attachment: ComposePendingAttachment) {
        attachments = attachments + attachment
    }

    fun removeAttachment(id: String) {
        attachments = attachments.filterNot { it.id == id }
    }

    fun toSendPayload(): JsonObject {
        fun emails(tokens: List<MailAddress>): kotlinx.serialization.json.JsonElement {
            val list = tokens.map { it.email }
            return if (list.size == 1) JsonPrimitive(list[0]) else JsonArray(list.map { JsonPrimitive(it) })
        }
        return buildJsonObject {
            put("to", emails(toTokens))
            if (ccTokens.isNotEmpty()) put("cc", emails(ccTokens))
            if (bccTokens.isNotEmpty()) put("bcc", emails(bccTokens))
            put("subject", subject)
            put("html", outgoingHtml())
            put("text", outgoingPlainText())
            if (quotesOriginal) {
                put("quote_original", true)
                put("quote_time_zone", java.util.TimeZone.getDefault().id)
            }
            val name = fromName
            if (isAliasBound) {
                // Bare address: a display name would pair the alias with the real owner.
                // The Worker substitutes the thread's alias regardless.
                put("from", fromEmail)
            } else if (!name.isNullOrBlank()) {
                put("from", buildJsonObject {
                    put("email", fromEmail)
                    put("name", name)
                })
            } else {
                put("from", fromEmail)
            }
            if (attachments.isNotEmpty()) {
                put(
                    "attachments",
                    buildJsonArray {
                        attachments.forEach { att ->
                            add(
                                buildJsonObject {
                                    put("content", att.base64)
                                    put("filename", att.filename)
                                    put("type", att.mimeType)
                                    put("disposition", "attachment")
                                },
                            )
                        }
                    },
                )
            }
        }
    }

    /** (draftId, threadId, originalEmailId, subject, bodyHtml, recipients) after a server save. */
    var onDraftSaved: ((String, String?, String?, String, String, String) -> Unit)? = null

    /** (draftId, threadId, originalEmailId) after the server copy is removed. */
    var onDraftDeleted: ((String, String?, String?) -> Unit)? = null

    private var lastSavedSnapshot: String? = null

    private val currentSnapshot: String
        get() = listOf(
            fromMailboxId,
            fromEmail,
            toJoined(),
            ccJoined(),
            bccJoined(),
            subject,
            outgoingHtml(),
        ).joinToString("\u0000")

    /**
     * POST /drafts (mirrors iOS ComposeFormModel.performSaveDraft). Sends `draft_id`
     * once the server has assigned one so repeat saves update in place. Callers show
     * the "Draft saved" toast only for explicit saves; returns false on failure. Never
     * writes [errorMessage]: that inline slot is for send/validation errors.
     */
    suspend fun saveDraft(explicit: Boolean = true): Boolean {
        cancelAutoSave()
        commitPendingTokens()
        if (isEmpty) return true
        // The mailbox went read-only (service ended): saving again can't succeed.
        if (writesBlocked) return false
        val snapshot = currentSnapshot
        if (draftId != null && snapshot == lastSavedSnapshot) return true
        // A save is already in flight; the next minimize/explicit save picks up any delta.
        if (isSavingDraft) return true

        // DEBUG preview fixtures (mailbox ids `mb-*`) never hit the network.
        if (fromMailboxId.startsWith("mb-")) {
            if (draftId == null) draftId = UUID.randomUUID().toString()
            lastSavedSnapshot = snapshot
            return true
        }

        isSavingDraft = true
        saveStatus = DraftSaveStatus.Saving
        try {
            val payload = buildJsonObject {
                put("body", outgoingHtml())
                if (toTokens.isNotEmpty()) put("to", toJoined())
                if (ccTokens.isNotEmpty()) put("cc", ccJoined())
                if (bccTokens.isNotEmpty()) put("bcc", bccJoined())
                if (subject.isNotEmpty()) put("subject", subject)
                originalEmailId?.let { put("in_reply_to", it) }
                threadId?.let { put("thread_id", it) }
                draftId?.let { put("draft_id", it) }
            }
            val saved = ApiClient.shared.saveDraft(fromMailboxId, payload)
            val resolved = saved.resolvedId.ifEmpty { draftId.orEmpty() }
            if (isSending) {
                // Send won the race — drop the copy this save just wrote.
                if (resolved.isNotEmpty() && resolved != draftId) {
                    runCatching { ApiClient.shared.deleteEmail(fromMailboxId, resolved) }
                }
                return false
            }
            if (resolved.isNotEmpty()) {
                draftId = resolved
                lastSavedSnapshot = snapshot
                onDraftSaved?.invoke(resolved, threadId, originalEmailId, subject, outgoingHtml(), toJoined())
            }
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiException.ServiceEnded) {
                // The domain's service ended: stop autosaving and say why, once.
                writesBlocked = true
                errorMessage = e.message ?: "This mailbox is read-only"
            } else {
                Log.w("ComposeFormModel", "saveDraft failed", e)
            }
            return false
        } finally {
            isSavingDraft = false
            saveStatus = DraftSaveStatus.Idle
        }
    }

    /** Remove the server copy (after a successful send, or "Delete Draft"). */
    suspend fun deleteSavedDraft() {
        cancelAutoSave()
        val id = draftId?.takeIf { it.isNotEmpty() } ?: return
        if (fromMailboxId.startsWith("mb-")) return
        runCatching { ApiClient.shared.deleteEmail(fromMailboxId, id) }
            .onSuccess {
                draftId = null
                onDraftDeleted?.invoke(id, threadId, originalEmailId)
            }
    }

    fun scheduleAutoSave(onSave: () -> Unit) {
        autoSaveJob?.cancel()
        if (writesBlocked) return
        autoSaveJob = scope.launch {
            delay(1200)
            if (!isEmpty) onSave()
        }
    }

    fun cancelAutoSave() {
        autoSaveJob?.cancel()
        autoSaveJob = null
    }

    private companion object {
        /** Message whose `alias_id` binds this compose; prefers the one carrying the address. */
        fun aliasSource(mode: ComposeMode, original: Email?, draft: Email?): Email? {
            if (mode == ComposeMode.Forward) return null
            val replying = mode == ComposeMode.Reply || mode == ComposeMode.ReplyAll
            val candidates = listOfNotNull(draft, original?.takeIf { replying })
                .filter { it.aliasId != null }
            return candidates.firstOrNull { !it.aliasEmail.isNullOrBlank() } ?: candidates.firstOrNull()
        }
    }

    private fun mergeTokens(existing: List<MailAddress>, draft: String): List<MailAddress> {
        val parts = MailAddress.parseList(draft)
        if (parts.isEmpty()) return existing
        val seen = existing.map { it.id }.toMutableSet()
        val next = existing.toMutableList()
        for (part in parts) {
            if (seen.add(part.id)) next += part
        }
        return next
    }
}

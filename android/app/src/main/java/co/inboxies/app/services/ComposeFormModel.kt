package co.inboxies.app.services

import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.ComposePresentation
import co.inboxies.app.models.Email
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.util.ComposeHtml
import co.inboxies.app.util.QuotedOriginal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

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
    var fromMailboxId: String = mailbox.id
    var fromEmail: String = mailbox.email
    var fromName: String? = mailbox.settings?.fromName
        ?: mailbox.name.takeIf { it != mailbox.email }
    val original: Email? = original

    var toTokens: List<MailAddress> = initialTo
    var ccTokens: List<MailAddress> = emptyList()
    var bccTokens: List<MailAddress> = emptyList()
    var toDraft: String = ""
    var ccDraft: String = ""
    var bccDraft: String = ""
    var subject: String = ""
    var body: String = ""
    var showCcBcc: Boolean = false
    var draftId: String? = draft?.id
    var originalEmailId: String? = original?.id ?: draft?.inReplyTo
    var threadId: String? = original?.threadId ?: original?.id ?: draft?.threadId
    var isSending: Boolean = false
    var isSavingDraft: Boolean = false
    var saveStatus: DraftSaveStatus = DraftSaveStatus.Idle
    var toast: ComposeToast? = null
    var errorMessage: String? = null
    val quotedOriginal: QuotedOriginal?

    private val signature: String
    val signatureText: String get() = signature
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var autoSaveJob: Job? = null
    private var toastDismissJob: Job? = null

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
            !ComposeHtml.bodyHasUserContent(body, signature)

    val hasUnsavedChanges: Boolean
        get() = ComposeHtml.bodyHasUserContent(body, signature) ||
            subject.isNotBlank() ||
            toTokens.isNotEmpty() ||
            ccTokens.isNotEmpty() ||
            bccTokens.isNotEmpty() ||
            toDraft.isNotBlank() ||
            ccDraft.isNotBlank() ||
            bccDraft.isNotBlank()

    init {
        signature = ComposeHtml.signatureText(
            settings = mailbox.settings,
            fromName = fromName,
        )
        quotedOriginal = if (mode == ComposeMode.Reply || mode == ComposeMode.ReplyAll) {
            original?.let { ComposeHtml.quotedOriginal(it) }
        } else {
            null
        }

        val selfAddresses = ComposeHtml.selfAddresses(mailbox)

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
                body = ComposeHtml.forwardBody(original, signature)
            }
            else -> {
                if (initialTo.isNotEmpty()) toTokens = initialTo
                body = ComposeHtml.bodyWithSignature(signature)
            }
        }
    }

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

    fun outgoingHtml(): String {
        var html = ComposeHtml.textToHtml(body)
        quotedOriginal?.let { html += ComposeHtml.quotedHtml(it) }
        return html
    }

    fun outgoingPlainText(): String {
        val quoted = quotedOriginal ?: return body
        val quotedLines = quoted.text.split("\n").map { "> $it" }
        return (listOf(body, "", quoted.header) + quotedLines).joinToString("\n")
    }

    suspend fun saveDraft(explicit: Boolean = true): Boolean {
        cancelAutoSave()
        commitPendingTokens()
        if (isEmpty) return true
        if (explicit) showToast("Draft saved")
        return true
    }

    fun scheduleAutoSave(onSave: () -> Unit) {
        autoSaveJob?.cancel()
        autoSaveJob = scope.launch {
            delay(1200)
            if (!isEmpty) onSave()
        }
    }

    fun cancelAutoSave() {
        autoSaveJob?.cancel()
        autoSaveJob = null
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

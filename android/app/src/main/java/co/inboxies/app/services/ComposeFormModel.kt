package co.inboxies.app.services

import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.ComposePresentation
import co.inboxies.app.models.Email
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.util.ComposeBody
import co.inboxies.app.util.ReplyRecipients
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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

/** Mutable compose form owned by AppModel (mirrors iOS ComposeFormModel). */
class ComposeFormModel(
    val mode: ComposeMode,
    mailbox: Mailbox,
    original: Email? = null,
    draft: Email? = null,
    initialTo: List<MailAddress> = emptyList(),
) {
    var fromEmail: String = mailbox.email
    var fromName: String? = mailbox.settings?.fromName ?: mailbox.name
    val original: Email? = original

    var toTokens: List<MailAddress> = initialTo
    var ccTokens: List<MailAddress> = emptyList()
    var bccTokens: List<MailAddress> = emptyList()
    var subject: String = ""
    var bodyHtml: String = ""
    var showCcBcc: Boolean = false
    var draftId: String? = draft?.id
    var isSending: Boolean = false
    var errorMessage: String? = null

    private val signature: String
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var autoSaveJob: Job? = null

    val displayTitle: String
        get() {
            val subj = subject.trim()
            if (subj.isNotEmpty()) return subj
            return when (mode) {
                ComposeMode.Reply, ComposeMode.ReplyAll ->
                    "Re: ${(original?.subject ?: "").removePrefix("Re: ").trim()}"
                ComposeMode.Forward -> "Fwd: ${original?.subject.orEmpty()}"
                ComposeMode.EditDraft -> "Draft"
                ComposeMode.New -> "New Message"
            }
        }

    val isEmpty: Boolean
        get() = !ComposeBody.composeBodyHasUserContent(bodyHtml, signature) &&
            toTokens.isEmpty() &&
            subject.isBlank()

    val hasUnsavedChanges: Boolean
        get() = ComposeBody.composeBodyHasUserContent(bodyHtml, signature) ||
            subject.isNotBlank() ||
            toTokens.isNotEmpty()

    suspend fun saveDraft(explicit: Boolean = true) {
        // Draft persistence is orchestrated by AppModel / ApiClient when wired;
        // ComposeFormModel keeps the dirty-state contract for minimize/close.
        if (!explicit && isEmpty) return
    }

    init {
        val sigEnabled = mailbox.settings?.signature?.enabled == true
        signature = if (sigEnabled) {
            mailbox.settings?.signature?.html
                ?: mailbox.settings?.signature?.text?.let { "<p>$it</p>" }
                ?: ""
        } else {
            ""
        }

        when {
            draft != null -> {
                toTokens = MailAddress.parseList(draft.recipient)
                ccTokens = MailAddress.parseList(draft.cc)
                bccTokens = MailAddress.parseList(draft.bcc)
                subject = draft.subject
                bodyHtml = draft.body.orEmpty()
                showCcBcc = !draft.cc.isNullOrBlank() || !draft.bcc.isNullOrBlank()
            }
            mode == ComposeMode.Reply || mode == ComposeMode.ReplyAll -> {
                val replyOriginal = ReplyRecipients.ReplyOriginal(
                    sender = original?.sender.orEmpty(),
                    recipient = original?.recipient,
                    cc = original?.cc,
                )
                if (mode == ComposeMode.Reply) {
                    toTokens = ReplyRecipients.replyToAddresses(replyOriginal, mailbox.email)
                        .map { MailAddress.parse(it) ?: MailAddress(email = it) }
                } else {
                    val (to, cc) = ReplyRecipients.replyAllAddresses(replyOriginal, mailbox.email)
                    toTokens = to.map { MailAddress.parse(it) ?: MailAddress(email = it) }
                    ccTokens = cc.map { MailAddress.parse(it) ?: MailAddress(email = it) }
                    showCcBcc = cc.isNotEmpty()
                }
                val base = original?.subject.orEmpty()
                subject = if (base.startsWith("Re:", ignoreCase = true)) base else "Re: $base"
                bodyHtml = if (signature.isNotEmpty()) "<p></p>$signature" else "<p></p>"
            }
            mode == ComposeMode.Forward -> {
                val base = original?.subject.orEmpty()
                subject = if (base.startsWith("Fwd:", ignoreCase = true)) base else "Fwd: $base"
                bodyHtml = if (signature.isNotEmpty()) "<p></p>$signature" else "<p></p>"
            }
            else -> {
                if (initialTo.isNotEmpty()) toTokens = initialTo
                bodyHtml = if (signature.isNotEmpty()) "<p></p>$signature" else "<p></p>"
            }
        }
    }

    fun toJoined(): String = toTokens.joinToString(", ") { it.email }
    fun ccJoined(): String = ccTokens.joinToString(", ") { it.email }
    fun bccJoined(): String = bccTokens.joinToString(", ") { it.email }

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
}

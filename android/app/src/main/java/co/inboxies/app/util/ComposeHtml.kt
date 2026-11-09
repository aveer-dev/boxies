package co.inboxies.app.util

import co.inboxies.app.models.Email
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.utils.DateUtils

/**
 * The message a reply / forward quotes (AVE-133). Shown rendered, read-only, under
 * the editor; the Worker appends it, sanitised, to the sent mail (`quote_original`).
 */
data class QuotedOriginal(
    /** Dock label: "On <date>, <sender> wrote:" or "Forwarded message from <sender>". */
    val header: String,
    /** Header lines shown above the message in the sheet. */
    val detailLines: List<String>,
    val email: Email,
    val isForward: Boolean,
)

/** Port of iOS `ComposeHTML` — rich compose with quoted original kept aside. */
object ComposeHtml {
    fun prefixedSubject(subject: String, prefix: String): String {
        val expected = "$prefix: "
        return if (subject.startsWith(expected)) subject else expected + subject
    }

    /** The fixed line the apps add when the signature is on but has no words. */
    const val DEFAULT_SIGNATURE = "Sent with Inboxies Email"

    /**
     * Whether the mailbox signature is on. Never saved, or the backend's seeded
     * `enabled = false` with no words, counts as on (with [DEFAULT_SIGNATURE]).
     */
    fun signatureEnabled(settings: MailboxSettings?): Boolean {
        val signature = settings?.signature ?: return true
        val configured = !signature.text.isNullOrBlank() || !signature.html.isNullOrBlank()
        return when {
            signature.enabled == false && !configured -> true
            else -> signature.enabled != false
        }
    }

    /**
     * The signature's words, on or off: the web's formatted signature as text (links
     * keep their address), else the saved text, else [DEFAULT_SIGNATURE]. A custom
     * signature replaces the fixed line (AVE-204).
     */
    fun signatureWords(settings: MailboxSettings?): String {
        val signature = settings?.signature
        val html = signature?.html?.trim().orEmpty()
        if (html.isNotEmpty()) {
            val words = signatureHtmlToText(html)
            if (words.isNotEmpty()) return words
        }
        val text = signature?.text?.trim().orEmpty()
        if (text.isNotEmpty()) return text
        return DEFAULT_SIGNATURE
    }

    /** Signature inserted into new mail, replies and forwards when it is on. */
    fun signatureText(settings: MailboxSettings?, fromName: String?): String =
        if (signatureEnabled(settings)) signatureWords(settings) else ""

    private val signatureLink = Regex(
        "<a\\b[^>]*\\bhref=\"([^\"]*)\"[^>]*>(.*?)</a>",
        setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL),
    )

    /**
     * Plain text for the web's signature HTML (port of `shared/signature.ts`
     * `signatureHtmlToText`): a line per paragraph or break, bullets for list items,
     * and "Label (https://…)" for a link unless the label is the address.
     */
    fun signatureHtmlToText(html: String): String {
        val linked = signatureLink.replace(html) { match ->
            val href = decodeSignatureEntities(match.groupValues[1])
            val inner = match.groupValues[2]
            val label = decodeSignatureEntities(inner.replace(Regex("<[^>]*>"), "")).trim()
            val bare = href.replace(Regex("^mailto:", RegexOption.IGNORE_CASE), "")
            if (label.isEmpty() || label == href || label == bare || "$label/" == href) {
                escapeHtml(bare)
            } else {
                "$inner (${escapeHtml(bare)})"
            }
        }
        val marked = linked
            .replace(Regex("[ \\t\\r\\n\\u000C]+"), " ")
            .replace(Regex("(?i)<br\\b[^>]*>"), "\n")
            .replace(Regex("(?i)<li\\b[^>]*>"), "\u0001• ")
            .replace(Regex("(?i)</(p|div|ul|ol|li)\\s*>"), "\u0001")
            .replace(Regex("<[^>]*>"), "")
            .replace(Regex("\u0001[\u0001 ]*"), "\n")
        return decodeSignatureEntities(marked)
            .split("\n")
            .joinToString("\n") { it.replace(Regex("\\s+"), " ").trim() }
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }

    private fun decodeSignatureEntities(text: String): String =
        text
            .replace("&nbsp;", " ")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&amp;", "&")

    fun bodyWithSignature(signature: String): String =
        if (signature.isEmpty()) "" else "\n\n$signature"

    /**
     * True when compose text has user-authored content beyond the mailbox signature.
     * Whitespace is collapsed on both sides: the editor turns the signature's line
     * breaks into paragraphs, which mustn't read as new content.
     */
    fun bodyHasUserContent(body: String, signature: String): Boolean {
        val collapse = { value: String -> value.replace(Regex("\\s+"), " ").trim() }
        var text = collapse(stripHtml(body))
        val sig = collapse(signature)
        if (sig.isNotEmpty()) {
            val index = text.indexOf(sig)
            if (index >= 0) {
                text = text.removeRange(index, index + sig.length)
            }
        }
        return text.trim().isNotEmpty()
    }

    fun stripHtml(html: String): String =
        html
            .replace(Regex("(?i)<br\\s*/?>"), "\n")
            .replace(Regex("(?i)</p>"), "\n\n")
            .replace(Regex("<[^>]+>"), "")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .trim()

    fun escapeHtml(text: String): String =
        text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")

    fun textToHtml(text: String): String {
        val withBreaks = escapeHtml(text).replace("\n", "<br>")
        return "<p>$withBreaks</p>"
    }

    fun quotedOriginal(from: Email, isForward: Boolean = false): QuotedOriginal? {
        val body = from.body ?: from.snippet.orEmpty()
        if (body.isBlank()) return null
        val date = DateUtils.formatMediumDateTime(from.date)
        val header = if (isForward) {
            "Forwarded message from ${from.formattedFrom}"
        } else {
            "On $date, ${from.formattedFrom} wrote:"
        }
        val detailLines = if (isForward) {
            listOf(
                "---------- Forwarded message ---------",
                "From: ${from.formattedFrom}",
                "Date: $date",
                "Subject: ${from.subject}",
                "To: ${from.recipient}",
            )
        } else {
            listOf(header)
        }
        return QuotedOriginal(header = header, detailLines = detailLines, email = from, isForward = isForward)
    }

    fun editableReply(fromDraftHtml: String, quotedHeader: String?): String {
        var text = stripHtml(fromDraftHtml)
        // Drafts saved before AVE-133 carry the forwarded message inline.
        val forwarded = text.indexOf("---------- Forwarded message")
        if (forwarded >= 0) text = text.substring(0, forwarded)
        if (!quotedHeader.isNullOrEmpty()) {
            val index = text.lastIndexOf(quotedHeader)
            if (index >= 0) text = text.substring(0, index)
        } else {
            val match = Regex("(?m)^On .+ wrote:\\s*$").findAll(text).lastOrNull()
            if (match != null) text = text.substring(0, match.range.first)
        }
        return text.trim()
    }

    fun selfAddresses(mailbox: Mailbox): Set<String> =
        setOf(mailbox.email, mailbox.id)
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()

    fun isSelfAddress(address: String, selfAddresses: Set<String>): Boolean =
        address.trim().lowercase() in selfAddresses

    fun replyFields(original: Email, selfAddresses: Set<String>): List<MailAddress> {
        if (isSelfAddress(original.fromAddress.email, selfAddresses)) {
            val seen = mutableSetOf<String>()
            val to = mutableListOf<MailAddress>()
            for (recipient in original.toAddresses) {
                val email = recipient.email.trim()
                if (email.isEmpty()) continue
                val normalized = email.lowercase()
                if (normalized in selfAddresses || !seen.add(normalized)) continue
                to += recipient
            }
            return to.ifEmpty { listOf(original.fromAddress) }
        }
        return listOf(original.fromAddress)
    }

    fun replyAllFields(
        original: Email,
        selfAddresses: Set<String>,
    ): Pair<List<MailAddress>, List<MailAddress>> {
        val to = mutableListOf<MailAddress>()
        val toSeen = mutableSetOf<String>()

        fun appendUnique(address: MailAddress, into: MutableList<MailAddress>, seen: MutableSet<String>) {
            val email = address.email.trim()
            if (email.isEmpty()) return
            val normalized = email.lowercase()
            if (normalized in selfAddresses || !seen.add(normalized)) return
            into += address
        }

        appendUnique(original.fromAddress, to, toSeen)
        for (recipient in original.toAddresses) {
            appendUnique(recipient, to, toSeen)
        }

        val cc = mutableListOf<MailAddress>()
        val ccSeen = mutableSetOf<String>()
        for (recipient in original.ccAddresses) {
            val normalized = recipient.email.lowercase()
            if (normalized in selfAddresses || normalized in toSeen || !ccSeen.add(normalized)) continue
            cc += recipient
        }
        return to to cc
    }
}

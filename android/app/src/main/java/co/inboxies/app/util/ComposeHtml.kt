package co.inboxies.app.util

import co.inboxies.app.models.Email
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.utils.DateUtils

data class QuotedOriginal(
    val header: String,
    val text: String,
)

/** Port of iOS `ComposeHTML` — plain-text compose with quoted original kept aside. */
object ComposeHtml {
    fun prefixedSubject(subject: String, prefix: String): String {
        val expected = "$prefix: "
        return if (subject.startsWith(expected)) subject else expected + subject
    }

    fun signatureText(settings: MailboxSettings?, fromName: String?): String {
        val signature = settings?.signature
        val configured = !signature?.text.isNullOrBlank() || !signature?.html.isNullOrBlank()
        val enabled = when {
            signature == null -> true
            // Backend seeds new mailboxes with enabled=false and empty text; treat that
            // unconfigured state as on, matching iOS (`enabled ?? true`).
            signature.enabled == false && !configured -> true
            else -> signature.enabled != false
        }
        if (!enabled) return ""
        val html = signature?.html?.trim().orEmpty()
        if (html.isNotEmpty()) {
            val stripped = stripHtml(html)
            if (stripped.isNotEmpty()) return stripped
        }
        val text = signature?.text?.trim().orEmpty()
        if (text.isNotEmpty()) return text
        return "Sent with Inboxies Email"
    }

    fun bodyWithSignature(signature: String): String =
        if (signature.isEmpty()) "" else "\n\n$signature"

    fun bodyHasUserContent(body: String, signature: String): Boolean {
        var text = body
        if (signature.isNotEmpty()) {
            val index = text.indexOf(signature)
            if (index >= 0) {
                text = text.removeRange(index, index + signature.length)
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

    fun quotedOriginal(from: Email): QuotedOriginal? {
        val text = stripHtml(from.body ?: from.snippet.orEmpty())
        if (text.isEmpty()) return null
        return QuotedOriginal(
            header = "On ${DateUtils.formatMediumDateTime(from.date)}, ${from.formattedFrom} wrote:",
            text = text,
        )
    }

    fun quotedHtml(from: QuotedOriginal): String {
        val header = escapeHtml(from.header)
        val bodyToQuote = escapeHtml(from.text).replace("\n", "<br>")
        return "<br><blockquote style=\"border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;\">$header<br><br>$bodyToQuote</blockquote>"
    }

    fun editableReply(fromDraftHtml: String, quotedHeader: String?): String {
        var text = stripHtml(fromDraftHtml)
        if (!quotedHeader.isNullOrEmpty()) {
            val index = text.lastIndexOf(quotedHeader)
            if (index >= 0) text = text.substring(0, index)
        } else {
            val match = Regex("(?m)^On .+ wrote:\\s*$").findAll(text).lastOrNull()
            if (match != null) text = text.substring(0, match.range.first)
        }
        return text.trim()
    }

    fun forwardBody(original: Email, signature: String): String {
        val parts = mutableListOf<String>()
        if (signature.isEmpty()) {
            parts += ""
        } else {
            parts += ""
            parts += ""
            parts += signature
        }
        parts += ""
        parts += "---------- Forwarded message ----------"
        parts += "From: ${original.formattedFrom}"
        parts += "Date: ${DateUtils.formatMediumDateTime(original.date)}"
        parts += "Subject: ${original.subject}"
        parts += "To: ${original.recipient}"
        parts += ""
        parts += stripHtml(original.body.orEmpty())
        return parts.joinToString("\n")
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

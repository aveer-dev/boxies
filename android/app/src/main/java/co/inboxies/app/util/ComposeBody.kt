package co.inboxies.app.util

/** Port of shared/compose-body.ts */
object ComposeBody {
    private fun stripTags(html: String): String =
        html.replace(Regex("<[^>]*>"), "").replace(Regex("\\s+"), " ").trim()

    /**
     * Whether compose HTML has user-authored text beyond empty paragraphs and the
     * mailbox signature. Signature-only bodies should not trigger draft saves.
     */
    fun composeBodyHasUserContent(bodyHtml: String, signatureHtml: String = ""): Boolean {
        val bodyText = stripTags(bodyHtml)
        if (bodyText.isEmpty()) return false
        val signatureText = stripTags(signatureHtml)
        if (signatureText.isEmpty()) return true
        if (bodyText == signatureText) return false
        if (!bodyText.contains(signatureText)) return true
        return bodyText.replace(signatureText, "").replace(Regex("\\s+"), " ").trim().isNotEmpty()
    }
}

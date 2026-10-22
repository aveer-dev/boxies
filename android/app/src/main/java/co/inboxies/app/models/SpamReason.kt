package co.inboxies.app.models

/**
 * Copy for `emails.classification_reason` codes (AVE-94). Mirrors web
 * `shared/spam-reason.ts` and iOS `SpamReason` in Models.swift (parity test:
 * `android/test/spam-reason-parity.test.mjs`).
 */
object SpamReason {
    const val UNVERIFIED_TITLE = "Unverified sender"

    /** One line for the Spam / Screened out reader, or null when we can't say. */
    fun line(reason: String?, folderId: String?): String? {
        if (folderId != "spam" && folderId != "screened_out") return null
        return when (reason) {
            "auth-failed" -> "Failed sender authentication"
            "spam-headers" -> "Flagged by spam filter"
            "ai-spam" -> "Marked as spam by AI check"
            "sender-rejected" -> "You blocked this sender"
            else -> null
        }
    }

    fun unverifiedDetail(sender: String): String {
        val at = sender.lastIndexOf('@')
        val domain = if (at >= 0) sender.substring(at + 1).trim().trimEnd('>') else ""
        return if (domain.isEmpty()) {
            "We couldn’t confirm who sent this message."
        } else {
            "We couldn’t confirm this message really came from $domain."
        }
    }
}

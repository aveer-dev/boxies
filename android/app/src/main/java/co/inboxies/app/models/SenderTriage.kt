package co.inboxies.app.models

import kotlinx.serialization.Serializable

/**
 * `POST sender-triage/approve` and `/reject` response: the queued Screener mail
 * that moved with the decision (AVE-159 Undo moves it back).
 */
@Serializable
data class SenderTriageDecisionResponse(
    val moved: Moved? = null,
) {
    @Serializable
    data class Moved(
        val moved: Int? = null,
        val ids: List<String>? = null,
    )
}

/**
 * Accept / Decline in the Screening room and its Undo (AVE-159).
 * Twin: iOS `ScreenerDecision` in Models.swift.
 */
object ScreenerDecision {
    private val folderNames = mapOf(
        "promotions" to "Promotions",
        "updates" to "Updates",
    )

    /**
     * Toast after the decision. [destinationFolderId] null means Decline. Inbox is
     * the plain Accept (pins nothing, AVE-139); Promotions / Updates stick.
     */
    fun toastTitle(destinationFolderId: String?): String {
        if (destinationFolderId == null) return "Declined"
        val name = folderNames[destinationFolderId] ?: return "Accepted"
        return "Accepted · future mail goes to $name"
    }

    /**
     * Messages Undo moves back to the Screener: everything the decision refiled,
     * plus the one it was made from. Order kept, duplicates dropped.
     */
    fun restoreIds(response: SenderTriageDecisionResponse?, emailId: String): List<String> =
        (response?.moved?.ids.orEmpty() + emailId).filter { it.isNotEmpty() }.distinct()
}

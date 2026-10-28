package co.inboxies.app.models

import kotlinx.serialization.Serializable

/**
 * `POST /emails/:id/move` response. Spam verdicts carry the sender lesson
 * (AVE-95), the one-click unsubscribe outcome (AVE-99), and the retroactive
 * rescue / refile count plus an undo token (AVE-98).
 */
@Serializable
data class MoveEmailResponse(
    val status: String? = null,
    val senderStatus: String? = null,
    val unsubscribe: String? = null,
    val rescuedCount: Int? = null,
    val undoToken: String? = null,
)

/**
 * Toast copy for a move that crossed Spam (docs/spam-management-plan.md §6).
 * Twins: web `app/lib/spam-verdict.ts`, iOS `SpamVerdictToast` in Models.swift.
 */
object SpamVerdictToast {
    private val folderNames = mapOf(
        "inbox" to "Inbox",
        "promotions" to "Promotions",
        "updates" to "Updates",
        "archive" to "Archive",
    )

    /**
     * "Moved to Inbox · future mail from ada@x will skip Spam · 3 more moved",
     * "Reported as spam · 3 more moved". Null when the move taught nothing.
     */
    fun title(response: MoveEmailResponse, folderId: String, sender: String?): String? {
        val status = response.senderStatus ?: return null
        val count = response.rescuedCount ?: 0
        val more = if (count > 0) " · $count more moved" else ""
        if (status == "rejected") {
            val base = when (response.unsubscribe) {
                "sent" -> "Reported as spam and unsubscribed"
                "failed" -> "Reported as spam · couldn't unsubscribe"
                else -> "Reported as spam"
            }
            return base + more
        }
        val moved = folderNames[folderId]?.let { "Moved to $it" } ?: "Moved out of Spam"
        val trimmed = sender?.trim().orEmpty()
        val skip = if (trimmed.isEmpty()) "" else " · future mail from $trimmed will skip Spam"
        return moved + skip + more
    }
}

package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import co.inboxies.app.models.Email

enum class SwipeQuickAction(val title: String) {
    DELETE("Delete"),
    ARCHIVE("Archive"),
    STAR("Star"),
    TOGGLE_READ("Mark Read/Unread"),
    REPLY("Reply");

    fun label(forEmail: Email): String = when (this) {
        STAR -> if (forEmail.starred) "Unstar" else "Star"
        TOGGLE_READ -> if (forEmail.read) "Unread" else "Read"
        else -> title
    }
}

enum class EmailFolderKind {
    INBOX,
    SENT,
    ARCHIVE,
    TRASH,
    DRAFT,
    OTHER,
}

object EmailFolderContext {
    fun kind(email: Email, fallbackFolderId: String?): EmailFolderKind {
        val folderId = normalizedFolderId(email.folderId) ?: normalizedFolderId(fallbackFolderId)
        return when (folderId) {
            "inbox" -> EmailFolderKind.INBOX
            "sent" -> EmailFolderKind.SENT
            "archive" -> EmailFolderKind.ARCHIVE
            "trash" -> EmailFolderKind.TRASH
            "draft", "drafts" -> EmailFolderKind.DRAFT
            else -> if (email.isDraft) EmailFolderKind.DRAFT else EmailFolderKind.OTHER
        }
    }

    private fun normalizedFolderId(id: String?): String? {
        if (id.isNullOrEmpty()) return null
        return id.lowercase()
    }
}

data class EmailSwipeLayout(
    val trailingActions: List<SwipeQuickAction>,
    val trailingAllowsFullSwipe: Boolean,
    val leadingActions: List<SwipeQuickAction>,
    val leadingAllowsFullSwipe: Boolean,
    val showsMore: Boolean,
) {
    companion object {
        fun resolve(
            email: Email,
            fallbackFolderId: String?,
            preferences: SwipeActionPreferences,
        ): EmailSwipeLayout {
            return when (EmailFolderContext.kind(email, fallbackFolderId)) {
                EmailFolderKind.ARCHIVE -> EmailSwipeLayout(
                    trailingActions = listOf(SwipeQuickAction.DELETE),
                    trailingAllowsFullSwipe = true,
                    leadingActions = emptyList(),
                    leadingAllowsFullSwipe = false,
                    showsMore = true,
                )
                EmailFolderKind.TRASH -> EmailSwipeLayout(
                    trailingActions = listOf(SwipeQuickAction.DELETE),
                    trailingAllowsFullSwipe = true,
                    leadingActions = listOf(SwipeQuickAction.ARCHIVE),
                    leadingAllowsFullSwipe = true,
                    showsMore = true,
                )
                EmailFolderKind.DRAFT -> EmailSwipeLayout(
                    trailingActions = listOf(SwipeQuickAction.DELETE),
                    trailingAllowsFullSwipe = true,
                    leadingActions = emptyList(),
                    leadingAllowsFullSwipe = false,
                    showsMore = true,
                )
                EmailFolderKind.INBOX, EmailFolderKind.SENT, EmailFolderKind.OTHER -> EmailSwipeLayout(
                    trailingActions = preferences.leftActions,
                    trailingAllowsFullSwipe = preferences.leftActions.isNotEmpty(),
                    leadingActions = preferences.rightActions,
                    leadingAllowsFullSwipe = preferences.rightActions.isNotEmpty(),
                    showsMore = true,
                )
            }
        }
    }
}

data class EmailActionAvailability(val email: Email) {
    val showsArchive: Boolean
        get() = EmailFolderContext.kind(email, null) != EmailFolderKind.ARCHIVE && !email.isDraft

    val showsDelete: Boolean get() = true

    val showsReplyActions: Boolean get() = !email.isDraft
}

data class SwipeActionPreferences(
    val leftActions: List<SwipeQuickAction> = listOf(SwipeQuickAction.DELETE),
    val rightActions: List<SwipeQuickAction> = listOf(SwipeQuickAction.ARCHIVE),
) {
    fun save(prefs: SharedPreferences) {
        prefs.edit {
            putString(KEY_LEFT, leftActions.joinToString(",") { it.name })
            putString(KEY_RIGHT, rightActions.joinToString(",") { it.name })
        }
    }

    companion object {
        const val MAX_ACTIONS_PER_EDGE = 3
        private const val KEY_LEFT = "swipe_left_actions"
        private const val KEY_RIGHT = "swipe_right_actions"
        private const val PREFS = "inboxies_swipe"

        fun prefs(context: Context): SharedPreferences =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        fun load(context: Context): SwipeActionPreferences = load(prefs(context))

        fun load(prefs: SharedPreferences): SwipeActionPreferences {
            fun parse(raw: String?, fallback: List<SwipeQuickAction>): List<SwipeQuickAction> {
                if (raw.isNullOrBlank()) return fallback
                return raw.split(",")
                    .mapNotNull { name -> SwipeQuickAction.entries.firstOrNull { it.name == name } }
                    .distinct()
                    .take(MAX_ACTIONS_PER_EDGE)
                    .ifEmpty { fallback }
            }
            return SwipeActionPreferences(
                leftActions = parse(prefs.getString(KEY_LEFT, null), listOf(SwipeQuickAction.DELETE)),
                rightActions = parse(prefs.getString(KEY_RIGHT, null), listOf(SwipeQuickAction.ARCHIVE)),
            )
        }
    }
}

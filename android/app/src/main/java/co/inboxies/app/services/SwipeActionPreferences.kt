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

data class SwipeActionPreferences(
    val leftActions: List<SwipeQuickAction> = listOf(SwipeQuickAction.ARCHIVE, SwipeQuickAction.DELETE),
    val rightActions: List<SwipeQuickAction> = listOf(SwipeQuickAction.TOGGLE_READ, SwipeQuickAction.STAR),
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
                    .take(MAX_ACTIONS_PER_EDGE)
            }
            return SwipeActionPreferences(
                leftActions = parse(prefs.getString(KEY_LEFT, null), listOf(SwipeQuickAction.ARCHIVE, SwipeQuickAction.DELETE)),
                rightActions = parse(prefs.getString(KEY_RIGHT, null), listOf(SwipeQuickAction.TOGGLE_READ, SwipeQuickAction.STAR)),
            )
        }
    }
}

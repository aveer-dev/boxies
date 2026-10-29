package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * The mailbox the app reopens on launch (AVE-90): the last one the user opened, until
 * another is opened. Cleared on sign-out with the rest of the session. Same
 * `inboxies_prefs` file as [AutofillMailboxPreference].
 */
object LastMailboxPreference {
    private const val PREFS_NAME = "inboxies_prefs"
    private const val KEY_MAILBOX_ID = "last_mailbox_id"

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun mailboxId(): String? = prefs?.getString(KEY_MAILBOX_ID, null)?.takeIf { it.isNotBlank() }

    fun save(mailboxId: String) {
        val current = prefs ?: return
        if (current.getString(KEY_MAILBOX_ID, null) == mailboxId) return
        current.edit { putString(KEY_MAILBOX_ID, mailboxId) }
    }

    fun clear() {
        prefs?.edit { remove(KEY_MAILBOX_ID) }
    }
}

/** The remembered mailbox while the user still has it; otherwise the first listed. */
fun initialMailboxId(remembered: String?, available: List<String>): String? =
    remembered?.takeIf { it in available } ?: available.firstOrNull()

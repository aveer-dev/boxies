package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Mailbox the autofill service creates private emails in: the one last selected in the
 * app. Autofill can run without the UI (no [AppModel]), so it lives in `inboxies_prefs`.
 */
object AutofillMailboxPreference {
    private const val PREFS_NAME = "inboxies_prefs"
    private const val KEY_MAILBOX_ID = "autofill_mailbox_id"

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

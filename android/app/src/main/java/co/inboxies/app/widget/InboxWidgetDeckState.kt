package co.inboxies.app.widget

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import co.inboxies.app.ui.widget.InboxWidgetSnapshot

/**
 * Per-widget Glance state (`PreferencesGlanceStateDefinition`) for "Today's inbox"
 * (AVE-150). Each placed widget keeps its own deck position and mailbox.
 *
 * The front index is stored with the [contentKey] of the snapshot it was set on, so
 * when the app writes a different snapshot the deck is back on its first card without
 * the app having to touch every widget's state.
 */
object InboxWidgetDeckState {
    /** Which thread is on top of the deck. */
    val frontIndexKey = intPreferencesKey("frontIndex")
    /** [contentKey] of the snapshot [frontIndexKey] belongs to. */
    val frontContentKey = stringPreferencesKey("frontContentKey")
    /** Configured mailbox; absent = follow the last active mailbox. */
    val mailboxIdKey = stringPreferencesKey("mailboxId")
    /** Bumped by the app on every data write so Glance recomposes with the new snapshot. */
    val dataVersionKey = longPreferencesKey("dataVersion")

    fun configuredMailboxId(prefs: Preferences): String? = prefs[mailboxIdKey]?.takeIf { it.isNotBlank() }

    /** The deck's front card, always inside the snapshot's thread list. */
    fun frontIndex(prefs: Preferences, snapshot: InboxWidgetSnapshot?): Int {
        val count = snapshot?.threads?.size ?: 0
        if (count == 0) return 0
        if (prefs[frontContentKey] != snapshot!!.contentKey) return 0
        val stored = prefs[frontIndexKey] ?: 0
        return ((stored % count) + count) % count
    }

    /**
     * › on the widget: the next thread comes to the front, wrapping after the last.
     * Returns the new index, or null when there's no deck to flip.
     */
    fun advance(prefs: MutablePreferences, snapshot: InboxWidgetSnapshot?): Int? {
        val count = snapshot?.threads?.size ?: 0
        if (snapshot == null || count < 2) return null
        val next = (frontIndex(prefs, snapshot) + 1) % count
        prefs[frontIndexKey] = next
        prefs[frontContentKey] = snapshot.contentKey
        return next
    }
}

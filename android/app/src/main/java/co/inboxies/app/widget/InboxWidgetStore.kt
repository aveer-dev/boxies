package co.inboxies.app.widget

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * "Today's inbox" data on disk (AVE-150), the twin of iOS `InboxWidgetStore`. The app
 * writes it; the Glance widget (same process) only reads it. The deck position lives
 * in each widget's own Glance state ([InboxWidgetDeckState]), not here.
 *
 * - Snapshots: one JSON string per mailbox (`snapshot.<mailboxId>`).
 * - Mailboxes: the signed-in user's list, for the configuration screen.
 * - Active mailbox: the one the app last published, i.e. the last active mailbox
 *   (AVE-90). A widget without a configured mailbox follows it.
 *
 * No session token, no network: the widget only draws what the app wrote.
 */
class InboxWidgetStore(private val prefs: SharedPreferences) {
    @Serializable
    data class MailboxRef(val id: String, val address: String)

    fun snapshot(mailboxId: String): InboxWidgetSnapshot? =
        prefs.getString(SNAPSHOT_PREFIX + mailboxId, null)?.let(InboxWidgetSnapshotJson::decode)

    /**
     * Writes [snapshot] when its content changed (`updatedAt` alone doesn't count) and
     * marks its mailbox active. Returns true when the widget needs a redraw.
     */
    fun write(snapshot: InboxWidgetSnapshot): Boolean {
        val activeChanged = activeMailboxId() != snapshot.mailboxId
        val previous = snapshot(snapshot.mailboxId)
        val contentChanged = previous == null || !previous.hasSameContent(snapshot)
        if (!contentChanged && !activeChanged) return false
        prefs.edit {
            if (contentChanged) putString(SNAPSHOT_PREFIX + snapshot.mailboxId, InboxWidgetSnapshotJson.encode(snapshot))
            putString(KEY_ACTIVE_MAILBOX, snapshot.mailboxId)
        }
        return true
    }

    fun activeMailboxId(): String? = prefs.getString(KEY_ACTIVE_MAILBOX, null)?.takeIf { it.isNotBlank() }

    /** The mailbox a widget shows: its configured one, else the last active one. */
    fun resolveMailboxId(configured: String?): String? = configured?.takeIf { it.isNotBlank() } ?: activeMailboxId()

    fun mailboxes(): List<MailboxRef> = prefs.getString(KEY_MAILBOXES, null)?.let { text ->
        runCatching { json.decodeFromString(mailboxListSerializer, text) }.getOrNull()
    }.orEmpty()

    /** Returns true when the list changed. */
    fun writeMailboxes(mailboxes: List<MailboxRef>): Boolean {
        if (mailboxes == mailboxes()) return false
        prefs.edit { putString(KEY_MAILBOXES, json.encodeToString(mailboxListSerializer, mailboxes)) }
        return true
    }

    /** Sign-out: nothing about the account stays on the home screen. */
    fun removeAll() {
        prefs.edit { clear() }
    }

    companion object {
        const val PREFS_NAME = "inboxies_widget"
        private const val SNAPSHOT_PREFIX = "snapshot."
        private const val KEY_ACTIVE_MAILBOX = "active_mailbox_id"
        private const val KEY_MAILBOXES = "mailboxes"
        private val json = Json { ignoreUnknownKeys = true }
        private val mailboxListSerializer = ListSerializer(MailboxRef.serializer())

        fun from(context: Context): InboxWidgetStore =
            InboxWidgetStore(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))
    }
}

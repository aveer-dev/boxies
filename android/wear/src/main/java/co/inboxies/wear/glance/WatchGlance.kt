package co.inboxies.wear.glance

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import co.inboxies.wear.data.WatchEmail
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What the Inbox Tile and the unread complication show (AVE-147, plan phase 3; twin of
 * the watchOS `WatchGlanceSnapshot`, AVE-146): the active mailbox's Inbox unread count
 * (the server's New total) and who sent the newest unread conversations. No token, no
 * message content: the Tile and complication only ever read this.
 */
@Serializable
data class WatchGlanceSnapshot(
    val mailboxId: String,
    val unreadCount: Int,
    /** Senders of the newest unread conversations, newest first, at most [MAX_SENDERS]. */
    val senders: List<String> = emptyList(),
    /** Epoch millis. */
    val updatedAt: Long = 0,
) {
    /** Same mailbox, count and senders; [updatedAt] is ignored. */
    fun hasSameContent(other: WatchGlanceSnapshot?): Boolean =
        other != null && mailboxId == other.mailboxId && unreadCount == other.unreadCount && senders == other.senders

    companion object {
        const val MAX_SENDERS = 3

        /** Clamps the count and keeps up to [MAX_SENDERS] distinct, non-blank senders (none at inbox zero). */
        fun of(mailboxId: String, unreadCount: Int, senders: List<String>, updatedAt: Long): WatchGlanceSnapshot {
            val count = maxOf(0, unreadCount)
            val kept = if (count == 0) {
                emptyList()
            } else {
                senders.map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(minOf(MAX_SENDERS, count))
            }
            return WatchGlanceSnapshot(mailboxId, count, kept, updatedAt)
        }
    }
}

/** Builds and formats glance snapshots. Pure, for tests. */
object WatchGlance {
    /** Older than this, a Tile or complication request asks the app to read the Inbox again. */
    const val STALE_AFTER_MILLIS: Long = 15 * 60 * 1000L

    /**
     * From a loaded Inbox page: the server's Inbox unread total when the folders call
     * answered, else the unread rows on the page; senders of the newest unread rows.
     */
    fun snapshot(mailboxId: String, inboxFolderUnread: Int?, emails: List<WatchEmail>, now: Long): WatchGlanceSnapshot {
        val unread = emails.filter { it.isUnread }
        return WatchGlanceSnapshot.of(
            mailboxId = mailboxId,
            unreadCount = inboxFolderUnread ?: unread.size,
            senders = unread.map { it.displaySender },
            updatedAt = now,
        )
    }

    /** The count on a small surface: "0" … "99", then "99+". */
    fun countText(count: Int): String = if (count > 99) "99+" else maxOf(0, count).toString()

    /** "No unread mail", "1 unread", "12 unread". */
    fun summary(count: Int): String = when {
        count <= 0 -> "No unread mail"
        else -> "${countText(count)} unread"
    }

    fun isStale(snapshot: WatchGlanceSnapshot?, now: Long): Boolean =
        snapshot == null || now - snapshot.updatedAt > STALE_AFTER_MILLIS || now < snapshot.updatedAt
}

/** Where the snapshot lives on the watch. */
interface WatchGlanceStorage {
    fun read(): WatchGlanceSnapshot?

    fun write(snapshot: WatchGlanceSnapshot)

    fun clear()
}

/**
 * The app side of the glance: [WatchStore][co.inboxies.wear.WatchStore] publishes after
 * each Inbox refresh or action and clears on sign-out. [read] is for the Tile and
 * complication (same process).
 */
interface WatchGlanceSink {
    fun read(): WatchGlanceSnapshot?

    fun publish(snapshot: WatchGlanceSnapshot)

    fun clear()

    /** DEBUG previews and tests that don't care: nothing is stored. */
    object None : WatchGlanceSink {
        override fun read(): WatchGlanceSnapshot? = null

        override fun publish(snapshot: WatchGlanceSnapshot) = Unit

        override fun clear() = Unit
    }
}

/**
 * Writes the snapshot and calls [onChanged] (request Tile + complication updates) only
 * when what they'd show changed, so a refresh that finds nothing new costs no redraw.
 */
class WatchGlancePublisher(
    private val storage: WatchGlanceStorage,
    private val onChanged: () -> Unit,
) : WatchGlanceSink {
    override fun read(): WatchGlanceSnapshot? = storage.read()

    override fun publish(snapshot: WatchGlanceSnapshot) {
        val previous = storage.read()
        storage.write(snapshot)
        if (!snapshot.hasSameContent(previous)) onChanged()
    }

    override fun clear() {
        if (storage.read() == null) return
        storage.clear()
        onChanged()
    }
}

/** [WatchGlanceStorage] in plain SharedPreferences (nothing secret in it), as JSON. */
class WatchGlancePrefs(context: Context) : WatchGlanceStorage {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun read(): WatchGlanceSnapshot? {
        val raw = prefs.getString(KEY, null) ?: return null
        return runCatching { json.decodeFromString(WatchGlanceSnapshot.serializer(), raw) }.getOrNull()
    }

    override fun write(snapshot: WatchGlanceSnapshot) {
        prefs.edit { putString(KEY, json.encodeToString(WatchGlanceSnapshot.serializer(), snapshot)) }
    }

    override fun clear() {
        // commit: a sign-out wipe must be on disk before the process can be killed.
        prefs.edit(commit = true) { remove(KEY) }
    }

    private companion object {
        const val PREFS = "inboxies_watch_glance"
        const val KEY = "watchGlance.snapshot"
        val json = Json { ignoreUnknownKeys = true }
    }
}

/** In-memory storage: unit tests. */
class MemoryWatchGlanceStorage(var snapshot: WatchGlanceSnapshot? = null) : WatchGlanceStorage {
    override fun read(): WatchGlanceSnapshot? = snapshot

    override fun write(snapshot: WatchGlanceSnapshot) {
        this.snapshot = snapshot
    }

    override fun clear() {
        snapshot = null
    }
}

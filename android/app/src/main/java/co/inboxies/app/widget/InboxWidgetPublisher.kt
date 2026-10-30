package co.inboxies.app.widget

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import co.inboxies.app.models.Mailbox
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * App side of the "Today's inbox" widget (AVE-150), the twin of iOS
 * `InboxWidgetPublisher`: writes snapshots and the mailbox list to [InboxWidgetStore]
 * and redraws placed widgets. Writes that don't change the content are skipped, so
 * refresh bursts don't redraw the home screen. Work runs in order on a background queue,
 * so a sign-out [clear] can't be overtaken by an earlier publish.
 */
object InboxWidgetPublisher {
    private const val TAG = "InboxWidget"

    @Volatile
    private var appContext: Context? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = Channel<suspend (Context) -> Unit>(Channel.UNLIMITED)

    fun init(context: Context) {
        if (appContext != null) return
        appContext = context.applicationContext
        scope.launch {
            for (job in queue) {
                val ctx = appContext ?: continue
                runCatching { job(ctx) }.onFailure { Log.w(TAG, "Widget update failed", it) }
            }
        }
    }

    /** Writes the snapshot; redraws the widgets when it changed. */
    fun publish(snapshot: InboxWidgetSnapshot) = enqueue { ctx ->
        if (InboxWidgetStore.from(ctx).write(snapshot)) redrawAll(ctx)
    }

    /** Mirrors the signed-in user's mailboxes for the configuration screen. */
    fun publishMailboxes(mailboxes: List<Mailbox>) = enqueue { ctx ->
        val refs = mailboxes.map { InboxWidgetStore.MailboxRef(it.id, it.email) }
        if (InboxWidgetStore.from(ctx).writeMailboxes(refs)) redrawAll(ctx)
    }

    /** Sign-out: the widget goes back to "Open Inboxies". */
    fun clear() = enqueue { ctx ->
        InboxWidgetStore.from(ctx).removeAll()
        redrawAll(ctx)
    }

    /** Redraw without new data, e.g. the system switched between light and dark. */
    fun redraw() = enqueue { ctx -> redrawAll(ctx) }

    /**
     * DEBUG `previewWidgetData` intent extra (`mail` / `zero`): puts the sample snapshot
     * in the store so the real home-screen widget can be reviewed without signing in.
     * iOS twin: `-previewWidgetData`.
     */
    fun publishPreviewData(inboxZero: Boolean) = enqueue { ctx ->
        val sample = if (inboxZero) InboxWidgetSnapshot.SampleInboxZero else InboxWidgetSnapshot.SampleHasMail
        val store = InboxWidgetStore.from(ctx)
        store.writeMailboxes(listOf(InboxWidgetStore.MailboxRef(sample.mailboxId, sample.mailboxAddress)))
        store.write(sample)
        redrawAll(ctx)
    }

    private fun enqueue(job: suspend (Context) -> Unit) {
        if (appContext == null) return
        queue.trySend(job)
    }

    /**
     * Bumps each widget's data version (so a running Glance session recomposes and
     * re-reads the store) and redraws it.
     */
    private suspend fun redrawAll(context: Context) {
        val manager = GlanceAppWidgetManager(context)
        val widget = TodayInboxWidget()
        for (id in manager.getGlanceIds(TodayInboxWidget::class.java)) {
            updateAppWidgetState(context, id) { prefs ->
                prefs[InboxWidgetDeckState.dataVersionKey] = (prefs[InboxWidgetDeckState.dataVersionKey] ?: 0L) + 1
            }
            widget.update(context, id)
        }
    }
}

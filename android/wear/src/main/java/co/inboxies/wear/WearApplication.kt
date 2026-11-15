package co.inboxies.wear

import android.app.Application
import android.content.ComponentName
import android.util.Log
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import co.inboxies.wear.data.WatchApi
import co.inboxies.wear.glance.InboxTileService
import co.inboxies.wear.glance.UnreadComplicationService
import co.inboxies.wear.glance.WatchGlance
import co.inboxies.wear.glance.WatchGlancePrefs
import co.inboxies.wear.glance.WatchGlancePublisher
import co.inboxies.wear.glance.WatchGlanceSink
import co.inboxies.wear.session.PhoneLink
import co.inboxies.wear.session.WatchSessionPrefs
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

class WearApplication : Application() {
    private val appScope = MainScope()

    val phoneLink: PhoneLink by lazy { PhoneLink(this) }

    /**
     * The Inbox Tile / unread complication snapshot (AVE-147). The store writes it; the
     * Tile and complication read it and are asked to redraw when it changes.
     */
    val glance: WatchGlanceSink by lazy {
        WatchGlancePublisher(WatchGlancePrefs(this)) { requestGlanceUpdates() }
    }

    /**
     * Process-scoped, so the Data Layer service and the activity share it: a grant or
     * wipe from the phone lands whether or not the UI is open.
     */
    val store: WatchStore by lazy {
        WatchStore(
            scope = appScope,
            storage = WatchSessionPrefs(this),
            phone = phoneLink,
            apiFactory = { baseUrl, token -> WatchApi(baseUrl, token) },
            glance = glance,
        )
    }

    /**
     * The Tile or complication was asked for a stale snapshot: the store reads the
     * Inbox again with its stored session (never the Tile itself) and publishes.
     */
    fun refreshGlanceIfStale() {
        if (!WatchGlance.isStale(glance.read(), System.currentTimeMillis())) return
        appScope.launch { store.refreshInBackground() }
    }

    private fun requestGlanceUpdates() {
        runCatching { TileService.getUpdater(this).requestUpdate(InboxTileService::class.java) }
            .onFailure { Log.w(TAG, "Tile update request failed", it) }
        runCatching {
            ComplicationDataSourceUpdateRequester
                .create(this, ComponentName(this, UnreadComplicationService::class.java))
                .requestUpdateAll()
        }.onFailure { Log.w(TAG, "Complication update request failed", it) }
    }

    private companion object {
        const val TAG = "WearApplication"
    }
}

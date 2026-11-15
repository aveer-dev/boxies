package co.inboxies.wear.session

import co.inboxies.watchshared.WatchHandoff
import co.inboxies.watchshared.WatchPhoneContext
import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.wear.WearApplication
import co.inboxies.wear.data.WatchApi
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * What the phone app pushes to the watch (AVE-145): a `watch` session grant after
 * sign-in, a wipe on sign-out / revoke, and the non-secret context DataItem. Runs
 * whether or not the watch app is open; the Data Layer only delivers from the same
 * package and signing key.
 */
class WearHandoffService : WearableListenerService() {
    private val store get() = (application as WearApplication).store

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WatchHandoff.SESSION_PATH ->
                WatchSessionGrant.decode(event.data, WatchApi.allowLocalHttp)?.let { store.receiveGrant(it) }
            WatchHandoff.CLEAR_PATH -> store.receiveClear()
        }
    }

    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val item = event.dataItem
            if (item.uri.path != WatchHandoff.CONTEXT_PATH) continue
            WatchPhoneContext.decode(item.data, WatchApi.allowLocalHttp)?.let { store.receiveContext(it) }
        }
    }
}

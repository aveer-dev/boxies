package co.inboxies.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import co.inboxies.wear.data.PreviewNetworkGuard
import co.inboxies.wear.preview.WearPreviewFixtures
import co.inboxies.wear.preview.WearPreviewMode
import co.inboxies.wear.ui.WearApp
import kotlinx.coroutines.launch

/** The watch app's one activity. Screens are Compose destinations in `WearApp`. */
class MainActivity : ComponentActivity() {
    private lateinit var store: WatchStore
    private var stopReachability: (() -> Unit)? = null

    private val app: WearApplication get() = application as WearApplication

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val preview = if (BuildConfig.DEBUG) WearPreviewMode.from(intent) else null
        // A normal launch turns a previous preview's network block off.
        PreviewNetworkGuard.setBlocking(preview != null)
        store = if (preview != null) {
            WearPreviewFixtures.store(preview, lifecycleScope)
        } else {
            app.store.also { store ->
                store.start()
                // A context that synced while the app was closed (a sign-out far from the watch wipes).
                lifecycleScope.launch { app.phoneLink.currentContext()?.let(store::receiveContext) }
            }
        }
        setContent {
            WearApp(store = store, openRoutes = preview?.openRoutes.orEmpty())
        }
    }

    override fun onStart() {
        super.onStart()
        if (store.isPreview) return
        stopReachability = app.phoneLink.watchReachability {
            runOnUiThread { store.retryNowIfDisconnected() }
        }
    }

    override fun onResume() {
        super.onResume()
        // Came forward: a watch still without a session asks the phone now.
        store.retryNowIfDisconnected()
    }

    override fun onStop() {
        stopReachability?.invoke()
        stopReachability = null
        super.onStop()
    }
}

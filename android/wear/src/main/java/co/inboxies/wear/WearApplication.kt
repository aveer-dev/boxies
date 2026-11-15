package co.inboxies.wear

import android.app.Application
import co.inboxies.wear.data.WatchApi
import co.inboxies.wear.session.PhoneLink
import co.inboxies.wear.session.WatchSessionPrefs
import kotlinx.coroutines.MainScope

class WearApplication : Application() {
    private val appScope = MainScope()

    val phoneLink: PhoneLink by lazy { PhoneLink(this) }

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
        )
    }
}

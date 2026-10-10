package co.inboxies.app

import android.app.Application
import co.inboxies.app.config.AppConfig
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.services.SwipeActionPreferences

class InboxiesApplication : Application() {
    lateinit var authStore: AuthStore
        private set

    /**
     * Process-scoped app state. Held here (not in MainActivity) so a configuration
     * change — dark mode, locale, font scale — reuses the same instance and an
     * open compose draft, selected thread and undo queue survive recreation.
     */
    val appModel: AppModel by lazy { AppModel() }

    override fun onCreate() {
        super.onCreate()
        AppConfig.init(this)
        authStore = AuthStore(this)
        PushNotificationManager.init(this)
        SwipeActionPreferences.init(this)
    }
}

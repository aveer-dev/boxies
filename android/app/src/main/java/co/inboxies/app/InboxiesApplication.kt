package co.inboxies.app

import android.app.Application
import co.inboxies.app.config.AppConfig
import co.inboxies.app.services.AuthStore
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.services.SwipeActionPreferences

class InboxiesApplication : Application() {
    lateinit var authStore: AuthStore
        private set

    override fun onCreate() {
        super.onCreate()
        AppConfig.init(this)
        authStore = AuthStore(this)
        PushNotificationManager.init(this)
        SwipeActionPreferences.init(this)
    }
}

package co.inboxies.app

import android.app.Application
import android.content.res.Configuration
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import co.inboxies.app.config.AppConfig
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.services.AutofillMailboxPreference
import co.inboxies.app.services.LastMailboxPreference
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.services.SwipeActionPreferences
import co.inboxies.app.widget.InboxWidgetPublisher

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
        // Also creates the default notification channel (the manifest points FCM at it).
        PushNotificationManager.init(this)
        SwipeActionPreferences.init(this)
        AutofillMailboxPreference.init(this)
        LastMailboxPreference.init(this)
        InboxWidgetPublisher.init(this)
        lastNightMode = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK

        // Live sync (SSE + 20 s poll) only while some activity is visible. ON_STOP is
        // debounced by ProcessLifecycleOwner, so rotations don't drop the stream.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    appModel.onAppForegrounded(isSignedIn = authStore.isAuthenticated)
                }

                override fun onStop(owner: LifecycleOwner) {
                    appModel.onAppBackgrounded()
                }
            },
        )
    }

    private var lastNightMode = Configuration.UI_MODE_NIGHT_UNDEFINED

    /** The widget's bitmaps are drawn for light or dark; redraw it when the system flips. */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val night = newConfig.uiMode and Configuration.UI_MODE_NIGHT_MASK
        if (night != lastNightMode) {
            lastNightMode = night
            InboxWidgetPublisher.redraw()
        }
    }
}

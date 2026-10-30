package co.inboxies.app

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.view.WindowCompat
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.ui.RootView
import co.inboxies.app.ui.preview.PreviewHarness
import co.inboxies.app.ui.preview.PreviewMode
import co.inboxies.app.ui.preview.PreviewRoot
import co.inboxies.app.widget.InboxWidgetLink
import co.inboxies.app.widget.InboxWidgetPublisher

val LocalAuthStore = staticCompositionLocalOf<AuthStore> { error("AuthStore missing") }
val LocalAppModel = staticCompositionLocalOf<AppModel> { error("AppModel missing") }

class MainActivity : ComponentActivity() {
    private lateinit var appModel: AppModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        val app = application as InboxiesApplication
        val auth = app.authStore
        appModel = app.appModel
        val model = appModel
        val previewMode = PreviewMode.fromIntent(intent)
        val isRecreation = savedInstanceState != null
        if (BuildConfig.DEBUG && !isRecreation) handleWidgetPreviewData(intent)
        if (previewMode != null) {
            // Re-seed only on a cold start (or after process death); a config change
            // keeps the already-seeded app-scoped model.
            if (!isRecreation || !model.isDebugPreview) PreviewHarness.seed(previewMode, auth, model)
        } else if (!isRecreation) {
            // The process (and AppModel) can outlive a finished Activity; a cold
            // launch should still refresh, only config-change recreation skips it.
            model.invalidateBootstrap()
            auth.resyncFromStorage()
            // Debug-only: the launcher activity is exported, so in release any app
            // could point the API (and our Bearer token) at its own host.
            val extraApiBase = if (BuildConfig.DEBUG) intent.getStringExtra("apiBase") else null
            if (!extraApiBase.isNullOrBlank()) {
                co.inboxies.app.config.AppConfig.parseAPIBaseURL(extraApiBase)?.let { parsed ->
                    co.inboxies.app.config.AppConfig.apiBaseURL = parsed
                }
            }
            handlePushIntent(intent)
            handleWidgetIntent(intent)
            handleInviteIntent(intent)
            handleOnboardingIntent(intent)
            handleBillingIntent(intent)
        }
        setContent {
            var themeMode by remember {
                mutableStateOf(
                    ThemeMode.fromStorage(
                        getSharedPreferences("inboxies_prefs", MODE_PRIVATE)
                            .getString("app_theme", null),
                    ),
                )
            }
            InboxiesTheme(themeMode = themeMode) {
                CompositionLocalProvider(
                    LocalAuthStore provides auth,
                    LocalAppModel provides model,
                ) {
                    if (previewMode != null) {
                        PreviewRoot(
                            mode = previewMode,
                            auth = auth,
                            appModel = model,
                            themeMode = themeMode,
                            onThemeModeChange = { mode ->
                                themeMode = mode
                                getSharedPreferences("inboxies_prefs", MODE_PRIVATE)
                                    .edit()
                                    .putString("app_theme", mode.name)
                                    .apply()
                            },
                        )
                    } else {
                        RootView(
                            auth = auth,
                            appModel = model,
                            themeMode = themeMode,
                            onThemeModeChange = { mode ->
                                themeMode = mode
                                getSharedPreferences("inboxies_prefs", MODE_PRIVATE)
                                    .edit()
                                    .putString("app_theme", mode.name)
                                    .apply()
                            },
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (BuildConfig.DEBUG) handleWidgetPreviewData(intent)
        if (PreviewMode.fromIntent(intent) != null) return
        handlePushIntent(intent)
        handleWidgetIntent(intent)
        handleInviteIntent(intent)
        handleOnboardingIntent(intent)
        handleBillingIntent(intent)
    }

    /**
     * `inboxies://billing/renewed?domain=` (paid; the webhook restores the domain, so
     * AppModel polls briefly) or `inboxies://billing/renew-cancelled?domain=`.
     */
    private fun handleBillingIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data ?: return
        if (data.scheme != "inboxies" || data.host != "billing") return
        val domain = data.getQueryParameter("domain")?.trim()?.lowercase()
        when (data.pathSegments.firstOrNull()) {
            "renewed" -> if (!domain.isNullOrBlank()) appModel.handleRenewalReturn(domain, cancelled = false)
            "renew-cancelled" -> if (!domain.isNullOrBlank()) appModel.handleRenewalReturn(domain, cancelled = true)
        }
        intent.data = null
    }

    private fun handleOnboardingIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data ?: return
        val isOnboarding = (data.scheme == "inboxies" && (data.host == "onboarding" || data.host == "domain-ready"))
            || (data.host == "inboxies.email" && data.path?.startsWith("/onboarding") == true)
        if (isOnboarding) {
            val domain = data.getQueryParameter("domain")
            // Only trust a token returned for the checkout this app started.
            val token = data.getQueryParameter("token")?.takeIf {
                co.inboxies.app.config.AppConfig.consumePendingCheckout(data.getQueryParameter("session_id"))
            }
            if (!token.isNullOrBlank()) {
                val auth = (application as InboxiesApplication).authStore
                val email = if (!domain.isNullOrBlank()) "admin@$domain" else null
                auth.applySession(token, email)
                if (::appModel.isInitialized) {
                    lifecycleScope.launch {
                        appModel.bootstrap(token)
                        appModel.refreshMailboxes(showLoading = true)
                    }
                }
            } else if (::appModel.isInitialized) {
                lifecycleScope.launch {
                    appModel.refreshMailboxes(showLoading = true)
                }
            }
            intent.data = null
        }
    }

    private fun handleInviteIntent(intent: Intent?) {
        if (intent == null) return
        val data = intent.data ?: return
        val token = when {
            data.scheme == "inboxies" && data.host == "invite" ->
                data.pathSegments.firstOrNull()
            data.host == "inboxies.email" && data.path?.startsWith("/invite/") == true ->
                data.path!!.removePrefix("/invite/").trim('/')
            else -> null
        }?.takeIf { it.isNotBlank() } ?: return
        if (::appModel.isInitialized) {
            appModel.setPendingInviteToken(token)
        }
        intent.data = null
    }

    /**
     * "Today's inbox" widget taps (AVE-150) take the notification-tap path: a card opens
     * its thread, anywhere else opens that mailbox's Inbox.
     */
    private fun handleWidgetIntent(intent: Intent?) {
        val link = InboxWidgetLink.parse(intent?.data?.toString()) ?: return
        when (link) {
            is InboxWidgetLink.Thread ->
                PushNotificationManager.shared.setPendingDeepLink(link.mailboxId, link.threadId, "inbox")
            is InboxWidgetLink.Inbox ->
                PushNotificationManager.shared.setPendingInboxLink(link.mailboxId)
        }
        intent?.data = null
    }

    /**
     * DEBUG `--es previewWidgetData mail|zero`: sample data for the real home-screen
     * widget, no sign-in needed (iOS `-previewWidgetData`). See run-debug-preview.sh.
     */
    private fun handleWidgetPreviewData(intent: Intent?) {
        val value = intent?.getStringExtra("previewWidgetData") ?: return
        InboxWidgetPublisher.publishPreviewData(inboxZero = value.equals("zero", ignoreCase = true))
        // `--ez previewWidgetPin true`: ask the launcher to add the widget (one "Add" tap).
        if (intent.getBooleanExtra("previewWidgetPin", false)) {
            val manager = getSystemService(android.appwidget.AppWidgetManager::class.java)
            if (manager?.isRequestPinAppWidgetSupported == true) {
                manager.requestPinAppWidget(
                    android.content.ComponentName(this, co.inboxies.app.widget.TodayInboxWidgetReceiver::class.java),
                    null,
                    null,
                )
            }
        }
    }

    private fun handlePushIntent(intent: Intent?) {
        if (intent == null) return
        val mailboxId = intent.getStringExtra("mailboxId")
        val emailId = intent.getStringExtra("emailId")
        val folderId = intent.getStringExtra("folderId")
        if (mailboxId.isNullOrBlank() || emailId.isNullOrBlank()) return
        PushNotificationManager.shared.setPendingDeepLink(mailboxId, emailId, folderId)
        // Prevent re-processing on recreation.
        intent.removeExtra("mailboxId")
        intent.removeExtra("emailId")
        intent.removeExtra("folderId")
    }
}

package co.inboxies.app.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import co.inboxies.app.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * FCM registration coordinator. No-ops when Firebase / google-services.json
 * is not configured (`BuildConfig.HAS_GOOGLE_SERVICES == false`).
 */
data class PushDeepLink(
    val mailboxId: String,
    val emailId: String,
    val folderId: String = "inbox",
)

class PushNotificationManager private constructor(private val appContext: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val prefs get() = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private var activeMailboxId: String? = null
    /** Persisted so sign-out / account deletion can unregister after a cold start. */
    private var deviceToken: String? = prefs.getString(KEY_DEVICE_TOKEN, null)
    /** Mailboxes this device token was registered for in this process. */
    private val registeredMailboxIds = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val _pendingDeepLink = MutableStateFlow<PushDeepLink?>(null)
    val pendingDeepLink: StateFlow<PushDeepLink?> = _pendingDeepLink.asStateFlow()

    fun requestPermissionAndRegister(mailboxId: String) {
        activeMailboxId = mailboxId
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return
        if (!isNotificationsEnabled()) return

        ensureChannel()
        deviceToken?.let { syncTokenWithServer(mailboxId, it) }

        // Permission is requested from Settings / Activity when needed; here we only sync.
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        fetchAndRegisterToken(mailboxId)
    }

    fun isNotificationsEnabled(): Boolean = prefs.getBoolean(KEY_PUSH_ENABLED, true)

    /** What Settings should show: the user's preference *and* the OS permission. */
    fun isEffectivelyEnabled(): Boolean = isNotificationsEnabled() && hasNotificationPermission()

    fun setNotificationsEnabled(enabled: Boolean) {
        prefs.edit { putBoolean(KEY_PUSH_ENABLED, enabled) }
    }

    /**
     * Ask once after sign-in (POST_NOTIFICATIONS is a runtime permission on API 33+).
     * After a denial, Settings → Notifications is the only re-entry point.
     */
    fun shouldPromptForPermission(): Boolean =
        BuildConfig.HAS_GOOGLE_SERVICES &&
            isNotificationsEnabled() &&
            !hasNotificationPermission() &&
            !prefs.getBoolean(KEY_PERMISSION_PROMPTED, false)

    fun markPermissionPrompted() {
        prefs.edit { putBoolean(KEY_PERMISSION_PROMPTED, true) }
    }

    fun onPermissionResult(granted: Boolean, mailboxId: String?) {
        setNotificationsEnabled(granted)
        if (granted) mailboxId?.let { requestPermissionAndRegister(it) }
    }

    fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun handleTokenReceived(token: String) {
        deviceToken = token
        prefs.edit { putString(KEY_DEVICE_TOKEN, token) }
        activeMailboxId?.let { syncTokenWithServer(it, token) }
    }

    fun unregisterToken(mailboxId: String) {
        val token = deviceToken ?: return
        registeredMailboxIds.remove(mailboxId)
        scope.launch {
            runCatching { ApiClient.shared.unregisterDeviceToken(mailboxId, token) }
        }
    }

    /**
     * Drop this device's token from every mailbox before the session token goes away
     * (sign-out / account deletion). Must run while the Bearer token is still valid.
     */
    suspend fun unregisterAll(mailboxIds: Collection<String>) {
        val token = deviceToken ?: return
        val targets = (mailboxIds + registeredMailboxIds).toSet()
        for (id in targets) {
            runCatching { ApiClient.shared.unregisterDeviceToken(id, token) }
        }
        registeredMailboxIds.clear()
        activeMailboxId = null
    }

    private fun fetchAndRegisterToken(mailboxId: String) {
        // Firebase Messaging is optional; resolve via reflection so missing
        // google-services.json does not crash class loading paths at compile time.
        try {
            val firebaseMessaging = Class.forName("com.google.firebase.messaging.FirebaseMessaging")
            val instance = firebaseMessaging.getMethod("getInstance").invoke(null)
            val task = firebaseMessaging.getMethod("getToken").invoke(instance)
            val addOnSuccess = task.javaClass.getMethod(
                "addOnSuccessListener",
                Class.forName("com.google.android.gms.tasks.OnSuccessListener"),
            )
            val listener = java.lang.reflect.Proxy.newProxyInstance(
                appContext.classLoader,
                arrayOf(Class.forName("com.google.android.gms.tasks.OnSuccessListener")),
            ) { _, _, args ->
                val token = args?.getOrNull(0) as? String
                if (token != null) handleTokenReceived(token)
                null
            }
            addOnSuccess.invoke(task, listener)
            syncTokenWithServer(mailboxId, deviceToken ?: return)
        } catch (_: Exception) {
            // Firebase not configured — silent no-op
        }
    }

    private fun syncTokenWithServer(mailboxId: String, token: String) {
        scope.launch {
            runCatching { ApiClient.shared.registerDeviceToken(mailboxId, token) }
                .onSuccess { registeredMailboxIds.add(mailboxId) }
        }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Inboxies",
            NotificationManager.IMPORTANCE_DEFAULT,
        )
        manager.createNotificationChannel(channel)
    }


    fun setPendingDeepLink(mailboxId: String?, emailId: String?, folderId: String?) {
        val mb = mailboxId?.takeIf { it.isNotBlank() } ?: return
        val em = emailId?.takeIf { it.isNotBlank() } ?: return
        _pendingDeepLink.value = PushDeepLink(
            mailboxId = mb,
            emailId = em,
            folderId = folderId?.takeIf { it.isNotBlank() } ?: "inbox",
        )
    }

    fun clearPendingDeepLink() {
        _pendingDeepLink.value = null
    }

    companion object {
        const val CHANNEL_ID = "inboxies_mail"
        private const val PREFS_NAME = "inboxies_prefs"
        private const val KEY_PUSH_ENABLED = "push_notifications_enabled"
        private const val KEY_PERMISSION_PROMPTED = "push_permission_prompted"
        private const val KEY_DEVICE_TOKEN = "push_device_token"

        lateinit var shared: PushNotificationManager
            private set

        fun init(context: Context) {
            shared = PushNotificationManager(context.applicationContext)
        }
    }
}

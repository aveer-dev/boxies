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
    private var activeMailboxId: String? = null
    private var deviceToken: String? = null
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

    fun isNotificationsEnabled(): Boolean =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(KEY_PUSH_ENABLED, true)

    fun setNotificationsEnabled(enabled: Boolean) {
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit {
            putBoolean(KEY_PUSH_ENABLED, enabled)
        }
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
        activeMailboxId?.let { syncTokenWithServer(it, token) }
    }

    fun unregisterToken(mailboxId: String) {
        val token = deviceToken ?: return
        scope.launch {
            runCatching { ApiClient.shared.unregisterDeviceToken(mailboxId, token) }
        }
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

        lateinit var shared: PushNotificationManager
            private set

        fun init(context: Context) {
            shared = PushNotificationManager(context.applicationContext)
        }
    }
}

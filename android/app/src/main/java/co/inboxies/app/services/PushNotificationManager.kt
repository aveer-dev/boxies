package co.inboxies.app.services

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import co.inboxies.app.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * FCM registration coordinator. No-ops when Firebase / google-services.json
 * is not configured (`BuildConfig.HAS_GOOGLE_SERVICES == false`).
 */
class PushNotificationManager private constructor(private val appContext: Context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var activeMailboxId: String? = null
    private var deviceToken: String? = null

    fun requestPermissionAndRegister(mailboxId: String) {
        activeMailboxId = mailboxId
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return

        ensureChannel()
        deviceToken?.let { syncTokenWithServer(mailboxId, it) }

        // Permission is requested from the Activity when needed; here we only sync.
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        fetchAndRegisterToken(mailboxId)
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

    companion object {
        const val CHANNEL_ID = "inboxies_mail"
        lateinit var shared: PushNotificationManager
            private set

        fun init(context: Context) {
            shared = PushNotificationManager(context.applicationContext)
        }
    }
}

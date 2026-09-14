package co.inboxies.app.services

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import co.inboxies.app.BuildConfig
import co.inboxies.app.MainActivity
import co.inboxies.app.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM service. Handlers no-op when Firebase / google-services.json is not configured.
 */
class InboxiesFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return
        runCatching { PushNotificationManager.shared.handleTokenReceived(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return
        val title = message.notification?.title ?: message.data["title"] ?: "Inboxies"
        val body = message.notification?.body ?: message.data["body"] ?: return
        val mailboxId = message.data["mailboxId"]
        val emailId = message.data["emailId"]
        val folderId = message.data["folderId"] ?: "inbox"
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("mailboxId", mailboxId)
            putExtra("emailId", emailId)
            putExtra("folderId", folderId)
        }
        val pending = PendingIntent.getActivity(
            this,
            emailId?.hashCode() ?: body.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, PushNotificationManager.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        getSystemService(NotificationManager::class.java)
            ?.notify(message.messageId?.hashCode() ?: body.hashCode(), notification)
    }
}

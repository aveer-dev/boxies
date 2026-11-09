package co.inboxies.app.services

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import co.inboxies.app.BuildConfig
import co.inboxies.app.InboxiesApplication
import co.inboxies.app.MainActivity
import co.inboxies.app.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM service. Handlers no-op when Firebase / google-services.json is not configured.
 *
 * The Worker sends data-only messages, so every push reaches [onMessageReceived] and
 * the app alone decides whether to show it: never while notifications are off or the
 * user is signed out, and never for a mailbox they no longer have.
 */
class InboxiesFirebaseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return
        runCatching { PushNotificationManager.shared.handleTokenReceived(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!BuildConfig.HAS_GOOGLE_SERVICES) return
        val push = PushNotificationManager.shared
        val mailboxId = message.data["mailboxId"]
        val signedIn = (application as? InboxiesApplication)?.authStore?.isAuthenticated == true
        if (!signedIn || !push.isEffectivelyEnabled() || !push.isKnownMailbox(mailboxId)) {
            Log.d(TAG, "Dropping push (signedIn=$signedIn, enabled=${push.isEffectivelyEnabled()})")
            return
        }
        // `notification` only appears on pushes from a Worker predating data-only sends.
        val title = message.data["title"] ?: message.notification?.title ?: "Inboxies"
        val body = message.data["body"] ?: message.notification?.body ?: return
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
        PushNotificationManager.ensureChannel(this)
        val notificationId = message.messageId?.hashCode() ?: body.hashCode()
        val builder = NotificationCompat.Builder(this, PushNotificationManager.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_inboxies_glyph)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            // A failed or blank Reply re-posts this notification; don't alert twice.
            .setOnlyAlertOnce(true)
            .setContentIntent(pending)
        // Archive / Mark read / Reply Later / Reply / Spam, bridged to Wear OS (AVE-142).
        MailNotificationActions.target(message.data)?.let { target ->
            MailNotificationActions.addActions(this, builder, target, notificationId)
        }
        getSystemService(NotificationManager::class.java)?.notify(notificationId, builder.build())
    }

    private companion object {
        const val TAG = "InboxiesFCM"
    }
}

package co.inboxies.app.services

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import co.inboxies.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.ZonedDateTime
import java.util.UUID

/**
 * Actions on a new-mail push (watch phase 1, AVE-142; iOS twin AVE-141). The Worker
 * tags pushes about a real message with FCM data `category = "INBOXIES_MAIL"` (AVE-140);
 * the notification gets these actions, and [NotificationCompat.WearableExtender]
 * bridges them to a paired Wear OS watch, which sends taps back to the phone.
 *
 * Archive, Mark read, Reply Later and Reply run in the background. Spam needs an
 * unlocked device (`setAuthenticationRequired`, API 31+; minSdk is 34). No Trash.
 */
enum class MailNotificationAction(val id: String) {
    ARCHIVE("ARCHIVE"),
    MARK_READ("MARK_READ"),
    REPLY_LATER("REPLY_LATER"),
    REPLY("REPLY"),
    SPAM("SPAM"),
    ;

    companion object {
        fun from(id: String?): MailNotificationAction? = entries.firstOrNull { it.id == id }
    }
}

/** The message a push is about, from the FCM data keys the Worker sends. */
data class MailNotificationTarget(
    val mailboxId: String,
    val emailId: String,
    val threadId: String? = null,
) {
    companion object {
        fun from(data: Map<String, String?>): MailNotificationTarget? {
            val mailboxId = data["mailboxId"]?.takeIf { it.isNotBlank() } ?: return null
            val emailId = data["emailId"]?.takeIf { it.isNotBlank() } ?: return null
            return MailNotificationTarget(mailboxId, emailId, data["threadId"]?.takeIf { it.isNotBlank() })
        }
    }
}

/** What an action sends to the Worker. Pure, so the mapping is unit-tested. */
sealed interface MailNotificationRequest {
    /** `POST .../emails/:id/move` */
    data class Move(val folderId: String, val setSenderPreference: Boolean) : MailNotificationRequest

    /** `PUT .../emails/:id { read: true }` */
    data object MarkRead : MailNotificationRequest

    /** `PUT .../emails/:id { reply_later: true, reply_later_remind_at }` */
    data class ReplyLater(val remindAtIso: String) : MailNotificationRequest

    /** `POST .../emails/:id/quick-reply { text }` */
    data class QuickReply(val text: String) : MailNotificationRequest
}

object MailNotificationActions {
    /** Must match `MAIL_NOTIFICATION_CATEGORY` in `workers/lib/apns.ts`. */
    const val CATEGORY = "INBOXIES_MAIL"

    /** Fixed short replies for v1 (watch plan); offered as RemoteInput choices. */
    val CANNED_REPLIES: List<String> = listOf("Thanks!", "Got it, will reply soon", "Can we talk later?", "👍")

    const val REMOTE_INPUT_KEY = "co.inboxies.app.notification.REPLY_TEXT"
    internal const val ACTION_PREFIX = "co.inboxies.app.notification.action."
    internal const val EXTRA_MAILBOX_ID = "mailboxId"
    internal const val EXTRA_EMAIL_ID = "emailId"
    internal const val EXTRA_THREAD_ID = "threadId"
    internal const val EXTRA_NOTIFICATION_ID = "notificationId"
    private const val TAG = "MailNotificationActions"

    /** Only pushes the Worker marks actionable get actions; test pushes stay plain. */
    fun target(data: Map<String, String?>): MailNotificationTarget? =
        if (data["category"] == CATEGORY) MailNotificationTarget.from(data) else null

    /**
     * Reply Later from a notification sets a reminder for tomorrow 09:00 local, the same
     * "Tomorrow" preset as the in-app picker (AVE-86). A blank reply sends nothing.
     */
    fun request(
        action: MailNotificationAction,
        replyText: String?,
        now: ZonedDateTime = ZonedDateTime.now(),
    ): MailNotificationRequest? = when (action) {
        MailNotificationAction.ARCHIVE -> MailNotificationRequest.Move("archive", setSenderPreference = false)
        MailNotificationAction.MARK_READ -> MailNotificationRequest.MarkRead
        MailNotificationAction.REPLY_LATER ->
            MailNotificationRequest.ReplyLater(ReplyLaterReminderPresets.toIso(ReplyLaterReminderPresets.tomorrow(now)))
        MailNotificationAction.REPLY ->
            replyText?.trim()?.takeIf { it.isNotEmpty() }?.let { MailNotificationRequest.QuickReply(it) }
        MailNotificationAction.SPAM -> MailNotificationRequest.Move("spam", setSenderPreference = true)
    }

    /** Adds the five actions plus a [NotificationCompat.WearableExtender] carrying them. */
    fun addActions(
        context: Context,
        builder: NotificationCompat.Builder,
        target: MailNotificationTarget,
        notificationId: Int,
    ) {
        val remoteInput = RemoteInput.Builder(REMOTE_INPUT_KEY)
            .setLabel("Reply")
            .setChoices(CANNED_REPLIES.toTypedArray())
            .setAllowFreeFormInput(true)
            .build()
        val reply = NotificationCompat.Action.Builder(
            R.drawable.ic_notification_reply,
            "Reply",
            pendingIntent(context, MailNotificationAction.REPLY, target, notificationId, mutable = true),
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(true)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
        val archive = simpleAction(
            context, MailNotificationAction.ARCHIVE, "Archive", R.drawable.ic_notification_archive,
            NotificationCompat.Action.SEMANTIC_ACTION_ARCHIVE, target, notificationId,
        )
        val markRead = simpleAction(
            context, MailNotificationAction.MARK_READ, "Mark as read", R.drawable.ic_notification_mark_read,
            NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ, target, notificationId,
        )
        val replyLater = simpleAction(
            context, MailNotificationAction.REPLY_LATER, "Reply Later", R.drawable.ic_notification_reply_later,
            NotificationCompat.Action.SEMANTIC_ACTION_NONE, target, notificationId,
        )
        val spam = simpleAction(
            context, MailNotificationAction.SPAM, "Report spam", R.drawable.ic_notification_spam,
            NotificationCompat.Action.SEMANTIC_ACTION_DELETE, target, notificationId,
            authenticationRequired = true,
        )
        // The shade shows the first three (Reply, Archive, Mark as read); Wear OS shows all.
        val actions = listOf(reply, archive, markRead, replyLater, spam)
        actions.forEach(builder::addAction)
        builder.extend(NotificationCompat.WearableExtender().addActions(actions))
    }

    private fun simpleAction(
        context: Context,
        action: MailNotificationAction,
        title: String,
        icon: Int,
        semantic: Int,
        target: MailNotificationTarget,
        notificationId: Int,
        authenticationRequired: Boolean = false,
    ): NotificationCompat.Action =
        NotificationCompat.Action.Builder(
            icon,
            title,
            pendingIntent(context, action, target, notificationId, mutable = false),
        )
            .setSemanticAction(semantic)
            .setShowsUserInterface(false)
            .setAuthenticationRequired(authenticationRequired)
            .build()

    private fun pendingIntent(
        context: Context,
        action: MailNotificationAction,
        target: MailNotificationTarget,
        notificationId: Int,
        mutable: Boolean,
    ): PendingIntent {
        val intent = Intent(context, MailNotificationActionReceiver::class.java).apply {
            this.action = ACTION_PREFIX + action.id
            putExtra(EXTRA_MAILBOX_ID, target.mailboxId)
            putExtra(EXTRA_EMAIL_ID, target.emailId)
            putExtra(EXTRA_THREAD_ID, target.threadId)
            putExtra(EXTRA_NOTIFICATION_ID, notificationId)
        }
        // RemoteInput writes the typed reply into the intent, so only Reply is mutable.
        val mutability = if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(
            context,
            31 * notificationId + action.ordinal,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or mutability,
        )
    }

    /** Runs [request] against the Worker with the app's session. */
    suspend fun perform(request: MailNotificationRequest, target: MailNotificationTarget, api: ApiClient = ApiClient.shared) {
        when (request) {
            is MailNotificationRequest.Move -> api.moveEmail(
                mailboxId = target.mailboxId,
                id = target.emailId,
                folderId = request.folderId,
                setSenderPreference = request.setSenderPreference,
            )
            MailNotificationRequest.MarkRead -> api.markRead(target.mailboxId, target.emailId)
            is MailNotificationRequest.ReplyLater ->
                api.setReplyLaterWithReminder(target.mailboxId, target.emailId, request.remindAtIso)
            is MailNotificationRequest.QuickReply -> api.quickReply(
                mailboxId = target.mailboxId,
                emailId = target.emailId,
                text = request.text,
                idempotencyKey = UUID.randomUUID().toString(),
            )
        }
    }

    internal fun log(message: String) {
        runCatching { Log.w(TAG, message) }
    }
}

/**
 * Runs a notification action in the background (not exported). Never throws: with no
 * session, a missing payload key or a failed call it logs and drops. On success the
 * notification is cancelled; a failed Reply re-posts it so the shade stops spinning.
 */
class MailNotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = MailNotificationAction.from(intent.action?.removePrefix(MailNotificationActions.ACTION_PREFIX))
            ?: return
        val extras = intent.extras ?: Bundle.EMPTY
        val target = MailNotificationTarget.from(
            mapOf(
                "mailboxId" to extras.getString(MailNotificationActions.EXTRA_MAILBOX_ID),
                "emailId" to extras.getString(MailNotificationActions.EXTRA_EMAIL_ID),
                "threadId" to extras.getString(MailNotificationActions.EXTRA_THREAD_ID),
            ),
        )
        val notificationId = extras.getInt(MailNotificationActions.EXTRA_NOTIFICATION_ID, 0)
        val manager = context.getSystemService(NotificationManager::class.java)
        if (target == null) {
            MailNotificationActions.log("${action.id}: payload has no mailboxId/emailId")
            return
        }
        val replyText = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(MailNotificationActions.REMOTE_INPUT_KEY)
            ?.toString()
        val request = MailNotificationActions.request(action, replyText)
        if (request == null) {
            // Blank reply: nothing to send; stop the RemoteInput spinner.
            restore(manager, notificationId)
            return
        }
        if (ApiClient.shared.authTokenProvider().isNullOrEmpty()) {
            MailNotificationActions.log("${action.id}: no session, skipped")
            restore(manager, notificationId)
            return
        }
        val pending = goAsync()
        scope.launch {
            try {
                val ok = withTimeoutOrNull(TIMEOUT_MS) {
                    runCatching { MailNotificationActions.perform(request, target) }
                        .onFailure { MailNotificationActions.log("${action.id} failed: $it") }
                        .isSuccess
                } ?: false.also { MailNotificationActions.log("${action.id} timed out") }
                if (ok) manager?.cancel(notificationId) else restore(manager, notificationId)
            } finally {
                pending.finish()
            }
        }
    }

    /** Re-posts the shown notification unchanged; it was built with onlyAlertOnce. */
    private fun restore(manager: NotificationManager?, notificationId: Int) {
        val shown: Notification = manager?.activeNotifications
            ?.firstOrNull { it.id == notificationId }?.notification ?: return
        runCatching { manager.notify(notificationId, shown) }
    }

    private companion object {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Under the 60 s background-broadcast limit for goAsync. */
        const val TIMEOUT_MS = 25_000L
    }
}

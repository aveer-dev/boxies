package co.inboxies.wear.ui

import android.app.RemoteInput
import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Text
import androidx.wear.input.RemoteInputIntentHelper
import co.inboxies.wear.WatchStore
import co.inboxies.wear.data.WatchApiException
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailText
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * The text of one reply attempt and its idempotency key. Retrying the same text
 * reuses the key, so a reply that reached the Worker can't send twice.
 */
data class ReplyAttempt(val text: String, val key: String) {
    companion object {
        fun next(text: String, last: ReplyAttempt?): ReplyAttempt =
            if (last?.text == text) last else ReplyAttempt(text, UUID.randomUUID().toString())
    }
}

/**
 * Quick reply: voice or keyboard through the system `RemoteInput` screen, or a
 * canned reply. The Worker composes the rest (`quick-reply`: To, the thread's
 * From, Re: subject).
 */
@Composable
fun ReplyScreen(
    email: WatchEmail,
    store: WatchStore,
    onDone: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var sending by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var lastAttempt by remember { mutableStateOf<ReplyAttempt?>(null) }

    fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || sending != null || sent) return
        val attempt = ReplyAttempt.next(text, lastAttempt)
        lastAttempt = attempt
        sending = text
        scope.launch {
            try {
                store.reply(email, attempt.text, attempt.key)
                lastAttempt = null
                sent = true
                delay(900)
                onDone()
            } catch (e: WatchApiException.SignedOut) {
                // The store wiped the session and shows Connect.
            } catch (e: WatchApiException) {
                error = e.message
            } finally {
                sending = null
            }
        }
    }

    val input = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data ?: return@rememberLauncherForActivityResult
        val text = RemoteInput.getResultsFromIntent(data)?.getCharSequence(REPLY_INPUT_KEY)?.toString()
        if (!text.isNullOrBlank()) send(text)
    }

    fun openInput() {
        val intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(
            intent,
            listOf(RemoteInput.Builder(REPLY_INPUT_KEY).setLabel("Reply to ${email.displaySender}").build()),
        )
        try {
            input.launch(intent)
        } catch (e: ActivityNotFoundException) {
            error = "Voice and keyboard input aren't available on this watch. Pick a quick reply."
        }
    }

    val idle = sending == null && !sent
    Box {
        WatchListScreen {
            item { WatchHeader("Reply") }
            item {
                WatchPill(
                    "Voice or keyboard",
                    icon = Icons.Outlined.Mic,
                    role = PillRole.Primary,
                    enabled = idle,
                    onClick = ::openInput,
                )
            }
            item {
                Text(
                    "Quick replies",
                    style = WearType.meta,
                    color = WearColors.muted,
                    modifier = Modifier.fillMaxWidth().padding(start = 8.dp, top = 6.dp),
                )
            }
            items(WatchMailText.cannedReplies.size) { index ->
                val reply = WatchMailText.cannedReplies[index]
                WatchPill(reply, enabled = idle, onClick = { send(reply) })
            }
        }
        if (sent) {
            WatchOverlay {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(
                        Icons.Outlined.CheckCircle,
                        contentDescription = null,
                        tint = WearColors.accent,
                        modifier = Modifier.size(30.dp),
                    )
                    Text("Sent", style = WearType.title, color = WearColors.ink)
                }
            }
        } else if (sending != null) {
            WatchOverlay {
                CircularProgressIndicator(
                    indicatorColor = WearColors.muted,
                    trackColor = WearColors.pillFill,
                    modifier = Modifier.size(26.dp),
                    strokeWidth = 2.dp,
                )
            }
        }
    }
    WatchErrorDialog(title = "Not sent", message = error, onDismiss = { error = null })
}

private const val REPLY_INPUT_KEY = "co.inboxies.wear.REPLY_TEXT"

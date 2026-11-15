package co.inboxies.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Report
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Text
import co.inboxies.wear.WatchStore
import co.inboxies.wear.data.WatchApiException
import co.inboxies.wear.data.WatchDates
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * One message as plain text (trimmed to about 2 KB), then the actions: Reply,
 * Archive, Mark read / unread, Reply Later and Report spam (with a confirm). No
 * Trash on the watch.
 */
@Composable
fun MessageScreen(
    email: WatchEmail,
    store: WatchStore,
    onReply: (WatchEmail) -> Unit,
    onLeave: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf<WatchEmail?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var isUnread by rememberSaveable { mutableStateOf(email.isUnread) }
    var inReplyLater by rememberSaveable { mutableStateOf(email.replyLater) }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var confirmSpam by remember { mutableStateOf(false) }
    val message = loaded ?: email

    // Loads the full message and marks it read, like opening it on the phone.
    LaunchedEffect(email.id) {
        if (loaded != null) return@LaunchedEffect
        try {
            loaded = store.loadMessage(email)
            loadError = null
        } catch (e: WatchApiException.SignedOut) {
            return@LaunchedEffect
        } catch (e: WatchApiException) {
            loadError = e.message
        }
        if (isUnread && !store.isPreview) {
            runCatching { store.setRead(true, email) }
                .onSuccess { isUnread = false }
                .onFailure { if (it is CancellationException) throw it }
        }
    }

    fun perform(leaving: Boolean, action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                action()
                if (leaving) onLeave()
            } catch (e: WatchApiException.SignedOut) {
                // The store wiped the session and shows Connect.
            } catch (e: WatchApiException) {
                actionError = e.message
            } finally {
                busy = false
            }
        }
    }

    WatchListScreen {
        item {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp).hairlineBelow().padding(bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Text(message.displaySender, style = WearType.sender, color = WearColors.ink, maxLines = 2)
                val count = email.threadCount
                val meta = buildString {
                    append(WatchDates.short(message.date))
                    if (count != null && count > 1) append(" · $count messages")
                }
                Text(meta, style = WearType.meta, color = WearColors.muted)
                Text(
                    message.displaySubject,
                    style = WearType.bodyTitle,
                    color = WearColors.ink,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        val text = WatchMailText.plainText(loaded?.body ?: email.body ?: email.snippet)
        when {
            loadError != null && loaded == null && text.isEmpty() -> item {
                Text(loadError.orEmpty(), style = WearType.subject, color = WearColors.muted)
            }
            text.isEmpty() && loaded == null -> item {
                CircularProgressIndicator(
                    indicatorColor = WearColors.muted,
                    trackColor = WearColors.pillFill,
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                )
            }
            text.isEmpty() -> item {
                Text("No text in this message.", style = WearType.body, color = WearColors.muted)
            }
            else -> {
                // One item per paragraph, so long bodies scroll and scale smoothly.
                val paragraphs = text.split("\n\n")
                items(paragraphs.size) { index ->
                    Text(
                        paragraphs[index],
                        style = WearType.body,
                        color = WearColors.ink,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                    )
                }
            }
        }
        item { androidx.compose.foundation.layout.Spacer(Modifier.height(6.dp)) }
        item {
            WatchPill(
                "Reply",
                icon = Icons.AutoMirrored.Outlined.Reply,
                role = PillRole.Primary,
                enabled = !busy,
                onClick = { onReply(message) },
            )
        }
        item {
            WatchPill(
                "Archive",
                icon = Icons.Outlined.Archive,
                enabled = !busy,
                onClick = { perform(leaving = true) { store.archive(email) } },
            )
        }
        item {
            WatchPill(
                if (isUnread) "Mark as read" else "Mark as unread",
                icon = if (isUnread) Icons.Outlined.MarkEmailRead else Icons.Outlined.MarkEmailUnread,
                enabled = !busy,
                onClick = {
                    val markRead = isUnread
                    perform(leaving = false) {
                        store.setRead(markRead, email)
                        isUnread = !markRead
                    }
                },
            )
        }
        item {
            WatchPill(
                if (inReplyLater) "In Reply Later" else "Reply Later",
                icon = if (inReplyLater) Icons.Outlined.Check else Icons.Outlined.Schedule,
                enabled = !busy && !inReplyLater,
                onClick = {
                    perform(leaving = false) {
                        store.replyLater(email)
                        inReplyLater = true
                    }
                },
            )
        }
        item {
            WatchPill(
                "Report spam",
                icon = Icons.Outlined.Report,
                role = PillRole.Destructive,
                enabled = !busy,
                onClick = { confirmSpam = true },
            )
        }
    }

    WatchConfirmDialog(
        show = confirmSpam,
        title = "Report spam?",
        message = "Moves this and ${message.displaySender}'s other mail to Spam. Undo from your phone.",
        confirmLabel = "Report spam",
        destructive = true,
        icon = Icons.Outlined.Report,
        onConfirm = {
            confirmSpam = false
            perform(leaving = true) { store.reportSpam(email) }
        },
        onDismiss = { confirmSpam = false },
    )
    WatchErrorDialog(title = "Couldn't do that", message = actionError, onDismiss = { actionError = null })
}

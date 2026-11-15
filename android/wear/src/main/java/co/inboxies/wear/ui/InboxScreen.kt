package co.inboxies.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Text
import co.inboxies.wear.Connection
import co.inboxies.wear.ListState
import co.inboxies.wear.WatchState
import co.inboxies.wear.WatchStore
import co.inboxies.wear.data.WatchEmail
import kotlinx.coroutines.launch

/**
 * The active mailbox's newest Inbox conversations: flat rows (unread dot, sender,
 * date, subject, one line of preview), hairline dividers, no cards. A mailbox
 * switcher above the list only when there's more than one mailbox.
 */
@Composable
fun InboxScreen(
    state: WatchState,
    store: WatchStore,
    onOpen: (WatchEmail) -> Unit,
    onPickMailbox: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    WatchListScreen {
        item { WatchHeader("Inbox") }
        val mailbox = state.activeMailbox
        if (state.mailboxes.size > 1 && mailbox != null) {
            item {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .clickable(onClick = onPickMailbox)
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                        .semantics { contentDescription = "Mailbox ${mailbox.title}. Switch mailbox" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        mailbox.title,
                        style = WearType.meta,
                        color = WearColors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        Icons.Outlined.KeyboardArrowDown,
                        contentDescription = null,
                        tint = WearColors.muted,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
        val emails = state.emails
        val listState = state.listState
        when {
            emails.isEmpty() && (listState == ListState.Idle || listState == ListState.Loading) ->
                items(4) { WatchRowSkeleton() }
            emails.isEmpty() && listState is ListState.Failed -> {
                item { WatchNotice("Couldn't load emails", listState.message) }
                item { WatchPill("Retry", onClick = { scope.launch { store.refresh() } }) }
            }
            emails.isEmpty() -> item { WatchNotice("Inbox zero", "Nothing new.") }
            else -> {
                items(emails.size, key = { emails[it].id }) { index ->
                    val email = emails[index]
                    WatchEmailRow(email, onClick = { onOpen(email) })
                }
                item {
                    WatchPill(
                        "Refresh",
                        icon = Icons.Outlined.Refresh,
                        onClick = { scope.launch { store.refresh() } },
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
    }
}

/**
 * No session on the watch: the phone hands one over (the watch asks it quietly, with
 * retries), or, once those have run out, the person taps Connect.
 */
@Composable
fun ConnectScreen(connection: Connection, store: WatchStore) {
    val scope = rememberCoroutineScope()
    val message = (connection as? Connection.NeedsPhone)?.message
    WatchListScreen {
        item {
            Icon(
                Icons.Outlined.PhoneAndroid,
                contentDescription = null,
                tint = WearColors.muted,
                modifier = Modifier.size(26.dp),
            )
        }
        item { WatchHeader("Inboxies") }
        if (message != null) {
            item {
                Text(
                    message,
                    style = WearType.subject,
                    color = WearColors.muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp),
                )
            }
            item {
                WatchPill(
                    "Connect",
                    role = PillRole.Primary,
                    onClick = { scope.launch { store.connect() } },
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        } else {
            item {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CircularProgressIndicator(
                        indicatorColor = WearColors.muted,
                        trackColor = WearColors.pillFill,
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                    )
                    Text(
                        "Connecting to your phone…",
                        style = WearType.subject,
                        color = WearColors.muted,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

/** Only shown with more than one mailbox. Follows the phone's active mailbox until the person picks another here. */
@Composable
fun MailboxPickerScreen(state: WatchState, onPick: (String) -> Unit) {
    WatchListScreen {
        item { WatchHeader("Mailboxes") }
        items(state.mailboxes.size, key = { state.mailboxes[it].id }) { index ->
            val mailbox = state.mailboxes[index]
            val active = mailbox.id == state.activeMailbox?.id
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onPick(mailbox.id) }
                    .hairlineBelow()
                    .padding(horizontal = 6.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        mailbox.title,
                        style = WearType.senderRead,
                        color = WearColors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        mailbox.email,
                        style = WearType.meta,
                        color = WearColors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (active) {
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        Icons.Outlined.Check,
                        contentDescription = "Current mailbox",
                        tint = WearColors.accent,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

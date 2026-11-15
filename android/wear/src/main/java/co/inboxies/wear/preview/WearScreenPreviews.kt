package co.inboxies.wear.preview

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.wear.compose.ui.tooling.preview.WearPreviewDevices
import co.inboxies.wear.ui.ConnectScreen
import co.inboxies.wear.ui.InboxScreen
import co.inboxies.wear.ui.InboxiesWearTheme
import co.inboxies.wear.ui.MailboxPickerScreen
import co.inboxies.wear.ui.MessageScreen
import co.inboxies.wear.ui.ReplyScreen

// Android Studio previews of each watch screen on the fixture store (no phone, no
// network). The emulator harness is `WearPreviewMode`.

@WearPreviewDevices
@Composable
private fun InboxPreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Inbox, rememberCoroutineScope())
    InboxiesWearTheme {
        InboxScreen(state = store.state.value, store = store, onOpen = {}, onPickMailbox = {})
    }
}

@WearPreviewDevices
@Composable
private fun MessagePreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Message, rememberCoroutineScope())
    InboxiesWearTheme {
        MessageScreen(email = store.state.value.emails.first(), store = store, onReply = {}, onLeave = {})
    }
}

@WearPreviewDevices
@Composable
private fun ReplyPreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Reply, rememberCoroutineScope())
    InboxiesWearTheme {
        ReplyScreen(email = store.state.value.emails.first(), store = store, onDone = {})
    }
}

@WearPreviewDevices
@Composable
private fun MailboxesPreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Mailboxes, rememberCoroutineScope())
    InboxiesWearTheme {
        MailboxPickerScreen(state = store.state.value, onPick = {})
    }
}

@WearPreviewDevices
@Composable
private fun ConnectPreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Connect, rememberCoroutineScope())
    InboxiesWearTheme {
        ConnectScreen(connection = store.state.value.connection, store = store)
    }
}

@WearPreviewDevices
@Composable
private fun ConnectingPreview() {
    val store = WearPreviewFixtures.store(WearPreviewMode.Connecting, rememberCoroutineScope())
    InboxiesWearTheme {
        ConnectScreen(connection = store.state.value.connection, store = store)
    }
}

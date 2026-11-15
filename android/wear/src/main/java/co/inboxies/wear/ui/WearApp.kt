package co.inboxies.wear.ui

import android.net.Uri
import androidx.compose.animation.Crossfade
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import co.inboxies.wear.WatchStore
import co.inboxies.wear.data.WatchEmail

/** Navigation routes. `SwipeDismissableNavHost` is allowed in `:wear` only (plan Q8). */
object WearRoutes {
    const val INBOX = "inbox"
    const val MAILBOXES = "mailboxes"
    const val MESSAGE = "message/{id}"
    const val REPLY = "reply/{id}"

    fun message(id: String) = "message/${Uri.encode(id)}"

    fun reply(id: String) = "reply/${Uri.encode(id)}"
}

/**
 * Root of the watch UI: Connect when there's no session to show the Inbox with,
 * else the Inbox → message → reply stack, with swipe-to-dismiss as back.
 * [openRoutes]: DEBUG previews open a message or reply on launch.
 */
@Composable
fun WearApp(store: WatchStore, openRoutes: List<String> = emptyList()) {
    InboxiesWearTheme {
        val state by store.state.collectAsStateWithLifecycle()
        Crossfade(targetState = state.showsInbox, animationSpec = inboxiesSpring(), label = "root") { showsInbox ->
            if (showsInbox) {
                WatchNav(store, openRoutes)
            } else {
                ConnectScreen(state.connection, store)
            }
        }
    }
}

@Composable
private fun WatchNav(store: WatchStore, openRoutes: List<String>) {
    val nav = rememberSwipeDismissableNavController()
    SwipeDismissableNavHost(navController = nav, startDestination = WearRoutes.INBOX) {
        composable(WearRoutes.INBOX) {
            val state by store.state.collectAsStateWithLifecycle()
            InboxScreen(
                state = state,
                store = store,
                onOpen = { nav.navigate(WearRoutes.message(it.id)) },
                onPickMailbox = { nav.navigate(WearRoutes.MAILBOXES) },
            )
        }
        composable(WearRoutes.MESSAGE) { entry ->
            val email = rememberEmail(store, entry.arguments?.getString("id"))
            if (email == null) {
                LaunchedEffect(Unit) { nav.popBackStack() }
            } else {
                MessageScreen(
                    email = email,
                    store = store,
                    onReply = { nav.navigate(WearRoutes.reply(it.id)) },
                    onLeave = { nav.popBackStack() },
                )
            }
        }
        composable(WearRoutes.REPLY) { entry ->
            val email = rememberEmail(store, entry.arguments?.getString("id"))
            if (email == null) {
                LaunchedEffect(Unit) { nav.popBackStack() }
            } else {
                ReplyScreen(email = email, store = store, onDone = { nav.popBackStack() })
            }
        }
        composable(WearRoutes.MAILBOXES) {
            val state by store.state.collectAsStateWithLifecycle()
            MailboxPickerScreen(state) { id ->
                store.selectMailbox(id)
                nav.popBackStack()
            }
        }
    }
    LaunchedEffect(Unit) {
        openRoutes.forEach { nav.navigate(it) }
    }
}

/** The row the screen was opened from; it stays put if the list refreshes or drops it meanwhile. */
@Composable
private fun rememberEmail(store: WatchStore, id: String?): WatchEmail? =
    remember(id) { store.state.value.emails.firstOrNull { it.id == id } }

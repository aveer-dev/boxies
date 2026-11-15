package co.inboxies.wear.preview

import android.content.Intent
import co.inboxies.wear.Connection
import co.inboxies.wear.ListState
import co.inboxies.wear.WatchState
import co.inboxies.wear.WatchStore
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailbox
import co.inboxies.wear.session.MemoryWatchSessionStorage
import co.inboxies.wear.session.PhoneAnswer
import co.inboxies.wear.ui.WearRoutes
import kotlinx.coroutines.CoroutineScope
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * DEBUG previews for the Wear OS app, peers of the phone's `PreviewMode` and the
 * iOS watch's `-previewWatch…` launch arguments (AVE-144). Hermetic (AVE-235): a
 * fixture store with in-memory storage, no phone link and no network (every OkHttp
 * call is blocked by `PreviewNetworkGuard` too); actions change local state only.
 * The real session on the watch is never read or touched.
 *
 * ```
 * adb shell am start -n co.inboxies.app/co.inboxies.wear.MainActivity -e preview inbox
 * adb shell am start -n co.inboxies.app/co.inboxies.wear.MainActivity --ez previewWatchInbox true
 * ```
 * or `android/scripts/run-wear-preview.sh <mode>`.
 */
enum class WearPreviewMode(val wire: String, val extra: String) {
    /** Inbox with fixture conversations, two mailboxes (switcher row). */
    Inbox("inbox", "previewWatchInbox"),

    /** The first conversation open in the message view. */
    Message("message", "previewWatchMessage"),

    /** Quick reply (voice / keyboard + canned replies). */
    Reply("reply", "previewWatchReply"),

    /** The mailbox picker. */
    Mailboxes("mailboxes", "previewWatchMailboxes"),

    /** "Open Inboxies on your phone" with Connect. */
    Connect("connect", "previewWatchConnect"),

    /** First launch, quietly asking the phone for a session. */
    Connecting("connecting", "previewWatchConnecting"),
    ;

    /** Screens to open over the Inbox on launch. */
    val openRoutes: List<String>
        get() = when (this) {
            Message -> listOf(WearRoutes.message(FIRST_ID))
            Reply -> listOf(WearRoutes.message(FIRST_ID), WearRoutes.reply(FIRST_ID))
            Mailboxes -> listOf(WearRoutes.MAILBOXES)
            Inbox, Connect, Connecting -> emptyList()
        }

    companion object {
        const val PREVIEW_EXTRA = "preview"

        /** `-e preview <wire>`, else the first `--ez <extra> true`. */
        fun parse(preview: String?, isSet: (String) -> Boolean): WearPreviewMode? =
            entries.firstOrNull { it.wire == preview } ?: entries.firstOrNull { isSet(it.extra) }

        fun from(intent: Intent?): WearPreviewMode? {
            intent ?: return null
            return parse(intent.getStringExtra(PREVIEW_EXTRA)) { intent.getBooleanExtra(it, false) }
        }
    }
}

object WearPreviewFixtures {
    fun state(mode: WearPreviewMode, now: Instant = Instant.now()): WatchState = when (mode) {
        WearPreviewMode.Connect -> WatchState(connection = Connection.NeedsPhone("Open Inboxies on your phone, then tap Connect."))
        WearPreviewMode.Connecting -> WatchState(connection = Connection.Connecting)
        else -> WatchState(
            connection = Connection.Connected,
            mailboxes = mailboxes,
            activeMailboxId = mailboxes.first().id,
            emails = emails(now),
            listState = ListState.Loaded,
        )
    }

    /** A store that never reaches the phone or the network. */
    fun store(mode: WearPreviewMode, scope: CoroutineScope): WatchStore = WatchStore(
        scope = scope,
        storage = MemoryWatchSessionStorage(),
        phone = { PhoneAnswer.Unreachable },
        apiFactory = { _, _ -> error("No network in DEBUG previews") },
        isPreview = true,
        initialState = state(mode),
    )

    val mailboxes = listOf(
        WatchMailbox(id = "hello@ada.studio", email = "hello@ada.studio", name = "Ada Studio"),
        WatchMailbox(id = "ada@ada.studio", email = "ada@ada.studio", name = "Ada"),
    )

    fun emails(now: Instant = Instant.now()): List<WatchEmail> {
        fun ago(minutes: Long) = now.minus(minutes, ChronoUnit.MINUTES).truncatedTo(ChronoUnit.SECONDS).toString()
        return listOf(
            WatchEmail(
                id = FIRST_ID, threadId = "t1", subject = "Q3 planning: final numbers",
                sender = "maya@northwind.co", senderName = "Maya Chen", date = ago(4), read = false,
                snippet = "Attached the last pass. Can you confirm the hiring line before Friday?",
                body = "<p>Hi Ada,</p><p>Attached the last pass of the Q3 plan. Revenue is up 12% on the draft; " +
                    "the only open item is the hiring line for design.</p><p>Can you confirm it before Friday? " +
                    "Then I'll send it to the board.</p><p>Thanks,<br>Maya</p>",
                threadCount = 3, threadUnreadCount = 1,
            ),
            WatchEmail(
                id = "w2", threadId = "t2", subject = "Your table for Saturday",
                sender = "bookings@lafourchette.example", senderName = "Le Petit Four", date = ago(38), read = false,
                snippet = "Table for 2 at 19:30 is confirmed. Reply to change the time.",
                body = "Table for 2 at 19:30 on Saturday is confirmed.\n\nReply to this email to change the time.",
                threadCount = 1, threadUnreadCount = 1,
            ),
            WatchEmail(
                id = "w3", threadId = "t3", subject = "Re: Logo files",
                sender = "sam@brightline.design", senderName = "Sam Ortiz", date = ago(180), read = true,
                replyLater = true, snippet = "Here are the SVGs and the dark variant you asked for.",
                body = "Here are the SVGs and the dark variant you asked for. Shout if the spacing looks off on the watch icon.",
                threadCount = 2, threadUnreadCount = 0,
            ),
            WatchEmail(
                id = "w4", threadId = "t4", subject = "Invoice INV-2041",
                sender = "billing@cloudhost.example", senderName = null, date = ago(60 * 26), read = true,
                snippet = "Your invoice for October is ready.",
                body = "Your invoice for October is ready. Total: $48.00.",
                threadCount = 1, threadUnreadCount = 0,
            ),
        )
    }
}

private const val FIRST_ID = "w1"

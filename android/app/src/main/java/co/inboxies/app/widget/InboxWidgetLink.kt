package co.inboxies.app.widget

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Where a tap on the "Today's inbox" widget goes (AVE-150). Same URLs as iOS (AVE-149):
 * - a card: `inboxies://thread?mailbox=<id>&thread=<threadId>`
 * - anywhere else: `inboxies://inbox?mailbox=<id>`
 *
 * They're set as the data of an explicit `MainActivity` intent (no intent filter), and
 * MainActivity routes them through the same path a notification tap takes.
 */
sealed class InboxWidgetLink {
    data class Thread(val mailboxId: String, val threadId: String) : InboxWidgetLink()
    data class Inbox(val mailboxId: String?) : InboxWidgetLink()

    val url: String
        get() = when (this) {
            is Thread -> "inboxies://thread?mailbox=${encode(mailboxId)}&thread=${encode(threadId)}"
            is Inbox -> if (mailboxId.isNullOrBlank()) "inboxies://inbox" else "inboxies://inbox?mailbox=${encode(mailboxId)}"
        }

    companion object {
        fun parse(url: String?): InboxWidgetLink? {
            if (url.isNullOrBlank()) return null
            val uri = runCatching { URI(url) }.getOrNull() ?: return null
            if (!uri.scheme.equals("inboxies", ignoreCase = true)) return null
            val query = uri.rawQuery.orEmpty().split('&').mapNotNull { pair ->
                val parts = pair.split('=', limit = 2)
                if (parts.size != 2 || parts[1].isEmpty()) return@mapNotNull null
                decode(parts[0]) to decode(parts[1])
            }.toMap()
            return when (uri.host?.lowercase()) {
                "thread" -> {
                    val mailbox = query["mailbox"]?.takeIf { it.isNotBlank() } ?: return null
                    val thread = query["thread"]?.takeIf { it.isNotBlank() } ?: return null
                    Thread(mailbox, thread)
                }
                "inbox" -> Inbox(query["mailbox"]?.takeIf { it.isNotBlank() })
                else -> null
            }
        }

        private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

        private fun decode(value: String): String = URLDecoder.decode(value, Charsets.UTF_8)
    }
}

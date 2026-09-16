package co.inboxies.app.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID

@Serializable
data class Mailbox(
    val id: String,
    val email: String,
    val name: String,
    val settings: MailboxSettings? = null,
)

@Serializable
data class MailboxSettings(
    val fromName: String? = null,
    val agentSystemPrompt: String? = null,
    val forwarding: ForwardingSettings? = null,
    val signature: SignatureSettings? = null,
    val autoReply: AutoReplySettings? = null,
)

@Serializable
data class ForwardingSettings(
    val enabled: Boolean? = null,
    val email: String? = null,
)

@Serializable
data class SignatureSettings(
    val enabled: Boolean? = null,
    val text: String? = null,
    val html: String? = null,
)

@Serializable
data class AutoReplySettings(
    val enabled: Boolean? = null,
    val subject: String? = null,
    val message: String? = null,
)

@Serializable
data class Folder(
    val id: String,
    val name: String,
    val unreadCount: Int = 0,
)

@Serializable
data class Attachment(
    val id: String,
    val filename: String = "",
    val mimetype: String = "",
    val size: Int = 0,
    @SerialName("content_id") val contentId: String? = null,
    val disposition: String? = null,
) {
    val isInline: Boolean get() = (disposition ?: "").lowercase() == "inline"

    /** Content-ID without surrounding angle brackets (`<image001@local>` → `image001@local`). */
    val normalizedContentId: String?
        get() {
            var value = contentId?.trim().orEmpty()
            if (value.isEmpty()) return null
            if (value.startsWith("<") && value.endsWith(">") && value.length >= 2) {
                value = value.substring(1, value.length - 1)
            }
            return value
        }
}

data class MailAddress(
    val name: String? = null,
    val email: String,
) {
    val id: String get() = email.lowercase()

    val resolvedName: String
        get() {
            val trimmed = name?.trim().orEmpty()
            if (trimmed.isNotEmpty()) return trimmed
            val address = email.trim()
            val at = address.indexOf('@')
            return if (at > 0) address.substring(0, at) else address
        }

    fun label(selfAddress: String?): String {
        if (!selfAddress.isNullOrEmpty() && email.equals(selfAddress, ignoreCase = true)) return "me"
        return resolvedName
    }

    /** Query used when searching mail for this person. */
    val searchQuery: String
        get() {
            val trimmed = name?.trim().orEmpty()
            return if (trimmed.isNotEmpty()) trimmed else email
        }

    val tokenLabel: String
        get() {
            val trimmed = name?.trim().orEmpty()
            return if (trimmed.isNotEmpty()) trimmed else email
        }

    companion object {
        fun parseList(raw: String?): List<MailAddress> {
            if (raw.isNullOrEmpty()) return emptyList()
            return splitList(raw).mapNotNull { parse(it) }
        }

        fun parse(value: String): MailAddress? {
            val trimmed = value.trim()
            if (trimmed.isEmpty()) return null
            val lt = trimmed.lastIndexOf('<')
            val gt = trimmed.lastIndexOf('>')
            if (lt in 0 until gt) {
                val email = trimmed.substring(lt + 1, gt).trim()
                if (email.isEmpty()) return null
                var name = trimmed.substring(0, lt).trim()
                if (name.startsWith("\"") && name.endsWith("\"") && name.length >= 2) {
                    name = name.substring(1, name.length - 1).replace("\\\"", "\"")
                }
                val resolved = when {
                    name.isEmpty() || (name.contains('@') && !name.contains(' ')) -> null
                    else -> name
                }
                return MailAddress(resolved, email)
            }
            return MailAddress(null, trimmed)
        }

        fun splitList(raw: String): List<String> {
            val parts = mutableListOf<String>()
            val current = StringBuilder()
            var angleDepth = 0
            var inQuotes = false
            for (character in raw) {
                if (character == '"') {
                    inQuotes = !inQuotes
                    current.append(character)
                    continue
                }
                if (!inQuotes) {
                    when {
                        character == '<' -> angleDepth++
                        character == '>' -> angleDepth = maxOf(0, angleDepth - 1)
                        (character == ',' || character == ';') && angleDepth == 0 -> {
                            val part = current.toString().trim()
                            if (part.isNotEmpty()) parts.add(part)
                            current.clear()
                            continue
                        }
                    }
                }
                current.append(character)
            }
            val part = current.toString().trim()
            if (part.isNotEmpty()) parts.add(part)
            return parts
        }
    }
}

@Serializable
data class Email(
    val id: String,
    @SerialName("thread_id") val threadId: String? = null,
    @SerialName("folder_id") val folderId: String? = null,
    val subject: String = "",
    val sender: String = "",
    @SerialName("sender_name") val senderName: String? = null,
    val recipient: String = "",
    val cc: String? = null,
    val bcc: String? = null,
    val date: String = "",
    val read: Boolean = false,
    val starred: Boolean = false,
    val body: String? = null,
    val snippet: String? = null,
    @SerialName("in_reply_to") val inReplyTo: String? = null,
    @SerialName("message_id") val messageId: String? = null,
    @SerialName("raw_headers") val rawHeaders: String? = null,
    @SerialName("thread_count") val threadCount: Int? = null,
    @SerialName("thread_unread_count") val threadUnreadCount: Int? = null,
    val participants: String? = null,
    @SerialName("folder_name") val folderName: String? = null,
    @SerialName("has_draft") val hasDraft: Boolean? = null,
    @SerialName("needs_reply") val needsReply: Boolean? = null,
    @SerialName("has_attachment") val hasAttachment: Boolean? = null,
    val attachments: List<Attachment>? = null,
) {
    val isDraft: Boolean
        get() {
            val name = folderName?.lowercase()
            return folderId == "draft" || name == "drafts" || name == "draft"
        }

    val bodyLooksLikeHTML: Boolean
        get() {
            val b = body ?: return false
            return Regex("</?[a-zA-Z][^>]*>").containsMatchIn(b)
        }

    val isUnread: Boolean
        get() {
            if (isDraft) return false
            if ((threadUnreadCount ?: 0) > 0) return true
            return !read
        }

    val nonInlineAttachments: List<Attachment>
        get() = (attachments ?: emptyList()).filter { !it.isInline }

    val hasFileAttachment: Boolean
        get() = nonInlineAttachments.isNotEmpty() || hasAttachment == true

    val fromAddress: MailAddress
        get() = MailAddress(name = storedOrParsedFromName, email = sender)

    val toAddresses: List<MailAddress> get() = MailAddress.parseList(recipient)
    val ccAddresses: List<MailAddress> get() = MailAddress.parseList(cc)
    val bccAddresses: List<MailAddress> get() = MailAddress.parseList(bcc)

    val displaySender: String
        get() {
            if (!participants.isNullOrEmpty()) {
                val separator = if (participants.contains('\u001f')) '\u001f' else ','
                val names = participants.split(separator)
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .map { displayLabel(it) }
                    .distinct()
                if (names.isEmpty()) return fromAddress.resolvedName
                if (names.size <= 3) return names.joinToString(", ")
                return "${names.take(2).joinToString(", ")} +${names.size - 2}"
            }
            return fromAddress.resolvedName
        }

    /** Name plus address for quoted/forward headers. */
    val formattedFrom: String
        get() {
            val name = fromAddress.resolvedName
            return if (name != sender && sender.isNotEmpty()) "$name <$sender>" else sender
        }

    val previewText: String
        get() {
            val source = snippet?.takeIf { it.isNotEmpty() } ?: body
            return snippetText(source)
        }

    /** Parsed raw headers for View Source, with field fallbacks when raw is missing. */
    val sourceHeaders: List<Pair<String, String>>
        get() {
            val raw = rawHeaders
            if (!raw.isNullOrEmpty()) {
                try {
                    val element = kotlinx.serialization.json.Json.parseToJsonElement(raw)
                    when (element) {
                        is kotlinx.serialization.json.JsonArray -> {
                            val parsed = element.mapNotNull { item ->
                                val obj = item as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
                                val key = (obj["key"] ?: obj["name"])?.let {
                                    (it as? kotlinx.serialization.json.JsonPrimitive)?.content
                                }.orEmpty()
                                val value = obj["value"]?.let {
                                    (it as? kotlinx.serialization.json.JsonPrimitive)?.content ?: it.toString()
                                }.orEmpty()
                                if (key.isEmpty() && value.isEmpty()) null else key to value
                            }
                            if (parsed.isNotEmpty()) return parsed
                        }
                        is kotlinx.serialization.json.JsonObject -> {
                            return element.entries
                                .map { (k, v) ->
                                    k to ((v as? kotlinx.serialization.json.JsonPrimitive)?.content ?: v.toString())
                                }
                                .sortedBy { it.first.lowercase() }
                        }
                        else -> Unit
                    }
                } catch (_: Exception) {
                }
            }
            val headers = mutableListOf<Pair<String, String>>()
            if (sender.isNotEmpty()) headers.add("From" to sender)
            if (recipient.isNotEmpty()) headers.add("To" to recipient)
            if (!cc.isNullOrEmpty()) headers.add("Cc" to cc)
            if (!bcc.isNullOrEmpty()) headers.add("Bcc" to bcc)
            if (subject.isNotEmpty()) headers.add("Subject" to subject)
            if (date.isNotEmpty()) headers.add("Date" to date)
            if (!messageId.isNullOrEmpty()) headers.add("Message-ID" to messageId)
            if (!inReplyTo.isNullOrEmpty()) headers.add("In-Reply-To" to inReplyTo)
            if (!threadId.isNullOrEmpty()) headers.add("X-Thread-ID" to threadId)
            return headers
        }

    val parsedDate: java.util.Date?
        get() = parseIsoDate(date)

    private val storedOrParsedFromName: String?
        get() {
            val sn = senderName?.trim()
            if (!sn.isNullOrEmpty() && (!sn.contains('@') || sn.contains(' '))) return sn
            return null
        }

    fun recipientSummary(selfAddress: String?): String {
        val seen = mutableSetOf<String>()
        val labels = mutableListOf<String>()
        for (address in toAddresses + ccAddresses) {
            val key = address.email.lowercase()
            if (key.isEmpty() || !seen.add(key)) continue
            labels.add(address.label(selfAddress))
        }
        return labels.joinToString(", ")
    }

    companion object {
        fun snippetText(snippet: String?, maxLength: Int = 100): String {
            var text = snippet ?: return ""
            if (text.isEmpty()) return ""
            text = text.replace(Regex("<style[^>]*>[\\s\\S]*?</style>", RegexOption.IGNORE_CASE), "")
            text = text.replace(Regex("<[^>]*>"), " ")
            text = decodeHtmlEntities(text).replace(Regex("\\s+"), " ").trim()
            if (text.isEmpty()) return ""
            return if (text.length > maxLength) text.take(maxLength) + "..." else text
        }

        private fun displayLabel(value: String): String {
            val trimmed = value.trim()
            return if (trimmed.contains('@') && !trimmed.contains(' ')) {
                trimmed.substringBefore('@')
            } else trimmed
        }

        private fun decodeHtmlEntities(text: String): String {
            var result = text
            val named = mapOf(
                "&amp;" to "&",
                "&lt;" to "<",
                "&gt;" to ">",
                "&quot;" to "\"",
                "&#39;" to "'",
                "&apos;" to "'",
                "&nbsp;" to " ",
            )
            for ((entity, replacement) in named) {
                result = result.replace(entity, replacement)
            }
            return result
        }

        fun parseIsoDate(value: String): Date? {
            if (value.isEmpty()) return null
            return try {
                Date.from(Instant.parse(value))
            } catch (_: Exception) {
                try {
                    val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("UTC"))
                    Date.from(Instant.from(fmt.parse(value)))
                } catch (_: Exception) {
                    null
                }
            }
        }
    }
}

enum class EmailDateFilter(val label: String) {
    ANY("Any time"),
    TODAY("Today"),
    LAST_THREE_DAYS("Last 3 days"),
    THIS_WEEK("This week"),
}

data class EmailFilterState(
    val unreadOnly: Boolean = false,
    val starredOnly: Boolean = false,
    val toMeOnly: Boolean = false,
    val ccOrBccMeOnly: Boolean = false,
    val withAttachmentsOnly: Boolean = false,
    val dateFilter: EmailDateFilter = EmailDateFilter.ANY,
    val needsReplyOnly: Boolean = false,
) {
    val isActive: Boolean
        get() = unreadOnly || starredOnly || toMeOnly || ccOrBccMeOnly ||
            withAttachmentsOnly || dateFilter != EmailDateFilter.ANY || needsReplyOnly

    val activeCount: Int
        get() {
            var count = 0
            if (unreadOnly) count++
            if (starredOnly) count++
            if (toMeOnly) count++
            if (ccOrBccMeOnly) count++
            if (withAttachmentsOnly) count++
            if (dateFilter != EmailDateFilter.ANY) count++
            if (needsReplyOnly) count++
            return count
        }

    fun reset(): EmailFilterState = EmailFilterState()

    fun matches(email: Email, userEmail: String, now: Date = Date()): Boolean {
        if (unreadOnly && !email.isUnread) return false
        if (starredOnly && !email.starred) return false
        if (withAttachmentsOnly && !email.hasFileAttachment) return false
        if (needsReplyOnly && email.needsReply != true) return false

        val normalizedUser = userEmail.trim().lowercase()
        if (normalizedUser.isNotEmpty()) {
            if (toMeOnly) {
                val inTo = email.toAddresses.any { it.email.lowercase() == normalizedUser }
                val inRecip = email.recipient.lowercase().contains(normalizedUser)
                if (!inTo && !inRecip) return false
            }
            if (ccOrBccMeOnly) {
                val inCc = email.ccAddresses.any { it.email.lowercase() == normalizedUser }
                val inBcc = email.bccAddresses.any { it.email.lowercase() == normalizedUser }
                val inCcRaw = email.cc?.lowercase()?.contains(normalizedUser) == true
                val inBccRaw = email.bcc?.lowercase()?.contains(normalizedUser) == true
                if (!inCc && !inBcc && !inCcRaw && !inBccRaw) return false
            }
        }

        if (dateFilter != EmailDateFilter.ANY) {
            val date = email.parsedDate ?: return false
            val cal = Calendar.getInstance()
            when (dateFilter) {
                EmailDateFilter.ANY -> Unit
                EmailDateFilter.TODAY -> {
                    cal.time = now
                    val today = cal.get(Calendar.DAY_OF_YEAR) to cal.get(Calendar.YEAR)
                    cal.time = date
                    if (cal.get(Calendar.DAY_OF_YEAR) to cal.get(Calendar.YEAR) != today) return false
                }
                EmailDateFilter.LAST_THREE_DAYS -> {
                    val threeDaysAgo = Date(now.time - 3L * 24 * 60 * 60 * 1000)
                    if (date.before(threeDaysAgo)) return false
                }
                EmailDateFilter.THIS_WEEK -> {
                    cal.time = now
                    val week = cal.get(Calendar.WEEK_OF_YEAR) to cal.get(Calendar.YEAR)
                    cal.time = date
                    if (cal.get(Calendar.WEEK_OF_YEAR) to cal.get(Calendar.YEAR) != week) return false
                }
            }
        }
        return true
    }

    fun filter(list: List<Email>, userEmail: String): List<Email> {
        if (!isActive) return list
        val now = Date()
        return list.filter { matches(it, userEmail, now) }
    }
}

@Serializable
data class EmailListResponse(
    val emails: List<Email> = emptyList(),
    val totalCount: Int = 0,
)

@Serializable
data class RecentRecipient(
    val email: String,
    val name: String? = null,
    val lastEmailedAt: String? = null,
) {
    val id: String get() = email.lowercase()

    fun toMailAddress(): MailAddress = MailAddress(name = name, email = email)
}

@Serializable
data class RecentRecipientsResponse(
    val recipients: List<RecentRecipient> = emptyList(),
)

@Serializable
data class InboxDigest(
    @SerialName("greeting_name") val greetingName: String = "",
    @SerialName("unread_count") val unreadCount: Int = 0,
    val todos: List<InboxDigestTodo> = emptyList(),
    val topics: List<InboxDigestTopic> = emptyList(),
)

@Serializable
data class InboxDigestTodo(
    val id: String,
    @SerialName("email_id") val emailId: String,
    @SerialName("thread_id") val threadId: String? = null,
    val title: String = "",
    val summary: String = "",
    val date: String = "",
)

@Serializable
data class InboxDigestTopic(
    val id: String,
    val title: String = "",
    val emoji: String = "",
    @SerialName("caught_up") val caughtUp: Boolean = false,
    @SerialName("remaining_summary") val remainingSummary: String? = null,
    val items: List<InboxDigestTopicItem> = emptyList(),
)

@Serializable
data class InboxDigestTopicItem(
    @SerialName("email_id") val emailId: String,
    @SerialName("thread_id") val threadId: String? = null,
    val subject: String = "",
    val summary: String = "",
    val date: String = "",
    val unread: Boolean = false,
    @SerialName("attachment_count") val attachmentCount: Int = 0,
) {
    val id: String get() = emailId
}

@Serializable
data class DigestStatusResponse(
    val status: String = "",
    val count: Int? = null,
)

@Serializable
data class SendEmailResponse(
    val id: String = "",
    val status: String = "",
)

@Serializable
data class DraftSaveResponse(
    val id: String? = null,
    @SerialName("draft_id") val draftId: String? = null,
    val status: String? = null,
    val subject: String? = null,
    val recipient: String? = null,
    val date: String? = null,
) {
    val resolvedId: String get() = id ?: draftId ?: ""
}

@Serializable
data class AgentConversation(
    val id: String,
    val title: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    val lastMessagePreview: String? = null,
)

sealed class ChatSession {
    data object Dismissed : ChatSession()
    data object List : ChatSession()
    data class Conversation(val id: String) : ChatSession()

    val conversationId: String?
        get() = (this as? Conversation)?.id

    companion object {
        fun newConversationId(): String = UUID.randomUUID().toString().lowercase()
    }
}

data class ConversationDateGroup(
    val id: String,
    val title: String,
    val conversations: List<AgentConversation>,
)

@Serializable
data class AuthResponse(
    val token: String,
    val expiresAt: String = "",
    val user: AuthUser,
)

@Serializable
data class AuthUser(
    val id: String,
    val email: String? = null,
)

data class ChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: String,
    val text: String = "",
    val reasoning: String? = null,
    val reasoningDurationMs: Long? = null,
    val isToolAction: Boolean = false,
    val toolName: String? = null,
    val isError: Boolean = false,
    val timestamp: Long = System.currentTimeMillis(),
) {
    /** Human-readable reasoning duration, e.g. `"3s"`. */
    val reasoningDurationString: String?
        get() {
            val ms = reasoningDurationMs ?: return null
            val secs = maxOf(1, ((ms + 500) / 1000).toInt())
            return "${secs}s"
        }
}

enum class ComposeMode {
    New,
    Reply,
    ReplyAll,
    Forward,
    EditDraft,
}

enum class ComposePresentation {
    Expanded,
    Minimized,
}

data class AppToast(
    val id: String = UUID.randomUUID().toString(),
    val message: String,
    val isError: Boolean = false,
    val isLoading: Boolean = false,
    val isUndo: Boolean = false,
)

sealed class HomeTab {
    data class Folder(val id: String) : HomeTab()
    data object Chats : HomeTab()
    data object AiInbox : HomeTab()

    val syncFolderId: String?
        get() = when (this) {
            is Folder -> id
            AiInbox -> "inbox"
            Chats -> null
        }

    val title: String
        get() = when (this) {
            is Folder -> when (id) {
                FolderIds.INBOX -> "Inbox"
                FolderIds.PROMOTIONS -> "Promotions"
                FolderIds.UPDATES -> "Updates"
                FolderIds.SENT -> "Sent"
                FolderIds.DRAFT -> "Drafts"
                FolderIds.ARCHIVE -> "Archive"
                FolderIds.SPAM -> "Spam"
                FolderIds.TRASH -> "Trash"
                else -> id.replaceFirstChar { it.uppercase() }
            }
            Chats -> "AI"
            AiInbox -> "For you"
        }

    companion object {
        val Inbox: HomeTab = Folder(FolderIds.INBOX)
    }
}

object FolderIds {
    const val INBOX = "inbox"
    const val PROMOTIONS = "promotions"
    const val UPDATES = "updates"
    const val SENT = "sent"
    const val DRAFT = "draft"
    const val ARCHIVE = "archive"
    const val SPAM = "spam"
    const val TRASH = "trash"

    /** Swipe-tab order, matching iOS `HomeShellView.folderTabs` (excluding For you). */
    val swipeFolderIds: List<String> = listOf(
        INBOX,
        PROMOTIONS,
        UPDATES,
        SENT,
        DRAFT,
        ARCHIVE,
        SPAM,
        TRASH,
    )
}

fun groupConversationsByDate(conversations: List<AgentConversation>): List<ConversationDateGroup> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val sorted = conversations.sortedByDescending {
        Email.parseIsoDate(it.updatedAt)?.time ?: Email.parseIsoDate(it.createdAt)?.time ?: 0L
    }
    val todayList = mutableListOf<AgentConversation>()
    val yesterdayList = mutableListOf<AgentConversation>()
    val prev7 = mutableListOf<AgentConversation>()
    val prev30 = mutableListOf<AgentConversation>()
    val months = linkedMapOf<String, MutableList<AgentConversation>>()

    for (conv in sorted) {
        val instant = Email.parseIsoDate(conv.updatedAt) ?: Email.parseIsoDate(conv.createdAt)
        val date = instant?.toInstant()?.atZone(zone)?.toLocalDate() ?: today
        val days = ChronoUnit.DAYS.between(date, today)
        when {
            date == today -> todayList.add(conv)
            date == today.minusDays(1) -> yesterdayList.add(conv)
            days in 0..7 -> prev7.add(conv)
            days in 0..30 -> prev30.add(conv)
            else -> {
                val key = date.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()))
                months.getOrPut(key) { mutableListOf() }.add(conv)
            }
        }
    }

    val groups = mutableListOf<ConversationDateGroup>()
    if (todayList.isNotEmpty()) groups += ConversationDateGroup("today", "Today", todayList)
    if (yesterdayList.isNotEmpty()) groups += ConversationDateGroup("yesterday", "Yesterday", yesterdayList)
    if (prev7.isNotEmpty()) groups += ConversationDateGroup("prev7Days", "Previous 7 Days", prev7)
    if (prev30.isNotEmpty()) groups += ConversationDateGroup("prev30Days", "Previous 30 Days", prev30)
    for ((title, list) in months) {
        groups += ConversationDateGroup("month-$title", title, list)
    }
    return groups
}

val AppJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    encodeDefaults = true
    explicitNulls = false
}

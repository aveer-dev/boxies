package co.inboxies.wear.data

import co.inboxies.wear.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.ZonedDateTime
import java.util.TimeZone
import java.util.concurrent.TimeUnit

@Serializable
data class WatchMailbox(
    val id: String,
    val email: String = "",
    val name: String = "",
) {
    val title: String get() = name.ifBlank { email.ifBlank { id } }
}

/** The fields of a list row / message the watch shows. The Worker sends many more. */
@Serializable
data class WatchEmail(
    val id: String,
    @SerialName("thread_id") val threadId: String? = null,
    val subject: String = "",
    val sender: String = "",
    @SerialName("sender_name") val senderName: String? = null,
    val date: String = "",
    val read: Boolean = false,
    @SerialName("reply_later") val replyLater: Boolean = false,
    val snippet: String? = null,
    val body: String? = null,
    @SerialName("thread_count") val threadCount: Int? = null,
    @SerialName("thread_unread_count") val threadUnreadCount: Int? = null,
) {
    /** Threaded rows: unread while any message in the conversation is. */
    val isUnread: Boolean get() = threadUnreadCount?.let { it > 0 } ?: !read

    val displaySender: String get() = WatchMailText.senderName(senderName, sender)

    val displaySubject: String get() = subject.trim().ifEmpty { "(No subject)" }

    /** This row after Mark read / unread. */
    fun withRead(read: Boolean): WatchEmail = copy(
        read = read,
        threadUnreadCount = threadUnreadCount?.let { if (read) 0 else maxOf(1, it) },
    )
}

/**
 * A folder's unread count (`GET .../folders`, AVE-147). For the Inbox,
 * `unreadThreadCount` is the New total the phone's widget shows; older Workers only
 * send `unreadCount` (messages).
 */
@Serializable
data class WatchFolder(
    val id: String,
    val unreadThreadCount: Int? = null,
    val unreadCount: Int? = null,
) {
    val unread: Int get() = unreadThreadCount ?: unreadCount ?: 0
}

@Serializable
private data class WatchEmailList(val emails: List<WatchEmail> = emptyList())

@Serializable
private data class WatchErrorBody(val error: String? = null)

sealed class WatchApiException(message: String) : Exception(message) {
    /** 401: the watch session ended (phone signed out, revoked, or replaced). */
    class SignedOut : WatchApiException("Signed out on this watch.")

    /** No session yet; the watch is still quietly asking the phone for one. */
    class Reconnecting : WatchApiException("Reconnecting to your phone. Try again in a moment.")

    class Http(val code: Int, message: String) :
        WatchApiException(message.ifBlank { "Something went wrong ($code)." })

    class Transport(cause: Throwable) : WatchApiException("Can't reach Inboxies. Check the connection.") {
        init {
            initCause(cause)
        }
    }

    class Decoding : WatchApiException("Inboxies sent something this watch can't read.")
}

enum class WatchMoveTarget(val folderId: String) {
    ARCHIVE("archive"),
    SPAM("spam"),
    INBOX("inbox"),
}

/**
 * The handful of Worker calls the watch makes, all inside the `watch` scope's
 * allowlist (`workers/lib/auth-paths.ts`, AVE-143). An interface so `WatchStore`
 * is testable without a network.
 */
interface WatchApiClient {
    val token: String

    suspend fun mailboxes(): List<WatchMailbox>

    suspend fun inbox(mailboxId: String, limit: Int = 20): List<WatchEmail>

    suspend fun email(mailboxId: String, id: String): WatchEmail

    /** Unread counts per folder, for the Tile and complication. */
    suspend fun folders(mailboxId: String): List<WatchFolder>

    suspend fun setRead(read: Boolean, mailboxId: String, email: WatchEmail)

    suspend fun replyLater(mailboxId: String, id: String)

    suspend fun move(mailboxId: String, id: String, to: WatchMoveTarget)

    suspend fun quickReply(mailboxId: String, id: String, text: String, idempotencyKey: String)
}

/** OkHttp client for [WatchApiClient]. Bearer token only, no cookies, no redirects. */
class WatchApi(
    private val baseUrl: String,
    override val token: String,
    private val http: OkHttpClient = sharedClient,
) : WatchApiClient {

    override suspend fun mailboxes(): List<WatchMailbox> =
        json.decodeOrThrow(ListSerializer(WatchMailbox.serializer()), send("GET", "/api/v1/mailboxes"))

    /** `GET .../emails?folder=inbox`: the newest conversations. */
    override suspend fun inbox(mailboxId: String, limit: Int): List<WatchEmail> = json.decodeOrThrow(
        WatchEmailList.serializer(),
        send(
            "GET",
            "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails",
            query = mapOf("folder" to "inbox", "threaded" to "true", "page" to "1", "limit" to limit.toString()),
        ),
    ).emails

    override suspend fun email(mailboxId: String, id: String): WatchEmail = json.decodeOrThrow(
        WatchEmail.serializer(),
        send("GET", "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails/${id.pathSegment()}"),
    )

    /** `GET .../folders`: the Inbox unread total for the Tile and complication (AVE-147). */
    override suspend fun folders(mailboxId: String): List<WatchFolder> = json.decodeOrThrow(
        ListSerializer(WatchFolder.serializer()),
        send("GET", "/api/v1/mailboxes/${mailboxId.pathSegment()}/folders"),
    )

    /** `POST .../threads/:threadId/read`, or `PUT .../emails/:id { read }` for one message. */
    override suspend fun setRead(read: Boolean, mailboxId: String, email: WatchEmail) {
        val threadId = email.threadId
        if (read && !threadId.isNullOrEmpty()) {
            send("POST", "/api/v1/mailboxes/${mailboxId.pathSegment()}/threads/${threadId.pathSegment()}/read", body = JsonObject(emptyMap()))
        } else {
            send(
                "PUT",
                "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails/${email.id.pathSegment()}",
                body = buildJsonObject { put("read", read) },
            )
        }
    }

    /** `PUT .../emails/:id { reply_later, reply_later_remind_at }`: tomorrow 09:00, like the notification action. */
    override suspend fun replyLater(mailboxId: String, id: String) {
        send(
            "PUT",
            "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails/${id.pathSegment()}",
            body = replyLaterBody(ZonedDateTime.now()),
        )
    }

    /** `POST .../emails/:id/move`: Archive, or Report spam (which also teaches the mailbox about the sender). */
    override suspend fun move(mailboxId: String, id: String, to: WatchMoveTarget) {
        send("POST", "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails/${id.pathSegment()}/move", body = moveBody(to))
    }

    /** `POST .../emails/:id/quick-reply { text }`. The Worker picks To, From and the subject. */
    override suspend fun quickReply(mailboxId: String, id: String, text: String, idempotencyKey: String) {
        send(
            "POST",
            "/api/v1/mailboxes/${mailboxId.pathSegment()}/emails/${id.pathSegment()}/quick-reply",
            body = quickReplyBody(text),
            headers = mapOf("Idempotency-Key" to idempotencyKey),
        )
    }

    private suspend fun send(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JsonObject? = null,
        headers: Map<String, String> = emptyMap(),
    ): String = withContext(Dispatchers.IO) {
        val url = buildUrl(baseUrl, path, query) ?: throw WatchApiException.Http(0, "Invalid server address.")
        val builder = Request.Builder().url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
        headers.forEach { (name, value) -> builder.header(name, value) }
        val requestBody = body?.let { json.encodeToString(JsonObject.serializer(), it).toRequestBody(JSON_MEDIA) }
        builder.method(method, requestBody)
        try {
            http.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (isSessionEnded(response.code, text)) throw WatchApiException.SignedOut()
                if (!response.isSuccessful) throw WatchApiException.Http(response.code, errorMessage(text))
                text
            }
        } catch (e: WatchApiException) {
            throw e
        } catch (e: IOException) {
            throw WatchApiException.Transport(e)
        }
    }

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        internal val json = Json {
            ignoreUnknownKeys = true
            isLenient = true
            coerceInputValues = true
        }

        private val sharedClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .addInterceptor(PreviewNetworkGuard.interceptor)
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .followRedirects(false)
                .build()
        }

        /**
         * The watch session is gone: a 401, or the Worker's "Invalid or expired mobile
         * session token" (also sent as 403). Other 403s (a mailbox the user lost, a route
         * outside the watch scope) are ordinary errors.
         */
        fun isSessionEnded(code: Int, body: String): Boolean =
            code == 401 ||
                (code == 403 && body.contains("invalid or expired mobile session token", ignoreCase = true))

        fun errorMessage(body: String): String =
            runCatching { json.decodeFromString(WatchErrorBody.serializer(), body).error }.getOrNull().orEmpty()

        fun buildUrl(baseUrl: String, path: String, query: Map<String, String> = emptyMap()): String? {
            val base = baseUrl.trimEnd('/').toHttpUrlOrNull() ?: return null
            val builder = base.newBuilder().encodedPath(path)
            query.toSortedMap().forEach { (name, value) -> builder.addQueryParameter(name, value) }
            return builder.build().toString()
        }

        fun moveBody(to: WatchMoveTarget): JsonObject = buildJsonObject {
            put("folderId", to.folderId)
            // Report spam also files the sender's other mail, like the phone's Report spam.
            if (to == WatchMoveTarget.SPAM) put("setSenderPreference", true)
        }

        fun quickReplyBody(text: String, timeZoneId: String = TimeZone.getDefault().id): JsonObject = buildJsonObject {
            put("text", text)
            put("quote_time_zone", timeZoneId)
        }

        fun replyLaterBody(now: ZonedDateTime): JsonObject = buildJsonObject {
            put("reply_later", true)
            put("reply_later_remind_at", ReplyLaterTomorrow.iso(now))
        }

        /** Dev builds may talk to a local Worker over http. */
        val allowLocalHttp: Boolean get() = BuildConfig.DEBUG
    }
}

private fun <T> Json.decodeOrThrow(serializer: kotlinx.serialization.KSerializer<T>, text: String): T =
    try {
        decodeFromString(serializer, text)
    } catch (e: Exception) {
        throw WatchApiException.Decoding()
    }

/** One URL path segment: ids are opaque, so escape everything but unreserved characters. */
internal fun String.pathSegment(): String = buildString {
    for (byte in this@pathSegment.toByteArray(Charsets.UTF_8)) {
        val c = byte.toInt() and 0xFF
        val ch = c.toChar()
        if (ch.isLetterOrDigit() && c < 0x80 || ch == '-' || ch == '.' || ch == '_' || ch == '~') {
            append(ch)
        } else {
            append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xF])
        }
    }
}

/**
 * "Tomorrow 09:00 local" as UTC ISO with milliseconds: the phone's Reply Later
 * preset and wire format (`ReplyLaterReminderPresets.tomorrow` / `toIso`, AVE-86).
 */
internal object ReplyLaterTomorrow {
    private val ISO_UTC = java.time.format.DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(java.time.ZoneOffset.UTC)

    fun at(now: ZonedDateTime): ZonedDateTime =
        now.toLocalDate().plusDays(1).atTime(9, 0).atZone(now.zone)

    fun iso(now: ZonedDateTime): String = ISO_UTC.format(at(now).toInstant())
}

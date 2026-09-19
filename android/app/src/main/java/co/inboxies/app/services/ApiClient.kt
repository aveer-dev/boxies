package co.inboxies.app.services

import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.AgentConversation
import co.inboxies.app.models.AuthResponse
import co.inboxies.app.models.DigestStatusResponse
import co.inboxies.app.models.DraftSaveResponse
import co.inboxies.app.models.Email
import co.inboxies.app.models.EmailListResponse
import co.inboxies.app.models.Folder
import co.inboxies.app.models.InboxDigest
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.MeResponse
import co.inboxies.app.models.RecentRecipient
import co.inboxies.app.models.RecentRecipientsResponse
import co.inboxies.app.models.SendEmailResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

sealed class ApiException(message: String) : Exception(message) {
    class InvalidURL : ApiException("Invalid API URL")
    class Http(val code: Int, body: String) : ApiException(if (body.isNotEmpty()) body else "HTTP $code")
    class Decoding(cause: Throwable) : ApiException("Decode error: ${cause.message}")
    class NotJson(preview: String) : ApiException("API returned HTML instead of JSON. $preview")
    class CloudflareAccess : ApiException(
        "Cloudflare Access is blocking the API. Add a Bypass policy for inboxies.email/api/* " +
            "(and /agents/* for chat) in Zero Trust.",
    )
    class Transport(cause: Throwable) : ApiException(cause.message ?: "Network error")
}

@Serializable
class EmptyResponse

/** Thin OkHttp + kotlinx.serialization client mirroring iOS APIClient. */
class ApiClient private constructor() {
    var authTokenProvider: () -> String? = { null }

    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    companion object {
        val shared: ApiClient by lazy { ApiClient() }
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }

    suspend inline fun <reified T> request(
        path: String,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        body: JsonObject? = null,
        authed: Boolean = true,
    ): T = withContext(Dispatchers.IO) {
        val (data, code, contentType) = perform(path, method, query, body, authed)
        if (code == 204 && T::class == EmptyResponse::class) {
            @Suppress("UNCHECKED_CAST")
            return@withContext EmptyResponse() as T
        }
        if (!contentType.contains("json", ignoreCase = true) && data.isNotBlank()) {
            if (looksLikeCloudflareAccess(data, null)) throw ApiException.CloudflareAccess()
            throw ApiException.NotJson(data.take(160))
        }
        try {
            json.decodeFromString<T>(data.ifBlank { "{}" })
        } catch (e: Exception) {
            throw ApiException.Decoding(e)
        }
    }

    suspend fun requestBytes(
        path: String,
        method: String = "GET",
        query: Map<String, String> = emptyMap(),
        authed: Boolean = true,
    ): ByteArray = withContext(Dispatchers.IO) {
        val (data, _, _) = perform(path, method, query, null, authed, asBytes = true)
        data.toByteArray(StandardCharsets.ISO_8859_1)
    }

    fun perform(
        path: String,
        method: String,
        query: Map<String, String>,
        body: JsonObject?,
        authed: Boolean,
        asBytes: Boolean = false,
    ): Triple<String, Int, String> {
        val base = AppConfig.apiBaseURL
        val uri = try {
            URI(base)
        } catch (_: Exception) {
            throw ApiException.InvalidURL()
        }
        val cleanPath = if (path.startsWith("/")) path else "/$path"
        val basePath = uri.path?.trim('/')?.takeIf { it.isNotEmpty() }
        val fullPath = if (basePath == null) cleanPath else "/$basePath$cleanPath"
        val queryString = if (query.isEmpty()) {
            ""
        } else {
            "?" + query.entries.joinToString("&") { (k, v) ->
                "${urlEncode(k)}=${urlEncode(v)}"
            }
        }
        val port = if (uri.port != -1) ":${uri.port}" else ""
        val url = "${uri.scheme}://${uri.host}$port$fullPath$queryString"

        val builder = Request.Builder().url(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
        if (authed) {
            authTokenProvider()?.let { builder.header("Authorization", "Bearer $it") }
        }
        val requestBody = body?.let { json.encodeToString(JsonObject.serializer(), it).toRequestBody(JSON_MEDIA) }
        builder.method(method, if (method == "GET" || method == "DELETE" && requestBody == null) null else requestBody
            ?: if (method == "POST" || method == "PUT" || method == "PATCH") "{}".toRequestBody(JSON_MEDIA) else null)

        try {
            client.newCall(builder.build()).execute().use { response ->
                val bytes = response.body?.bytes() ?: ByteArray(0)
                val text = if (asBytes) {
                    String(bytes, StandardCharsets.ISO_8859_1)
                } else {
                    String(bytes, StandardCharsets.UTF_8)
                }
                val location = response.header("Location")
                val wwwAuth = response.header("WWW-Authenticate")
                if (looksLikeCloudflareAccess(text, wwwAuth) || location?.contains("cloudflareaccess") == true) {
                    throw ApiException.CloudflareAccess()
                }
                if (!response.isSuccessful) {
                    throw ApiException.Http(response.code, httpErrorMessage(text))
                }
                return Triple(text, response.code, response.header("Content-Type").orEmpty())
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException.Transport(e)
        }
    }

    suspend fun listMailboxes(): List<Mailbox> = request("/api/v1/mailboxes")

    suspend fun getMe(): MeResponse = request("/api/v1/me")

    suspend fun createMailbox(name: String, email: String): Mailbox = request(
        "/api/v1/mailboxes",
        method = "POST",
        body = buildJsonObject {
            put("name", name)
            put("email", email)
        },
    )

    suspend fun getMailbox(mailboxId: String): Mailbox =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}")

    suspend fun updateMailbox(mailboxId: String, settings: MailboxSettings): Mailbox {
        val settingsElement = json.encodeToJsonElement(MailboxSettings.serializer(), settings)
        return request(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}",
            method = "PUT",
            body = buildJsonObject { put("settings", settingsElement) },
        )
    }

    suspend fun deleteMailbox(mailboxId: String) {
        request<EmptyResponse>("/api/v1/mailboxes/${pathEncode(mailboxId)}", method = "DELETE")
    }

    suspend fun listFolders(mailboxId: String): List<Folder> =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}/folders")

    suspend fun getInboxDigest(mailboxId: String): InboxDigest =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}/inbox-digest")

    suspend fun inboxDigest(mailboxId: String): InboxDigest = getInboxDigest(mailboxId)

    fun okHttpClient(): OkHttpClient = client

    suspend fun completeDigestTodo(mailboxId: String, todoId: String): DigestStatusResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/inbox-digest/todos/${pathEncode(todoId)}/complete",
        method = "POST",
    )

    suspend fun markDigestTopicRead(mailboxId: String, topicId: String, emailIds: List<String>): DigestStatusResponse =
        request(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/inbox-digest/topics/${pathEncode(topicId)}/mark-read",
            method = "POST",
            body = buildJsonObject {
                put("emailIds", kotlinx.serialization.json.JsonArray(emailIds.map { JsonPrimitive(it) }))
            },
        )

    suspend fun listEmails(
        mailboxId: String,
        folder: String,
        page: Int = 1,
        threaded: Boolean = true,
    ): EmailListResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails",
        query = mapOf(
            "folder" to folder,
            "threaded" to threaded.toString(),
            "page" to page.toString(),
            "limit" to "25",
        ),
    )

    suspend fun getEmail(mailboxId: String, id: String): Email =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(id)}")

    suspend fun getThread(mailboxId: String, threadId: String): List<Email> =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}/threads/${pathEncode(threadId)}")

    suspend fun updateEmail(
        mailboxId: String,
        id: String,
        read: Boolean? = null,
        starred: Boolean? = null,
    ): Email = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(id)}",
        method = "PUT",
        body = buildJsonObject {
            if (read != null) put("read", read)
            if (starred != null) put("starred", starred)
        },
    )

    suspend fun markRead(mailboxId: String, id: String): Email =
        updateEmail(mailboxId, id, read = true)

    suspend fun moveEmail(mailboxId: String, id: String, folderId: String) {
        request<EmptyResponse>(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(id)}/move",
            method = "POST",
            body = buildJsonObject { put("folderId", folderId) },
        )
    }

    suspend fun deleteEmail(mailboxId: String, id: String) {
        request<EmptyResponse>(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(id)}",
            method = "DELETE",
        )
    }

    suspend fun searchEmails(mailboxId: String, query: String, page: Int = 1): EmailListResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/search",
        query = mapOf("query" to query, "page" to page.toString(), "limit" to "25"),
    )

    suspend fun listRecipients(mailboxId: String, q: String = "", limit: Int = 20): List<RecentRecipient> {
        val response: RecentRecipientsResponse = request(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/recipients",
            query = buildMap {
                if (q.isNotEmpty()) put("q", q)
                put("limit", limit.toString())
            },
        )
        return response.recipients
    }

    suspend fun search(mailboxId: String, query: String): List<Email> =
        searchEmails(mailboxId, query).emails

    suspend fun sendEmail(mailboxId: String, payload: JsonObject): SendEmailResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails",
        method = "POST",
        body = payload,
    )

    suspend fun sendEmail(
        mailboxId: String,
        to: String,
        subject: String,
        body: String,
        cc: String? = null,
        bcc: String? = null,
    ): SendEmailResponse = sendEmail(
        mailboxId,
        buildJsonObject {
            put("to", to)
            put("subject", subject)
            put("body", body)
            put("html", true)
            if (!cc.isNullOrBlank()) put("cc", cc)
            if (!bcc.isNullOrBlank()) put("bcc", bcc)
        },
    )

    suspend fun replyToEmail(mailboxId: String, emailId: String, payload: JsonObject): SendEmailResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(emailId)}/reply",
        method = "POST",
        body = payload,
    )

    suspend fun replyEmail(
        mailboxId: String,
        emailId: String,
        body: String,
        replyAll: Boolean = false,
    ): SendEmailResponse = replyToEmail(
        mailboxId,
        emailId,
        buildJsonObject {
            put("body", body)
            put("html", true)
            put("replyAll", replyAll)
        },
    )

    suspend fun forwardEmail(mailboxId: String, emailId: String, payload: JsonObject): SendEmailResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(emailId)}/forward",
        method = "POST",
        body = payload,
    )

    suspend fun forwardEmail(
        mailboxId: String,
        emailId: String,
        to: String,
        body: String,
    ): SendEmailResponse = forwardEmail(
        mailboxId,
        emailId,
        buildJsonObject {
            put("to", to)
            put("body", body)
            put("html", true)
        },
    )

    suspend fun saveDraft(mailboxId: String, draft: JsonObject): DraftSaveResponse = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/drafts",
        method = "POST",
        body = draft,
    )

    suspend fun saveDraft(
        mailboxId: String,
        to: String,
        subject: String,
        body: String,
        draftId: String? = null,
        inReplyTo: String? = null,
        cc: String? = null,
        bcc: String? = null,
    ): DraftSaveResponse = saveDraft(
        mailboxId,
        buildJsonObject {
            put("to", to)
            put("subject", subject)
            put("body", body)
            put("html", true)
            if (!draftId.isNullOrBlank()) put("id", draftId)
            if (!inReplyTo.isNullOrBlank()) put("inReplyTo", inReplyTo)
            if (!cc.isNullOrBlank()) put("cc", cc)
            if (!bcc.isNullOrBlank()) put("bcc", bcc)
        },
    )

    suspend fun getAttachment(mailboxId: String, emailId: String, attachmentId: String): ByteArray =
        requestBytes(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/emails/${pathEncode(emailId)}/attachments/${pathEncode(attachmentId)}",
        )

    suspend fun listConversations(mailboxId: String): List<AgentConversation> =
        request("/api/v1/mailboxes/${pathEncode(mailboxId)}/agent/conversations")

    suspend fun createConversation(
        mailboxId: String,
        id: String? = null,
        title: String? = null,
        lastMessagePreview: String? = null,
    ): AgentConversation = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/agent/conversations",
        method = "POST",
        body = buildJsonObject {
            if (id != null) put("id", id)
            if (title != null) put("title", title)
            if (lastMessagePreview != null) put("lastMessagePreview", lastMessagePreview)
        },
    )

    suspend fun updateConversation(
        mailboxId: String,
        id: String,
        title: String? = null,
        lastMessagePreview: String? = null,
    ): AgentConversation = request(
        "/api/v1/mailboxes/${pathEncode(mailboxId)}/agent/conversations/${pathEncode(id)}",
        method = "PATCH",
        body = buildJsonObject {
            if (title != null) put("title", title)
            if (lastMessagePreview != null) put("lastMessagePreview", lastMessagePreview)
        },
    )

    suspend fun deleteConversation(mailboxId: String, id: String) {
        request<EmptyResponse>(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/agent/conversations/${pathEncode(id)}",
            method = "DELETE",
        )
    }

    suspend fun registerDeviceToken(mailboxId: String, token: String) {
        request<EmptyResponse>(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/device-token",
            method = "POST",
            body = buildJsonObject {
                put("token", token)
                put("platform", "android")
            },
        )
    }

    suspend fun unregisterDeviceToken(mailboxId: String, token: String) {
        request<EmptyResponse>(
            "/api/v1/mailboxes/${pathEncode(mailboxId)}/device-token/${pathEncode(token)}",
            method = "DELETE",
        )
    }

    suspend fun authGoogle(idToken: String): AuthResponse = request(
        "/api/v1/auth/google",
        method = "POST",
        body = buildJsonObject { put("idToken", idToken) },
        authed = false,
    )

    suspend fun authDev(email: String): AuthResponse = request(
        "/api/v1/auth/dev",
        method = "POST",
        body = buildJsonObject { put("email", email) },
        authed = false,
    )

    private fun pathEncode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private fun urlEncode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    private fun httpErrorMessage(data: String): String = try {
        val obj = json.parseToJsonElement(data).jsonObjectOrNull()
        obj?.get("error")?.let { (it as? JsonPrimitive)?.content } ?: data
    } catch (_: Exception) {
        data
    }

    fun looksLikeCloudflareAccess(body: String, wwwAuth: String?): Boolean {
        if (wwwAuth?.contains("cloudflare-access", ignoreCase = true) == true) return true
        val preview = body.take(400).lowercase()
        return preview.contains("cloudflareaccess.com") || preview.contains("cloudflare access")
    }

    private fun JsonElement.jsonObjectOrNull(): JsonObject? = this as? JsonObject
}

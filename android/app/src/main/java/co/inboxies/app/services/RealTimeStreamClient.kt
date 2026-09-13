package co.inboxies.app.services

import android.util.Log
import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.AppJson
import co.inboxies.app.models.Email
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

/** SSE event stream + 20s poll safety net. */
class RealTimeStreamClient private constructor(private val api: ApiClient) {
    var onNewEmailReceived: ((Email) -> Unit)? = null
    var onSyncRequested: (() -> Unit)? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentMailboxId: String? = null
    private var streamJob: Job? = null
    private var pollJob: Job? = null

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    fun start(mailboxId: String) {
        if (currentMailboxId == mailboxId && streamJob?.isActive == true) return
        stop()
        currentMailboxId = mailboxId
        streamJob = scope.launch { runEventStream(mailboxId) }
        pollJob = scope.launch { runAdaptivePolling() }
    }

    fun stop() {
        streamJob?.cancel()
        streamJob = null
        pollJob?.cancel()
        pollJob = null
        currentMailboxId = null
    }

    private suspend fun runEventStream(mailboxId: String) {
        var backoff = 2_000L
        while (currentMailboxId == mailboxId) {
            try {
                val url = eventsUrl(mailboxId) ?: return
                val requestBuilder = Request.Builder()
                    .url(url)
                    .header("Accept", "text/event-stream")
                api.authTokenProvider()?.let {
                    requestBuilder.header("Authorization", "Bearer $it")
                }
                client.newCall(requestBuilder.build()).execute().use { response ->
                    if (!response.isSuccessful) {
                        delay(backoff)
                        backoff = minOf(backoff * 2, 30_000L)
                        return@use
                    }
                    backoff = 2_000L
                    val source = response.body?.source() ?: return@use
                    var eventName = "message"
                    while (currentMailboxId == mailboxId && !source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        val trimmed = line.trim()
                        when {
                            trimmed.isEmpty() -> Unit
                            trimmed.startsWith("event:") ->
                                eventName = trimmed.removePrefix("event:").trim()
                            trimmed.startsWith("data:") -> {
                                val data = trimmed.removePrefix("data:").trim()
                                handleServerEvent(eventName, data)
                                eventName = "message"
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.d(TAG, "Realtime reconnect: ${e.message}")
                delay(backoff)
                backoff = minOf(backoff * 2, 30_000L)
            }
        }
    }

    private fun handleServerEvent(event: String, data: String) {
        if (event == "new_email" || event == "message") {
            runCatching { AppJson.decodeFromString(Email.serializer(), data) }.getOrNull()?.let { email ->
                onNewEmailReceived?.invoke(email)
                return
            }
        }
        onSyncRequested?.invoke()
    }

    private suspend fun runAdaptivePolling() {
        while (true) {
            delay(20_000L)
            onSyncRequested?.invoke()
        }
    }

    private fun eventsUrl(mailboxId: String): String? = try {
        val base = URI(AppConfig.apiBaseURL)
        val encoded = URLEncoder.encode(mailboxId, StandardCharsets.UTF_8.name()).replace("+", "%20")
        val path = "/api/v1/mailboxes/$encoded/events"
        val port = if (base.port != -1) ":${base.port}" else ""
        "${base.scheme}://${base.host}$port$path"
    } catch (_: Exception) {
        null
    }

    companion object {
        private const val TAG = "RealtimeStream"
        val shared: RealTimeStreamClient by lazy { RealTimeStreamClient(ApiClient.shared) }
    }
}

package co.inboxies.app.services

import android.util.Log
import co.inboxies.app.models.AppJson
import co.inboxies.app.models.Email
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import kotlin.coroutines.coroutineContext

/**
 * SSE event stream + 20s poll safety net for one mailbox.
 *
 * Callbacks carry the mailbox id the stream was started for. A blocking read can still
 * hand over an event from the previous mailbox right after a switch, so listeners must
 * drop ids that are no longer selected (this client also drops them once [stop] ran).
 * [stop] cancels the in-flight HTTP call so the socket closes immediately — that is what
 * lets the app go quiet in the background.
 */
class RealTimeStreamClient private constructor(private val api: ApiClient) {
    var onNewEmailReceived: ((mailboxId: String, email: Email) -> Unit)? = null
    var onSyncRequested: ((mailboxId: String) -> Unit)? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var currentMailboxId: String? = null
    private var streamJob: Job? = null
    private var pollJob: Job? = null

    @Volatile
    private var activeCall: Call? = null

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    val isRunning: Boolean
        get() = streamJob?.isActive == true

    @Synchronized
    fun start(mailboxId: String) {
        if (currentMailboxId == mailboxId && streamJob?.isActive == true) return
        stop()
        currentMailboxId = mailboxId
        streamJob = scope.launch { runEventStream(mailboxId) }
        pollJob = scope.launch { runAdaptivePolling(mailboxId) }
    }

    @Synchronized
    fun stop() {
        currentMailboxId = null
        streamJob?.cancel()
        streamJob = null
        pollJob?.cancel()
        pollJob = null
        activeCall?.cancel()
        activeCall = null
    }

    private fun isCurrent(mailboxId: String) = currentMailboxId == mailboxId

    private suspend fun runEventStream(mailboxId: String) {
        var backoff = 2_000L
        val parser = SseEventParser()
        while (isCurrent(mailboxId) && coroutineContext.isActive) {
            try {
                val url = eventsUrl(mailboxId) ?: return
                val requestBuilder = Request.Builder()
                    .url(url)
                    .header("Accept", "text/event-stream")
                api.authTokenProvider()?.let {
                    requestBuilder.header("Authorization", "Bearer $it")
                }
                val call = client.newCall(requestBuilder.build())
                activeCall = call
                // stop() may have run between the loop check and publishing the call.
                if (!isCurrent(mailboxId)) {
                    call.cancel()
                    return
                }
                call.execute().use { response ->
                    if (!response.isSuccessful) {
                        delay(backoff)
                        backoff = minOf(backoff * 2, 30_000L)
                        return@use
                    }
                    backoff = 2_000L
                    parser.reset()
                    val source = response.body?.source() ?: return@use
                    while (isCurrent(mailboxId) && !source.exhausted()) {
                        val line = source.readUtf8Line() ?: break
                        val event = parser.feed(line) ?: continue
                        if (isCurrent(mailboxId)) handleServerEvent(mailboxId, event)
                    }
                }
            } catch (e: Exception) {
                if (!isCurrent(mailboxId)) return
                Log.d(TAG, "Realtime reconnect: ${e.message}")
                delay(backoff)
                backoff = minOf(backoff * 2, 30_000L)
            }
        }
    }

    private fun handleServerEvent(mailboxId: String, event: SseEvent) {
        if (event.event == "ping" || event.event == "connected") return
        if (event.event == "new_email" || event.event == "message") {
            runCatching { AppJson.decodeFromString(Email.serializer(), event.data) }.getOrNull()?.let { email ->
                onNewEmailReceived?.invoke(mailboxId, email)
                return
            }
        }
        onSyncRequested?.invoke(mailboxId)
    }

    private suspend fun runAdaptivePolling(mailboxId: String) {
        while (isCurrent(mailboxId) && coroutineContext.isActive) {
            delay(20_000L)
            if (isCurrent(mailboxId)) onSyncRequested?.invoke(mailboxId)
        }
    }

    /** Built like every other API URL, so a base path in the API base URL is kept. */
    private fun eventsUrl(mailboxId: String): String? = runCatching {
        api.buildUrl("/api/v1/mailboxes/${api.pathEncode(mailboxId)}/events")
    }.getOrNull()

    companion object {
        private const val TAG = "RealtimeStream"
        val shared: RealTimeStreamClient by lazy { RealTimeStreamClient(ApiClient.shared) }
    }
}

package co.inboxies.app.services

import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.ChatMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

/** WebSocket client for `/agents/email-agent/{mailbox}::{conversationId}`. */
class AgentChatClient(
    private val api: ApiClient = ApiClient.shared,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _isStreaming = MutableStateFlow(false)
    val isStreaming: StateFlow<Boolean> = _isStreaming.asStateFlow()

    private val _isLoadingHistory = MutableStateFlow(false)
    val isLoadingHistory: StateFlow<Boolean> = _isLoadingHistory.asStateFlow()

    private val _statusText = MutableStateFlow<String?>(null)
    val statusText: StateFlow<String?> = _statusText.asStateFlow()

    private val _historyError = MutableStateFlow<String?>(null)
    val historyError: StateFlow<String?> = _historyError.asStateFlow()

    var onStreamFinished: ((Boolean) -> Unit)? = null
    var onHistoryLoaded: ((List<ChatMessage>) -> Unit)? = null

    private var webSocket: WebSocket? = null
    private var authToken: String? = null
    private var mailboxId: String? = null
    private var conversationId: String? = null
    private var streamingAssistantId: String? = null
    private var hasActiveToolAction = false
    private var pingJob: Job? = null
    private var isExplicitDisconnect = false
    private val pendingToolCalls = mutableMapOf<String, String>()

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    fun connect(mailboxId: String, conversationId: String, authToken: String? = api.authTokenProvider()) {
        if (_isConnected.value && this.mailboxId == mailboxId && this.conversationId == conversationId) {
            return
        }
        val same = this.mailboxId == mailboxId && this.conversationId == conversationId
        teardownSocket(explicit = false)
        if (!same) _messages.value = emptyList()
        isExplicitDisconnect = false
        _statusText.value = null
        _historyError.value = null
        _isLoadingHistory.value = true
        this.mailboxId = mailboxId
        this.conversationId = conversationId
        this.authToken = authToken

        scope.launch {
            loadInitialMessages(mailboxId, conversationId, authToken)
        }

        val url = agentURL(mailboxId, conversationId, websocket = true) ?: run {
            _isLoadingHistory.value = false
            return
        }
        val requestBuilder = Request.Builder().url(url)
        if (!authToken.isNullOrEmpty()) {
            requestBuilder.header("Authorization", "Bearer $authToken")
        }
        webSocket = client.newWebSocket(requestBuilder.build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _isConnected.value = true
                startPing()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch { handleMessage(text) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _isConnected.value = false
                if (!isExplicitDisconnect) scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _isConnected.value = false
                if (!isExplicitDisconnect) scheduleReconnect()
            }
        })
    }

    fun disconnect() = teardownSocket(explicit = true)

    fun clearMessages() {
        _messages.value = emptyList()
    }

    fun clearHistory() {
        sendJSON(buildJsonObject { put("type", "cf_agent_chat_clear") })
        _messages.value = emptyList()
    }

    fun sendUserMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || !_isConnected.value || _isStreaming.value) return
        val userId = UUID.randomUUID().toString()
        _messages.value = _messages.value + ChatMessage(id = userId, role = "user", text = trimmed)
        val history = _messages.value.filter { !it.isError && !it.isToolAction }.map { msg ->
            val parts = mutableListOf<JsonObject>()
            msg.reasoning?.takeIf { it.isNotEmpty() }?.let { r ->
                parts.add(
                    buildJsonObject {
                        put("type", "reasoning")
                        put("text", r)
                        put("state", "done")
                        msg.reasoningDurationMs?.let { put("duration", it) }
                    },
                )
            }
            if (msg.text.isNotEmpty()) {
                parts.add(
                    buildJsonObject {
                        put("type", "text")
                        put("text", msg.text)
                        put("state", "done")
                    },
                )
            }
            buildJsonObject {
                put("id", msg.id)
                put("role", msg.role)
                put("parts", JsonArray(parts))
            }
        }
        sendJSON(
            buildJsonObject {
                put("type", "cf_agent_use_chat_request")
                put("id", userId)
                put("messages", JsonArray(history))
            },
        )
        _isStreaming.value = true
        streamingAssistantId = null
        hasActiveToolAction = false
    }

    private fun teardownSocket(explicit: Boolean) {
        isExplicitDisconnect = explicit
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, null)
        webSocket = null
        _isConnected.value = false
        _isStreaming.value = false
        _statusText.value = null
        streamingAssistantId = null
        hasActiveToolAction = false
        pendingToolCalls.clear()
    }

    private fun scheduleReconnect() {
        val mb = mailboxId ?: return
        val conv = conversationId ?: return
        val token = authToken
        scope.launch {
            delay(1_500)
            if (!isExplicitDisconnect) connect(mb, conv, token)
        }
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(25_000)
                sendJSON(buildJsonObject { put("type", "ping") })
            }
        }
    }

    private fun sendJSON(obj: JsonObject) {
        webSocket?.send(json.encodeToString(JsonObject.serializer(), obj))
    }

    private fun handleMessage(text: String) {
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (root["type"]?.jsonPrimitive?.contentOrNull) {
            "cf_agent_message" -> {
                val msg = root["message"]?.jsonObject ?: return
                appendAssistantChunk(msg)
            }
            "cf_agent_tool_result", "tool-output" -> {
                hasActiveToolAction = true
                val toolName = root["toolName"]?.jsonPrimitive?.contentOrNull
                    ?: root["name"]?.jsonPrimitive?.contentOrNull
                    ?: pendingToolCalls[root["toolCallId"]?.jsonPrimitive?.contentOrNull.orEmpty()]
                    ?: "tool"
                _messages.value = _messages.value + ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = "assistant",
                    text = "Ran $toolName",
                    isToolAction = true,
                    toolName = toolName,
                )
            }
            "cf_agent_stream_finished", "finish" -> {
                _isStreaming.value = false
                streamingAssistantId = null
                onStreamFinished?.invoke(hasActiveToolAction)
                hasActiveToolAction = false
            }
            else -> {
                // Try AI SDK chunk shapes
                val chunkType = root["type"]?.jsonPrimitive?.contentOrNull.orEmpty()
                if (chunkType.contains("text") || chunkType == "reasoning") {
                    appendAssistantChunk(root)
                }
            }
        }
    }

    private fun appendAssistantChunk(msg: JsonObject) {
        val textDelta = msg["text"]?.jsonPrimitive?.contentOrNull
            ?: msg["delta"]?.jsonPrimitive?.contentOrNull
            ?: ""
        val reasoning = msg["reasoning"]?.jsonPrimitive?.contentOrNull
        val id = streamingAssistantId ?: UUID.randomUUID().toString().also { streamingAssistantId = it }
        val existing = _messages.value.toMutableList()
        val idx = existing.indexOfFirst { it.id == id }
        if (idx >= 0) {
            val cur = existing[idx]
            existing[idx] = cur.copy(
                text = cur.text + textDelta,
                reasoning = listOfNotNull(cur.reasoning, reasoning).joinToString("").ifEmpty { cur.reasoning },
            )
        } else {
            existing.add(
                ChatMessage(
                    id = id,
                    role = "assistant",
                    text = textDelta,
                    reasoning = reasoning,
                ),
            )
        }
        _messages.value = existing
    }

    private suspend fun loadInitialMessages(mailboxId: String, conversationId: String, authToken: String?) {
        _isLoadingHistory.value = true
        _historyError.value = null
        try {
            var loaded: List<ChatMessage>? = null
            repeat(3) { attempt ->
                loaded = fetchMessages(mailboxId, conversationId, authToken)
                if (loaded != null) return@repeat
                if (attempt < 2) delay(400)
            }
            if (this.mailboxId != mailboxId || this.conversationId != conversationId) return
            val result = loaded
            if (result == null) {
                if (_messages.value.isEmpty()) _historyError.value = "Couldn't load this chat."
                return
            }
            if (_isStreaming.value) return
            if (result.isEmpty() && _messages.value.isNotEmpty()) return
            _messages.value = result
            onHistoryLoaded?.invoke(result)
        } finally {
            _isLoadingHistory.value = false
        }
    }

    companion object {
        fun agentInstanceName(mailboxId: String, conversationId: String) =
            "$mailboxId::$conversationId"

        fun agentURL(
            mailboxId: String,
            conversationId: String,
            websocket: Boolean,
            pathSuffix: String = "",
        ): String? = try {
            val base = URI(AppConfig.apiBaseURL)
            val name = agentInstanceName(mailboxId, conversationId)
            val scheme = if (websocket) {
                if (base.scheme == "https") "wss" else "ws"
            } else {
                base.scheme
            }
            val port = if (base.port != -1) ":${base.port}" else ""
            val path = "${AppConfig.AGENT_PATH_PREFIX}/$name$pathSuffix"
            "$scheme://${base.host}$port$path"
        } catch (_: Exception) {
            null
        }

        suspend fun fetchMessages(
            mailboxId: String,
            conversationId: String,
            authToken: String?,
        ): List<ChatMessage>? = withContext(Dispatchers.IO) {
            val url = agentURL(mailboxId, conversationId, websocket = false, pathSuffix = "/get-messages")
                ?: return@withContext null
            val client = OkHttpClient()
            val builder = Request.Builder().url(url).get()
            if (!authToken.isNullOrEmpty()) {
                builder.header("Authorization", "Bearer $authToken")
            }
            try {
                client.newCall(builder.build()).execute().use { response ->
                    if (!response.isSuccessful) return@withContext null
                    val body = response.body?.string().orEmpty()
                    val json = Json { ignoreUnknownKeys = true; isLenient = true }
                    val array = json.parseToJsonElement(body) as? JsonArray ?: return@withContext emptyList()
                    array.flatMap { element ->
                        val obj = element.jsonObject
                        val role = obj["role"]?.jsonPrimitive?.contentOrNull ?: "assistant"
                        val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: UUID.randomUUID().toString()
                        val parts = obj["parts"]?.jsonArray
                        if (parts != null) {
                            val text = parts.mapNotNull {
                                val p = it.jsonObject
                                if (p["type"]?.jsonPrimitive?.contentOrNull == "text") {
                                    p["text"]?.jsonPrimitive?.contentOrNull
                                } else null
                            }.joinToString("")
                            val reasoning = parts.mapNotNull {
                                val p = it.jsonObject
                                if (p["type"]?.jsonPrimitive?.contentOrNull == "reasoning") {
                                    p["text"]?.jsonPrimitive?.contentOrNull
                                } else null
                            }.joinToString("").ifEmpty { null }
                            listOf(ChatMessage(id = id, role = role, text = text, reasoning = reasoning))
                        } else {
                            val content = obj["content"]?.jsonPrimitive?.contentOrNull
                                ?: obj["text"]?.jsonPrimitive?.contentOrNull
                                ?: ""
                            listOf(ChatMessage(id = id, role = role, text = content))
                        }
                    }
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}

object ConversationTitleHelper {
    fun deriveTitle(from: String): String {
        val cleaned = from.trim().replace(Regex("\\s+"), " ")
        if (cleaned.isEmpty()) return "New chat"
        return if (cleaned.length <= 48) cleaned else cleaned.take(45) + "…"
    }
}

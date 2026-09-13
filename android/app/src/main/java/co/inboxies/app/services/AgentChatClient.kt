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
import kotlinx.serialization.json.JsonElement
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

/** WebSocket client for `/agents/email-agent/{mailbox}::{conversationId}` — mirrors iOS AgentChatClient. */
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
    private var reconnectJob: Job? = null
    private var isExplicitDisconnect = false
    private var reasoningStartMs: Long? = null
    private val pendingToolCalls = mutableMapOf<String, PendingToolCall>()

    private data class PendingToolCall(
        var toolName: String,
        var input: Map<String, JsonElement>? = null,
    )

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
                        msg.reasoningDurationMs?.let { put("duration", it / 1000.0) }
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
                msg.reasoningDurationMs?.let { put("reasoningDuration", it / 1000.0) }
            }
        }

        val bodyString = json.encodeToString(
            JsonObject.serializer(),
            buildJsonObject { put("messages", JsonArray(history)) },
        )
        sendJSON(
            buildJsonObject {
                put("type", "cf_agent_use_chat_request")
                put("id", UUID.randomUUID().toString())
                put(
                    "init",
                    buildJsonObject {
                        put("method", "POST")
                        put("body", bodyString)
                    },
                )
            },
        )
        _isStreaming.value = true
        _statusText.value = null
        streamingAssistantId = null
        hasActiveToolAction = false
        pendingToolCalls.clear()
        reasoningStartMs = null
    }

    suspend fun loadInitialMessages(mailboxId: String, conversationId: String, authToken: String?) {
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

    private fun teardownSocket(explicit: Boolean) {
        isExplicitDisconnect = explicit
        reconnectJob?.cancel()
        reconnectJob = null
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, null)
        webSocket = null
        _isConnected.value = false
        _isStreaming.value = false
        _statusText.value = null
        streamingAssistantId = null
        hasActiveToolAction = false
        reasoningStartMs = null
        pendingToolCalls.clear()
    }

    private fun scheduleReconnect() {
        val mb = mailboxId ?: return
        val conv = conversationId ?: return
        val token = authToken
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(2_000)
            if (!isExplicitDisconnect && !_isConnected.value) connect(mb, conv, token)
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
            "cf_agent_chat_messages" -> {
                if (_isStreaming.value) return
                val arr = root["messages"]?.jsonArray ?: return
                val parsed = arr.flatMap { parseMessages(it.jsonObject) }
                if (parsed.isNotEmpty()) _messages.value = parsed
            }
            "cf_agent_chat_clear" -> {
                _messages.value = emptyList()
            }
            "cf_agent_use_chat_response" -> {
                val chunk = root["body"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val doneFlag = jsonBoolean(root["done"])
                val errorFlag = jsonBoolean(root["error"])

                if (errorFlag) {
                    val errorText = chunk.ifEmpty { "An error occurred while generating a response." }
                    handleStreamError(errorText)
                } else if (chunk.isNotEmpty()) {
                    appendStreamChunk(chunk)
                }

                if (doneFlag) {
                    stampReasoningDurationIfNeeded()
                    _isStreaming.value = false
                    _statusText.value = null
                    streamingAssistantId = null
                    pendingToolCalls.clear()
                    val hadTool = hasActiveToolAction
                    hasActiveToolAction = false
                    onStreamFinished?.invoke(hadTool)
                }
            }
            // Legacy / alternate shapes
            "cf_agent_message" -> {
                root["message"]?.jsonObject?.let { appendStreamChunk(json.encodeToString(JsonObject.serializer(), it)) }
            }
            "cf_agent_tool_result", "tool-output" -> {
                hasActiveToolAction = true
                val toolName = root["toolName"]?.jsonPrimitive?.contentOrNull
                    ?: root["name"]?.jsonPrimitive?.contentOrNull
                    ?: pendingToolCalls[root["toolCallId"]?.jsonPrimitive?.contentOrNull.orEmpty()]?.toolName
                    ?: "tool"
                if (isRealToolName(toolName)) {
                    insertToolMessage(describeToolAction(toolName, null), toolName)
                }
            }
            "cf_agent_stream_finished", "finish" -> {
                stampReasoningDurationIfNeeded()
                _isStreaming.value = false
                streamingAssistantId = null
                _statusText.value = null
                pendingToolCalls.clear()
                onStreamFinished?.invoke(hasActiveToolAction)
                hasActiveToolAction = false
            }
            else -> Unit
        }
    }

    private fun appendStreamChunk(raw: String) {
        val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
        if (obj == null) {
            val trimmed = raw.trim()
            if (trimmed.isNotEmpty() && trimmed != "0" && trimmed != "[DONE]") {
                appendAssistantText(trimmed)
            }
            return
        }

        val type = obj["type"]?.jsonPrimitive?.contentOrNull.orEmpty()

        if (type == "reasoning-start") {
            if (reasoningStartMs == null) reasoningStartMs = System.currentTimeMillis()
            _statusText.value = null
            return
        }
        if (type == "reasoning-end") {
            stampReasoningDurationIfNeeded()
            return
        }
        if (type == "reasoning-delta" || (type.contains("reasoning") && type.contains("delta"))) {
            val delta = obj["delta"]?.jsonPrimitive?.contentOrNull
                ?: obj["text"]?.jsonPrimitive?.contentOrNull
                ?: obj["reasoningDelta"]?.jsonPrimitive?.contentOrNull
            if (!delta.isNullOrEmpty()) {
                _statusText.value = null
                appendAssistantReasoning(delta)
            }
            return
        }

        if (type == "text-delta" || type.contains("text")) {
            val delta = obj["delta"]?.jsonPrimitive?.contentOrNull
                ?: obj["text"]?.jsonPrimitive?.contentOrNull
                ?: obj["textDelta"]?.jsonPrimitive?.contentOrNull
            if (!delta.isNullOrEmpty()) {
                _statusText.value = null
                appendAssistantText(delta)
            }
            return
        }

        if (type.startsWith("tool-") || type.contains("tool")) {
            stampReasoningDurationIfNeeded()
            hasActiveToolAction = true

            val toolCallId = obj["toolCallId"]?.jsonPrimitive?.contentOrNull
            val rawName = obj["toolName"]?.jsonPrimitive?.contentOrNull
            val input = (obj["input"] as? JsonObject)?.toMap()
                ?: (obj["args"] as? JsonObject)?.toMap()

            if (type.contains("start") || type.contains("input")) {
                val toolName = resolveToolName(rawName, type)
                if (toolName != null) {
                    if (toolCallId != null) {
                        val pending = pendingToolCalls[toolCallId] ?: PendingToolCall(toolName)
                        pending.toolName = toolName
                        if (input != null) pending.input = input
                        pendingToolCalls[toolCallId] = pending
                    }
                    _statusText.value = statusForTool(toolName)
                } else {
                    _statusText.value = "Working on email actions…"
                }
            } else if (type.contains("output")) {
                val pending = toolCallId?.let { pendingToolCalls[it] }
                val toolName = resolveToolName(rawName ?: pending?.toolName, type) ?: pending?.toolName
                val resolvedInput = input ?: pending?.input
                if (toolName == null || !isRealToolName(toolName)) return
                if (toolCallId != null) pendingToolCalls.remove(toolCallId)
                insertToolMessage(describeToolAction(toolName, resolvedInput), toolName)
                _statusText.value = if (pendingToolCalls.isEmpty()) {
                    null
                } else {
                    statusForTool(pendingToolCalls.values.first().toolName)
                }
            }
            return
        }

        if (type == "error") {
            val errorMsg = obj["errorText"]?.jsonPrimitive?.contentOrNull ?: "An error occurred."
            handleStreamError(errorMsg)
        }
    }

    private fun insertToolMessage(desc: String, toolName: String) {
        val toolMessage = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = "assistant",
            text = desc,
            isToolAction = true,
            toolName = toolName,
        )
        val existing = _messages.value.toMutableList()
        val assistantId = streamingAssistantId
        val idx = if (assistantId != null) existing.indexOfFirst { it.id == assistantId } else -1
        if (idx >= 0) {
            existing.add(idx, toolMessage)
        } else {
            existing.add(toolMessage)
        }
        _messages.value = existing
    }

    private fun appendAssistantReasoning(delta: String) {
        if (reasoningStartMs == null) reasoningStartMs = System.currentTimeMillis()
        val existing = _messages.value.toMutableList()
        val id = streamingAssistantId
        if (id != null) {
            val idx = existing.indexOfFirst { it.id == id }
            if (idx >= 0) {
                val cur = existing[idx]
                existing[idx] = cur.copy(reasoning = (cur.reasoning.orEmpty()) + delta)
                _messages.value = existing
                return
            }
        }
        val newId = UUID.randomUUID().toString()
        streamingAssistantId = newId
        existing.add(ChatMessage(id = newId, role = "assistant", text = "", reasoning = delta))
        _messages.value = existing
    }

    private fun appendAssistantText(text: String) {
        stampReasoningDurationIfNeeded()
        val existing = _messages.value.toMutableList()
        val id = streamingAssistantId
        if (id != null) {
            val idx = existing.indexOfFirst { it.id == id }
            if (idx >= 0) {
                val cur = existing[idx]
                existing[idx] = cur.copy(text = cur.text + text)
                _messages.value = existing
                return
            }
        }
        val newId = UUID.randomUUID().toString()
        streamingAssistantId = newId
        existing.add(ChatMessage(id = newId, role = "assistant", text = text))
        _messages.value = existing
    }

    private fun stampReasoningDurationIfNeeded() {
        val start = reasoningStartMs ?: return
        val elapsed = System.currentTimeMillis() - start
        val id = streamingAssistantId
        if (id != null) {
            val existing = _messages.value.toMutableList()
            val idx = existing.indexOfFirst { it.id == id }
            if (idx >= 0 && existing[idx].reasoningDurationMs == null) {
                existing[idx] = existing[idx].copy(reasoningDurationMs = elapsed)
                _messages.value = existing
            }
        }
        reasoningStartMs = null
    }

    private fun handleStreamError(errorMsg: String) {
        _isStreaming.value = false
        _statusText.value = null
        streamingAssistantId = null
        pendingToolCalls.clear()
        _messages.value = _messages.value + ChatMessage(
            id = UUID.randomUUID().toString(),
            role = "assistant",
            text = errorMsg,
            isError = true,
        )
    }

    private fun jsonBoolean(el: JsonElement?): Boolean {
        val p = el as? JsonPrimitive ?: return false
        return p.contentOrNull?.toBooleanStrictOrNull() ?: (p.content == "true")
    }

    companion object {
        private val lifecycleToolNames = setOf(
            "call", "result", "invocation",
            "input-start", "input-delta", "input-available",
            "output-available", "output-error", "output-denied",
            "start", "end", "delta", "available", "error",
        )

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

        fun isRealToolName(name: String): Boolean {
            val trimmed = name.trim()
            return trimmed.isNotEmpty() && trimmed !in lifecycleToolNames
        }

        fun resolveToolName(rawName: String?, eventType: String): String? {
            if (rawName != null && isRealToolName(rawName)) return rawName
            if (eventType.startsWith("tool-")) {
                val stripped = eventType.removePrefix("tool-")
                if (isRealToolName(stripped)) return stripped
            }
            return null
        }

        fun statusForTool(name: String): String = when (name) {
            "draft_reply" -> "Drafting reply…"
            "draft_email" -> "Creating draft…"
            "list_emails" -> "Searching emails…"
            "get_email", "get_thread" -> "Reading thread…"
            "search_emails" -> "Searching mailbox…"
            "mark_email_read" -> "Updating email…"
            "move_email" -> "Organizing email…"
            "discard_draft" -> "Deleting draft…"
            else -> "Working on email actions…"
        }

        fun describeToolAction(name: String, input: Map<String, JsonElement>?): String {
            fun stringField(key: String): String? =
                input?.get(key)?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }

            return when (name) {
                "draft_reply" -> "Drafted a reply in your Drafts folder."
                "draft_email" -> {
                    val to = stringField("to")
                    if (to != null) "Created draft email to $to." else "Created a new draft in Drafts."
                }
                "list_emails" -> "Reviewed recent emails in your inbox."
                "get_email", "get_thread" -> "Read thread context."
                "search_emails" -> {
                    val q = stringField("query")
                    if (q != null) "Searched mailbox for \"$q\"." else "Searched mailbox."
                }
                "mark_email_read" -> "Marked email as read."
                "move_email" -> {
                    val folder = stringField("folder")
                    if (folder != null) {
                        "Moved email to ${folder.replaceFirstChar { it.uppercase() }}."
                    } else {
                        "Moved email."
                    }
                }
                "discard_draft" -> "Discarded draft."
                else -> "Completed action: ${name.replace('_', ' ')}."
            }
        }

        fun parseMessages(obj: JsonObject): List<ChatMessage> {
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return emptyList()
            val role = obj["role"]?.jsonPrimitive?.contentOrNull ?: return emptyList()

            val results = mutableListOf<ChatMessage>()
            var text = ""
            var reasoning: String? = null
            var reasoningDurationMs: Long? = null
            val seenToolCallIds = mutableSetOf<String>()

            val parts = obj["parts"]?.jsonArray ?: obj["content"]?.jsonArray

            if (parts != null) {
                for (partEl in parts) {
                    val part = partEl.jsonObject
                    val pType = part["type"]?.jsonPrimitive?.contentOrNull.orEmpty()

                    when {
                        pType == "text" -> {
                            val t = part["text"]?.jsonPrimitive?.contentOrNull
                                ?: part["content"]?.jsonPrimitive?.contentOrNull
                            if (t != null) text += t
                        }
                        pType == "reasoning" || pType.contains("reasoning") -> {
                            val r = part["text"]?.jsonPrimitive?.contentOrNull
                                ?: part["reasoning"]?.jsonPrimitive?.contentOrNull
                                ?: part["delta"]?.jsonPrimitive?.contentOrNull
                                ?: ""
                            if (r.isNotEmpty()) reasoning = (reasoning.orEmpty()) + r
                            if (reasoningDurationMs == null) {
                                val dur = part["duration"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()
                                if (dur != null) reasoningDurationMs = (dur * 1000).toLong()
                            }
                        }
                        pType == "tool-invocation" || pType == "tool-call" || pType == "tool-result" ||
                            pType.startsWith("tool-") || pType == "dynamic-tool" ||
                            part["toolName"] != null -> {
                            val invocation = part["toolInvocation"]?.jsonObject
                            val callId = invocation?.get("toolCallId")?.jsonPrimitive?.contentOrNull
                                ?: part["toolCallId"]?.jsonPrimitive?.contentOrNull
                                ?: part["id"]?.jsonPrimitive?.contentOrNull

                            var tName = invocation?.get("toolName")?.jsonPrimitive?.contentOrNull
                                ?: part["toolName"]?.jsonPrimitive?.contentOrNull
                                ?: part["name"]?.jsonPrimitive?.contentOrNull

                            if (tName.isNullOrEmpty() &&
                                pType.startsWith("tool-") &&
                                pType !in listOf("tool-call", "tool-result", "tool-invocation")
                            ) {
                                tName = pType.removePrefix("tool-")
                            }

                            val toolName = tName?.takeIf { isRealToolName(it) } ?: continue
                            val nameKey = "name:$toolName"
                            if (callId != null && callId in seenToolCallIds) continue
                            if (nameKey in seenToolCallIds) continue
                            if (callId != null) seenToolCallIds.add(callId)
                            seenToolCallIds.add(nameKey)

                            val input = (invocation?.get("args") as? JsonObject)?.toMap()
                                ?: (invocation?.get("input") as? JsonObject)?.toMap()
                                ?: (part["input"] as? JsonObject)?.toMap()
                                ?: (part["args"] as? JsonObject)?.toMap()

                            val desc = describeToolAction(toolName, input)
                            results.add(
                                ChatMessage(
                                    id = "$id-tool-${results.size}",
                                    role = "assistant",
                                    text = desc,
                                    isToolAction = true,
                                    toolName = toolName,
                                ),
                            )
                        }
                    }
                }
            }

            if (reasoning == null) {
                obj["reasoning"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }?.let {
                    reasoning = it
                }
            }
            if (reasoningDurationMs == null) {
                obj["reasoningDuration"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()?.let {
                    reasoningDurationMs = (it * 1000).toLong()
                }
            }

            if (text.isEmpty()) {
                text = obj["content"]?.jsonPrimitive?.contentOrNull
                    ?: obj["text"]?.jsonPrimitive?.contentOrNull
                    ?: ""
            }

            if (text.isNotEmpty() || reasoning != null) {
                results.add(
                    ChatMessage(
                        id = id,
                        role = role,
                        text = text,
                        reasoning = reasoning,
                        reasoningDurationMs = reasoningDurationMs,
                    ),
                )
            }

            return results
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
                    array.flatMap { parseMessages(it.jsonObject) }
                }
            } catch (_: Exception) {
                null
            }
        }
    }
}

object ConversationTitleHelper {
    private val prefixesToRemove = listOf(
        "can you please", "could you please", "would you please",
        "can you", "could you", "would you",
        "please", "help me to", "help me",
        "i want to", "i need to", "i'd like to", "id like to",
        "tell me about", "tell me", "show me",
        "search for", "find me", "look for",
        "what is", "what are", "what's",
        "how do i", "how can i", "how to",
        "draft a reply to", "draft reply to", "draft a", "draft",
        "write an email to", "write a reply to", "write a", "write",
    )

    fun deriveTitle(from: String): String {
        var cleaned = from.trim()
        cleaned = cleaned.lineSequence().firstOrNull { it.trim().isNotEmpty() }?.trim() ?: cleaned

        cleaned = cleaned.replace(Regex("^[#>*_`~\\-\\s]+"), "")
        cleaned = cleaned.replace(Regex("[*_`~]"), "")

        val lower = cleaned.lowercase()
        for (prefix in prefixesToRemove) {
            if (lower.startsWith(prefix)) {
                cleaned = cleaned.drop(prefix.length).trimStart(' ', ':', ',', '-', '\t')
                break
            }
        }

        cleaned = cleaned.trimEnd('?', '!', '.', ',', ':', ';', ' ', '\t', '\n', '\r')
        if (cleaned.isEmpty()) return "New chat"

        cleaned = cleaned.replaceFirstChar { it.uppercase() }

        val maxLen = 36
        if (cleaned.length > maxLen) {
            val truncated = cleaned.take(maxLen)
            val lastSpace = truncated.lastIndexOf(' ')
            cleaned = if (lastSpace > 16) truncated.take(lastSpace) else truncated
        }

        return cleaned.ifEmpty { "New chat" }
    }
}

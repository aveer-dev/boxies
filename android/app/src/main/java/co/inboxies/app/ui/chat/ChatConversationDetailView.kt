package co.inboxies.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ChatMessage
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.MailAddress
import co.inboxies.app.services.AgentChatClient
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ConversationTitleHelper
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.homeChromeToolbarSurface
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.MarkdownContentView
import co.inboxies.app.ui.search.SearchView
import kotlinx.coroutines.launch

private val suggestedPrompts = listOf(
    "Show latest inbox emails",
    "Draft a reply to latest email",
    "Summarize unread emails",
    "Find orders and receipts",
)

/** Active conversation thread — mirrors iOS `ChatConversationDetailView`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatConversationDetailView(
    conversationId: String,
    seedPrompt: String? = null,
    onSeedConsumed: (() -> Unit)? = null,
    onBack: () -> Unit,
    onNewChat: () -> Unit,
    onClose: () -> Unit,
    topDragModifier: Modifier = Modifier,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val chatClient = remember { AgentChatClient(ApiClient.shared) }
    val messages by chatClient.messages.collectAsState()
    val isConnected by chatClient.isConnected.collectAsState()
    val isStreaming by chatClient.isStreaming.collectAsState()
    val isLoadingHistory by chatClient.isLoadingHistory.collectAsState()
    val statusText by chatClient.statusText.collectAsState()
    val historyError by chatClient.historyError.collectAsState()
    val conversations by app.conversations.collectAsState()

    var draft by remember { mutableStateOf("") }
    var showOptions by remember { mutableStateOf(false) }
    var showRename by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf("") }
    var selectedReasoning by remember { mutableStateOf<ChatMessage?>(null) }
    var activeSearchQuery by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    val currentTitle = conversations.firstOrNull { it.id == conversationId }?.title ?: "Ask AI"
    val isKnownConversation = conversations.any { it.id == conversationId }
    val isWaitingForHistory = messages.isEmpty() &&
        isKnownConversation &&
        (isLoadingHistory || historyError != null)
    val isChatReady = isConnected && !isWaitingForHistory
    val canSend = draft.trim().isNotEmpty() && !isStreaming && isChatReady

    fun sendMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || !isChatReady || isStreaming) return
        chatClient.sendUserMessage(trimmed)
        val isSaved = conversations.any { it.id == conversationId }
        if (!isSaved) {
            val derived = ConversationTitleHelper.deriveTitle(trimmed)
            app.notePendingConversation(conversationId, derived, trimmed)
            scope.launch {
                app.createConversation(conversationId, derived, trimmed)
            }
        } else {
            val conv = conversations.firstOrNull { it.id == conversationId }
            val isDefaultTitle = conv == null ||
                conv.title == "New chat" ||
                conv.title == "Ask AI" ||
                conv.title.isEmpty()
            scope.launch {
                if (isDefaultTitle) {
                    val derived = ConversationTitleHelper.deriveTitle(trimmed)
                    app.updateConversation(conversationId, derived, trimmed)
                } else {
                    app.updateConversation(conversationId, lastMessagePreview = trimmed)
                }
            }
        }
        // Mark as active so Ask AI can resume (requires known/pending id).
        app.openChatSession(existingId = conversationId)
    }

    LaunchedEffect(conversationId) {
        draft = ""
        showRename = false
        selectedReasoning = null
        activeSearchQuery = null

        chatClient.onStreamFinished = { hasToolActions ->
            if (hasToolActions) {
                scope.launch { app.notifyAIToolCompleted() }
            }
            val lastMsg = chatClient.messages.value.lastOrNull { !it.isError }
            if (lastMsg != null && lastMsg.text.isNotEmpty()) {
                val preview = lastMsg.text.take(120)
                scope.launch {
                    app.updateConversation(conversationId, lastMessagePreview = preview)
                }
            }
        }

        chatClient.onHistoryLoaded = { loaded ->
            val conv = app.conversations.value.firstOrNull { it.id == conversationId }
            val isDefaultTitle = conv == null || conv.title == "New chat" || conv.title == "Ask AI"
            val lastResponse = loaded.lastOrNull { !it.isToolAction && !it.isError && it.text.isNotEmpty() }
            if (isDefaultTitle) {
                val firstUser = loaded.firstOrNull { it.role == "user" && it.text.isNotEmpty() }
                if (firstUser != null) {
                    val derived = ConversationTitleHelper.deriveTitle(firstUser.text)
                    val lastText = lastResponse?.text ?: loaded.lastOrNull()?.text ?: firstUser.text
                    scope.launch {
                        app.updateConversation(conversationId, derived, lastText.take(120))
                    }
                }
            } else if (conv?.lastMessagePreview == null) {
                val last = lastResponse ?: loaded.lastOrNull()
                if (last != null && last.text.isNotEmpty()) {
                    scope.launch {
                        app.updateConversation(conversationId, lastMessagePreview = last.text.take(120))
                    }
                }
            }
        }

        val mailboxId = app.selectedMailboxId.value ?: return@LaunchedEffect
        chatClient.connect(mailboxId, conversationId)

        if (!seedPrompt.isNullOrEmpty()) {
            draft = seedPrompt
            onSeedConsumed?.invoke()
        }
    }

    DisposableEffect(Unit) {
        onDispose { chatClient.disconnect() }
    }

    LaunchedEffect(messages.size, statusText, isStreaming) {
        val target = when {
            statusText != null || (isStreaming && statusText == null) -> messages.size // status row after items
            messages.isNotEmpty() -> messages.lastIndex
            else -> return@LaunchedEffect
        }
        runCatching { listState.animateScrollToItem(target.coerceAtLeast(0)) }
    }

    val showsFallbackThinking = isStreaming && statusText == null && messages.none { msg ->
        !msg.isToolAction && !msg.isError && msg.role != "user" &&
            msg.text.isEmpty() && !msg.reasoning.isNullOrEmpty()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Toolbar — also participates in drag-to-dismiss with the sheet handle.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(topDragModifier)
                .padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Chats",
                onClick = {
                    chatClient.disconnect()
                    onBack()
                },
            )
            Text(
                currentTitle,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                letterSpacing = 0.2.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Box {
                HomeChromeToolbarButton(
                    icon = Icons.Outlined.MoreVert,
                    contentDescription = "Options",
                    onClick = { showOptions = true },
                )
                InboxiesDropdownMenu(
                    expanded = showOptions,
                    onDismiss = { showOptions = false },
                ) {
                    InboxiesMenuItem(
                        text = "Rename chat",
                        icon = Icons.Outlined.Edit,
                        onClick = {
                            showOptions = false
                            renameText = if (currentTitle == "Ask AI") "" else currentTitle
                            showRename = true
                        },
                    )
                    InboxiesMenuItem(
                        text = "New chat",
                        icon = Icons.Outlined.Add,
                        onClick = {
                            showOptions = false
                            onNewChat()
                        },
                    )
                    InboxiesMenuItem(
                        text = "Clear this chat",
                        icon = Icons.Outlined.Delete,
                        destructive = true,
                        onClick = {
                            showOptions = false
                            chatClient.clearHistory()
                            if (isKnownConversation) {
                                scope.launch {
                                    app.updateConversation(conversationId, lastMessagePreview = "")
                                }
                            }
                        },
                    )
                }
            }
        }

        // Messages
        Box(modifier = Modifier.weight(1f)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                if (messages.isEmpty()) {
                    item {
                        when {
                            historyError != null -> HistoryErrorView(
                                message = historyError!!,
                                onRetry = {
                                    val mailboxId = app.selectedMailboxId.value ?: return@HistoryErrorView
                                    scope.launch {
                                        chatClient.loadInitialMessages(
                                            mailboxId,
                                            conversationId,
                                            ApiClient.shared.authTokenProvider(),
                                        )
                                    }
                                },
                            )
                            isChatReady -> EmptyStateView(
                                onPrompt = {
                                    focusManager.clearFocus()
                                    sendMessage(it)
                                },
                            )
                            else -> Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 24.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(28.dp),
                                    strokeWidth = 2.dp,
                                    color = colors.accent,
                                )
                            }
                        }
                    }
                } else {
                    itemsIndexed(messages, key = { _, m -> m.id }) { index, message ->
                        val topPad = if (index == 0) 0.dp else spacingBefore(messages, index)
                        ChatBubble(
                            message = message,
                            isStreaming = isStreaming,
                            hasActiveToolStatus = statusText != null,
                            modifier = Modifier.padding(top = topPad),
                            onOpenReasoning = { selectedReasoning = message },
                            onCompose = { address ->
                                onClose()
                                scope.launch {
                                    app.startCompose(ComposeMode.New, initialTo = listOf(address))
                                }
                            },
                            onSearch = { activeSearchQuery = it },
                            onAskAI = {
                                focusManager.clearFocus()
                                sendMessage(it)
                            },
                        )
                    }
                }

                if (statusText != null) {
                    item(key = "status") {
                        StatusRow(statusText!!, Modifier.padding(top = if (messages.isEmpty()) 0.dp else 4.dp))
                    }
                } else if (showsFallbackThinking) {
                    item(key = "thinking") {
                        StatusRow("Thinking…", Modifier.padding(top = if (messages.isEmpty()) 0.dp else 8.dp))
                    }
                }

                item { Spacer(Modifier.height(70.dp)) }
            }
        }

        // Composer
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.chromeSpacing),
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(HomeChromeMetrics.actionBarHeight)
                    .homeChromeToolbarSurface(RoundedCornerShape(50))
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Filled.AutoAwesome,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(18.dp),
                )
                BasicTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    textStyle = TextStyle(
                        fontFamily = InterFontFamily,
                        fontSize = AppThemeDims.Chat.input,
                        color = colors.ink,
                    ),
                    cursorBrush = SolidColor(colors.ink),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(
                        onSend = {
                            if (canSend) {
                                val text = draft
                                draft = ""
                                focusManager.clearFocus()
                                sendMessage(text)
                            }
                        },
                    ),
                    decorationBox = { inner ->
                        Box {
                            if (draft.isEmpty()) {
                                Text(
                                    "Ask about your inbox…",
                                    fontFamily = InterFontFamily,
                                    fontSize = AppThemeDims.Chat.input,
                                    color = colors.muted,
                                )
                            }
                            inner()
                        }
                    },
                )
                if (draft.isNotEmpty()) {
                    IconButton(
                        onClick = { draft = "" },
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Close,
                            contentDescription = "Clear",
                            tint = colors.muted,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
            HomeChromeToolbarButton(
                icon = Icons.Outlined.ArrowUpward,
                contentDescription = "Send message",
                onClick = {
                    if (canSend) {
                        val text = draft
                        draft = ""
                        focusManager.clearFocus()
                        sendMessage(text)
                    }
                },
                enabled = canSend,
                size = HomeChromeMetrics.actionBarHeight,
            )
        }
    }

    if (showRename) {
        AlertDialog(
            onDismissRequest = { showRename = false },
            title = { Text("Rename Chat", fontFamily = InterFontFamily) },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    label = { Text("Chat title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val trimmed = renameText.trim()
                        if (trimmed.isNotEmpty()) {
                            scope.launch {
                                if (isKnownConversation) {
                                    app.updateConversation(conversationId, title = trimmed)
                                } else {
                                    app.createConversation(conversationId, title = trimmed)
                                    app.openChatSession(existingId = conversationId)
                                }
                            }
                        }
                        showRename = false
                    },
                ) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { showRename = false }) { Text("Cancel") }
            },
        )
    }

    selectedReasoning?.reasoning?.let { reasoning ->
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        ModalBottomSheet(
            onDismissRequest = { selectedReasoning = null },
            sheetState = sheetState,
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
        ) {
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                Text(
                    selectedReasoning?.reasoningDurationString?.let { "Thought for $it" }
                        ?: "Thought process",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                MarkdownContentView(markdown = reasoning, fontSize = AppThemeDims.Chat.body)
                Spacer(Modifier.height(32.dp))
            }
        }
    }

    activeSearchQuery?.let { query ->
        Box(modifier = Modifier.fillMaxSize()) {
            SearchView(
                onClose = { activeSearchQuery = null },
                initialQuery = query,
            )
        }
    }
}

@Composable
private fun StatusRow(text: String, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Row(
        modifier = modifier.padding(horizontal = 2.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            text,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.Chat.meta,
            letterSpacing = AppThemeDims.Chat.tracking,
            color = colors.muted,
        )
        CircularProgressIndicator(
            modifier = Modifier.size(12.dp),
            strokeWidth = 1.5.dp,
            color = colors.muted,
        )
    }
}

@Composable
private fun HistoryErrorView(message: String, onRetry: () -> Unit) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            message,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = colors.ink,
            textAlign = TextAlign.Center,
        )
        Text(
            "Try again",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.Chat.prompt,
            color = colors.accent,
            modifier = Modifier.clickable(onClick = onRetry),
        )
    }
}

@Composable
private fun EmptyStateView(onPrompt: (String) -> Unit) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 16.dp),
        ) {
            Icon(
                Icons.Filled.AutoAwesome,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(36.dp),
            )
            Text(
                "How can I help you today?",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                letterSpacing = 0.2.sp,
                color = colors.ink,
            )
            Text(
                "I can search messages, summarize threads, draft replies, and organize your mailbox.",
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.Chat.body,
                letterSpacing = AppThemeDims.Chat.tracking,
                color = colors.muted,
                textAlign = TextAlign.Center,
            )
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(horizontal = 8.dp),
        ) {
            suggestedPrompts.forEach { prompt ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface, RoundedCornerShape(12.dp))
                        .clickable { onPrompt(prompt) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        prompt,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = AppThemeDims.Chat.prompt,
                        letterSpacing = AppThemeDims.Chat.tracking,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        Icons.Outlined.ArrowUpward,
                        contentDescription = null,
                        tint = colors.muted,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(
    message: ChatMessage,
    isStreaming: Boolean,
    hasActiveToolStatus: Boolean,
    modifier: Modifier = Modifier,
    onOpenReasoning: () -> Unit,
    onCompose: ((MailAddress) -> Unit)?,
    onSearch: ((String) -> Unit)?,
    onAskAI: ((String) -> Unit)?,
) {
    val colors = inboxiesColors()
    val isLiveThinking = isStreaming && message.text.isEmpty() && !hasActiveToolStatus

    when {
        message.isToolAction -> {
            Text(
                message.text,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = AppThemeDims.Chat.meta,
                letterSpacing = AppThemeDims.Chat.tracking,
                color = colors.muted,
                modifier = modifier.padding(end = 14.dp, top = 2.dp, bottom = 2.dp),
            )
        }
        message.isError -> {
            Text(
                message.text,
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.Chat.toolAction,
                letterSpacing = AppThemeDims.Chat.tracking,
                color = colors.deepDarkRed,
                modifier = modifier.padding(end = 14.dp, top = 10.dp, bottom = 10.dp),
            )
        }
        message.role == "user" -> {
            Row(modifier = modifier.fillMaxWidth()) {
                Spacer(Modifier.weight(1f))
                Box(
                    modifier = Modifier
                        .widthIn(max = 320.dp)
                        .background(colors.pillFill, RoundedCornerShape(16.dp))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    MarkdownContentView(
                        markdown = message.text,
                        fontSize = AppThemeDims.Chat.body,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                    )
                }
            }
        }
        else -> {
            Column(
                modifier = modifier
                    .fillMaxWidth()
                    .padding(end = 40.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!message.reasoning.isNullOrEmpty()) {
                    ThinkingGhostButton(
                        message = message,
                        isLiveThinking = isLiveThinking,
                        onTap = onOpenReasoning,
                    )
                }
                if (message.text.isNotEmpty()) {
                    MarkdownContentView(
                        markdown = message.text,
                        fontSize = AppThemeDims.Chat.body,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                        modifier = Modifier.padding(horizontal = 15.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ThinkingGhostButton(
    message: ChatMessage,
    isLiveThinking: Boolean,
    onTap: () -> Unit,
) {
    val colors = inboxiesColors()
    val label = when {
        isLiveThinking -> "Thinking…"
        message.reasoningDurationString != null -> "Thought for ${message.reasoningDurationString}"
        else -> "Thought process"
    }
    Row(
        modifier = Modifier
            .clickable(onClick = onTap)
            .padding(horizontal = 2.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.Chat.meta,
            letterSpacing = AppThemeDims.Chat.tracking,
            color = colors.muted,
        )
        if (isLiveThinking) {
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 1.5.dp,
                color = colors.muted,
            )
        } else {
            Icon(
                Icons.Outlined.ChevronRight,
                contentDescription = null,
                tint = colors.muted.copy(alpha = 0.6f),
                modifier = Modifier.size(10.dp),
            )
        }
    }
}

private fun spacingBefore(messages: List<ChatMessage>, index: Int): androidx.compose.ui.unit.Dp {
    if (index <= 0 || index >= messages.size) return 12.dp
    val previous = messages[index - 1]
    val current = messages[index]
    fun isChrome(m: ChatMessage): Boolean {
        if (m.isToolAction) return true
        if (m.role == "user" || m.isError) return false
        return !m.reasoning.isNullOrEmpty() && m.text.isEmpty()
    }
    val previousIsChrome = isChrome(previous)
    val currentIsChrome = isChrome(current)
    val currentIsReply = !current.isToolAction && !current.isError && current.role != "user" &&
        (current.text.isNotEmpty() || current.reasoning != null)
    return when {
        previousIsChrome && currentIsChrome -> 4.dp
        previousIsChrome && currentIsReply -> 8.dp
        else -> 12.dp
    }
}

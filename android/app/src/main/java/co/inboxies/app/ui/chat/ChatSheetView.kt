package co.inboxies.app.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ChatSession
import co.inboxies.app.services.AgentChatClient
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.MarkdownContentView
import kotlinx.coroutines.launch

@Composable
fun ChatSheetView(onClose: () -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val session by app.chatSession.collectAsState()
    val conversations by app.conversations.collectAsState()
    val chatClient = remember { AgentChatClient(ApiClient.shared) }
    val messages by chatClient.messages.collectAsState()
    var draft by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        app.refreshConversations()
        if (session is ChatSession.Dismissed) app.showChatList()
    }

    LaunchedEffect(session) {
        val conversation = session as? ChatSession.Conversation ?: return@LaunchedEffect
        val mailboxId = app.selectedMailboxId.value ?: return@LaunchedEffect
        chatClient.connect(mailboxId, conversation.id)
    }

    DisposableEffect(Unit) {
        onDispose { chatClient.disconnect() }
    }

    BackHandler(enabled = session is ChatSession.Conversation) {
        app.showChatList()
        chatClient.disconnect()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .padding(top = 24.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (session is ChatSession.Conversation) {
                IconButton(onClick = {
                    app.showChatList()
                    chatClient.disconnect()
                }) { Icon(Icons.Outlined.ArrowBack, null, tint = colors.ink) }
            }
            Text(
                if (session is ChatSession.Conversation) "Chat" else "Ask AI",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 18.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { app.startNewChat() }) {
                Text("New", color = colors.accent, fontFamily = InterFontFamily)
            }
            IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, null, tint = colors.ink) }
        }

        when (val s = session) {
            is ChatSession.Conversation -> {
                LazyColumn(
                    modifier = Modifier.weight(1f).padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(messages, key = { it.id }) { msg ->
                        val mine = msg.role == "user"
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(
                                    if (mine) colors.pillFill else colors.surface,
                                    RoundedCornerShape(12.dp),
                                )
                                .padding(12.dp),
                        ) {
                            if (mine) Text(msg.text, fontFamily = InterFontFamily, color = colors.ink)
                            else MarkdownContentView(msg.text)
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Ask anything…") },
                    )
                    TextButton(
                        onClick = {
                            val text = draft.trim()
                            if (text.isNotEmpty()) {
                                chatClient.sendUserMessage(text)
                                draft = ""
                            }
                        },
                    ) { Text("Send", color = colors.accent, fontFamily = InterFontFamily) }
                }
            }
            else -> {
                LazyColumn(modifier = Modifier.weight(1f).padding(16.dp)) {
                    item {
                        TextButton(onClick = { app.startNewChat() }) {
                            Text("Start new chat", color = colors.accent, fontFamily = InterFontFamily)
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                    items(conversations, key = { it.id }) { c ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { app.openChatSession(c.id) }
                                .padding(vertical = 12.dp),
                        ) {
                            Text(
                                c.title.ifBlank { "Conversation" },
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                color = colors.ink,
                            )
                            Text(
                                c.lastMessagePreview ?: "",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                        }
                    }
                }
            }
        }
    }
}

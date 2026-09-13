package co.inboxies.app.ui.chat

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AgentConversation
import co.inboxies.app.models.groupConversationsByDate
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.launch

/** Conversations list inside the chat modal — mirrors iOS `ChatConversationsModalListView`. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatConversationsListView(
    onSelect: (AgentConversation) -> Unit,
    onNewChat: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val conversations by app.conversations.collectAsState()
    val userConversations = remember(conversations) {
        conversations.filter { it.id != "auto" }
    }
    val groups = remember(userConversations) { groupConversationsByDate(userConversations) }
    var collapsed by remember { mutableStateOf(setOf<String>()) }
    var refreshing by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<AgentConversation?>(null) }
    var renameText by remember { mutableStateOf("") }
    var menuTarget by remember { mutableStateOf<AgentConversation?>(null) }

    LaunchedEffect(Unit) {
        app.refreshConversations()
        app.pruneEmptyConversations()
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                app.refreshConversations()
                app.pruneEmptyConversations()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        if (userConversations.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Filled.AutoAwesome,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.size(32.dp),
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "No conversations yet",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    letterSpacing = 0.2.sp,
                    color = colors.ink,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Ask your AI assistant to search emails, draft replies, or organize your inbox.",
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.Chat.body,
                    letterSpacing = AppThemeDims.Chat.tracking,
                    color = colors.muted,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    "Start a new chat",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.Chat.prompt,
                    color = colors.accent,
                    modifier = Modifier.clickable(onClick = onNewChat),
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                groups.forEach { group ->
                    val isCollapsed = group.title in collapsed
                    item(key = "header-${group.id}") {
                        val rotation by animateFloatAsState(
                            targetValue = if (isCollapsed) 0f else 90f,
                            animationSpec = tween(200),
                            label = "chevron",
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    collapsed = if (isCollapsed) {
                                        collapsed - group.title
                                    } else {
                                        collapsed + group.title
                                    }
                                }
                                .padding(
                                    start = AppThemeDims.List.rowHorizontalPadding,
                                    end = AppThemeDims.List.rowHorizontalPadding,
                                    top = 18.dp,
                                    bottom = 4.dp,
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp),
                        ) {
                            Text(
                                group.title,
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = AppThemeDims.List.sectionHeader,
                                letterSpacing = AppThemeDims.List.tracking,
                                color = colors.muted,
                            )
                            Icon(
                                Icons.Outlined.ChevronRight,
                                contentDescription = null,
                                tint = colors.muted.copy(alpha = 0.6f),
                                modifier = Modifier
                                    .size(AppThemeDims.FontSize.chevron.value.dp + 4.dp)
                                    .rotate(rotation),
                            )
                        }
                    }
                    if (!isCollapsed) {
                        items(group.conversations, key = { it.id }) { conversation ->
                            Box {
                                ConversationRow(
                                    conversation = conversation,
                                    onClick = { onSelect(conversation) },
                                    onLongClick = { menuTarget = conversation },
                                )
                                InboxiesDropdownMenu(
                                    expanded = menuTarget?.id == conversation.id,
                                    onDismiss = { menuTarget = null },
                                ) {
                                    InboxiesMenuItem(
                                        text = "Rename",
                                        icon = Icons.Outlined.Edit,
                                        onClick = {
                                            menuTarget = null
                                            renameTarget = conversation
                                            renameText =
                                                if (conversation.title == "New chat") "" else conversation.title
                                        },
                                    )
                                    InboxiesMenuItem(
                                        text = "Delete",
                                        icon = Icons.Outlined.Delete,
                                        destructive = true,
                                        onClick = {
                                            menuTarget = null
                                            scope.launch { app.deleteConversation(conversation.id) }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    renameTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
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
                            scope.launch { app.updateConversation(target.id, title = trimmed) }
                        }
                        renameTarget = null
                    },
                ) { Text("Save") }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) { Text("Cancel") }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ConversationRow(
    conversation: AgentConversation,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(
                horizontal = AppThemeDims.List.rowHorizontalPadding,
                vertical = AppThemeDims.List.rowVerticalPadding,
            ),
        verticalArrangement = Arrangement.spacedBy(AppThemeDims.List.rowTextSpacing),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                conversation.title.ifBlank { "Conversation" },
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = AppThemeDims.List.title,
                letterSpacing = AppThemeDims.List.tracking,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text(
                DateUtils.formatChatRelativeDate(conversation.updatedAt),
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.List.date,
                color = colors.muted,
            )
        }
        conversation.lastMessagePreview?.takeIf { it.isNotEmpty() }?.let { preview ->
            Text(
                preview,
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.List.preview,
                letterSpacing = AppThemeDims.List.tracking,
                color = colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(AppThemeDims.List.separatorHeight)
                .background(colors.line.copy(alpha = 0.65f)),
        )
    }
}

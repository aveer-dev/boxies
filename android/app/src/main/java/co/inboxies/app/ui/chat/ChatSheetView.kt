package co.inboxies.app.ui.chat

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ChatSession
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.TransparentSystemBars
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.rememberSheetDragY
import co.inboxies.app.ui.components.sheetDragToDismiss

private sealed class ChatNavDestination {
    data object List : ChatNavDestination()
    data class Conversation(val id: String) : ChatNavDestination()
}

/**
 * Full-screen AI chat modal — mirrors iOS `ChatSheetView` (list ↔ conversation).
 */
@Composable
fun ChatSheetView(
    onClose: () -> Unit,
    seedPrompt: String? = null,
    forceNewChat: Boolean = false,
    initialConversationId: String? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val session by app.chatSession.collectAsState()
    var pendingSeed by remember { mutableStateOf(seedPrompt) }

    val destination = when (val s = session) {
        is ChatSession.Conversation -> ChatNavDestination.Conversation(s.id)
        else -> ChatNavDestination.List
    }

    LaunchedEffect(Unit) {
        app.refreshConversations()
        when {
            app.chatSession.value !is ChatSession.Dismissed -> Unit
            !initialConversationId.isNullOrEmpty() ->
                app.openChatSession(existingId = initialConversationId)
            forceNewChat || !seedPrompt.isNullOrBlank() -> app.startNewChat()
            else -> {
                val active = app.activeConversationId.value
                if (!active.isNullOrEmpty()) {
                    app.openChatSession(resumeActive = true)
                } else {
                    app.showChatList()
                }
            }
        }
    }

    BackHandler(enabled = session !is ChatSession.Conversation) {
        onClose()
    }

    BackHandler(enabled = session is ChatSession.Conversation) {
        app.showChatList()
    }

    TransparentSystemBars()

    val dragY = rememberSheetDragY()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HomeChromeMetrics.modalScrim),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { translationY = dragY.floatValue.coerceAtLeast(0f) }
                .background(colors.background)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            // Top drag chrome: status bar + handle + generous hit area (ComposeSheet / iOS).
            // Fresh sheetDragToDismiss() per hit target — never reuse one Modifier instance.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Drag to close" }
                    .sheetDragToDismiss(dragY = dragY, onDismiss = onClose)
                    .statusBarsPadding(),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .padding(top = 8.dp, bottom = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .width(36.dp)
                            .height(5.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colors.muted.copy(alpha = 0.45f)),
                    )
                }
            }

            AnimatedContent(
                targetState = destination,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                transitionSpec = {
                    val forward = when {
                        targetState is ChatNavDestination.Conversation &&
                            initialState is ChatNavDestination.List -> true
                        targetState is ChatNavDestination.List &&
                            initialState is ChatNavDestination.Conversation -> false
                        else -> true
                    }
                    (
                        slideInHorizontally(chatNavSpring()) { full ->
                            if (forward) full else -full / 4
                        } + fadeIn(chatNavSpring())
                    ) togetherWith (
                        slideOutHorizontally(chatNavSpring()) { full ->
                            if (forward) -full / 4 else full
                        } + fadeOut(chatNavSpring())
                    )
                },
                contentAlignment = Alignment.TopStart,
                label = "chatNav",
            ) { dest ->
                when (dest) {
                    is ChatNavDestination.Conversation -> {
                        ChatConversationDetailView(
                            conversationId = dest.id,
                            seedPrompt = pendingSeed,
                            onSeedConsumed = { pendingSeed = null },
                            onBack = { app.showChatList() },
                            onNewChat = { app.startNewChat() },
                            onClose = onClose,
                            topDragModifier = Modifier
                                .semantics { contentDescription = "Drag to close" }
                                .sheetDragToDismiss(dragY = dragY, onDismiss = onClose),
                        )
                    }
                    ChatNavDestination.List -> {
                        Column(modifier = Modifier.fillMaxSize()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .semantics { contentDescription = "Drag to close" }
                                    .sheetDragToDismiss(dragY = dragY, onDismiss = onClose)
                                    .padding(horizontal = 8.dp, vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(
                                    HomeChromeMetrics.toolbarControlSpacing,
                                ),
                            ) {
                                Text(
                                    "Chats",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 26.sp,
                                    color = colors.ink,
                                    modifier = Modifier.weight(1f),
                                )
                                HomeChromeToolbarButton(
                                    icon = Icons.Outlined.Add,
                                    contentDescription = "New chat",
                                    onClick = { app.startNewChat() },
                                )
                            }
                            ChatConversationsListView(
                                onSelect = { app.openChatSession(existingId = it.id) },
                                onNewChat = { app.startNewChat() },
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun <T> chatNavSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

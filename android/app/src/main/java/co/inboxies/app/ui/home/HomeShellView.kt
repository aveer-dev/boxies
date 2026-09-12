package co.inboxies.app.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.models.ChatSession
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.HomeTab
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.chat.ChatSheetView
import co.inboxies.app.ui.components.UndoToastBanner
import co.inboxies.app.ui.compose.ComposeDockBar
import co.inboxies.app.ui.compose.ComposeSheetView
import co.inboxies.app.ui.email.EmailDetailView
import co.inboxies.app.ui.email.EmailListView
import co.inboxies.app.ui.search.SearchView
import co.inboxies.app.ui.settings.SettingsSheetView
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeShellView(
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val selectedTab by appModel.selectedTab.collectAsState()
    val selectedEmail by appModel.selectedEmail.collectAsState()
    val composeSession by appModel.composeSession.collectAsState()
    val toast by appModel.toast.collectAsState()
    val digest by appModel.inboxDigest.collectAsState()
    val emails by appModel.emails.collectAsState()
    val isLoading by appModel.isLoading.collectAsState()
    val chatSession by appModel.chatSession.collectAsState()
    val mailbox = appModel.selectedMailbox

    var showSearch by remember { mutableStateOf(false) }
    var showChat by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }

    val folderTabs = remember {
        listOf(
            HomeTab.AiInbox,
            HomeTab.Folder("inbox"),
            HomeTab.Folder("sent"),
            HomeTab.Folder("draft"),
            HomeTab.Folder("archive"),
            HomeTab.Folder("trash"),
        )
    }

    BackHandler(enabled = showSearch) { showSearch = false }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding(),
    ) {
        if (!showSearch) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            mailbox?.email ?: "Inboxies",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 22.sp,
                            color = colors.ink,
                        )
                        val subtitle = when (selectedTab) {
                            HomeTab.AiInbox -> {
                                val n = digest?.todos?.size ?: 0
                                if (n > 0) "$n to-dos" else "${digest?.unreadCount ?: 0} unread"
                            }
                            else -> selectedTab.title
                        }
                        Text(subtitle, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
                    }
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = colors.ink)
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    folderTabs.forEach { tab ->
                        val active = tab == selectedTab
                        Text(
                            tab.title,
                            modifier = Modifier
                                .clip(RoundedCornerShape(20.dp))
                                .background(if (active) colors.pillActive else colors.pillFill)
                                .clickable { scope.launch { appModel.selectTab(tab) } }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            fontFamily = InterFontFamily,
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            fontSize = 13.sp,
                            color = colors.ink,
                        )
                    }
                }

                Box(modifier = Modifier.weight(1f)) {
                    when (selectedTab) {
                        HomeTab.AiInbox -> InboxDigestView(
                            onRefresh = { appModel.loadInboxDigest(showLoading = true) },
                        )
                        is HomeTab.Folder -> EmailListView(
                            emails = emails,
                            isLoading = isLoading,
                            onRefresh = { appModel.refreshCurrentTab() },
                            onOpen = { email ->
                                scope.launch {
                                    if (email.isDraft) appModel.openDraft(email) else appModel.openEmail(email)
                                }
                            },
                        )
                        HomeTab.Chats -> Unit
                    }
                }
            }

            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(bottom = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                toast?.let {
                    UndoToastBanner(
                        message = it.message,
                        isError = it.isError,
                        isLoading = it.isLoading,
                        isUndo = it.isUndo,
                        onUndo = { appModel.clearToast() },
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                if (composeSession?.isMinimized == true) {
                    ComposeDockBar(
                        session = composeSession!!,
                        onExpand = { appModel.expandCompose() },
                        onClose = { appModel.closeCompose() },
                    )
                }
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(28.dp))
                        .background(colors.surface)
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { showSearch = true }) {
                        Icon(Icons.Filled.Search, contentDescription = "Search", tint = colors.ink)
                    }
                    IconButton(onClick = {
                        appModel.startNewChat()
                        showChat = true
                    }) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = "Ask AI", tint = colors.ink)
                    }
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(colors.ink)
                            .clickable { scope.launch { appModel.startCompose(ComposeMode.New) } },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Edit, contentDescription = "Compose", tint = colors.background, modifier = Modifier.size(20.dp))
                    }
                }
            }
        } else {
            SearchView(onClose = { showSearch = false })
        }
    }

    if (selectedEmail != null) {
        ModalBottomSheet(
            onDismissRequest = { appModel.closeEmail() },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
        ) {
            EmailDetailView(onClose = { appModel.closeEmail() })
        }
    }

    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
        ) {
            SettingsSheetView(
                onClose = { showSettings = false },
                onThemeModeChange = onThemeModeChange,
                themeMode = themeMode,
                onSignOut = {
                    showSettings = false
                    auth.signOut()
                    appModel.reset()
                },
            )
        }
    }

    if (composeSession?.isExpanded == true) {
        Dialog(
            onDismissRequest = { appModel.minimizeCompose() },
            properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = true),
        ) {
            ComposeSheetView(
                session = composeSession!!,
                onMinimize = { appModel.minimizeCompose() },
                onClose = { appModel.closeCompose() },
                onSend = { appModel.sendCompose() },
                onSaveDraft = { appModel.saveDraft() },
            )
        }
    }

    if (showChat || chatSession !is ChatSession.Dismissed) {
        Dialog(
            onDismissRequest = {
                showChat = false
                appModel.dismissChatSession()
            },
            properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = true),
        ) {
            ChatSheetView(
                onClose = {
                    showChat = false
                    appModel.dismissChatSession()
                },
            )
        }
    }
}

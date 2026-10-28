package co.inboxies.app.ui.home

import co.inboxies.app.theme.ToastMetrics
import co.inboxies.app.models.ToastAction
import co.inboxies.app.ui.components.toastIcon
import co.inboxies.app.ui.components.InboxiesToast
import co.inboxies.app.ui.components.AnimatedToast
import android.Manifest
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.zIndex
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.ViewSidebar
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import co.inboxies.app.models.ChatSession
import co.inboxies.app.models.AdminDomainInfo
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.EmailDateFilter
import co.inboxies.app.models.EmailFilterState
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.Mailbox
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.theme.AvatarInitials
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ProgressiveBlurBackground
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.homeChromeToolbarSurface
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import co.inboxies.app.ui.chat.ChatSheetView
import co.inboxies.app.ui.components.DomainServiceBanner
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.domainServiceCopy
import co.inboxies.app.ui.components.rememberDomainRenewal
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.compose.ComposeActionItem
import co.inboxies.app.ui.compose.ComposeActionListOverlay
import co.inboxies.app.ui.compose.ComposeDockBar
import co.inboxies.app.ui.compose.ComposeSheetView
import co.inboxies.app.ui.compose.ComposeStackButton
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import co.inboxies.app.theme.attention
import co.inboxies.app.ui.compose.rememberReduceMotion
import co.inboxies.app.ui.email.ReplyLaterReminderSheetModal
import co.inboxies.app.ui.email.EmailDetailView
import co.inboxies.app.ui.email.EmailListView
import co.inboxies.app.ui.email.InboxNewListView
import co.inboxies.app.ui.search.SearchView
import co.inboxies.app.ui.settings.SettingsSheetView
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class, ExperimentalAnimationApi::class)
@Composable
fun HomeShellView(
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val selectedTab by appModel.selectedTab.collectAsState()
    val selectedEmail by appModel.selectedEmail.collectAsState()
    val composeSession by appModel.composeSession.collectAsState()
    val toast by appModel.toast.collectAsState()
    val digest by appModel.inboxDigest.collectAsState()
    val folders by appModel.folders.collectAsState()
    val emails by appModel.emails.collectAsState()
    val replyLaterCount by appModel.replyLaterCount.collectAsState()
    val replyLaterDueCount by appModel.replyLaterDueCount.collectAsState()
    val reminderPickerEmail by appModel.reminderPickerEmail.collectAsState()
    val isLoading by appModel.isLoading.collectAsState()
    val paging by appModel.paging.collectAsState()
    val inboxNewTotal by appModel.inboxNewTotal.collectAsState()
    val emailListError by appModel.emailListError.collectAsState()
    val isDigestLoading by appModel.isDigestLoading.collectAsState()
    val mailboxes by appModel.mailboxes.collectAsState()
    val isMailboxLoading by appModel.isMailboxLoading.collectAsState()
    val authEmail by auth.userEmail.collectAsState()
    val mailDomain by appModel.mailDomain.collectAsState()
    val mailbox = appModel.selectedMailbox

    var showSearch by remember { mutableStateOf(false) }
    /** Inbox "Show N more new" replaced the list with the All new screen (AVE-23). */
    var showAllNew by remember { mutableStateOf(false) }
    // DEBUG previews (e.g. `aiUsage`) seed an open chat session before first composition.
    var showChat by remember {
        mutableStateOf(appModel.isDebugPreview && appModel.chatSession.value !is ChatSession.Dismissed)
    }
    var showSettings by remember { mutableStateOf(false) }
    var showMailboxMenu by remember { mutableStateOf(false) }
    var showAddMailbox by remember { mutableStateOf(false) }
    var isSelectMode by remember { mutableStateOf(false) }
    var selectedEmailIds by remember { mutableStateOf(setOf<String>()) }
    var filterState by remember { mutableStateOf(EmailFilterState()) }
    var showFilterMenu by remember { mutableStateOf(false) }
    var showComposeActions by remember { mutableStateOf(false) }
    var composeActionsClosing by remember { mutableStateOf(false) }
    var composeActionsDismissible by remember { mutableStateOf(false) }
    var composeDoubleTapArmed by remember { mutableStateOf(false) }
    var highlightedComposeAction by remember { mutableStateOf<ComposeActionItem?>(null) }
    var composeActionFrames by remember { mutableStateOf<Map<ComposeActionItem, Rect>>(emptyMap()) }
    var tabNavigatingForward by remember { mutableStateOf(true) }
    // Entering or leaving Reply Later is a push, not a folder-tab slide.
    var isReplyLaterPush by remember { mutableStateOf(false) }
    var previousTabBeforeReplyLater by remember { mutableStateOf<HomeTab>(HomeTab.Folder(FolderIds.INBOX)) }
    var newMailboxName by remember { mutableStateOf("") }
    var newMailboxEmail by remember { mutableStateOf("") }
    var isCreatingMailbox by remember { mutableStateOf(false) }

    val isAdmin by appModel.isAdmin.collectAsState()
    var pendingDomain by remember { mutableStateOf<AdminDomainInfo?>(null) }

    // Service ended for this mailbox's domain: read, flag and export only.
    val isReadOnly by appModel.selectedMailboxReadOnly.collectAsState()
    val domainService by appModel.selectedDomainService.collectAsState()
    val administeredDomains by appModel.administeredDomains.collectAsState()
    val renewal = rememberDomainRenewal()
    val serviceCopy = mailbox?.let { m ->
        domainServiceCopy(
            domain = m.domain,
            service = domainService,
            readOnly = isReadOnly,
            isAdmin = domainService?.canManage ?: (m.domain in administeredDomains),
        )
    }
    var settingsInitialDomainAdmin by remember { mutableStateOf(false) }

    LaunchedEffect(isAdmin) {
        if (isAdmin && !appModel.isDebugPreview) {
            runCatching { ApiClient.shared.listAdminDomains() }
                .onSuccess { list ->
                    pendingDomain = list.firstOrNull { it.status == "pending" || it.status == "pending_nameservers" }
                }
        }
    }

    LaunchedEffect(Unit) {
        if (!appModel.isDebugPreview) {
            appModel.refreshReplyLaterCount()
        }
    }

    // POST_NOTIFICATIONS is a runtime permission (minSdk 34): ask once the user has
    // a mailbox to register for, then register the FCM token if granted.
    val selectedMailboxId by appModel.selectedMailboxId.collectAsState()
    // A different mailbox or folder closes the All new screen.
    LaunchedEffect(selectedMailboxId, selectedTab) { showAllNew = false }
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        PushNotificationManager.shared.onPermissionResult(granted)
    }
    LaunchedEffect(selectedMailboxId) {
        if (selectedMailboxId == null || appModel.isDebugPreview) return@LaunchedEffect
        val push = PushNotificationManager.shared
        if (push.shouldPromptForPermission()) {
            push.markPermissionPrompted()
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    val showsScreenerFolder = remember(mailboxes, folders, selectedMailboxId) { appModel.showsScreenerFolder }
    val folderTabs = remember(showsScreenerFolder) {
        // listOf(HomeTab.AiInbox) + FolderIds.swipeFolderIds.map { HomeTab.Folder(it) }
        FolderIds.swipeFolderIds
            .filter { it != FolderIds.SCREENER || showsScreenerFolder }
            .map { HomeTab.Folder(it) }
    }

    val hasMinimizedCompose = composeSession?.isMinimized == true
    val isInboxTab = (selectedTab as? HomeTab.Folder)?.id == FolderIds.INBOX || selectedTab == HomeTab.AiInbox
    val screenerSenderCount = remember(folders, emails) { appModel.screenerSenderCount }
    val screenerEnabled = remember(mailboxes, selectedMailboxId) { appModel.isScreenerEnabled }
    val showScreenerBanner = isInboxTab && screenerEnabled && screenerSenderCount > 0 && !isSelectMode && !showComposeActions
    val listBottomInset by animateDpAsState(
        targetValue = HomeChromeMetrics.listBottomInset(hasMinimizedCompose && !isSelectMode) +
            (if (showScreenerBanner) 48.dp else 0.dp),
        animationSpec = selectModeSpring(),
        label = "listBottomInset",
    )
    val mailboxTitle = mailbox?.email ?: authEmail.orEmpty()
    val mailboxName = mailbox?.let { displayName(it) }
        ?: mailboxTitle.substringBefore("@").ifBlank { mailboxTitle }
    val initials = AvatarInitials.from(if (mailboxName.isNotBlank()) mailboxName else mailboxTitle.ifBlank { "A" })

    val filteredEmails = remember(emails, filterState, mailboxTitle) {
        filterState.filter(emails, mailboxTitle)
    }

    val navigationTitle = when (val tab = selectedTab) {
        HomeTab.AiInbox -> {
            val name = digest?.greetingName.orEmpty()
            if (name.isNotBlank()) "Hi $name \uD83D\uDC4B" else "Hi \uD83D\uDC4B"
        }
        else -> tab.title
    }

    val navigationSubtitle = when (val tab = selectedTab) {
        HomeTab.AiInbox -> {
            val d = digest
            when {
                d != null && d.todos.isEmpty() -> "You're all caught up on suggested to-dos"
                d != null -> {
                    val count = d.todos.size
                    "You have $count suggested to-do${if (count == 1) "" else "s"}"
                }
                isDigestLoading -> "Loading…"
                else -> ""
            }
        }
        is HomeTab.Folder -> when {
            isSelectMode -> {
                if (selectedEmailIds.isEmpty()) "Select emails" else "${selectedEmailIds.size} selected"
            }
            filterState.isActive -> "${filteredEmails.size} filtered · ${filterState.activeCount} active"
            else -> {
                val count = appModel.unreadCount(forFolderId = tab.id)
                when {
                    count == 0 -> "No unread"
                    count == 1 -> "1 unread"
                    else -> "$count unread"
                }
            }
        }
        HomeTab.ReplyLater -> {
            when {
                replyLaterCount == 0 -> "Nothing queued"
                replyLaterCount == 1 -> "1 to reply"
                else -> "$replyLaterCount to reply"
            }
        }
        else -> ""
    }

    fun selectTab(tab: HomeTab) {
        if (selectedTab == tab) return
        if (isSelectMode) {
            isSelectMode = false
            selectedEmailIds = emptySet()
        }
        isReplyLaterPush = tab is HomeTab.ReplyLater || selectedTab is HomeTab.ReplyLater
        if (tab is HomeTab.ReplyLater) {
            if (selectedTab !is HomeTab.ReplyLater) {
                previousTabBeforeReplyLater = selectedTab
            }
            tabNavigatingForward = true
        } else if (selectedTab is HomeTab.ReplyLater) {
            tabNavigatingForward = false
        } else {
            val current = folderTabs.indexOf(selectedTab).coerceAtLeast(0)
            val next = folderTabs.indexOf(tab).coerceAtLeast(0)
            tabNavigatingForward = next > current
        }
        scope.launch { appModel.selectTab(tab) }
    }

    /** Back out of Reply Later to the folder it was opened from (iOS: swipe right / pile button). */
    fun popReplyLater() {
        if (selectedTab !is HomeTab.ReplyLater) return
        val target = if (previousTabBeforeReplyLater is HomeTab.ReplyLater) {
            HomeTab.Folder(FolderIds.INBOX)
        } else {
            previousTabBeforeReplyLater
        }
        selectTab(target)
    }

    fun selectAdjacentTab(forward: Boolean) {
        val current = folderTabs.indexOf(selectedTab)
        if (current < 0) return
        val next = if (forward) current + 1 else current - 1
        if (next in folderTabs.indices) selectTab(folderTabs[next])
    }

    fun dismissComposeMenu() {
        if (!showComposeActions || composeActionsClosing) return
        composeActionsClosing = true
        composeDoubleTapArmed = false
    }

    fun performComposeAction(item: ComposeActionItem) {
        showComposeActions = false
        composeActionsClosing = false
        composeActionsDismissible = false
        composeDoubleTapArmed = false
        highlightedComposeAction = null
        when (item) {
            ComposeActionItem.Compose -> scope.launch { appModel.startCompose(ComposeMode.New) }
            ComposeActionItem.Settings -> showSettings = true
            else -> item.folderTab?.let { selectTab(it) }
        }
    }

    fun updateComposeHighlight(hit: ComposeActionItem?) {
        if (hit == highlightedComposeAction) return
        if (hit != null) {
            view.selectionHaptic()
        }
        highlightedComposeAction = hit
    }

    // Large screens read mail in a side pane; phones keep the detail sheet (AVE-72).
    // Wide windows add the leading folder column unless the user hid it (AVE-73).
    var showsFolderColumn by rememberFolderColumnVisible()
    val allowsFolderColumn = rememberAllowsFolderColumn()
    val layoutMode = rememberHomeLayoutMode(showsFolderColumn)
    val isTwoPane = layoutMode.isSplit

    // Two-pane: back clears the reading pane to its placeholder (the phone's back
    // dismisses the detail sheet). Declared before the home handler so search /
    // select mode / overlays still take precedence.
    BackHandler(enabled = isTwoPane && selectedEmail != null) { appModel.closeEmail() }

    BackHandler(enabled = showSearch || showComposeActions || isSelectMode || selectedTab is HomeTab.ReplyLater) {
        when {
            showComposeActions -> {
                dismissComposeMenu()
            }
            showSearch -> showSearch = false
            isSelectMode -> {
                isSelectMode = false
                selectedEmailIds = emptySet()
            }
            selectedTab is HomeTab.ReplyLater -> popReplyLater()
        }
    }

    CompositionLocalProvider(
        LocalHomeLayoutMode provides layoutMode,
        LocalReadingPaneEmail provides if (isTwoPane) selectedEmail else null,
    ) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        HomeSplitLayout(
            mode = layoutMode,
            folders = {
                HomeFolderColumn(
                    title = mailboxName,
                    subtitle = mailboxTitle,
                    folders = folderTabs,
                    selected = selectedTab,
                    unreadCount = { appModel.unreadCount(forFolderId = it) },
                    replyLaterCount = replyLaterCount,
                    onSelect = { selectTab(it) },
                    onHide = { showsFolderColumn = false },
                )
            },
            list = {
        ProgressiveBlurBackground(modifier = Modifier.align(Alignment.TopCenter))

        if (showAllNew && !showSearch) {
            InboxNewListView(
                onClose = {
                    showAllNew = false
                    // Re-sync so the capped New preview reflects what was read.
                    scope.launch { appModel.refreshCurrentTab() }
                },
                bottomInset = listBottomInset,
            )
        } else if (!showSearch) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding(),
            ) {
                // Top bar: avatar + trailing actions
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box {
                        MailboxAvatar(
                            initials = initials,
                            isLoading = isMailboxLoading,
                            onClick = { showMailboxMenu = true },
                        )
                        MailboxDropdown(
                            expanded = showMailboxMenu,
                            onDismiss = { showMailboxMenu = false },
                            mailboxes = mailboxes,
                            selectedId = mailbox?.id,
                            onSelectMailbox = { id ->
                                showMailboxMenu = false
                                scope.launch { appModel.loadMailbox(id) }
                            },
                            onAddMailbox = {
                                showMailboxMenu = false
                                showAddMailbox = true
                            },
                            // Not a top-bar button: matches iOS, where an extra toolbar
                            // item crowds the list column.
                            folderColumnToggle = if (allowsFolderColumn) showsFolderColumn else null,
                            onToggleFolderColumn = {
                                showMailboxMenu = false
                                showsFolderColumn = !showsFolderColumn
                            },
                            onSettings = {
                                showMailboxMenu = false
                                showSettings = true
                            },
                            onSignOut = {
                                showMailboxMenu = false
                                appModel.signOut(auth)
                            },
                        )
                    }

                    Spacer(modifier = Modifier.weight(1f))

                    if (selectedTab is HomeTab.Folder) {
                        Row(
                            modifier = Modifier.padding(end = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            HomeChromeToolbarButton(
                                onClick = {
                                    if (isSelectMode) {
                                        isSelectMode = false
                                        selectedEmailIds = emptySet()
                                    }
                                    showSearch = true
                                },
                                modifier = Modifier.size(HomeChromeMetrics.toolbarControlSize),
                            ) {
                                Icon(
                                    Icons.Filled.Search,
                                    contentDescription = "Search",
                                    tint = colors.ink,
                                    modifier = Modifier.size(HomeChromeMetrics.toolbarControlIconSize),
                                )
                            }

                            Row(
                                modifier = Modifier
                                    .height(HomeChromeMetrics.toolbarControlSize)
                                    .homeChromeToolbarSurface(
                                        RoundedCornerShape(HomeChromeMetrics.toolbarControlCornerRadius),
                                    )
                                    .animateContentSize(animationSpec = selectModeSpring()),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                AnimatedContent(
                                    targetState = isSelectMode,
                                    transitionSpec = {
                                        (
                                            fadeIn(selectModeSpring()) +
                                                scaleIn(selectModeSpring(), initialScale = 0.86f)
                                            ) togetherWith (
                                            fadeOut(selectModeSpring()) +
                                                scaleOut(selectModeSpring(), targetScale = 0.86f)
                                            ) using SizeTransform(clip = false) { _, _ ->
                                            selectModeSpring()
                                        }
                                    },
                                    contentAlignment = Alignment.Center,
                                    label = "selectToggle",
                                ) { selectMode ->
                                    if (selectMode) {
                                        Box(
                                            modifier = Modifier
                                                .size(HomeChromeMetrics.toolbarControlSize)
                                                .clickable {
                                                    isSelectMode = false
                                                    selectedEmailIds = emptySet()
                                                },
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Icon(
                                                Icons.Filled.Close,
                                                contentDescription = "Cancel selection",
                                                tint = colors.ink,
                                                modifier = Modifier.size(HomeChromeMetrics.toolbarControlIconSize),
                                            )
                                        }
                                    } else {
                                        Box(
                                            modifier = Modifier
                                                .height(HomeChromeMetrics.toolbarControlSize)
                                                .clickable {
                                                    isSelectMode = true
                                                    selectedEmailIds = emptySet()
                                                }
                                                .padding(start = 16.dp, end = 12.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            Text(
                                                "Select",
                                                fontFamily = InterFontFamily,
                                                fontWeight = FontWeight.Medium,
                                                fontSize = 15.sp,
                                                color = colors.ink,
                                            )
                                        }
                                    }
                                }

                                Box {
                                    Box(
                                        modifier = Modifier
                                            .size(HomeChromeMetrics.toolbarControlSize)
                                            .clickable { showFilterMenu = true },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(
                                            Icons.Filled.FilterList,
                                            contentDescription = "Filter",
                                            tint = if (filterState.isActive) colors.accent else colors.ink,
                                            modifier = Modifier.size(HomeChromeMetrics.toolbarControlIconSize),
                                        )
                                        if (filterState.isActive) {
                                            Box(
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .padding(8.dp)
                                                    .size(7.dp)
                                                    .clip(CircleShape)
                                                    .background(colors.accent),
                                            )
                                        }
                                    }
                                    FilterDropdown(
                                        expanded = showFilterMenu,
                                        onDismiss = { showFilterMenu = false },
                                        filterState = filterState,
                                        onChange = { filterState = it },
                                        isInbox = (selectedTab as? HomeTab.Folder)?.id == FolderIds.INBOX,
                                    )
                                }
                            }
                        }
                    }
                }

                // Large title + subtitle
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 8.dp),
                ) {
                    Text(
                        navigationTitle,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 34.sp,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    AnimatedContent(
                        targetState = navigationSubtitle,
                        transitionSpec = {
                            fadeIn(selectModeSpring()) togetherWith fadeOut(selectModeSpring())
                        },
                        label = "navSubtitle",
                    ) { subtitle ->
                        if (subtitle.isNotBlank()) {
                            Text(
                                subtitle,
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Normal,
                                fontSize = 12.sp,
                                color = colors.muted,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }

                // Pending domain propagation banner
                pendingDomain?.let { domain ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors.accent.copy(alpha = 0.08f))
                            .border(BorderStroke(0.5.dp, colors.accent.copy(alpha = 0.25f)), RoundedCornerShape(12.dp))
                            .clickable {
                                settingsInitialDomainAdmin = true
                                showSettings = true
                            }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(colors.accent.copy(alpha = 0.15f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Outlined.Public,
                                contentDescription = null,
                                tint = colors.accent,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Domain Setup: ${domain.domain}",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                                color = colors.ink,
                            )
                            Text(
                                "Cloudflare is awaiting nameservers. Tap to view DNS.",
                                fontFamily = InterFontFamily,
                                fontSize = 11.sp,
                                color = colors.muted,
                            )
                        }
                        Icon(
                            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.muted.copy(alpha = 0.55f),
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }

                // Subscription ended (read-only) or, for admins, set to end.
                AnimatedVisibility(
                    visible = serviceCopy != null,
                    enter = expandVertically(selectModeSpring()) + fadeIn(selectModeSpring()),
                    exit = shrinkVertically(selectModeSpring()) + fadeOut(selectModeSpring()),
                ) {
                    // Keep the last copy on screen while the exit animation runs.
                    var shownCopy by remember { mutableStateOf(serviceCopy) }
                    if (serviceCopy != null) shownCopy = serviceCopy
                    shownCopy?.let { copy ->
                        DomainServiceBanner(
                            copy = copy,
                            isWorking = renewal.workingDomain != null,
                            onAction = { mailbox?.domain?.let { renewal.renew(it) } },
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                        )
                    }
                }

                // Tab content with swipe
                var dragAccum by remember { mutableFloatStateOf(0f) }
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .pointerInput(selectedTab) {
                            detectHorizontalDragGestures(
                                onDragStart = { dragAccum = 0f },
                                onDragEnd = {
                                    if (selectedTab is HomeTab.ReplyLater) {
                                        // Reply Later is pushed over a folder: swipe right pops back.
                                        if (dragAccum >= 40f) popReplyLater()
                                    } else if (abs(dragAccum) >= 40f) {
                                        selectAdjacentTab(forward = dragAccum < 0)
                                    }
                                    dragAccum = 0f
                                },
                                onDragCancel = { dragAccum = 0f },
                                onHorizontalDrag = { change, dragAmount ->
                                    change.consume()
                                    dragAccum += dragAmount
                                },
                            )
                        },
                ) {
                    val density = LocalDensity.current
                    AnimatedContent(
                        targetState = selectedTab,
                        transitionSpec = {
                            val forward = tabNavigatingForward
                            if (isReplyLaterPush) {
                                // Same push as Settings (iOS twin: spring 0.32 / 0.86): the
                                // incoming page slides a quarter width, the one under it a sixth.
                                (
                                    slideInHorizontally(selectModeSpring()) { full ->
                                        if (forward) full / 4 else -full / 6
                                    } + fadeIn(selectModeSpring())
                                ) togetherWith (
                                    slideOutHorizontally(selectModeSpring()) { full ->
                                        if (forward) -full / 6 else full / 4
                                    } + fadeOut(selectModeSpring())
                                )
                            } else {
                                // 28 / 18 dp, like iOS points (these lambdas take pixels).
                                val inOffset = with(density) { 28.dp.roundToPx() }
                                val outOffset = with(density) { 18.dp.roundToPx() }
                                (
                                    slideInHorizontally { if (forward) inOffset else -inOffset } + fadeIn()
                                ) togetherWith (
                                    slideOutHorizontally { if (forward) -outOffset else outOffset } + fadeOut()
                                )
                            }
                        },
                        label = "homeTab",
                    ) { tab ->
                        // AnimatedContent keeps composing the outgoing page with current
                        // state; freeze its rows so a folder sliding out under Reply Later
                        // doesn't show the Reply Later list (and vice versa).
                        val isCurrentTab = tab == selectedTab
                        var frozenEmails by remember { mutableStateOf(filteredEmails) }
                        var frozenLoading by remember { mutableStateOf(isLoading) }
                        SideEffect {
                            if (isCurrentTab) {
                                frozenEmails = filteredEmails
                                frozenLoading = isLoading
                            }
                        }
                        val tabEmails = if (isCurrentTab) filteredEmails else frozenEmails
                        val tabLoading = if (isCurrentTab) isLoading else frozenLoading
                        when (tab) {
                            HomeTab.AiInbox -> InboxDigestView(
                                bottomInset = listBottomInset,
                                onRefresh = { appModel.refreshCurrentTab() },
                            )
                            is HomeTab.Folder -> EmailListView(
                                emails = tabEmails,
                                isLoading = tabLoading,
                                bottomInset = listBottomInset,
                                fallbackFolderId = tab.id,
                                showsTags = true,
                                isSelectMode = isSelectMode,
                                selectedEmailIds = selectedEmailIds,
                                onToggleSelect = { id ->
                                    selectedEmailIds = if (selectedEmailIds.contains(id)) {
                                        selectedEmailIds - id
                                    } else {
                                        selectedEmailIds + id
                                    }
                                },
                                isFiltered = filterState.isActive,
                                onClearFilters = { filterState = filterState.reset() },
                                filterChipsBar = if (filterState.isActive) {
                                    {
                                        ActiveFilterChipsBar(
                                            filterState = filterState,
                                            onChange = { filterState = it },
                                            isInbox = tab.id == FolderIds.INBOX,
                                        )
                                    }
                                } else {
                                    null
                                },
                                onRefresh = { appModel.refreshCurrentTab() },
                                loadError = emailListError,
                                paging = paging,
                                onLoadMore = { appModel.loadMoreEmails() },
                                inboxNewCount = if (tab.id == FolderIds.INBOX) appModel.inboxNewCountFor(inboxNewTotal) else null,
                                onShowAllNew = if (tab.id == FolderIds.INBOX) ({ showAllNew = true }) else null,
                                onOpen = { email ->
                                    scope.launch {
                                        if (email.isDraft) appModel.openDraft(email) else appModel.openEmail(email)
                                    }
                                },
                            )
                            HomeTab.ReplyLater -> EmailListView(
                                emails = tabEmails,
                                isLoading = tabLoading,
                                bottomInset = listBottomInset,
                                fallbackFolderId = null,
                                showsTags = false,
                                isSelectMode = isSelectMode,
                                selectedEmailIds = selectedEmailIds,
                                onToggleSelect = { id ->
                                    selectedEmailIds = if (selectedEmailIds.contains(id)) {
                                        selectedEmailIds - id
                                    } else {
                                        selectedEmailIds + id
                                    }
                                },
                                isFiltered = false,
                                onClearFilters = null,
                                filterChipsBar = null,
                                onRefresh = { appModel.refreshCurrentTab() },
                                loadError = emailListError,
                                paging = paging,
                                onLoadMore = { appModel.loadMoreEmails() },
                                onOpen = { email ->
                                    scope.launch { appModel.openEmail(email) }
                                },
                            )
                            HomeTab.Chats -> Unit
                        }
                    }
                }
            }

            // Bottom chrome
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .zIndex(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        // Size animation first so its clip includes the bottom inset: the
                        // Reply Later attention halo (AVE-86) draws just past the bar.
                        .animateContentSize(animationSpec = selectModeSpring())
                        .then(
                            if (hasMinimizedCompose && !isSelectMode) {
                                Modifier.padding(bottom = HomeChromeMetrics.minimizedComposeGap)
                            } else {
                                Modifier
                                    .navigationBarsPadding()
                                    .padding(bottom = HomeChromeMetrics.chromeBottomPadding - 12.dp)
                            }
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                AnimatedToast(toast) { current ->
                    InboxiesToast(
                        message = current.message,
                        icon = current.toastIcon,
                        iconVector = current.icon,
                        action = if (current.isUndo) {
                            ToastAction("Undo") { appModel.undoPendingAction() }
                        } else {
                            current.action
                        },
                        onDismiss = { appModel.hideToast() },
                        modifier = Modifier
                            .padding(horizontal = ToastMetrics.screenInset)
                            .padding(bottom = ToastMetrics.barGap),
                    )
                }

                AnimatedVisibility(
                    visible = showScreenerBanner,
                    enter = slideInVertically(selectModeSpring()) { it } + fadeIn(selectModeSpring()),
                    exit = slideOutVertically(selectModeSpring()) { it } + fadeOut(selectModeSpring()),
                ) {
                    ScreenerBanner(
                        count = screenerSenderCount,
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                            selectTab(HomeTab.Folder(FolderIds.SCREENER))
                        },
                        modifier = Modifier
                            .padding(horizontal = 24.dp)
                            .padding(bottom = 8.dp),
                    )
                }

                AnimatedContent(
                    targetState = isSelectMode,
                    modifier = Modifier.fillMaxWidth(),
                    transitionSpec = {
                        (
                            slideInVertically(selectModeSpring()) { it } + fadeIn(selectModeSpring())
                            ) togetherWith (
                            slideOutVertically(selectModeSpring()) { it } + fadeOut(selectModeSpring())
                            ) using SizeTransform(clip = false) { _, _ ->
                            selectModeSpring()
                        }
                    },
                    contentAlignment = Alignment.BottomCenter,
                    label = "selectChrome",
                ) { selectMode ->
                    if (selectMode) {
                        SelectionActionBar(
                            selectedCount = selectedEmailIds.size,
                            allSelected = filteredEmails.isNotEmpty() &&
                                filteredEmails.all { selectedEmailIds.contains(it.id) },
                            mostlyUnread = run {
                                val selected = emails.filter { selectedEmailIds.contains(it.id) }
                                if (selected.isEmpty()) true
                                else selected.count { it.isUnread } >= maxOf(1, selected.size - selected.count { it.isUnread })
                            },
                            mostlyStarred = run {
                                val selected = emails.filter { selectedEmailIds.contains(it.id) }
                                if (selected.isEmpty()) false
                                else selected.count { it.starred } >= maxOf(1, selected.size - selected.count { it.starred })
                            },
                            onToggleSelectAll = {
                                selectedEmailIds = if (
                                    filteredEmails.isNotEmpty() &&
                                    filteredEmails.all { selectedEmailIds.contains(it.id) }
                                ) {
                                    emptySet()
                                } else {
                                    filteredEmails.map { it.id }.toSet()
                                }
                            },
                            onToggleRead = {
                                val targetRead = run {
                                    val selected = emails.filter { selectedEmailIds.contains(it.id) }
                                    if (selected.isEmpty()) true
                                    else selected.count { it.isUnread } >= maxOf(1, selected.size - selected.count { it.isUnread })
                                }
                                val ids = selectedEmailIds
                                scope.launch { appModel.markEmailsRead(ids, targetRead) }
                            },
                            onToggleStar = {
                                val targetStarred = run {
                                    val selected = emails.filter { selectedEmailIds.contains(it.id) }
                                    if (selected.isEmpty()) true
                                    else selected.count { it.starred } < maxOf(1, selected.size - selected.count { it.starred })
                                }
                                val ids = selectedEmailIds
                                scope.launch { appModel.starEmails(ids, targetStarred) }
                            },
                            onArchive = {
                                val ids = selectedEmailIds
                                scope.launch {
                                    appModel.archiveEmails(ids)
                                    selectedEmailIds = emptySet()
                                }
                            },
                            onDelete = {
                                val ids = selectedEmailIds
                                scope.launch {
                                    appModel.deleteEmails(ids)
                                    selectedEmailIds = emptySet()
                                }
                            },
                            modifier = Modifier.padding(horizontal = 16.dp),
                            canMove = !isReadOnly,
                        )
                    } else {
                        BottomBar(
                            showComposeActions = showComposeActions && !composeActionsClosing,
                            replyLaterCount = replyLaterCount,
                            replyLaterDueCount = replyLaterDueCount,
                            isReplyLaterTab = selectedTab is HomeTab.ReplyLater,
                            onReplyLater = {
                                if (selectedTab is HomeTab.ReplyLater) {
                                    popReplyLater()
                                } else if (replyLaterCount == 0) {
                                    appModel.showToast("There is no reply later mail")
                                    scope.launch { appModel.refreshReplyLaterCount() }
                                } else {
                                    previousTabBeforeReplyLater = selectedTab
                                    selectTab(HomeTab.ReplyLater)
                                }
                            },
                            onAskAi = {
                                appModel.openChatSession(resumeActive = true)
                                showChat = true
                            },
                            onOpenComposeMenu = {
                                composeActionsDismissible = true
                                composeDoubleTapArmed = true
                                composeActionsClosing = false
                                view.performHapticFeedback(
                                    android.view.HapticFeedbackConstants.KEYBOARD_TAP,
                                )
                                showComposeActions = true
                                scope.launch {
                                    delay(HomeChromeMetrics.composeDoubleTapWindowMs)
                                    composeDoubleTapArmed = false
                                }
                            },
                            onOpenCompose = {
                                composeDoubleTapArmed = false
                                composeActionsClosing = false
                                if (isReadOnly) {
                                    // Nothing to compose from a read-only mailbox; the press
                                    // still opens the folder list.
                                    composeActionsDismissible = true
                                    showComposeActions = true
                                } else {
                                    showComposeActions = false
                                    scope.launch { appModel.startCompose(ComposeMode.New) }
                                }
                            },
                            onCloseComposeMenu = { dismissComposeMenu() },
                            showAskAi = !isReadOnly,
                        )
                    }
                }
                }

                AnimatedVisibility(
                    visible = hasMinimizedCompose && !isSelectMode,
                    enter = slideInVertically(selectModeSpring()) { it } + fadeIn(selectModeSpring()),
                    exit = slideOutVertically(selectModeSpring()) { it } + fadeOut(selectModeSpring()),
                ) {
                    composeSession?.let { session ->
                        ComposeDockBar(
                            session = session,
                            onExpand = { appModel.expandCompose() },
                        )
                    }
                }
            }
        } else {
            SearchView(onClose = { showSearch = false })
        }

        if (showComposeActions) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .zIndex(2f),
            ) {
                ComposeActionListOverlay(
                    highlightedId = highlightedComposeAction,
                    onSelect = { performComposeAction(it) },
                    onDismiss = {
                        showComposeActions = false
                        composeActionsClosing = false
                        composeActionsDismissible = false
                        composeDoubleTapArmed = false
                        highlightedComposeAction = null
                    },
                    onHighlightChange = { updateComposeHighlight(it) },
                    onRowFramesChange = { composeActionFrames = it },
                    dismissEnabled = composeActionsDismissible && !composeActionsClosing,
                    isClosingExternal = composeActionsClosing,
                    onDismissStarted = {
                        composeActionsClosing = true
                        composeDoubleTapArmed = false
                        highlightedComposeAction = null
                    },
                    showCompose = !isReadOnly,
                    showScreener = showsScreenerFolder,
                )
                if (composeDoubleTapArmed && !isReadOnly) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(
                                end = HomeChromeMetrics.bottomBarHorizontalPadding,
                                bottom = HomeChromeMetrics.chromeBottomPadding,
                            )
                            .size(
                                width = HomeChromeMetrics.actionBarHeight,
                                height = HomeChromeMetrics.composeStackHeight(),
                            )
                            .clickable(
                                indication = null,
                                interactionSource = remember { MutableInteractionSource() },
                            ) {
                                composeDoubleTapArmed = false
                                showComposeActions = false
                                composeActionsClosing = false
                                composeActionsDismissible = false
                                highlightedComposeAction = null
                                scope.launch { appModel.startCompose(ComposeMode.New) }
                            },
                    )
                }
            }
        }

            },
            detail = {
                val open = selectedEmail
                if (open != null) {
                    // Fresh detail state per email; the pane keeps the email's close (x),
                    // which clears back to the placeholder.
                    key(open.id) {
                        EmailDetailView(onClose = { appModel.closeEmail() }, showsGrabber = false)
                    }
                } else {
                    ReadingPanePlaceholder()
                }
            },
        )

        if (composeSession?.isExpanded == true) {
            // Scrim stays inert: unsaved field edits live in the sheet until it minimizes.
            HomeFormSheet(mode = layoutMode, onDismissOutside = null) {
                ComposeSheetView(
                    session = composeSession!!,
                    onMinimize = { appModel.minimizeCompose() },
                    onClose = { appModel.closeCompose() },
                    onSend = { appModel.sendCompose() },
                    onSaveDraft = { appModel.saveDraft() },
                )
            }
        }

        if (showChat) {
            val closeChat = {
                showChat = false
                appModel.dismissChatSession()
            }
            HomeFormSheet(mode = layoutMode, onDismissOutside = closeChat) {
                ChatSheetView(onClose = closeChat)
            }
        }

        if (showSettings && isTwoPane) {
            val closeSettings = {
                showSettings = false
                settingsInitialDomainAdmin = false
            }
            HomeFormSheet(mode = layoutMode, onDismissOutside = closeSettings) {
                SettingsSheetView(
                    onClose = closeSettings,
                    onThemeModeChange = onThemeModeChange,
                    themeMode = themeMode,
                    initialDomainAdmin = settingsInitialDomainAdmin,
                )
            }
        }
    }
    }

    // Phone detail sheet. In two-pane the email shows in the reading pane instead; if the
    // window widens with the sheet up it simply leaves composition (no dismiss callback),
    // so the selection carries over to the pane.
    if (selectedEmail != null && !isTwoPane) {
        ModalBottomSheet(
            onDismissRequest = { appModel.closeEmail() },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
            contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
            dragHandle = null,
        ) {
            EmailDetailView(onClose = { appModel.closeEmail() })
        }
    }

    if (showSettings && !isTwoPane) {
        ModalBottomSheet(
            onDismissRequest = {
                showSettings = false
                settingsInitialDomainAdmin = false
            },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
            contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
            dragHandle = null,
        ) {
            SettingsSheetView(
                onClose = {
                    showSettings = false
                    settingsInitialDomainAdmin = false
                },
                onThemeModeChange = onThemeModeChange,
                themeMode = themeMode,
                initialDomainAdmin = settingsInitialDomainAdmin,
            )
        }
    }

    reminderPickerEmail?.let { email ->
        ReplyLaterReminderSheetModal(
            email = email,
            onDismiss = { appModel.dismissReminderPicker() },
        )
    }

    if (showAddMailbox) {
        Dialog(onDismissRequest = { if (!isCreatingMailbox) showAddMailbox = false }) {
            AddMailboxDialog(
                name = newMailboxName,
                emailLocal = newMailboxEmail,
                mailDomain = mailDomain,
                isCreating = isCreatingMailbox,
                onNameChange = { newMailboxName = it },
                onEmailChange = { value ->
                    newMailboxEmail = value.substringBefore("@")
                },
                onDismiss = {
                    showAddMailbox = false
                    newMailboxName = ""
                    newMailboxEmail = ""
                },
                onCreate = {
                    // A second tap while the request is in flight would create (or 409 on) the same address.
                    if (!isCreatingMailbox) {
                        isCreatingMailbox = true
                        scope.launch {
                            try {
                                if (appModel.createMailbox(newMailboxName, "$newMailboxEmail@$mailDomain")) {
                                    showAddMailbox = false
                                    newMailboxName = ""
                                    newMailboxEmail = ""
                                }
                            } finally {
                                isCreatingMailbox = false
                            }
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun MailboxAvatar(
    initials: String,
    isLoading: Boolean,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .padding(8.dp)
            .size(HomeChromeMetrics.mailboxAvatarSize)
            .homeChromeToolbarSurface(CircleShape)
            .clickable(enabled = !isLoading, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (!isLoading) {
            Text(
                initials,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = if (initials.length > 1) 15.sp else 17.sp,
                color = colors.ink,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun MailboxDropdown(
    expanded: Boolean,
    onDismiss: () -> Unit,
    mailboxes: List<Mailbox>,
    selectedId: String?,
    onSelectMailbox: (String) -> Unit,
    onAddMailbox: () -> Unit,
    onSettings: () -> Unit,
    onSignOut: () -> Unit,
    /** Folder column currently shown; null when the window is too narrow for it. */
    folderColumnToggle: Boolean? = null,
    onToggleFolderColumn: () -> Unit = {},
) {
    InboxiesDropdownMenu(expanded = expanded, onDismiss = onDismiss) {
        mailboxes.forEach { mailbox ->
            InboxiesMenuItem(
                text = displayName(mailbox),
                onClick = { onSelectMailbox(mailbox.id) },
                icon = if (mailbox.id == selectedId) Icons.Filled.Check else null,
            )
        }
        InboxiesMenuDivider()
        if (folderColumnToggle != null) {
            InboxiesMenuItem(
                text = if (folderColumnToggle) "Hide folders" else "Show folders",
                onClick = onToggleFolderColumn,
                icon = Icons.AutoMirrored.Outlined.ViewSidebar,
            )
        }
        InboxiesMenuItem(
            text = "Add another email",
            onClick = onAddMailbox,
            icon = Icons.Filled.Add,
        )
        InboxiesMenuItem(
            text = "Settings",
            onClick = onSettings,
            icon = Icons.Outlined.Settings,
        )
        InboxiesMenuItem(
            text = "Sign out",
            onClick = onSignOut,
            icon = Icons.AutoMirrored.Outlined.Logout,
            destructive = true,
        )
    }
}

@Composable
private fun FilterDropdown(
    expanded: Boolean,
    onDismiss: () -> Unit,
    filterState: EmailFilterState,
    onChange: (EmailFilterState) -> Unit,
    isInbox: Boolean = false,
) {
    InboxiesDropdownMenu(expanded = expanded, onDismiss = onDismiss) {
        FilterToggle(
            if (isInbox) "New only" else "Unread",
            filterState.unreadOnly,
        ) {
            onChange(filterState.copy(unreadOnly = it))
        }
        FilterToggle("Starred", filterState.starredOnly) {
            onChange(filterState.copy(starredOnly = it))
        }
        FilterToggle("Reply later", filterState.replyLaterOnly) {
            onChange(filterState.copy(replyLaterOnly = it))
        }
        FilterToggle("To me", filterState.toMeOnly) {
            onChange(filterState.copy(toMeOnly = it))
        }
        FilterToggle("Cc / Bcc me", filterState.ccOrBccMeOnly) {
            onChange(filterState.copy(ccOrBccMeOnly = it))
        }
        FilterToggle("With attachments", filterState.withAttachmentsOnly) {
            onChange(filterState.copy(withAttachmentsOnly = it))
        }
        FilterToggle("Only today", filterState.dateFilter == EmailDateFilter.TODAY) {
            onChange(filterState.copy(dateFilter = if (it) EmailDateFilter.TODAY else EmailDateFilter.ANY))
        }
        FilterToggle("Last three days", filterState.dateFilter == EmailDateFilter.LAST_THREE_DAYS) {
            onChange(filterState.copy(dateFilter = if (it) EmailDateFilter.LAST_THREE_DAYS else EmailDateFilter.ANY))
        }
        FilterToggle("This week", filterState.dateFilter == EmailDateFilter.THIS_WEEK) {
            onChange(filterState.copy(dateFilter = if (it) EmailDateFilter.THIS_WEEK else EmailDateFilter.ANY))
        }
        FilterToggle("Needs reply", filterState.needsReplyOnly) {
            onChange(filterState.copy(needsReplyOnly = it))
        }
        if (filterState.isActive) {
            InboxiesMenuDivider()
            InboxiesMenuItem(
                text = "Clear all filters",
                onClick = {
                    onChange(filterState.reset())
                    onDismiss()
                },
                destructive = true,
            )
        }
    }
}

@Composable
private fun FilterToggle(label: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    InboxiesMenuItem(
        text = label,
        onClick = { onCheckedChange(!checked) },
        icon = if (checked) Icons.Filled.Check else null,
    )
}

@Composable
private fun ActiveFilterChipsBar(
    filterState: EmailFilterState,
    onChange: (EmailFilterState) -> Unit,
    isInbox: Boolean = false,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (filterState.unreadOnly) {
            FilterChip(if (isInbox) "New only" else "Unread") {
                onChange(filterState.copy(unreadOnly = false))
            }
        }
        if (filterState.starredOnly) {
            FilterChip("Starred") { onChange(filterState.copy(starredOnly = false)) }
        }
        if (filterState.replyLaterOnly) {
            FilterChip("Reply later") { onChange(filterState.copy(replyLaterOnly = false)) }
        }
        if (filterState.toMeOnly) {
            FilterChip("To me") { onChange(filterState.copy(toMeOnly = false)) }
        }
        if (filterState.ccOrBccMeOnly) {
            FilterChip("Cc/Bcc me") { onChange(filterState.copy(ccOrBccMeOnly = false)) }
        }
        if (filterState.withAttachmentsOnly) {
            FilterChip("Attachments") { onChange(filterState.copy(withAttachmentsOnly = false)) }
        }
        if (filterState.dateFilter != EmailDateFilter.ANY) {
            FilterChip(filterState.dateFilter.label) {
                onChange(filterState.copy(dateFilter = EmailDateFilter.ANY))
            }
        }
        if (filterState.needsReplyOnly) {
            FilterChip("Needs reply") { onChange(filterState.copy(needsReplyOnly = false)) }
        }
        Text(
            "Clear all",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            color = colors.muted,
            modifier = Modifier
                .clickable { onChange(filterState.reset()) }
                .padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun FilterChip(title: String, onRemove: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(colors.pillActive)
            .clickable(onClick = onRemove)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.ink)
        Icon(Icons.Filled.Close, contentDescription = "Remove", tint = colors.muted, modifier = Modifier.size(10.dp))
    }
}

@Composable
private fun BottomBar(
    showComposeActions: Boolean,
    replyLaterCount: Int,
    isReplyLaterTab: Boolean,
    onReplyLater: () -> Unit,
    onAskAi: () -> Unit,
    /** Reply Later mails whose reminder fired (AVE-86): > 0 switches the button to attention. */
    replyLaterDueCount: Int = 0,
    onOpenComposeMenu: () -> Unit,
    onOpenCompose: () -> Unit,
    onCloseComposeMenu: () -> Unit,
    /** False for a read-only mailbox: the AI agent ended with the service. */
    showAskAi: Boolean = true,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    var composePressed by remember { mutableStateOf(false) }

    val showReplyLater = replyLaterCount > 0 || isReplyLaterTab

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = HomeChromeMetrics.bottomBarHorizontalPadding),
        verticalAlignment = Alignment.Bottom,
    ) {
        AnimatedVisibility(
            visible = showReplyLater,
            enter = fadeIn(selectModeSpring()) +
                expandHorizontally(
                    animationSpec = selectModeSpring(),
                    expandFrom = Alignment.Start,
                    clip = false,
                ) +
                scaleIn(animationSpec = selectModeSpring(), initialScale = 0.72f),
            exit = fadeOut(selectModeSpring()) +
                shrinkHorizontally(
                    animationSpec = selectModeSpring(),
                    shrinkTowards = Alignment.Start,
                    clip = false,
                ) +
                scaleOut(animationSpec = selectModeSpring(), targetScale = 0.72f),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val isDue = replyLaterDueCount > 0
                val contentTint = when {
                    isDue -> colors.attention
                    isReplyLaterTab -> colors.accent
                    else -> colors.ink
                }
                val description = buildString {
                    append("Reply Later")
                    if (replyLaterCount > 0) append(", $replyLaterCount to reply")
                    if (isDue) append(", $replyLaterDueCount due")
                }
                Row(
                    modifier = Modifier
                        .height(HomeChromeMetrics.actionBarHeight)
                        .replyLaterAttentionGlow(isDue, colors.attention)
                        .homeChromeToolbarSurface(RoundedCornerShape(50))
                        .then(
                            if (isDue) {
                                Modifier.background(colors.attention.copy(alpha = 0.12f), RoundedCornerShape(50))
                            } else {
                                Modifier
                            },
                        )
                        .clickable {
                            if (showComposeActions) {
                                onCloseComposeMenu()
                            } else {
                                onReplyLater()
                            }
                        }
                        .semantics(mergeDescendants = true) { contentDescription = description }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        if (isDue) Icons.Outlined.NotificationsActive else Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = contentTint,
                        modifier = Modifier.size(18.dp),
                    )
                    if (replyLaterCount > 0) {
                        Text(
                            "$replyLaterCount",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            color = contentTint,
                        )
                    }
                }
                Spacer(modifier = Modifier.width(HomeChromeMetrics.chromeSpacing))
            }
        }

        if (showAskAi) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .height(HomeChromeMetrics.actionBarHeight)
                    .homeChromeToolbarSurface(RoundedCornerShape(50))
                    .clickable {
                        if (showComposeActions) {
                            onCloseComposeMenu()
                        } else {
                            onAskAi()
                        }
                    }
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = colors.muted, modifier = Modifier.size(18.dp))
                Text(
                    "Ask AI",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = colors.muted,
                )
            }

            Spacer(modifier = Modifier.width(HomeChromeMetrics.chromeSpacing))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }

        val composeButtonAlpha by animateFloatAsState(
            targetValue = if (showComposeActions) 0f else 1f,
            animationSpec = spring(
                dampingRatio = 0.86f,
                stiffness = Spring.StiffnessMediumLow,
            ),
            label = "composeButtonAlpha",
        )

        Box(
            modifier = Modifier
                .size(
                    width = HomeChromeMetrics.actionBarHeight,
                    height = HomeChromeMetrics.composeStackHeight(),
                )
                .graphicsLayer {
                    alpha = composeButtonAlpha
                }
                .semantics {
                    contentDescription =
                        "Compose menu. Tap for folders and actions. Double tap or press briefly to compose."
                }
                .pointerInput(showComposeActions, onOpenComposeMenu, onOpenCompose, onCloseComposeMenu) {
                    if (showComposeActions) {
                        return@pointerInput
                    }
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var triggeredCompose = false
                        composePressed = true

                        val pressJob = scope.launch {
                            delay(HomeChromeMetrics.composeLongPressMs)
                            triggeredCompose = true
                            view.impactHaptic()
                            onOpenCompose()
                        }
                        try {
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull { it.id == down.id }
                                    ?: event.changes.firstOrNull()
                                    ?: break
                                if (!change.pressed) {
                                    pressJob.cancel()
                                    if (!triggeredCompose) {
                                        // Instant menu open — no double-tap debounce wait.
                                        onOpenComposeMenu()
                                    }
                                    change.consume()
                                    break
                                }
                                change.consume()
                            }
                        } finally {
                            pressJob.cancel()
                            composePressed = false
                        }
                    }
                },
            contentAlignment = Alignment.BottomCenter,
        ) {
            ComposeStackButton(isExpanded = showComposeActions, isPressed = composePressed)
        }
    }
}

@Composable
private fun ScreenerBanner(
    count: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val text = if (count == 1) {
        "1 first-time sender to screen"
    } else {
        "$count first-time senders to screen"
    }

    Surface(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = text
            },
        shape = RoundedCornerShape(50),
        color = colors.surface.copy(alpha = 0.94f),
        border = BorderStroke(0.5.dp, colors.line.copy(alpha = 0.6f)),
        shadowElevation = 3.dp,
        tonalElevation = 0.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Shield,
                contentDescription = null,
                tint = colors.accent,
                modifier = Modifier.size(15.dp),
            )
            Text(
                text = text,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(15.dp),
            )
        }
    }
}

@Composable
private fun SelectionActionBar(
    selectedCount: Int,
    allSelected: Boolean,
    mostlyUnread: Boolean,
    mostlyStarred: Boolean,
    onToggleSelectAll: () -> Unit,
    onToggleRead: () -> Unit,
    onToggleStar: () -> Unit,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
    canMove: Boolean = true,
) {
    val colors = inboxiesColors()
    val enabled = selectedCount > 0
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(HomeChromeMetrics.selectionBarHeight)
            .liquidGlass(RoundedCornerShape(HomeChromeMetrics.chromeCornerRadius))
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (allSelected) "Deselect All" else "Select All",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            color = colors.ink,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(colors.pillFill)
                .clickable(onClick = onToggleSelectAll)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )

        Spacer(modifier = Modifier.weight(1f))

        Text(
            "$selectedCount",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
            color = if (selectedCount == 0) colors.muted else colors.ink,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(colors.pillFill)
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )

        Spacer(modifier = Modifier.weight(1f))

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.then(if (enabled) Modifier else Modifier),
        ) {
            CircleAction(
                icon = if (mostlyUnread) Icons.Outlined.MarkEmailRead else Icons.Outlined.MarkEmailUnread,
                enabled = enabled,
                onClick = onToggleRead,
                contentDescription = "Mark as read or unread",
            )
            CircleAction(
                icon = if (mostlyStarred) Icons.Outlined.StarBorder else Icons.Filled.Star,
                enabled = enabled,
                onClick = onToggleStar,
                contentDescription = "Star or unstar",
            )
            // Read-only mailbox (service ended): read/star flags only.
            if (canMove) {
                CircleAction(
                    icon = Icons.Filled.Archive,
                    enabled = enabled,
                    onClick = onArchive,
                    contentDescription = "Archive",
                )
                CircleAction(
                    icon = Icons.Filled.Delete,
                    enabled = enabled,
                    tint = Color.Red,
                    onClick = onDelete,
                    contentDescription = "Delete",
                )
            }
        }
    }
}

@Composable
private fun CircleAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
    contentDescription: String,
    tint: Color = inboxiesColors().ink,
) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(38.dp)
            .clip(CircleShape)
            .background(colors.pillFill)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = if (enabled) tint else tint.copy(alpha = 0.35f),
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun AddMailboxDialog(
    name: String,
    emailLocal: String,
    mailDomain: String,
    isCreating: Boolean,
    onNameChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onCreate: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "Add Mailbox",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            color = colors.ink,
        )
        OutlinedTextField(
            value = name,
            onValueChange = onNameChange,
            label = { Text("Full Name") },
            singleLine = true,
            enabled = !isCreating,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = emailLocal,
            onValueChange = onEmailChange,
            label = { Text("Username") },
            singleLine = true,
            enabled = !isCreating,
            trailingIcon = {
                Text("@$mailDomain", color = colors.muted, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "Create a new email address for this workspace.",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onDismiss, enabled = !isCreating) {
                Text("Cancel", color = colors.muted)
            }
            TextButton(
                onClick = onCreate,
                enabled = !isCreating && name.isNotBlank() && emailLocal.isNotBlank(),
            ) {
                if (isCreating) {
                    CircularProgressIndicator(
                        color = colors.accent,
                        strokeWidth = 2.dp,
                        modifier = Modifier
                            .size(16.dp)
                            .semantics { contentDescription = "Creating mailbox" },
                    )
                } else {
                    Text("Create", color = colors.accent)
                }
            }
        }
    }
}

private fun displayName(mailbox: Mailbox): String {
    val local = mailbox.email.substringBefore("@")
    return local.ifBlank { mailbox.email }
}

private fun View.impactHaptic() {
    val feedback = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        HapticFeedbackConstants.CONFIRM
    } else {
        HapticFeedbackConstants.KEYBOARD_TAP
    }
    performHapticFeedback(feedback)
}

private fun View.selectionHaptic() {
    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
}

private fun <T> selectModeSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

/**
 * Soft attention halo behind the Reply Later pill while a reminder is due (AVE-86): a warm
 * glow that breathes (opacity + spread, ~1.8s). With animations off it stays static.
 */
@Composable
private fun Modifier.replyLaterAttentionGlow(active: Boolean, color: Color): Modifier {
    if (!active) return this
    val reduceMotion = rememberReduceMotion()
    val pulse = if (reduceMotion) {
        0.5f
    } else {
        val transition = rememberInfiniteTransition(label = "replyLaterDue")
        val value by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 900, easing = FastOutSlowInEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "replyLaterDuePulse",
        )
        value
    }
    return this.drawBehind {
        val radius = size.height / 2f
        // Two stacked rings read as a soft glow without a blur effect.
        val outer = (3.dp.toPx() + 3.dp.toPx() * pulse)
        val inner = (1.dp.toPx() + 1.5.dp.toPx() * pulse)
        drawRoundRect(
            color = color.copy(alpha = 0.06f + 0.08f * pulse),
            topLeft = Offset(-outer, -outer),
            size = Size(size.width + outer * 2, size.height + outer * 2),
            cornerRadius = CornerRadius(radius + outer),
        )
        drawRoundRect(
            color = color.copy(alpha = 0.14f + 0.12f * pulse),
            topLeft = Offset(-inner, -inner),
            size = Size(size.width + inner * 2, size.height + inner * 2),
            cornerRadius = CornerRadius(radius + inner),
        )
    }
}

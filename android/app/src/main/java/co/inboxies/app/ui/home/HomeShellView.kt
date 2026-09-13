package co.inboxies.app.ui.home

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.EmailDateFilter
import co.inboxies.app.models.EmailFilterState
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.Mailbox
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
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
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.UndoToastBanner
import co.inboxies.app.ui.compose.ComposeActionItem
import co.inboxies.app.ui.compose.ComposeActionListOverlay
import co.inboxies.app.ui.compose.ComposeDockBar
import co.inboxies.app.ui.compose.ComposeSheetView
import co.inboxies.app.ui.compose.hitTestComposeAction
import co.inboxies.app.ui.email.EmailDetailView
import co.inboxies.app.ui.email.EmailListView
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
    val emails by appModel.emails.collectAsState()
    val isLoading by appModel.isLoading.collectAsState()
    val isDigestLoading by appModel.isDigestLoading.collectAsState()
    val mailboxes by appModel.mailboxes.collectAsState()
    val isMailboxLoading by appModel.isMailboxLoading.collectAsState()
    val authEmail by auth.userEmail.collectAsState()
    val mailbox = appModel.selectedMailbox

    var showSearch by remember { mutableStateOf(false) }
    var showChat by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var showMailboxMenu by remember { mutableStateOf(false) }
    var showAddMailbox by remember { mutableStateOf(false) }
    var isSelectMode by remember { mutableStateOf(false) }
    var selectedEmailIds by remember { mutableStateOf(setOf<String>()) }
    var filterState by remember { mutableStateOf(EmailFilterState()) }
    var showFilterMenu by remember { mutableStateOf(false) }
    var showComposeActions by remember { mutableStateOf(false) }
    var composeActionsDismissible by remember { mutableStateOf(false) }
    var highlightedComposeAction by remember { mutableStateOf<ComposeActionItem?>(null) }
    var composeActionFrames by remember { mutableStateOf<Map<ComposeActionItem, Rect>>(emptyMap()) }
    var tabNavigatingForward by remember { mutableStateOf(true) }
    var newMailboxName by remember { mutableStateOf("") }
    var newMailboxEmail by remember { mutableStateOf("") }

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

    val hasMinimizedCompose = composeSession?.isMinimized == true
    val listBottomInset by animateDpAsState(
        targetValue = HomeChromeMetrics.listBottomInset(hasMinimizedCompose && !isSelectMode),
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
        else -> ""
    }

    fun selectTab(tab: HomeTab) {
        if (selectedTab == tab) return
        if (isSelectMode) {
            isSelectMode = false
            selectedEmailIds = emptySet()
        }
        val current = folderTabs.indexOf(selectedTab).coerceAtLeast(0)
        val next = folderTabs.indexOf(tab).coerceAtLeast(0)
        tabNavigatingForward = next > current
        scope.launch { appModel.selectTab(tab) }
    }

    fun selectAdjacentTab(forward: Boolean) {
        val current = folderTabs.indexOf(selectedTab)
        if (current < 0) return
        val next = if (forward) current + 1 else current - 1
        if (next in folderTabs.indices) selectTab(folderTabs[next])
    }

    fun performComposeAction(item: ComposeActionItem) {
        if (!showComposeActions) return
        showComposeActions = false
        composeActionsDismissible = false
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

    BackHandler(enabled = showSearch || showComposeActions || isSelectMode) {
        when {
            showComposeActions -> {
                showComposeActions = false
                composeActionsDismissible = false
                highlightedComposeAction = null
            }
            showSearch -> showSearch = false
            isSelectMode -> {
                isSelectMode = false
                selectedEmailIds = emptySet()
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        ProgressiveBlurBackground(modifier = Modifier.align(Alignment.TopCenter))

        if (!showSearch) {
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
                            onSettings = {
                                showMailboxMenu = false
                                showSettings = true
                            },
                            onSignOut = {
                                showMailboxMenu = false
                                auth.signOut()
                                appModel.reset()
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
                                    if (abs(dragAccum) >= 40f) {
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
                    AnimatedContent(
                        targetState = selectedTab,
                        transitionSpec = {
                            val forward = tabNavigatingForward
                            (
                                slideInHorizontally { if (forward) 28 else -28 } + fadeIn()
                            ) togetherWith (
                                slideOutHorizontally { if (forward) -18 else 18 } + fadeOut()
                            )
                        },
                        label = "homeTab",
                    ) { tab ->
                        when (tab) {
                            HomeTab.AiInbox -> InboxDigestView(
                                bottomInset = listBottomInset,
                                onRefresh = { appModel.refreshCurrentTab() },
                            )
                            is HomeTab.Folder -> EmailListView(
                                emails = filteredEmails,
                                isLoading = isLoading,
                                bottomInset = listBottomInset,
                                fallbackFolderId = tab.id,
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
                                        )
                                    }
                                } else {
                                    null
                                },
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
            }

            // Bottom chrome
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (hasMinimizedCompose && !isSelectMode) {
                                Modifier.padding(bottom = HomeChromeMetrics.minimizedComposeGap)
                            } else {
                                Modifier
                                    .navigationBarsPadding()
                                    .padding(bottom = HomeChromeMetrics.chromeBottomPadding - 12.dp)
                            }
                        )
                        .animateContentSize(animationSpec = selectModeSpring()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                toast?.let {
                    UndoToastBanner(
                        message = it.message,
                        isError = it.isError,
                        isLoading = it.isLoading,
                        isUndo = it.isUndo,
                        onUndo = { appModel.undoPendingAction() },
                        modifier = Modifier
                            .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding)
                            .padding(bottom = HomeChromeMetrics.chromeSpacing),
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
                        )
                    } else {
                        BottomBar(
                            showComposeActions = showComposeActions,
                            onAskAi = {
                                appModel.openChatSession(resumeActive = true)
                                showChat = true
                            },
                            onComposeTap = {
                                scope.launch { appModel.startCompose(ComposeMode.New) }
                            },
                            onComposeLongPress = {
                                composeActionsDismissible = false
                                view.impactHaptic()
                                showComposeActions = true
                            },
                            onComposeDrag = { point ->
                                if (showComposeActions) {
                                    val hit = hitTestComposeAction(point, composeActionFrames)
                                    if (hit != null) updateComposeHighlight(hit)
                                }
                            },
                            onComposeRelease = { wasLongPress, point ->
                                if (wasLongPress) {
                                    val hit = hitTestComposeAction(point, composeActionFrames)
                                    if (hit != null) {
                                        performComposeAction(hit)
                                    } else {
                                        highlightedComposeAction = null
                                        composeActionsDismissible = true
                                    }
                                }
                            },
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
            ComposeActionListOverlay(
                highlightedId = highlightedComposeAction,
                onSelect = { performComposeAction(it) },
                onDismiss = {
                    showComposeActions = false
                    composeActionsDismissible = false
                    highlightedComposeAction = null
                },
                onHighlightChange = { updateComposeHighlight(it) },
                onRowFramesChange = { composeActionFrames = it },
                dismissEnabled = composeActionsDismissible,
            )
        }

        if (composeSession?.isExpanded == true) {
            ComposeSheetView(
                session = composeSession!!,
                onMinimize = { appModel.minimizeCompose() },
                onClose = { appModel.closeCompose() },
                onSend = { appModel.sendCompose() },
                onSaveDraft = { appModel.saveDraft() },
            )
        }

        if (showChat) {
            ChatSheetView(
                onClose = {
                    showChat = false
                    appModel.dismissChatSession()
                },
            )
        }
    }

    if (selectedEmail != null) {
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

    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
            contentWindowInsets = { WindowInsets(0, 0, 0, 0) },
            dragHandle = null,
        ) {
            SettingsSheetView(
                onClose = { showSettings = false },
                onThemeModeChange = onThemeModeChange,
                themeMode = themeMode,
            )
        }
    }

    if (showAddMailbox) {
        Dialog(onDismissRequest = { showAddMailbox = false }) {
            AddMailboxDialog(
                name = newMailboxName,
                emailLocal = newMailboxEmail,
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
                    scope.launch {
                        appModel.createMailbox(newMailboxName, "$newMailboxEmail@inboxies.email")
                        showAddMailbox = false
                        newMailboxName = ""
                        newMailboxEmail = ""
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
) {
    InboxiesDropdownMenu(expanded = expanded, onDismiss = onDismiss) {
        FilterToggle("Unread", filterState.unreadOnly) {
            onChange(filterState.copy(unreadOnly = it))
        }
        FilterToggle("Starred", filterState.starredOnly) {
            onChange(filterState.copy(starredOnly = it))
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
            FilterChip("Unread") { onChange(filterState.copy(unreadOnly = false)) }
        }
        if (filterState.starredOnly) {
            FilterChip("Starred") { onChange(filterState.copy(starredOnly = false)) }
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
    onAskAi: () -> Unit,
    onComposeTap: () -> Unit,
    onComposeLongPress: () -> Unit,
    onComposeDrag: (Offset) -> Unit,
    onComposeRelease: (wasLongPress: Boolean, point: Offset) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var composeCoords by remember { mutableStateOf<LayoutCoordinates?>(null) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = HomeChromeMetrics.bottomBarHorizontalPadding),
        horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.chromeSpacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .height(HomeChromeMetrics.actionBarHeight)
                .homeChromeToolbarSurface(RoundedCornerShape(50))
                .clickable(onClick = onAskAi)
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

        Box(
            modifier = Modifier
                .size(HomeChromeMetrics.actionBarHeight)
                .homeChromeToolbarSurface(CircleShape)
                .onGloballyPositioned { composeCoords = it }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var longPressTriggered = false
                        val pressJob = scope.launch {
                            delay(100)
                            longPressTriggered = true
                            onComposeLongPress()
                        }
                        try {
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull { it.id == down.id }
                                    ?: event.changes.firstOrNull()
                                    ?: break
                                val rootPos = composeCoords?.localToRoot(change.position)
                                    ?: change.position
                                if (change.pressed) {
                                    if (longPressTriggered) {
                                        onComposeDrag(rootPos)
                                    }
                                    change.consume()
                                } else {
                                    pressJob.cancel()
                                    if (longPressTriggered) {
                                        onComposeDrag(rootPos)
                                        onComposeRelease(true, rootPos)
                                    } else {
                                        onComposeTap()
                                    }
                                    break
                                }
                            }
                        } finally {
                            pressJob.cancel()
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (!showComposeActions) {
                Icon(
                    Icons.Filled.Edit,
                    contentDescription = "Compose",
                    tint = colors.ink,
                    modifier = Modifier
                        .size(18.dp)
                        .offset(x = (-3).dp),
                )
                Icon(
                    Icons.Filled.KeyboardArrowUp,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(end = 7.dp)
                        .size(10.dp),
                )
            }
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
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = emailLocal,
            onValueChange = onEmailChange,
            label = { Text("Username") },
            singleLine = true,
            trailingIcon = {
                Text("@inboxies.email", color = colors.muted, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
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
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = colors.muted)
            }
            TextButton(
                onClick = onCreate,
                enabled = name.isNotBlank() && emailLocal.isNotBlank(),
            ) {
                Text("Create", color = colors.accent)
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

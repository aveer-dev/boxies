package co.inboxies.app.ui.email

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Email
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.MailAddress
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.EmailActionAvailability
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.HomeChromeToolbarCluster
import co.inboxies.app.theme.HomeChromeToolbarClusterItem
import co.inboxies.app.theme.InboxiesPalette
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.TransparentSystemBars
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuHeader
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.search.SearchView
import co.inboxies.app.util.DeliveryStatus
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
fun EmailDetailView(
    onClose: () -> Unit = {},
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val email by app.selectedEmail.collectAsState()
    val thread by app.threadEmails.collectAsState()
    val listEmails by app.emails.collectAsState()
    val loading by app.isEmailDetailLoading.collectAsState()
    val selectedTab by app.selectedTab.collectAsState()
    val current = email ?: return

    val isScreenerEmail = current.folderId == FolderIds.SCREENER ||
        (selectedTab as? HomeTab.Folder)?.id == FolderIds.SCREENER

    val navigable = remember(listEmails) { listEmails.filter { !it.isDraft } }
    val navIndex = navigable.indexOfFirst { it.id == current.id }
    val canOpenPrevious = navIndex > 0
    val canOpenNext = navIndex in 0 until navigable.lastIndex

    val selfAddresses = remember(app.selectedMailbox) {
        setOfNotNull(
            app.selectedMailbox?.email?.lowercase()?.takeIf { it.isNotEmpty() },
            app.selectedMailbox?.id?.lowercase()?.takeIf { it.isNotEmpty() },
        )
    }
    val source = remember(thread, current, selfAddresses) {
        thread.lastOrNull { !it.isDraft && it.sender.lowercase() !in selfAddresses }
            ?: thread.lastOrNull { !it.isDraft }
            ?: current
    }
    val availability = EmailActionAvailability(source)
    val selfAddress = app.selectedMailbox?.email

    var expandedMessageIds by remember { mutableStateOf(setOf<String>()) }
    var expandedRecipientIds by remember { mutableStateOf(setOf<String>()) }
    var toolbarSheetEmail by remember { mutableStateOf<Email?>(null) }
    var messageSheetEmail by remember { mutableStateOf<Email?>(null) }
    var personSearchQuery by remember { mutableStateOf<String?>(null) }
    var showDeleteMenu by remember { mutableStateOf(false) }
    var contextMenuMessage by remember { mutableStateOf<Email?>(null) }

    val subjectText = current.subject.ifBlank { "(no subject)" }
    val messages = thread.ifEmpty { listOf(current) }

    fun seedExpandedMessages() {
        val latest = messages.lastOrNull { !it.isDraft }
        expandedMessageIds = if (latest != null) setOf(latest.id) else emptySet()
    }

    LaunchedEffect(current.id) {
        expandedMessageIds = emptySet()
        expandedRecipientIds = emptySet()
        if (!loading) seedExpandedMessages()
    }

    LaunchedEffect(loading, messages.map { it.id }.joinToString()) {
        if (!loading) seedExpandedMessages()
    }

    val detailTags = remember(current, messages.size) {
        buildList {
            val folderName = current.folderName?.takeIf { it.isNotEmpty() }
            if (folderName != null) {
                add(folderName.replaceFirstChar { it.uppercase() })
            } else {
                val folderId = current.folderId?.takeIf { it.isNotEmpty() }
                if (folderId != null) add(HomeTab.Folder(folderId).title)
            }
            if (current.isUnread) add("Unread")
            if (current.needsReply == true) add("Needs reply")
            if (current.hasDraft == true) add("Has draft")
            if (current.isSpoofed) add("Spoofed")
            current.deliveryStatusLabel?.let { add(it) }
            val messageCount = maxOf(messages.size, current.threadCount ?: 1)
            if (messageCount > 1) add("$messageCount messages")
        }
    }

    // Compact collapse range so expanded title sits close under the toolbar.
    val titleCollapseRangePx = with(density) { 28.dp.toPx() }
    var titleCollapsePx by remember(current.id) { mutableFloatStateOf(0f) }
    val titleCollapseFraction = (titleCollapsePx / titleCollapseRangePx).coerceIn(0f, 1f)
    val titleNestedScroll = remember(titleCollapseRangePx) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                val delta = available.y
                if (delta >= 0f) return Offset.Zero
                val next = (titleCollapsePx - delta).coerceIn(0f, titleCollapseRangePx)
                val consumed = next - titleCollapsePx
                titleCollapsePx = next
                return Offset(0f, -consumed)
            }

            override fun onPostScroll(
                consumed: Offset,
                available: Offset,
                source: NestedScrollSource,
            ): Offset {
                val delta = available.y
                if (delta <= 0f) return Offset.Zero
                val next = (titleCollapsePx - delta).coerceIn(0f, titleCollapseRangePx)
                val consumedY = titleCollapsePx - next
                titleCollapsePx = next
                return Offset(0f, consumedY)
            }

            override suspend fun onPreFling(available: Velocity): Velocity = Velocity.Zero
        }
    }
    val titleSize = lerp(AppThemeDims.FontSize.largeTitle, AppThemeDims.FontSize.inlineTitle, titleCollapseFraction)
    val titleWeight = if (titleCollapseFraction > 0.5f) FontWeight.SemiBold else FontWeight.Bold
    val titleTopPadding = lerp(8.dp, 0.dp, titleCollapseFraction)
    val titleBottomPadding = lerp(4.dp, 2.dp, titleCollapseFraction)

    TransparentSystemBars()

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .nestedScroll(titleNestedScroll),
        containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = {
            Column {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp, bottom = 8.dp),
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
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
                ) {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Close,
                        contentDescription = "Close",
                        onClick = {
                            app.closeEmail()
                            onClose()
                        },
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    HomeChromeToolbarCluster {
                        HomeChromeToolbarClusterItem(
                            icon = Icons.Outlined.KeyboardArrowUp,
                            contentDescription = "Previous email",
                            onClick = { scope.launch { app.openAdjacentEmail(-1) } },
                            enabled = canOpenPrevious,
                            tint = if (canOpenPrevious) colors.ink else colors.muted.copy(alpha = 0.4f),
                        )
                        HomeChromeToolbarClusterItem(
                            icon = Icons.Outlined.KeyboardArrowDown,
                            contentDescription = "Next email",
                            onClick = { scope.launch { app.openAdjacentEmail(1) } },
                            enabled = canOpenNext,
                            tint = if (canOpenNext) colors.ink else colors.muted.copy(alpha = 0.4f),
                        )
                    }
                }
                Text(
                    subjectText,
                    fontFamily = InterFontFamily,
                    fontWeight = titleWeight,
                    fontSize = titleSize,
                    color = colors.ink,
                    maxLines = if (titleCollapseFraction > 0.6f) 1 else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = titleTopPadding, bottom = titleBottomPadding),
                )
            }
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = HomeChromeMetrics.bottomBarHorizontalPadding)
                    .padding(top = 8.dp, bottom = HomeChromeMetrics.chromeBottomPadding),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.chromeSpacing),
            ) {
                HomeChromeToolbarCluster(
                    contentPadding = PaddingValues(horizontal = HomeChromeMetrics.toolbarClusterInnerPadding),
                    itemSpacing = HomeChromeMetrics.toolbarClusterItemSpacing,
                ) {
                    Box {
                        HomeChromeToolbarClusterItem(
                            icon = Icons.Outlined.Delete,
                            contentDescription = "Delete",
                            onClick = { showDeleteMenu = true },
                        )
                        InboxiesDropdownMenu(
                            expanded = showDeleteMenu,
                            onDismiss = { showDeleteMenu = false },
                        ) {
                            InboxiesMenuItem(
                                text = "Delete Message",
                                icon = Icons.Outlined.Delete,
                                destructive = true,
                                onClick = {
                                    showDeleteMenu = false
                                    scope.launch { app.deleteCurrentEmail() }
                                },
                            )
                        }
                    }
                    if (availability.showsArchive) {
                        HomeChromeToolbarClusterItem(
                            icon = Icons.Outlined.Archive,
                            contentDescription = "Archive",
                            onClick = { scope.launch { app.archiveCurrentEmail() } },
                        )
                    }
                    if (availability.showsReplyActions) {
                        HomeChromeToolbarClusterItem(
                            icon = Icons.AutoMirrored.Outlined.Reply,
                            contentDescription = "Reply",
                            onClick = {
                                scope.launch {
                                    app.startCompose(ComposeMode.Reply, original = source)
                                }
                            },
                        )
                    }
                }
                Spacer(modifier = Modifier.weight(1f))
                HomeChromeToolbarButton(
                    icon = Icons.Outlined.MoreHoriz,
                    contentDescription = "More",
                    onClick = { toolbarSheetEmail = current },
                )
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            if (isScreenerEmail) {
                ScreenerTriageBar(
                    email = current,
                    onDone = onClose,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            TagsRow(
                tags = detailTags,
                starred = current.starred,
                loading = loading && detailTags.isEmpty(),
                onToggleStar = { scope.launch { app.toggleStar(current) } },
            )

            if (loading && messages.isEmpty()) {
                DetailSkeleton()
            } else {
                messages.forEachIndexed { index, message ->
                    if (index > 0) {
                        HorizontalDivider(thickness = 1.dp, color = colors.line)
                    }
                    if (message.isDraft) {
                        DraftMessageRow(
                            message = message,
                            onOpen = { scope.launch { app.openDraft(message) } },
                            onDelete = { scope.launch { app.deleteThreadDraft(message) } },
                        )
                    } else {
                        val isExpanded = expandedMessageIds.contains(message.id)
                        val recipientsExpanded = expandedRecipientIds.contains(message.id)
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(colors.background)
                                .then(
                                    if (!isExpanded) {
                                        Modifier.combinedClickable(
                                            onClick = {},
                                            onLongClick = { contextMenuMessage = message },
                                        )
                                    } else {
                                        Modifier
                                    },
                                )
                                .padding(horizontal = 16.dp, vertical = 16.dp),
                        ) {
                            MessagePeopleHeader(
                                message = message,
                                selfAddress = selfAddress,
                                formattedDate = DateUtils.formatDetailDate(message.date),
                                isRecipientsExpanded = recipientsExpanded,
                                isBodyExpanded = isExpanded,
                                onToggleRecipients = {
                                    expandedRecipientIds = if (recipientsExpanded) {
                                        expandedRecipientIds - message.id
                                    } else {
                                        expandedRecipientIds + message.id
                                    }
                                },
                                onToggleBody = {
                                    expandedMessageIds = if (isExpanded) {
                                        expandedMessageIds - message.id
                                    } else {
                                        expandedMessageIds + message.id
                                    }
                                },
                                onShowActions = { messageSheetEmail = message },
                                onSearch = { personSearchQuery = it },
                            )

                            if (message.isSpoofed) {
                                SpoofWarningBanner(
                                    modifier = Modifier.padding(top = 10.dp),
                                )
                            }

                            if (message.isDeliveryFailure) {
                                DeliveryFailureBanner(
                                    title = message.deliveryStatusLabel
                                        ?: DeliveryStatus.label(message.deliveryStatus),
                                    detail = message.deliveryError,
                                    modifier = Modifier.padding(top = 10.dp),
                                )
                            }

                            AnimatedVisibility(
                                visible = isExpanded,
                                enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { 6 },
                                exit = fadeOut(tween(200)) + slideOutVertically(tween(200)) { 6 },
                            ) {
                                Column {
                                    EmailBodyView(
                                        email = message,
                                        modifier = Modifier.padding(top = 20.dp),
                                    )
                                    AttachmentListView(
                                        email = message,
                                        modifier = Modifier.padding(top = 20.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    toolbarSheetEmail?.let { sheetEmail ->
        EmailActionsSheetModal(
            email = sheetEmail,
            onDismiss = { toolbarSheetEmail = null },
            onDone = {
                toolbarSheetEmail = null
                if (app.selectedEmail.value == null) onClose()
            },
        )
    }

    messageSheetEmail?.let { sheetEmail ->
        EmailActionsSheetModal(
            email = sheetEmail,
            onDismiss = { messageSheetEmail = null },
            onDone = {
                messageSheetEmail = null
                if (app.selectedEmail.value == null) onClose()
            },
        )
    }

    personSearchQuery?.let { query ->
        ModalBottomSheet(
            onDismissRequest = { personSearchQuery = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = colors.background,
            scrimColor = HomeChromeMetrics.modalScrim,
        ) {
            SearchView(
                onClose = { personSearchQuery = null },
                initialQuery = query,
                onOpenEmail = { opened ->
                    scope.launch {
                        personSearchQuery = null
                        app.openEmail(opened)
                    }
                },
            )
        }
    }

    contextMenuMessage?.let { message ->
        MessageContextMenu(
            message = message,
            onDismiss = { contextMenuMessage = null },
            onReply = {
                contextMenuMessage = null
                scope.launch { app.startCompose(ComposeMode.Reply, original = message) }
            },
            onReplyAll = {
                contextMenuMessage = null
                scope.launch { app.startCompose(ComposeMode.ReplyAll, original = message) }
            },
            onForward = {
                contextMenuMessage = null
                scope.launch { app.startCompose(ComposeMode.Forward, original = message) }
            },
            onToggleStar = {
                contextMenuMessage = null
                scope.launch { app.toggleStar(message) }
            },
            onToggleRead = {
                contextMenuMessage = null
                scope.launch { app.toggleRead(message) }
            },
            onMore = {
                contextMenuMessage = null
                messageSheetEmail = message
            },
            onDelete = {
                contextMenuMessage = null
                scope.launch { app.deleteEmail(message) }
            },
        )
    }
}

@Composable
private fun TagsRow(
    tags: List<String>,
    starred: Boolean,
    loading: Boolean,
    onToggleStar: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp, bottom = 12.dp),
    ) {
        if (loading) {
            repeat(3) { TagChip("Folder") }
        } else {
            if (starred) {
                IconButton(
                    onClick = onToggleStar,
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        Icons.Filled.Star,
                        contentDescription = "Unstar",
                        tint = Color(0xFFFFC107),
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            tags.forEach { TagChip(it, destructive = it == "Spoofed") }
        }
    }
}

@Composable
private fun TagChip(title: String, destructive: Boolean = false) {
    val colors = inboxiesColors()
    Text(
        title,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        color = if (destructive) colors.deepDarkRed else colors.muted,
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(colors.pillFill)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun ScreenerTriageBar(
    email: Email,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var picking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val destinations = listOf(
        FolderIds.INBOX to "Inbox",
        FolderIds.PROMOTIONS to "Promotions",
        FolderIds.UPDATES to "Updates",
    )

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(0.5.dp, colors.line, RoundedCornerShape(12.dp))
            .background(colors.surface)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "New sender — approve where their mail should go, or screen them out privately.",
            fontFamily = InterFontFamily,
            fontSize = AppThemeDims.FontSize.meta,
            color = colors.muted,
        )
        if (picking) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                destinations.forEach { (id, title) ->
                    val primary = id == FolderIds.INBOX
                    Text(
                        title,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = AppThemeDims.FontSize.meta,
                        color = if (primary) colors.surface else colors.ink,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(if (primary) colors.ink else colors.pillFill)
                            .clickable(enabled = !busy) {
                                scope.launch {
                                    busy = true
                                    app.approveScreenerSender(email, id)
                                    busy = false
                                    onDone()
                                }
                            }
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
                Text(
                    "Cancel",
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.FontSize.meta,
                    color = colors.muted,
                    modifier = Modifier
                        .clickable(enabled = !busy) { picking = false }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                )
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "Approve",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = AppThemeDims.FontSize.meta,
                    color = colors.surface,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(colors.ink)
                        .clickable(enabled = !busy) { picking = true }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
                Text(
                    "Reject",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = AppThemeDims.FontSize.meta,
                    color = colors.ink,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(colors.pillFill)
                        .clickable(enabled = !busy) {
                            scope.launch {
                                busy = true
                                app.rejectScreenerSender(email)
                                busy = false
                                onDone()
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun SpoofWarningBanner(modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, colors.deepDarkRed.copy(alpha = 0.35f), RoundedCornerShape(8.dp))
            .background(colors.pillFill)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            "This sender isn’t authenticated.",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.meta,
            color = colors.deepDarkRed,
        )
        Text(
            "The From address failed SPF/DKIM/DMARC alignment.",
            fontFamily = InterFontFamily,
            fontSize = AppThemeDims.FontSize.meta,
            color = colors.muted,
        )
    }
}

@Composable
private fun DeliveryFailureBanner(
    title: String,
    detail: String?,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val warning = Color(0xFFFFC107)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, warning.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
            .background(colors.pillFill)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.meta,
            color = warning,
        )
        if (!detail.isNullOrBlank()) {
            Text(
                detail,
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.FontSize.meta,
                color = colors.muted,
            )
        }
    }
}

@Composable
private fun DetailSkeleton() {
    val colors = inboxiesColors()
    Column {
        repeat(2) { index ->
            if (index > 0) {
                HorizontalDivider(thickness = 1.dp, color = colors.line)
            }
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(modifier = Modifier.fillMaxWidth()) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(16.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(colors.line),
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Box(
                        modifier = Modifier
                            .width(80.dp)
                            .height(14.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(colors.line),
                    )
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.55f)
                        .height(14.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(colors.line),
                )
                Spacer(modifier = Modifier.height(8.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(60.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(colors.line),
                )
            }
        }
    }
}

@Composable
private fun DraftMessageRow(
    message: Email,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var showConfirm by remember { mutableStateOf(false) }
    val preview = message.previewText

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Column(
            modifier = Modifier
                .weight(1f)
                .clickable(onClick = onOpen),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    "Draft",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                    color = colors.deepDarkRed,
                )
                if (message.hasFileAttachment) {
                    Icon(
                        Icons.Outlined.AttachFile,
                        contentDescription = "Has attachment",
                        tint = colors.muted,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
            if (preview.isNotEmpty()) {
                Text(
                    preview,
                    fontFamily = InterFontFamily,
                    fontSize = 11.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        IconButton(onClick = { showConfirm = true }) {
            Icon(Icons.Outlined.Delete, contentDescription = "Delete draft", tint = colors.muted)
        }
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Draft") },
            text = { Text("Delete this draft?") },
            confirmButton = {
                TextButton(onClick = {
                    showConfirm = false
                    onDelete()
                }) {
                    Text("Delete Draft", color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirm = false }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MessagePeopleHeader(
    message: Email,
    selfAddress: String?,
    formattedDate: String,
    isRecipientsExpanded: Boolean,
    isBodyExpanded: Boolean,
    onToggleRecipients: () -> Unit,
    onToggleBody: () -> Unit,
    onShowActions: () -> Unit,
    onSearch: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val senderOrToAction = {
        if (isBodyExpanded) onToggleRecipients() else onToggleBody()
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(if (isRecipientsExpanded) 8.dp else 2.dp),
    ) {
        if (isRecipientsExpanded) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    "From",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.FontSize.recipient,
                    color = colors.muted,
                    modifier = Modifier.width(32.dp),
                )
                PersonAddressPill(
                    address = message.fromAddress,
                    selfAddress = selfAddress,
                    onSearch = onSearch,
                )
                message.deliveryStatusLabel?.let { label ->
                    DeliveryStatusChip(label = label, colors = colors)
                }
                Spacer(modifier = Modifier.weight(1f))
                DateAndToggle(
                    message = message,
                    formattedDate = formattedDate,
                    isRecipientsExpanded = true,
                    onToggleRecipients = onToggleRecipients,
                    onShowActions = onShowActions,
                )
            }
            AddressDetailRow("To", message.toAddresses, selfAddress, onSearch)
            AddressDetailRow("Cc", message.ccAddresses, selfAddress, onSearch)
            AddressDetailRow("Bcc", message.bccAddresses, selfAddress, onSearch)
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(onClick = senderOrToAction),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        message.fromAddress.label(selfAddress),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = AppThemeDims.FontSize.sender,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    message.deliveryStatusLabel?.let { label ->
                        DeliveryStatusChip(label = label, colors = colors)
                    }
                }
                DateAndToggle(
                    message = message,
                    formattedDate = formattedDate,
                    isRecipientsExpanded = false,
                    onToggleRecipients = onToggleRecipients,
                    onShowActions = onShowActions,
                )
            }
            val summary = message.recipientSummary(selfAddress)
            if (summary.isNotEmpty()) {
                Text(
                    "To $summary",
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.FontSize.recipient,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = senderOrToAction),
                )
            }
        }
    }
}

@Composable
private fun DeliveryStatusChip(
    label: String,
    colors: InboxiesPalette,
) {
    Text(
        label,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        color = Color(0xFFFFC107),
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(colors.pillFill)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

@Composable
private fun DateAndToggle(
    message: Email,
    formattedDate: String,
    isRecipientsExpanded: Boolean,
    onToggleRecipients: () -> Unit,
    onShowActions: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (message.hasFileAttachment) {
            Icon(
                Icons.Outlined.AttachFile,
                contentDescription = "Has attachment",
                tint = colors.muted,
                modifier = Modifier.size(12.dp),
            )
        }
        IconButton(
            onClick = onShowActions,
            modifier = Modifier.size(32.dp),
        ) {
            Icon(
                Icons.Outlined.MoreVert,
                contentDescription = "Message options",
                tint = colors.muted,
                modifier = Modifier.size(16.dp),
            )
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.clickable(onClick = onToggleRecipients),
        ) {
            Text(
                formattedDate,
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.FontSize.meta,
                color = colors.muted,
                maxLines = 1,
            )
            Icon(
                if (isRecipientsExpanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddressDetailRow(
    label: String,
    addresses: List<MailAddress>,
    selfAddress: String?,
    onSearch: (String) -> Unit,
) {
    if (addresses.isEmpty()) return
    val colors = inboxiesColors()
    val unique = addresses.distinctBy { it.id }
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.meta,
            color = colors.muted,
            modifier = Modifier
                .width(32.dp)
                .padding(top = 4.dp),
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.weight(1f),
        ) {
            unique.forEach { address ->
                PersonAddressPill(address = address, selfAddress = selfAddress, onSearch = onSearch)
            }
        }
    }
}

@Composable
private fun PersonAddressPill(
    address: MailAddress,
    selfAddress: String?,
    onSearch: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }

    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .background(colors.pillFill)
                .clickable { expanded = true }
                .padding(start = 8.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
        ) {
            Text(
                address.label(selfAddress),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = AppThemeDims.FontSize.meta,
                color = colors.muted,
                maxLines = 1,
            )
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(8.dp),
            )
        }
        InboxiesDropdownMenu(
            expanded = expanded,
            onDismiss = { expanded = false },
        ) {
            InboxiesMenuHeader(
                title = address.resolvedName,
                subtitle = address.email,
            )
            InboxiesMenuDivider()
            InboxiesMenuItem(
                text = "Copy Address",
                icon = Icons.Outlined.ContentCopy,
                onClick = {
                    expanded = false
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("email", address.email))
                },
            )
            InboxiesMenuItem(
                text = "Search Name",
                icon = Icons.Outlined.Search,
                onClick = {
                    expanded = false
                    onSearch(address.searchQuery)
                },
            )
        }
    }
}

@Composable
private fun MessageContextMenu(
    message: Email,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onReplyAll: () -> Unit,
    onForward: () -> Unit,
    onToggleStar: () -> Unit,
    onToggleRead: () -> Unit,
    onMore: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    val availability = EmailActionAvailability(message)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(message.fromAddress.resolvedName, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            Column {
                if (availability.showsReplyActions) {
                    TextButton(onClick = onReply, modifier = Modifier.fillMaxWidth()) {
                        Text("Reply", modifier = Modifier.fillMaxWidth())
                    }
                    TextButton(onClick = onReplyAll, modifier = Modifier.fillMaxWidth()) {
                        Text("Reply All", modifier = Modifier.fillMaxWidth())
                    }
                    TextButton(onClick = onForward, modifier = Modifier.fillMaxWidth()) {
                        Text("Forward", modifier = Modifier.fillMaxWidth())
                    }
                    HorizontalDivider(color = colors.line)
                }
                TextButton(onClick = onToggleStar, modifier = Modifier.fillMaxWidth()) {
                    Text(if (message.starred) "Unstar" else "Star", modifier = Modifier.fillMaxWidth())
                }
                TextButton(onClick = onToggleRead, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (message.read) "Mark as Unread" else "Mark as Read",
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                HorizontalDivider(color = colors.line)
                TextButton(onClick = onMore, modifier = Modifier.fillMaxWidth()) {
                    Text("More Options…", modifier = Modifier.fillMaxWidth())
                }
                if (availability.showsDelete) {
                    TextButton(onClick = onDelete, modifier = Modifier.fillMaxWidth()) {
                        Text("Delete Message", color = colors.deepDarkRed, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

/** Sent message with bounce — mirrors iOS `PreviewSupport.bouncedSentEmail`. */
private val bouncedSentEmailFixture = Email(
    id = "preview-bounced",
    folderId = "sent",
    subject = "Invoice attached",
    sender = "you@inboxies.email",
    senderName = "Alex Rivera",
    recipient = "client@example.com",
    date = "2026-09-18T16:00:00.000Z",
    read = true,
    starred = false,
    body = "<p>Please find the invoice attached.</p>",
    snippet = "Please find the invoice attached.",
    folderName = "Sent",
    deliveryStatus = "bounced",
    deliveryError = "550 5.1.1 The email account that you tried to reach does not exist.",
)

@Preview(showBackground = true, name = "EmailDetail bounced delivery")
@Composable
private fun EmailDetailBouncedDeliveryPreview() {
    val model = remember {
        AppModel().also { it.seedOpenThreadForPreview(bouncedSentEmailFixture) }
    }
    InboxiesTheme {
        CompositionLocalProvider(LocalAppModel provides model) {
            EmailDetailView(onClose = {})
        }
    }
}

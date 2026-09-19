package co.inboxies.app.ui.email

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.ReplyAll
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.automirrored.outlined.Forward
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Email
import co.inboxies.app.services.EmailActionAvailability
import co.inboxies.app.services.EmailSwipeLayout
import co.inboxies.app.services.SwipeQuickAction
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun EmailListView(
    emails: List<Email>,
    isLoading: Boolean,
    onOpen: (Email) -> Unit,
    onRefresh: (suspend () -> Unit)? = null,
    bottomInset: Dp = HomeChromeMetrics.listBottomInset(false),
    isSelectMode: Boolean = false,
    selectedEmailIds: Set<String> = emptySet(),
    onToggleSelect: ((String) -> Unit)? = null,
    isFiltered: Boolean = false,
    onClearFilters: (() -> Unit)? = null,
    filterChipsBar: (@Composable () -> Unit)? = null,
    highlightQuery: String = "",
    folderLabel: String? = null,
    fallbackFolderId: String? = null,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var actionsEmail by remember { mutableStateOf<Email?>(null) }

    val content: @Composable () -> Unit = {
        when {
            isLoading && emails.isEmpty() -> SkeletonList(bottomInset = bottomInset)
            emails.isEmpty() -> EmptyList(
                isFiltered = isFiltered,
                onClearFilters = onClearFilters,
                filterChipsBar = filterChipsBar,
                bottomInset = bottomInset,
            )
            else -> EmailRows(
                emails = emails,
                bottomInset = bottomInset,
                isSelectMode = isSelectMode,
                selectedEmailIds = selectedEmailIds,
                onToggleSelect = onToggleSelect,
                filterChipsBar = filterChipsBar,
                highlightQuery = highlightQuery,
                folderLabel = folderLabel,
                fallbackFolderId = fallbackFolderId,
                onOpen = onOpen,
                onMore = { actionsEmail = it },
            )
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background),
    ) {
        if (onRefresh != null) {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        try {
                            onRefresh()
                        } finally {
                            refreshing = false
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                content()
            }
        } else {
            content()
        }
    }

    actionsEmail?.let { email ->
        EmailActionsSheetModal(
            email = email,
            onDismiss = { actionsEmail = null },
            onDone = { actionsEmail = null },
        )
    }
}

@Composable
private fun EmailRows(
    emails: List<Email>,
    bottomInset: Dp,
    isSelectMode: Boolean,
    selectedEmailIds: Set<String>,
    onToggleSelect: ((String) -> Unit)?,
    filterChipsBar: (@Composable () -> Unit)?,
    highlightQuery: String,
    folderLabel: String?,
    fallbackFolderId: String?,
    onOpen: (Email) -> Unit,
    onMore: (Email) -> Unit,
) {
    val app = LocalAppModel.current
    val swipePreferences by app.swipePreferences.collectAsState()

    LazyColumn(
        contentPadding = PaddingValues(top = 12.dp, bottom = bottomInset),
        modifier = Modifier.fillMaxSize(),
        userScrollEnabled = true,
    ) {
        if (filterChipsBar != null) {
            item {
                Box(modifier = Modifier.padding(bottom = 4.dp)) {
                    filterChipsBar()
                }
            }
        }
        items(emails, key = { it.id }) { email ->
            val isSelected = selectedEmailIds.contains(email.id)
            val layout = remember(email.id, email.folderId, fallbackFolderId, swipePreferences) {
                EmailSwipeLayout.resolve(email, fallbackFolderId, swipePreferences)
            }
            MailRow(
                email = email,
                highlightQuery = highlightQuery,
                folderLabel = folderLabel,
                isSelectMode = isSelectMode,
                isSelected = isSelected,
                layout = layout,
                onOpen = { onOpen(email) },
                onToggleSelect = { onToggleSelect?.invoke(email.id) },
                onMore = { onMore(email) },
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MailRow(
    email: Email,
    highlightQuery: String,
    folderLabel: String?,
    isSelectMode: Boolean,
    isSelected: Boolean,
    layout: EmailSwipeLayout,
    onOpen: () -> Unit,
    onToggleSelect: () -> Unit,
    onMore: () -> Unit,
) {
    val colors = inboxiesColors()
    val app = LocalAppModel.current
    val scope = rememberCoroutineScope()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    var showMenu by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer { alpha = if (pressed) 0.55f else 1f },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(
            visible = isSelectMode,
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
                Icon(
                    if (isSelected) Icons.Filled.CheckCircle else Icons.Outlined.Circle,
                    contentDescription = if (isSelected) "Selected" else "Not selected",
                    tint = if (isSelected) colors.ink else colors.muted.copy(alpha = 0.6f),
                    modifier = Modifier
                        .padding(start = 12.dp)
                        .size(20.dp),
                )
                Spacer(Modifier.width(8.dp))
            }
        }

        Box(modifier = Modifier.weight(1f)) {
            MailSwipeRow(
                email = email,
                layout = layout,
                enabled = !isSelectMode,
                onAction = { action ->
                    scope.launch { app.performSwipeAction(action, email) }
                },
                onMore = onMore,
            ) {
                EmailRowView(
                    email = email,
                    highlightQuery = highlightQuery,
                    folderLabel = folderLabel,
                    modifier = Modifier
                        .fillMaxWidth()
                        .combinedClickable(
                            interactionSource = interaction,
                            indication = null,
                            onClick = {
                                if (isSelectMode) onToggleSelect() else onOpen()
                            },
                            onLongClick = {
                                if (!isSelectMode) showMenu = true
                            },
                        ),
                )
            }

            InboxiesDropdownMenu(
                expanded = showMenu,
                onDismiss = { showMenu = false },
            ) {
                val availability = EmailActionAvailability(email)
                if (availability.showsReplyActions) {
                    InboxiesMenuItem(
                        text = "Reply",
                        icon = Icons.AutoMirrored.Outlined.Reply,
                        onClick = {
                            showMenu = false
                            scope.launch { app.startCompose(ComposeMode.Reply, original = email) }
                        },
                    )
                    InboxiesMenuItem(
                        text = "Reply All",
                        icon = Icons.AutoMirrored.Outlined.ReplyAll,
                        onClick = {
                            showMenu = false
                            scope.launch { app.startCompose(ComposeMode.ReplyAll, original = email) }
                        },
                    )
                    InboxiesMenuItem(
                        text = "Forward",
                        icon = Icons.AutoMirrored.Outlined.Forward,
                        onClick = {
                            showMenu = false
                            scope.launch { app.startCompose(ComposeMode.Forward, original = email) }
                        },
                    )
                    InboxiesMenuDivider()
                }
                InboxiesMenuItem(
                    text = if (email.starred) "Unstar" else "Star",
                    icon = if (email.starred) Icons.Filled.Star else Icons.Outlined.StarBorder,
                    onClick = {
                        showMenu = false
                        scope.launch { app.toggleStar(email) }
                    },
                )
                InboxiesMenuItem(
                    text = if (email.read) "Mark as Unread" else "Mark as Read",
                    icon = if (email.read) Icons.Outlined.MarkEmailUnread else Icons.Outlined.MarkEmailRead,
                    onClick = {
                        showMenu = false
                        scope.launch { app.toggleRead(email) }
                    },
                )
                InboxiesMenuDivider()
                InboxiesMenuItem(
                    text = "More Options…",
                    icon = Icons.Outlined.MoreHoriz,
                    onClick = {
                        showMenu = false
                        onMore()
                    },
                )
                if (availability.showsDelete) {
                    InboxiesMenuDivider()
                    InboxiesMenuItem(
                        text = "Delete Message",
                        icon = Icons.Outlined.Delete,
                        destructive = true,
                        onClick = {
                            showMenu = false
                            scope.launch { app.deleteEmail(email) }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun MailSwipeRow(
    email: Email,
    layout: EmailSwipeLayout,
    enabled: Boolean,
    onAction: (SwipeQuickAction) -> Unit,
    onMore: () -> Unit,
    content: @Composable () -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val actionWidth = AppThemeDims.List.actionWidth
    val leadingCount = layout.leadingActions.size + if (layout.showsMore) 1 else 0
    val trailingCount = layout.trailingActions.size
    val leadingWidthPx = with(density) { (actionWidth * leadingCount).toPx() }
    val trailingWidthPx = with(density) { (actionWidth * trailingCount).toPx() }
    val fullSwipeExtra = with(density) { 48.dp.toPx() }
    val offsetX = remember(email.id) { Animatable(0f) }

    LaunchedEffect(enabled) {
        if (!enabled) offsetX.animateTo(0f)
    }

    val minOffset = if (trailingCount > 0) -trailingWidthPx - fullSwipeExtra else 0f
    val maxOffset = if (leadingCount > 0) leadingWidthPx + fullSwipeExtra else 0f
    val dragState = rememberDraggableState { delta ->
        val next = (offsetX.value + delta).coerceIn(minOffset, maxOffset)
        scope.launch { offsetX.snapTo(next) }
    }

    fun settle(velocity: Float) {
        scope.launch {
            val x = offsetX.value
            when {
                layout.trailingAllowsFullSwipe &&
                    layout.trailingActions.isNotEmpty() &&
                    (x <= -trailingWidthPx - fullSwipeExtra * 0.45f || (velocity < -1400f && x < -trailingWidthPx * 0.4f)) -> {
                    val action = layout.trailingActions.first()
                    offsetX.animateTo(minOffset, tween(120))
                    onAction(action)
                    if (action != SwipeQuickAction.DELETE && action != SwipeQuickAction.ARCHIVE) {
                        offsetX.animateTo(0f)
                    }
                }
                layout.leadingAllowsFullSwipe &&
                    layout.leadingActions.isNotEmpty() &&
                    (x >= leadingWidthPx + fullSwipeExtra * 0.45f || (velocity > 1400f && x > leadingWidthPx * 0.4f)) -> {
                    val action = layout.leadingActions.first()
                    offsetX.animateTo(maxOffset, tween(120))
                    onAction(action)
                    if (action != SwipeQuickAction.DELETE && action != SwipeQuickAction.ARCHIVE) {
                        offsetX.animateTo(0f)
                    }
                }
                trailingCount > 0 && x < -trailingWidthPx * 0.45f -> offsetX.animateTo(-trailingWidthPx)
                leadingCount > 0 && x > leadingWidthPx * 0.45f -> offsetX.animateTo(leadingWidthPx)
                else -> offsetX.animateTo(0f)
            }
        }
    }

    Box(modifier = Modifier.fillMaxWidth().clip(RectangleShape)) {
        if (abs(offsetX.value) > 0.5f) {
            Row(modifier = Modifier.matchParentSize()) {
                if (offsetX.value > 0f) {
                    layout.leadingActions.forEach { action ->
                        SwipeActionCell(
                            label = action.label(email),
                            icon = action.icon(email),
                            color = action.tint(colors),
                            width = actionWidth,
                            onClick = {
                                scope.launch { offsetX.animateTo(0f) }
                                onAction(action)
                            },
                        )
                    }
                    if (layout.showsMore) {
                        SwipeActionCell(
                            label = "More",
                            icon = Icons.Outlined.MoreHoriz,
                            color = colors.muted,
                            width = actionWidth,
                            onClick = {
                                scope.launch { offsetX.animateTo(0f) }
                                onMore()
                            },
                        )
                    }
                    Spacer(Modifier.weight(1f))
                } else {
                    Spacer(Modifier.weight(1f))
                    layout.trailingActions.forEach { action ->
                        SwipeActionCell(
                            label = action.label(email),
                            icon = action.icon(email),
                            color = action.tint(colors),
                            width = actionWidth,
                            onClick = {
                                scope.launch { offsetX.animateTo(0f) }
                                onAction(action)
                            },
                        )
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .background(colors.background)
                .draggable(
                    orientation = Orientation.Horizontal,
                    enabled = enabled,
                    state = dragState,
                    onDragStopped = { velocity -> settle(velocity) },
                )
                .clickable(
                    enabled = abs(offsetX.value) > 8f,
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) {
                    scope.launch { offsetX.animateTo(0f) }
                },
        ) {
            content()
        }
    }
}

@Composable
private fun SwipeActionCell(
    label: String,
    icon: ImageVector,
    color: Color,
    width: Dp,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .width(width)
            .fillMaxHeight()
            .background(color)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
        Text(
            label,
            color = Color.White,
            fontFamily = InterFontFamily,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun EmptyList(
    isFiltered: Boolean,
    onClearFilters: (() -> Unit)?,
    filterChipsBar: (@Composable () -> Unit)?,
    bottomInset: Dp,
) {
    val colors = inboxiesColors()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = bottomInset),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (filterChipsBar != null) {
            item { filterChipsBar() }
        }
        item {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = if (isFiltered) 32.dp else 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    if (isFiltered) Icons.Outlined.FilterList else Icons.Outlined.Inbox,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(40.dp),
                )
                Text(
                    if (isFiltered) "No matching emails" else "No emails",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                )
                Text(
                    if (isFiltered) "No emails match your active filters." else "This folder is empty.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                if (isFiltered && onClearFilters != null) {
                    Button(
                        onClick = onClearFilters,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.background,
                        ),
                    ) {
                        Text("Clear Filters", fontFamily = InterFontFamily)
                    }
                }
            }
        }
    }
}

@Composable
private fun SkeletonList(bottomInset: Dp) {
    val colors = inboxiesColors()
    val list = AppThemeDims.List
    val pulse = rememberInfiniteTransition(label = "skeleton")
    val alpha by pulse.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(950), RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    val senderWidths = listOf(128, 156, 112, 140, 168, 120, 148, 104, 136)
    val subjectWidths = listOf(220, 176, 248, 196, 164, 232, 188, 210, 154)
    val previewWidths = listOf(260, 210, 284, 198, 246, 172, 268, 224, 190)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .semantics { contentDescription = "Loading emails" },
        contentPadding = PaddingValues(top = 12.dp, bottom = bottomInset),
        userScrollEnabled = false,
    ) {
        items(9) { index ->
            Box(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = list.rowHorizontalPadding, vertical = list.rowVerticalPadding),
                    verticalAlignment = Alignment.Top,
                ) {
                    Box(
                        modifier = Modifier
                            .height(list.unreadDotLineHeight)
                            .width(list.unreadDotSize),
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(list.unreadDotSize)
                                .clip(CircleShape)
                                .background(colors.pillActive.copy(alpha = alpha)),
                        )
                    }
                    Spacer(Modifier.width(list.dotToText))
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(list.rowTextSpacing),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            SkeletonBar(senderWidths[index].dp, list.sender.value.dp, alpha)
                            Spacer(Modifier.weight(1f))
                            SkeletonBar(44.dp, list.date.value.dp, alpha)
                        }
                        SkeletonBar(subjectWidths[index].dp, list.subject.value.dp, alpha)
                        SkeletonBar(previewWidths[index].dp, list.preview.value.dp, alpha)
                    }
                }
                HorizontalDivider(
                    color = colors.line.copy(alpha = 0.65f),
                    thickness = list.separatorHeight,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(
                            start = list.separatorLeadingInset,
                            end = list.rowHorizontalPadding,
                        ),
                )
            }
        }
    }
}

@Composable
private fun SkeletonBar(width: Dp, height: Dp, alpha: Float) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .width(width)
            .height(height)
            .clip(RoundedCornerShape(4.dp))
            .background(colors.pillActive.copy(alpha = alpha)),
    )
}

@Composable
fun EmailRowView(
    email: Email,
    highlightQuery: String = "",
    folderLabel: String? = null,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val list = AppThemeDims.List
    val previewText = email.previewText
    val tags = rowTags(email, highlightQuery, folderLabel)
    val senderWeight = if (email.isUnread) FontWeight.Medium else FontWeight.Normal
    val subjectWeight = if (email.isUnread) FontWeight.Medium else FontWeight.Normal

    Box(modifier = modifier.fillMaxWidth().background(colors.background)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = list.rowHorizontalPadding,
                    vertical = list.rowVerticalPadding,
                ),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                modifier = Modifier
                    .height(list.unreadDotLineHeight)
                    .width(list.unreadDotSize)
                    .semantics { contentDescription = if (email.isUnread) "Unread" else "Read" },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(list.unreadDotSize)
                        .clip(CircleShape)
                        .background(if (email.isUnread) colors.unread else colors.pillActive),
                )
            }

            Spacer(Modifier.width(list.dotToText))

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(list.rowTextSpacing),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    HighlightedText(
                        text = email.displaySender,
                        query = highlightQuery,
                        fontSizeSp = list.sender,
                        weight = senderWeight,
                        color = colors.ink,
                        modifier = Modifier.weight(1f, fill = false),
                    )

                    if ((email.threadCount ?: 1) > 1) {
                        Text(
                            "${email.threadCount}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = list.badge,
                            color = colors.muted,
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(colors.pillFill)
                                .padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }

                    if (email.hasDraft == true) {
                        Text(
                            "Draft",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = list.badge,
                            color = colors.deepDarkRed,
                        )
                    }
                    if (email.isSpoofed) {
                        Text(
                            "Spoofed",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = list.badge,
                            color = colors.deepDarkRed,
                        )
                    }
                }

                Spacer(Modifier.width(8.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    if (email.hasFileAttachment) {
                        Icon(
                            Icons.Outlined.AttachFile,
                            contentDescription = "Has attachment",
                            tint = colors.muted,
                            modifier = Modifier.size(list.badge.value.dp),
                        )
                    }
                    if (email.starred) {
                        Icon(
                            Icons.Filled.Star,
                            contentDescription = "Starred",
                            tint = Color(0xFFFFD54F),
                            modifier = Modifier.size(list.badge.value.dp),
                        )
                    }
                    Text(
                        DateUtils.formatListDate(email.date),
                        fontFamily = InterFontFamily,
                        fontSize = list.date,
                        color = colors.muted,
                    )
                }
            }

            HighlightedText(
                text = email.subject.ifBlank { "(no subject)" },
                query = highlightQuery,
                fontSizeSp = list.subject,
                weight = subjectWeight,
                color = colors.ink,
            )

            if (previewText.isNotEmpty()) {
                HighlightedText(
                    text = previewText,
                    query = highlightQuery,
                    fontSizeSp = list.preview,
                    weight = FontWeight.Normal,
                    color = colors.muted,
                )
            }

            if (tags.isNotEmpty()) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 3.dp),
                ) {
                    tags.forEach { tag ->
                        Text(
                            tag,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = list.badge,
                            color = if (tag == "Spoofed") colors.deepDarkRed else colors.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(colors.pillFill)
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                    }
                }
            }
        }
        }

        HorizontalDivider(
            color = colors.line.copy(alpha = 0.65f),
            thickness = list.separatorHeight,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(
                    start = list.separatorLeadingInset,
                    end = list.rowHorizontalPadding,
                ),
        )
    }
}

@Composable
private fun HighlightedText(
    text: String,
    query: String,
    fontSizeSp: androidx.compose.ui.unit.TextUnit,
    weight: FontWeight,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val annotated = remember(text, query, weight, color, colors.ink) {
        highlightedString(text, query, weight, color, colors.ink)
    }
    Text(
        annotated,
        fontFamily = InterFontFamily,
        fontSize = fontSizeSp,
        letterSpacing = AppThemeDims.List.tracking,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

private fun highlightedString(
    text: String,
    query: String,
    weight: FontWeight,
    color: Color,
    ink: Color,
) = buildAnnotatedString {
    val needle = query.trim()
    if (needle.isEmpty()) {
        withStyle(SpanStyle(fontWeight = weight, color = color)) {
            append(text)
        }
        return@buildAnnotatedString
    }
    val lower = text.lowercase()
    val target = needle.lowercase()
    var start = 0
    while (start < text.length) {
        val index = lower.indexOf(target, start)
        if (index < 0) {
            withStyle(SpanStyle(fontWeight = weight, color = color)) {
                append(text.substring(start))
            }
            break
        }
        if (index > start) {
            withStyle(SpanStyle(fontWeight = weight, color = color)) {
                append(text.substring(start, index))
            }
        }
        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = ink)) {
            append(text.substring(index, index + target.length))
        }
        start = index + target.length
    }
}

private fun rowTags(email: Email, highlightQuery: String, folderLabel: String?): List<String> {
    val tags = mutableListOf<String>()
    if (!folderLabel.isNullOrEmpty()) {
        tags += folderLabel
    } else if (highlightQuery.trim().isNotEmpty()) {
        val folderName = email.folderName
        if (!folderName.isNullOrEmpty()) {
            tags += folderName.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        }
    }
    if (email.needsReply == true) tags += "Needs reply"
    if (email.isSpoofed) tags += "Spoofed"
    return tags
}

private fun <T> selectModeSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

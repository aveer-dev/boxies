package co.inboxies.app.ui.email

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ForwardToInbox
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.automirrored.outlined.ReplyAll
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.services.EmailActionAvailability
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.launch

/** Medium-height actions sheet host — matches iOS detent height, not a full-screen sheet. */
@Composable
fun EmailActionsSheetModal(
    email: Email,
    onDismiss: () -> Unit,
    onDone: () -> Unit = onDismiss,
    onRemoveFromList: ((String) -> Unit)? = null,
) {
    val colors = inboxiesColors()
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(HomeChromeMetrics.modalScrim)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onDismiss,
                    ),
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(colors.background)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {},
                    )
                    .navigationBarsPadding()
                    .padding(top = 20.dp, bottom = 20.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp),
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
                EmailActionsSheet(
                    email = email,
                    onDismiss = onDismiss,
                    onDone = onDone,
                    onRemoveFromList = onRemoveFromList,
                )
            }
        }
    }
}

@Composable
fun EmailActionsSheet(
    email: Email,
    onDismiss: () -> Unit,
    onDone: () -> Unit = onDismiss,
    onRemoveFromList: ((String) -> Unit)? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val folders by app.folders.collectAsState()
    val availability = EmailActionAvailability(email)
    val fromList = onRemoveFromList != null
    val moveTargets = folders.filter { it.id != email.folderId }

    var screen by remember { mutableStateOf(ActionsScreen.Main) }
    var showDeleteMenu by remember { mutableStateOf(false) }

    AnimatedContent(
        targetState = screen,
        modifier = Modifier.fillMaxWidth(),
        transitionSpec = {
            val forward = initialState == ActionsScreen.Main
            (
                slideInHorizontally(sheetNavSpring()) { full ->
                    if (forward) full / 4 else -full / 4
                } + fadeIn(sheetNavSpring())
            ) togetherWith (
                slideOutHorizontally(sheetNavSpring()) { full ->
                    if (forward) -full / 6 else full / 6
                } + fadeOut(sheetNavSpring())
            ) using SizeTransform(clip = true) { _, _ ->
                sheetNavSpring()
            }
        },
        contentAlignment = Alignment.TopCenter,
        label = "actionsScreen",
    ) { current ->
        when (current) {
            ActionsScreen.Main -> Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 48.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 20.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(AppThemeDims.List.dotToText),
            ) {
                Box(
                    modifier = Modifier
                        .padding(top = 2.dp)
                        .width(AppThemeDims.List.unreadDotSize)
                        .height(AppThemeDims.List.unreadDotLineHeight),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .size(AppThemeDims.List.unreadDotSize)
                            .clip(CircleShape)
                            .background(if (email.isUnread) colors.unread else colors.pillActive),
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        email.displaySender,
                        fontFamily = InterFontFamily,
                        fontWeight = if (email.isUnread) FontWeight.Medium else FontWeight.Normal,
                        fontSize = AppThemeDims.List.sender,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        letterSpacing = AppThemeDims.List.tracking,
                    )
                    Text(
                        email.previewText.ifEmpty { "(no preview)" },
                        fontFamily = InterFontFamily,
                        fontSize = AppThemeDims.List.preview,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        letterSpacing = AppThemeDims.List.tracking,
                    )
                }
                HomeChromeToolbarButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = "Close",
                    onClick = onDismiss,
                    size = 40.dp,
                )
            }

            if (availability.showsReplyActions) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 16.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(colors.surface)
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    QuickActionButton(
                        title = "Reply",
                        icon = Icons.AutoMirrored.Outlined.Reply,
                        modifier = Modifier.weight(1f),
                    ) {
                        scope.launch {
                            onDismiss()
                            app.startCompose(ComposeMode.Reply, original = email)
                        }
                    }
                    QuickActionButton(
                        title = "Reply All",
                        icon = Icons.AutoMirrored.Outlined.ReplyAll,
                        modifier = Modifier.weight(1f),
                    ) {
                        scope.launch {
                            onDismiss()
                            app.startCompose(ComposeMode.ReplyAll, original = email)
                        }
                    }
                    QuickActionButton(
                        title = "Forward",
                        icon = Icons.AutoMirrored.Outlined.ForwardToInbox,
                        modifier = Modifier.weight(1f),
                    ) {
                        scope.launch {
                            onDismiss()
                            app.startCompose(ComposeMode.Forward, original = email)
                        }
                    }
                    if (availability.showsArchive) {
                        QuickActionButton(
                            title = "Archive",
                            icon = Icons.Outlined.Archive,
                            modifier = Modifier.weight(1f),
                        ) {
                            scope.launch {
                                onDismiss()
                                app.archiveEmail(email)
                                if (fromList) onRemoveFromList?.invoke(email.id)
                                else onDone()
                            }
                        }
                    }
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(colors.surface),
            ) {
                ActionRow(
                    if (email.starred) "Unstar" else "Star",
                    if (email.starred) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                ) {
                    scope.launch { app.toggleStar(email); onDismiss() }
                }
                ActionRow(
                    if (email.read) "Mark as Unread" else "Mark as Read",
                    if (email.read) Icons.Outlined.MarkEmailUnread else Icons.Outlined.MarkEmailRead,
                ) {
                    scope.launch { app.toggleRead(email); onDismiss() }
                }
                if (moveTargets.isNotEmpty()) {
                    ActionRow(
                        "Move to Folder",
                        Icons.Outlined.Folder,
                        trailing = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    ) {
                        screen = ActionsScreen.Move
                    }
                }
                ActionRow(
                    "View Source",
                    Icons.Outlined.Code,
                    trailing = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                ) {
                    screen = ActionsScreen.Source
                }
                if (availability.showsDelete) {
                    Box {
                        ActionRow("Delete", Icons.Outlined.Delete, destructive = true) {
                            showDeleteMenu = true
                        }
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
                                    scope.launch {
                                        onDismiss()
                                        app.deleteEmail(email)
                                        if (fromList) onRemoveFromList?.invoke(email.id)
                                        else onDone()
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }

            ActionsScreen.Move -> MoveToFolderScreen(
            folders = moveTargets,
            onClose = onDismiss,
            onBack = { screen = ActionsScreen.Main },
            onMove = { folderId ->
                scope.launch {
                    onDismiss()
                    app.moveEmailToFolder(email, folderId)
                    if (fromList) onRemoveFromList?.invoke(email.id)
                    else onDone()
                }
            },
        )

            ActionsScreen.Source -> EmailSourceScreen(
                email = email,
                onClose = onDismiss,
                onBack = { screen = ActionsScreen.Main },
            )
        }
    }
}

private enum class ActionsScreen { Main, Move, Source }

@Composable
private fun QuickActionButton(
    title: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
            .clickable(onClick = onClick)
            .padding(horizontal = 2.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(colors.pillFill),
        ) {
            Icon(icon, contentDescription = null, tint = colors.ink, modifier = Modifier.size(20.dp))
        }
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 11.sp,
            color = colors.ink,
            maxLines = 1,
        )
    }
}

@Composable
private fun ActionRow(
    label: String,
    icon: ImageVector,
    destructive: Boolean = false,
    trailing: ImageVector? = null,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val contentColor = if (destructive) colors.deepDarkRed else colors.ink
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = contentColor,
            modifier = Modifier.size(18.dp),
        )
        Text(
            label,
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = contentColor,
            modifier = Modifier.weight(1f),
        )
        if (trailing != null) {
            Icon(
                trailing,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(14.dp),
            )
        }
    }
}

@Composable
private fun MoveToFolderScreen(
    folders: List<Folder>,
    onClose: () -> Unit,
    onBack: () -> Unit,
    onMove: (String) -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 48.dp),
    ) {
        SubScreenHeader(title = "Move to", onClose = onClose, onBack = onBack)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .heightIn(max = sheetListMaxHeight())
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .verticalScroll(rememberScrollState()),
        ) {
            folders.forEach { folder ->
                Text(
                    folder.name,
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.ink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onMove(folder.id) }
                        .padding(horizontal = 16.dp, vertical = 11.dp),
                )
            }
        }
    }
}

@Composable
private fun EmailSourceScreen(
    email: Email,
    onClose: () -> Unit,
    onBack: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 48.dp),
    ) {
        SubScreenHeader(title = "Source", onClose = onClose, onBack = onBack)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .heightIn(max = sheetListMaxHeight())
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .verticalScroll(rememberScrollState())
                .padding(vertical = 8.dp),
        ) {
            email.sourceHeaders.forEach { (key, value) ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text(
                        key,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                    Text(
                        value,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 14.sp,
                        color = colors.ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun SubScreenHeader(
    title: String,
    onClose: () -> Unit,
    onBack: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        HomeChromeToolbarButton(
            icon = Icons.AutoMirrored.Outlined.ArrowBack,
            contentDescription = "Back",
            onClick = onBack,
            size = 40.dp,
        )
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            color = colors.ink,
            modifier = Modifier.weight(1f),
        )
        HomeChromeToolbarButton(
            icon = Icons.Outlined.Close,
            contentDescription = "Close",
            onClick = onClose,
            size = 40.dp,
        )
    }
    Spacer(modifier = Modifier.height(8.dp))
}

private fun <T> sheetNavSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

@Composable
private fun sheetListMaxHeight() =
    (LocalConfiguration.current.screenHeightDp * 0.62f).dp

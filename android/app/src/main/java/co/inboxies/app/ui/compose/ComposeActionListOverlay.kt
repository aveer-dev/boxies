package co.inboxies.app.ui.compose

import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateRectAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.absoluteOffset
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Newspaper
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.zIndex
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

/** World App–style right-aligned action list over a blurred backdrop. */
enum class ComposeActionItem {
    Settings,
    Trash,
    Archive,
    Drafts,
    Sent,
    Updates,
    Promotions,
    Screener,
    Inbox,
//    ForYou,
    Compose,
    ;

    val title: String
        get() = when (this) {
            Settings -> "Settings"
            Trash -> "Trash"
            Archive -> "Archive"
            Drafts -> "Drafts"
            Sent -> "Sent"
            Updates -> "Updates"
            Promotions -> "Promotions"
            Screener -> "Screener"
            Inbox -> "Inbox"
//            ForYou -> "For you"
            Compose -> "Compose"
        }

    val icon: ImageVector
        get() = when (this) {
            Settings -> Icons.Filled.Settings
            Trash -> Icons.Filled.Delete
            Archive -> Icons.Filled.Archive
            Drafts -> Icons.Outlined.Drafts
            Sent -> Icons.AutoMirrored.Filled.Send
            Updates -> Icons.Filled.Newspaper
            Promotions -> Icons.Filled.Campaign
            Screener -> Icons.Filled.Shield
            Inbox -> Icons.Filled.Inbox
//            ForYou -> Icons.Filled.AutoAwesome
            Compose -> Icons.Filled.Edit
        }

    val folderTab: HomeTab?
        get() = when (this) {
//            ForYou -> HomeTab.AiInbox
            Inbox -> HomeTab.Folder(FolderIds.INBOX)
            Screener -> HomeTab.Folder(FolderIds.SCREENER)
            Promotions -> HomeTab.Folder(FolderIds.PROMOTIONS)
            Updates -> HomeTab.Folder(FolderIds.UPDATES)
            Sent -> HomeTab.Folder(FolderIds.SENT)
            Drafts -> HomeTab.Folder(FolderIds.DRAFT)
            Archive -> HomeTab.Folder(FolderIds.ARCHIVE)
            Trash -> HomeTab.Folder(FolderIds.TRASH)
            Settings, Compose -> null
        }
}

private val HighlightSpring = spring<Rect>(
    dampingRatio = 0.82f,
    stiffness = 480f,
)

private val ExpandSpring = spring<Float>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

private val CloseSpring = spring<Float>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMedium,
)

private fun View.impactHaptic() {
    val feedback = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        HapticFeedbackConstants.CONFIRM
    } else {
        HapticFeedbackConstants.KEYBOARD_TAP
    }
    performHapticFeedback(feedback)
}

@Composable
internal fun rememberReduceMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        runCatching {
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) == 0f
        }.getOrDefault(false)
    }
}

@Composable
fun ComposeActionListOverlay(
    highlightedId: ComposeActionItem?,
    onSelect: (ComposeActionItem) -> Unit,
    onDismiss: () -> Unit,
    onHighlightChange: (ComposeActionItem?) -> Unit,
    onRowFramesChange: (Map<ComposeActionItem, Rect>) -> Unit,
    dismissEnabled: Boolean,
    isClosingExternal: Boolean = false,
    onDismissStarted: () -> Unit = {},
) {
    val colors = inboxiesColors()
    val density = LocalDensity.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()
    val actions = ComposeActionItem.entries
    val rowFrames = remember { mutableMapOf<ComposeActionItem, Rect>() }
    var publishedFrames by remember { mutableStateOf<Map<ComposeActionItem, Rect>>(emptyMap()) }
    val backdropAlpha = remember { Animatable(0f) }
    var listContainer by remember { mutableStateOf<LayoutCoordinates?>(null) }
    var lastHighlightRect by remember { mutableStateOf(Rect.Zero) }
    val hoverFill = lerp(colors.pillActive, colors.surface, 0.45f)
    var isClosing by remember { mutableStateOf(false) }

    val appearedAnimatables = remember {
        List(actions.size) { Animatable(0f) }
    }

    val baseOffsetToStackPx = with(density) { 60.dp.toPx() }
    val rowStridePx = with(density) {
        (HomeChromeMetrics.composeActionIconSize + HomeChromeMetrics.composeActionRowSpacing).toPx()
    }

    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            backdropAlpha.snapTo(1f)
            appearedAnimatables.forEach { it.snapTo(1f) }
        } else {
            backdropAlpha.snapTo(0.2f)
            launch { backdropAlpha.animateTo(1f, ExpandSpring) }
            actions.forEachIndexed { index, _ ->
                val distanceFromBottom = actions.size - 1 - index
                launch {
                    delay(distanceFromBottom * 16L)
                    appearedAnimatables[index].animateTo(1f, ExpandSpring)
                }
            }
        }
    }

    fun triggerDismiss(action: ComposeActionItem? = null) {
        if (isClosing) return
        isClosing = true
        view.impactHaptic()
        onDismissStarted()
        scope.launch {
            if (reduceMotion) {
                backdropAlpha.animateTo(0f, tween(100))
                if (action != null) onSelect(action) else onDismiss()
                return@launch
            }
            val jobs = actions.mapIndexed { index, _ ->
                launch {
                    delay(index * 12L)
                    appearedAnimatables[index].animateTo(0f, CloseSpring)
                }
            }
            launch {
                backdropAlpha.animateTo(0f, CloseSpring)
            }
            jobs.joinAll()
            if (action != null) {
                onSelect(action)
            } else {
                onDismiss()
            }
        }
    }

    LaunchedEffect(isClosingExternal) {
        if (isClosingExternal && !isClosing) {
            triggerDismiss()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.background.copy(alpha = 0.82f * backdropAlpha.value))
                .clickable(
                    enabled = dismissEnabled && !isClosing,
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = { triggerDismiss() },
                ),
        )

        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(
                    end = 24.dp,
                    bottom = 64.dp,
                )
                .onGloballyPositioned { listContainer = it }
                .pointerInput(dismissEnabled, isClosing) {
                    if (!dismissEnabled || isClosing) return@pointerInput
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val change = event.changes.firstOrNull() ?: continue
                            val root = listContainer?.localToRoot(change.position) ?: continue
                            val hit = hitTestComposeAction(root, rowFrames)
                            if (change.pressed) {
                                if (hit != null) onHighlightChange(hit)
                            } else if (hit != null) {
                                triggerDismiss(hit)
                            }
                        }
                    }
                },
        ) {
            val origin = listContainer?.boundsInRoot()?.topLeft ?: Offset.Zero
            val targetRect = highlightedId?.let { highlighted ->
                publishedFrames[highlighted]?.translate(-origin.x, -origin.y)
            }
            SideEffect {
                if (targetRect != null) {
                    lastHighlightRect = targetRect
                }
            }
            val animatedRect by animateRectAsState(
                targetValue = targetRect ?: lastHighlightRect,
                animationSpec = HighlightSpring,
                label = "composeActionHighlight",
            )
            val highlightAlpha by animateFloatAsState(
                targetValue = if (targetRect != null) 1f else 0f,
                animationSpec = spring(stiffness = Spring.StiffnessMedium),
                label = "composeActionHighlightAlpha",
            )

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(HomeChromeMetrics.composeActionRowSpacing),
            ) {
                actions.forEachIndexed { index, action ->
                    val appeared = appearedAnimatables[index]
                    val distanceFromBottom = actions.size - 1 - index
                    val stackedOffsetPx = distanceFromBottom * rowStridePx + baseOffsetToStackPx

                    Row(
                        modifier = Modifier
                            .graphicsLayer {
                                val progress = appeared.value
                                alpha = if (reduceMotion) progress else progress.coerceIn(0f, 1f)
                                translationY = if (reduceMotion) 0f else (1f - progress) * stackedOffsetPx
                                val scale = if (reduceMotion) 1f else 0.76f + 0.24f * progress
                                scaleX = scale
                                scaleY = scale
                            }
                            .onGloballyPositioned { coords ->
                                rowFrames[action] = coords.boundsInRoot()
                                val next = rowFrames.toMap()
                                publishedFrames = next
                                onRowFramesChange(next)
                            }
                            .clickable(
                                enabled = !isClosing,
                                indication = null,
                                interactionSource = remember { MutableInteractionSource() },
                            ) { triggerDismiss(action) }
                            .padding(start = 14.dp, end = 2.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Text(
                            action.title,
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 17.sp,
                            color = colors.ink,
                            modifier = Modifier.graphicsLayer {
                                val progress = appeared.value
                                alpha = progress
                                translationX = (1f - progress) * with(density) { 10.dp.toPx() }
                            },
                        )
                        Box(
                            modifier = Modifier
                                .size(HomeChromeMetrics.composeActionIconSize)
                                .liquidGlass(CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                action.icon,
                                contentDescription = action.title,
                                tint = colors.ink,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }

            Box(modifier = Modifier.matchParentSize().zIndex(-1f)) {
                Box(
                    modifier = Modifier
                        .graphicsLayer { alpha = highlightAlpha }
                        .absoluteOffset {
                            IntOffset(
                                animatedRect.left.roundToInt(),
                                animatedRect.top.roundToInt(),
                            )
                        }
                        .size(
                            width = with(density) { animatedRect.width.toDp() },
                            height = with(density) { animatedRect.height.toDp() },
                        )
                        .background(hoverFill, RoundedCornerShape(50)),
                )
            }
        }
    }
}

fun hitTestComposeAction(
    point: Offset,
    frames: Map<ComposeActionItem, Rect>,
): ComposeActionItem? {
    return frames.entries.firstOrNull { (_, frame) ->
        frame.inflate(12f, 10f).contains(point)
    }?.key
}

private fun Rect.inflate(dx: Float, dy: Float): Rect =
    Rect(left - dx, top - dy, right + dx, bottom + dy)

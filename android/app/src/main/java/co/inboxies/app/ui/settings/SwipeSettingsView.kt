package co.inboxies.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DragHandle
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.services.SwipeActionPreferences
import co.inboxies.app.services.SwipeQuickAction
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlin.math.roundToInt

enum class SwipeEdge { Left, Right }

@Composable
fun SwipeSettingsView(
    onBack: () -> Unit,
    onAddAction: (SwipeEdge) -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val prefs by app.swipePreferences.collectAsState()

    fun persist(left: List<SwipeQuickAction>, right: List<SwipeQuickAction>) {
        app.updateSwipePreferences {
            it.copy(leftActions = left, rightActions = right)
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Text(
                "Swipe Settings",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            SwipePreviewCard(
                leadingAction = prefs.rightActions.firstOrNull(),
                trailingAction = prefs.leftActions.firstOrNull(),
            )

            SwipeActionSection(
                title = "Right swipe",
                actions = prefs.rightActions,
                onReorder = { next -> persist(prefs.leftActions, next) },
                onRemove = { action ->
                    if (prefs.rightActions.size > 1) {
                        persist(prefs.leftActions, prefs.rightActions - action)
                    }
                },
                onAdd = { onAddAction(SwipeEdge.Right) },
            )

            SwipeActionSection(
                title = "Left swipe",
                actions = prefs.leftActions,
                onReorder = { next -> persist(next, prefs.rightActions) },
                onRemove = { action ->
                    if (prefs.leftActions.size > 1) {
                        persist(prefs.leftActions - action, prefs.rightActions)
                    }
                },
                onAdd = { onAddAction(SwipeEdge.Left) },
            )
        }
    }
}

@Composable
fun SwipeAddActionView(
    edge: SwipeEdge,
    onBack: () -> Unit,
    onDone: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val prefs by app.swipePreferences.collectAsState()
    val used = when (edge) {
        SwipeEdge.Left -> prefs.leftActions.toSet()
        SwipeEdge.Right -> prefs.rightActions.toSet()
    }
    val available = SwipeQuickAction.entries.filter { it !in used }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Text(
                "Add action",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            SettingsChromeTextButton(label = "Done", onClick = onDone)
        }

        if (available.isEmpty()) {
            Text(
                "All actions are already assigned to this swipe.",
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.muted,
                modifier = Modifier.padding(20.dp),
            )
        } else {
            available.forEach { action ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            app.updateSwipePreferences { current ->
                                when (edge) {
                                    SwipeEdge.Left -> current.copy(
                                        leftActions = current.leftActions + action,
                                    )
                                    SwipeEdge.Right -> current.copy(
                                        rightActions = current.rightActions + action,
                                    )
                                }
                            }
                            onDone()
                        }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        action.icon(),
                        contentDescription = null,
                        tint = colors.ink,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(14.dp))
                    Text(
                        action.title,
                        fontFamily = InterFontFamily,
                        fontSize = 16.sp,
                        color = colors.ink,
                    )
                }
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun SwipePreviewCard(
    leadingAction: SwipeQuickAction?,
    trailingAction: SwipeQuickAction?,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.pillFill.copy(alpha = 0.65f), RoundedCornerShape(16.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Outlined.Folder,
                contentDescription = null,
                tint = colors.deepDarkRed,
                modifier = Modifier.size(14.dp),
            )
            Text(
                "Move to Inbox",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        PreviewRow(leadingAction = leadingAction, trailingAction = null, revealLeading = true)
        PreviewRow(leadingAction = null, trailingAction = trailingAction, revealLeading = false)
    }
}

@Composable
private fun PreviewRow(
    leadingAction: SwipeQuickAction?,
    trailingAction: SwipeQuickAction?,
    revealLeading: Boolean,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (revealLeading && leadingAction != null) {
            PreviewActionChip(leadingAction)
        }
        Row(
            modifier = Modifier
                .weight(1f)
                .background(colors.surface, RoundedCornerShape(10.dp))
                .padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .background(colors.pillFill, CircleShape),
            )
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    modifier = Modifier
                        .width(120.dp)
                        .height(8.dp)
                        .background(colors.pillFill, RoundedCornerShape(3.dp)),
                )
                Box(
                    modifier = Modifier
                        .width(80.dp)
                        .height(6.dp)
                        .background(colors.pillActive, RoundedCornerShape(3.dp)),
                )
            }
        }
        if (!revealLeading && trailingAction != null) {
            PreviewActionChip(trailingAction)
        }
    }
}

@Composable
private fun PreviewActionChip(action: SwipeQuickAction) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(52.dp)
            .background(action.tint(colors)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            action.icon(),
            contentDescription = null,
            tint = androidx.compose.ui.graphics.Color.White,
            modifier = Modifier.size(20.dp),
        )
    }
}

@Composable
private fun SwipeActionSection(
    title: String,
    actions: List<SwipeQuickAction>,
    onReorder: (List<SwipeQuickAction>) -> Unit,
    onRemove: (SwipeQuickAction) -> Unit,
    onAdd: () -> Unit,
) {
    val colors = inboxiesColors()
    val density = LocalDensity.current
    val rowHeightPx = with(density) { 60.dp.toPx() }
    var dragIndex by remember { mutableStateOf<Int?>(null) }
    var dragOffset by remember { mutableFloatStateOf(0f) }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = colors.muted,
        )

        actions.forEachIndexed { index, action ->
            val isDragging = dragIndex == index
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .graphicsLayer {
                        if (isDragging) {
                            translationY = dragOffset
                            alpha = 0.85f
                        }
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Outlined.DragHandle,
                    contentDescription = "Reorder",
                    tint = colors.muted.copy(alpha = 0.75f),
                    modifier = Modifier
                        .size(22.dp)
                        .pointerInput(actions, index) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = {
                                    dragIndex = index
                                    dragOffset = 0f
                                },
                                onDragEnd = {
                                    dragIndex = null
                                    dragOffset = 0f
                                },
                                onDragCancel = {
                                    dragIndex = null
                                    dragOffset = 0f
                                },
                                onDrag = { change, dragAmount ->
                                    change.consume()
                                    dragOffset += dragAmount.y
                                    val from = dragIndex ?: return@detectDragGesturesAfterLongPress
                                    val shift = (dragOffset / rowHeightPx).roundToInt()
                                    val to = (from + shift).coerceIn(0, actions.lastIndex)
                                    if (to != from) {
                                        val next = actions.toMutableList()
                                        val item = next.removeAt(from)
                                        next.add(to, item)
                                        onReorder(next)
                                        dragIndex = to
                                        dragOffset -= (to - from) * rowHeightPx
                                    }
                                },
                            )
                        },
                )

                Row(
                    modifier = Modifier
                        .weight(1f)
                        .background(colors.pillFill, RoundedCornerShape(14.dp))
                        .padding(horizontal = 14.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        action.icon(),
                        contentDescription = null,
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        action.title,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    if (actions.size > 1) {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .background(colors.background, CircleShape)
                                .clickable { onRemove(action) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = "Remove ${action.title}",
                                tint = colors.muted,
                                modifier = Modifier.size(12.dp),
                            )
                        }
                    }
                }
            }
        }

        if (actions.size < SwipeActionPreferences.MAX_ACTIONS_PER_EDGE) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onAdd)
                    .padding(start = 28.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.Add,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    "Add action",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.muted,
                )
            }
        }
    }
}

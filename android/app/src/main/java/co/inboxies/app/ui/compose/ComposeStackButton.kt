package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors

/**
 * Compose stack — same-size discs with top peeks (Figma).
 * Back layers share the horizontal center, lift upward, and get darker so only
 * crescent arcs show above the white front. Flat fills, no heavy shadows.
 */
@Composable
fun ComposeStackButton(
    isExpanded: Boolean,
    modifier: Modifier = Modifier,
    size: Dp = HomeChromeMetrics.actionBarHeight,
) {
    val colors = inboxiesColors()
    val layerCount = HomeChromeMetrics.composeStackLayerCount
    val peek = HomeChromeMetrics.composeStackPeekOffset
    val stackHeight = HomeChromeMetrics.composeStackHeight(size)

    Box(
        modifier = modifier.size(width = size, height = stackHeight),
        contentAlignment = Alignment.BottomCenter,
    ) {
        for (depth in (layerCount - 1) downTo 0) {
            val scale = HomeChromeMetrics.composeStackScale(depth)
            val layerSize = size * scale
            val lift = if (isExpanded) 0.dp else peek * depth
            val fill = when (depth) {
                0 -> colors.surface
                1 -> colors.pillFill
                else -> lerp(colors.pillActive, colors.ink, 0.22f)
            }
            Box(
                modifier = Modifier
                    .size(layerSize)
                    .offset(y = -lift)
                    .graphicsLayer { alpha = if (isExpanded && depth > 0) 0f else 1f }
                    .background(fill, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (depth == 0 && !isExpanded) {
                    Icon(
                        Icons.Filled.Edit,
                        contentDescription = null,
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors

/** Layered compose control — back layers are progressively smaller and darker. */
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
            // Bottom-aligned smaller discs need enough lift to clear the front disc's top.
            val lift = if (isExpanded) 0.dp else peek * depth + (size - layerSize)
            val fill = when (depth) {
                0 -> colors.surface
                1 -> colors.pillFill
                else -> lerp(colors.pillActive, colors.ink, 0.18f)
            }
            Box(
                modifier = Modifier
                    .size(layerSize)
                    .offset(y = -lift)
                    .graphicsLayer { alpha = if (isExpanded && depth > 0) 0f else 1f }
                    .shadow(
                        elevation = if (depth == 0) 10.dp else 5.dp,
                        shape = CircleShape,
                        clip = false,
                        ambientColor = Color.Black.copy(alpha = 0.08f),
                        spotColor = Color.Black.copy(alpha = 0.10f),
                    )
                    .background(fill, CircleShape)
                    .border(1.dp, colors.line.copy(alpha = if (depth == 0) 0.9f else 0.55f), CircleShape),
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

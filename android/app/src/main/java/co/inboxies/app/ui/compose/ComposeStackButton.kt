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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors

/** Layered compose control — reads as a stack of buttons that expands into the action list. */
@Composable
fun ComposeStackButton(
    isExpanded: Boolean,
    modifier: Modifier = Modifier,
    size: Dp = HomeChromeMetrics.actionBarHeight,
) {
    val colors = inboxiesColors()
    val layerCount = HomeChromeMetrics.composeStackLayerCount
    val peek = HomeChromeMetrics.composeStackPeekOffset
    val stackExtra = peek * (layerCount - 1)
    val rim = colors.line.copy(alpha = 0.85f)

    Box(
        modifier = modifier
            .size(width = size, height = size + stackExtra),
        contentAlignment = Alignment.BottomCenter,
    ) {
        // Draw back → front so peeks stack upward from the front control.
        for (depth in (layerCount - 1) downTo 0) {
            val scale = if (depth == 0) 1f else HomeChromeMetrics.composeStackBackScale
            val fill = when (depth) {
                0 -> colors.surface.copy(alpha = 0.96f)
                1 -> colors.pillFill.copy(alpha = 0.95f)
                else -> colors.pillActive.copy(alpha = 0.9f)
            }
            Box(
                modifier = Modifier
                    .size(size)
                    .offset(y = if (isExpanded) 0.dp else -(peek * depth))
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        alpha = when {
                            depth == 0 -> 1f
                            isExpanded -> 0f
                            else -> 1f
                        }
                    }
                    .shadow(
                        elevation = if (depth == 0) 10.dp else 6.dp,
                        shape = CircleShape,
                        clip = false,
                        ambientColor = Color.Black.copy(alpha = 0.08f),
                        spotColor = Color.Black.copy(alpha = 0.10f),
                    )
                    .background(fill, CircleShape)
                    .border(1.dp, rim, CircleShape),
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

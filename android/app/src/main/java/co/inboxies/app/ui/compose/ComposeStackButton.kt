package co.inboxies.app.ui.compose

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors

/**
 * Compose stack — same-size discs with top peeks.
 * Back layers share the horizontal center and lift upward.
 * Uses native surface fill, subtle button shadow, and faint hairline border.
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
            val targetLift = if (isExpanded) 0.dp else peek * depth
            val animatedLift by animateDpAsState(
                targetValue = targetLift,
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                label = "composeStackLift_$depth",
            )
            val animatedAlpha by animateFloatAsState(
                targetValue = if (isExpanded && depth > 0) 0f else 1f,
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                label = "composeStackAlpha_$depth",
            )
            Box(
                modifier = Modifier
                    .size(layerSize)
                    .offset(y = -animatedLift)
                    .graphicsLayer { alpha = animatedAlpha }
                    .shadow(
                        elevation = 2.dp,
                        shape = CircleShape,
                        ambientColor = Color.Black.copy(alpha = 0.08f),
                        spotColor = Color.Black.copy(alpha = 0.08f),
                    )
                    .background(colors.surface, CircleShape)
                    .border(0.5.dp, colors.line.copy(alpha = 0.7f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (depth == 0) {
                    Icon(
                        imageVector = Icons.Filled.Edit,
                        contentDescription = "Compose",
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

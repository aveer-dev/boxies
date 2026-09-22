package co.inboxies.app.ui.compose

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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass

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

    Box(
        modifier = modifier
            .size(width = size, height = size + stackExtra)
            .offset(y = stackExtra / 2),
        contentAlignment = Alignment.Center,
    ) {
        for (index in 0 until layerCount) {
            val depth = layerCount - 1 - index
            Box(
                modifier = Modifier
                    .size(size)
                    .graphicsLayer {
                        scaleX = if (depth == 0) 1f else HomeChromeMetrics.composeStackBackScale
                        scaleY = if (depth == 0) 1f else HomeChromeMetrics.composeStackBackScale
                        translationY = if (isExpanded) 0f else -(depth * peek.toPx())
                        alpha = when {
                            depth == 0 -> 1f
                            isExpanded -> 0f
                            else -> 0.55f - (depth - 1) * 0.12f
                        }
                    }
                    .liquidGlass(CircleShape),
            )
        }
        if (!isExpanded) {
            Icon(
                Icons.Filled.Edit,
                contentDescription = null,
                tint = colors.ink,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

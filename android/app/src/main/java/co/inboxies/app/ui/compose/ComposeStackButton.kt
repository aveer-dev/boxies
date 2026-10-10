package co.inboxies.app.ui.compose

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.R
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.inboxiesColors

/**
 * Compose stack — same-size discs with top peeks.
 * Back layers share the horizontal center and lift upward.
 * Uses native surface fill, subtle button shadow, and faint hairline border.
 * While pressed the stack squishes; on release it springs back with a bounce.
 */
@Composable
fun ComposeStackButton(
    isExpanded: Boolean,
    modifier: Modifier = Modifier,
    isPressed: Boolean = false,
    size: Dp = HomeChromeMetrics.actionBarHeight,
) {
    val colors = inboxiesColors()
    val reduceMotion = rememberReduceMotion()
    val layerCount = HomeChromeMetrics.composeStackLayerCount
    val peek = HomeChromeMetrics.composeStackPeekOffset
    val stackHeight = HomeChromeMetrics.composeStackHeight(size)
    val squishes = isPressed && !reduceMotion

    val pressSpring = spring<Float>(dampingRatio = 0.72f, stiffness = Spring.StiffnessMedium)
    val stackScale by animateFloatAsState(
        targetValue = if (squishes) HomeChromeMetrics.composeStackPressedScale else 1f,
        animationSpec = if (isPressed) {
            pressSpring
        } else {
            spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow)
        },
        label = "composeStackPressScale",
    )
    // A touch looser than the discs so the glyph overshoots on its own beat.
    val iconScale by animateFloatAsState(
        targetValue = if (squishes) HomeChromeMetrics.composeStackPressedIconScale else 1f,
        animationSpec = if (isPressed) {
            pressSpring
        } else {
            spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessMediumLow)
        },
        label = "composeStackIconScale",
    )
    val peekSquash by animateFloatAsState(
        targetValue = if (squishes) HomeChromeMetrics.composeStackPressedPeekRatio else 1f,
        animationSpec = if (isPressed) {
            pressSpring
        } else {
            spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow)
        },
        label = "composeStackPeekSquash",
    )
    val pressAlpha by animateFloatAsState(
        targetValue = if (isPressed && reduceMotion) 0.55f else 1f,
        animationSpec = tween(durationMillis = 120),
        label = "composeStackPressAlpha",
    )

    Box(
        modifier = modifier
            .size(width = size, height = stackHeight)
            .graphicsLayer {
                // Scale around the front disc's center, not the taller stack frame.
                transformOrigin = TransformOrigin(0.5f, 1f - (size / 2) / stackHeight)
                scaleX = stackScale
                scaleY = stackScale
                alpha = pressAlpha
            },
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
                    .offset(y = -animatedLift * peekSquash)
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
                        painter = painterResource(R.drawable.ic_square_stack),
                        contentDescription = null,
                        tint = colors.ink,
                        modifier = Modifier
                            .size(22.dp)
                            .graphicsLayer {
                                scaleX = iconScale
                                scaleY = iconScale
                            },
                    )
                }
            }
        }
    }
}

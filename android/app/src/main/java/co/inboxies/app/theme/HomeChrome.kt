package co.inboxies.app.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Shared home chrome metrics — mirrors iOS `HomeChromeMetrics`. */
object HomeChromeMetrics {
    val actionBarHeight: Dp = 52.dp
    val chromeHorizontalPadding: Dp = 12.dp
    val chromeSpacing: Dp = 10.dp
    val chromeBottomPadding: Dp = 20.dp
    val chromeCornerRadius: Dp = 50.dp
    val minimizedComposeHeight: Dp = 88.dp
    val minimizedComposeGap: Dp = 18.dp
    val mailboxAvatarSize: Dp = 48.dp
    val bottomBarHorizontalPadding: Dp = 24.dp
    val selectionBarHeight: Dp = 58.dp
    val composeActionIconSize: Dp = 48.dp
    val composeActionRowSpacing: Dp = 18.dp

    /** Visible back-layer peeks on the compose stack control (design twin of iOS).
     * Depth 0 = front; higher depth = smaller + darker. */
    const val composeStackLayerCount: Int = 3
    val composeStackPeekOffset: Dp = 5.dp
    /** Progressive scales: front 1.0, mid, back (clearly stepped). */
    val composeStackScales: FloatArray = floatArrayOf(1.0f, 0.72f, 0.50f)

    /** Short long-press opens compose (menu opens on tap, instantly). */
    const val composeLongPressMs: Long = 180L
    const val composeDoubleTapWindowMs: Long = 280L

    fun composeStackScale(depth: Int): Float {
        val index = depth.coerceIn(0, composeStackScales.lastIndex)
        return composeStackScales[index]
    }

    /** Total height of the compose stack control (front + visible peeks). */
    fun composeStackHeight(frontSize: Dp = actionBarHeight): Dp {
        val smallest = composeStackScale(composeStackLayerCount - 1)
        return frontSize + composeStackPeekOffset * (composeStackLayerCount - 1) +
            frontSize * (1f - smallest)
    }

    /** iOS `Menu` chrome — 14pt continuous corners, 20pt glyphs, 16pt insets. */
    val menuCornerRadius: Dp = 22.dp
    val menuIconSize: Dp = 16.dp
    val menuItemHorizontalPadding: Dp = 16.dp
    val menuDividerInset: Dp = 16.dp
    val menuMinWidth: Dp = 220.dp
    val menuShadowElevation: Dp = 8.dp

    val toolbarControlSize: Dp = 48.dp
    val toolbarControlCornerRadius: Dp = 50.dp
    val toolbarControlIconSize: Dp = 22.dp
    val toolbarControlSpacing: Dp = 10.dp
    val toolbarControlElevation: Dp = 8.dp
    val toolbarClusterInnerPadding: Dp = 8.dp
    val toolbarClusterItemSpacing: Dp = 6.dp

    /** Subtle dim behind compose / sheets so a drag shows a layer over home. */
    val modalScrim: Color = Color.Black.copy(alpha = 0.22f)

    fun listBottomInset(hasMinimizedCompose: Boolean): Dp {
        var height = actionBarHeight + chromeBottomPadding
        if (hasMinimizedCompose) {
            height += minimizedComposeHeight
        }
        return height
    }
}

/**
 * iOS pre-26 liquid-glass fallback: frosted fill, white hairline, soft shadow.
 * Does not attempt iOS 26 `glassEffect`.
 */
@Composable
fun Modifier.liquidGlass(shape: Shape): Modifier {
    val colors = inboxiesColors()
    return this
        .shadow(
            elevation = 12.dp,
            shape = shape,
            ambientColor = Color.Black.copy(alpha = 0.08f),
            spotColor = Color.Black.copy(alpha = 0.08f),
        )
        .clip(shape)
        .background(colors.surface.copy(alpha = 0.92f), shape)
        .border(0.5.dp, Color.White.copy(alpha = 0.45f), shape)
}

/**
 * Compact chrome chip — same language as [liquidGlass], tuned for 38.dp toolbar controls.
 * White hairline instead of a gray stroke, so the lift comes from the shadow.
 */
@Composable
fun Modifier.homeChromeToolbarSurface(
    shape: Shape = CircleShape,
): Modifier {
    val colors = inboxiesColors()
    val rim = if (colors.background.luminance() < 0.5f) {
        Color.White.copy(alpha = 0.32f)
    } else {
        colors.line.copy(alpha = 0.8f)
    }
    return this
        .shadow(
            elevation = HomeChromeMetrics.toolbarControlElevation,
            shape = shape,
            clip = false,
            ambientColor = Color.Black.copy(alpha = 0.06f),
            spotColor = Color.Black.copy(alpha = 0.08f),
        )
        .clip(shape)
        .background(colors.surface.copy(alpha = 0.94f), shape)
        .border(1.dp, rim, shape)
}

@Composable
fun HomeChromeToolbarButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = CircleShape,
    size: Dp = HomeChromeMetrics.toolbarControlSize,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .size(size)
            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .homeChromeToolbarSurface(shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

@Composable
fun HomeChromeToolbarButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = CircleShape,
    size: Dp = HomeChromeMetrics.toolbarControlSize,
    tint: Color = inboxiesColors().ink,
) {
    HomeChromeToolbarButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        shape = shape,
        size = size,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(HomeChromeMetrics.toolbarControlIconSize),
        )
    }
}

/** Grouped trailing controls — same capsule as home Select + Filter. */
@Composable
fun HomeChromeToolbarCluster(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    itemSpacing: Dp = 0.dp,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier
            .height(HomeChromeMetrics.toolbarControlSize)
            .homeChromeToolbarSurface(
                RoundedCornerShape(HomeChromeMetrics.toolbarControlCornerRadius),
            )
            .padding(contentPadding),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(itemSpacing),
        content = content,
    )
}

@Composable
fun HomeChromeToolbarClusterItem(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        modifier = modifier
            .size(HomeChromeMetrics.toolbarControlSize)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

@Composable
fun HomeChromeToolbarClusterItem(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = inboxiesColors().ink,
) {
    HomeChromeToolbarClusterItem(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
    ) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(HomeChromeMetrics.toolbarControlIconSize),
        )
    }
}

/** Soft material fade behind the large title, analogous to iOS ProgressiveBlurBackground. */
@Composable
fun ProgressiveBlurBackground(
    modifier: Modifier = Modifier,
    height: Dp = 120.dp,
) {
    val colors = inboxiesColors()
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .background(
                Brush.verticalGradient(
                    colorStops = arrayOf(
                        0.0f to colors.background.copy(alpha = 0.95f),
                        0.6f to colors.background.copy(alpha = 0.55f),
                        1.0f to Color.Transparent,
                    ),
                ),
            ),
    )
}

object AvatarInitials {
    /** Two letters for first + last; otherwise the first letter. */
    fun from(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return "A"

        val source = if (trimmed.contains("@")) {
            trimmed.substringBefore("@")
        } else {
            trimmed
        }
        val parts = source
            .split(Regex("[\\s._]+"))
            .filter { it.isNotEmpty() }

        if (parts.size >= 2) {
            return (parts.first().take(1) + parts.last().take(1)).uppercase()
        }

        val word = parts.firstOrNull() ?: source
        return if (word.length <= 2) word.uppercase() else word.take(1).uppercase()
    }
}

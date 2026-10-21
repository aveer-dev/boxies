package co.inboxies.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.R
import co.inboxies.app.theme.inboxiesColors

/** Logo tile corner radius as a fraction of the tile size (matches iOS and web). */
internal const val LOGO_TILE_CORNER_FRACTION = 0.22f

/**
 * The plane drawable for a given rendered size. Both are generated from the master mark
 * (`design/logo/inboxies-mark.svg`) with the same padding; at 32dp and below the strokes
 * are heavier and the finest folds are dropped so it stays legible.
 */
internal fun inboxiesLogoRes(size: Dp): Int =
    if (size <= 32.dp) R.drawable.ic_inboxies_logo_small else R.drawable.ic_inboxies_logo

/**
 * The official Inboxies app logo / icon component.
 * Renders the Notion-inspired rounded card tile (22% corners) with the paper plane.
 */
@Composable
fun AppLogoView(
    modifier: Modifier = Modifier,
    size: Dp = 64.dp,
    showTile: Boolean = true,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(size * LOGO_TILE_CORNER_FRACTION)

    if (showTile) {
        val glyph = size * 0.60f
        Box(
            modifier = modifier
                .size(size)
                .shadow(
                    elevation = 6.dp,
                    shape = shape,
                    ambientColor = Color.Black.copy(alpha = 0.08f),
                    spotColor = Color.Black.copy(alpha = 0.08f),
                )
                .clip(shape)
                .background(colors.surface)
                .border(1.dp, colors.line.copy(alpha = 0.8f), shape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(id = inboxiesLogoRes(glyph)),
                contentDescription = "Inboxies Logo",
                tint = colors.ink,
                modifier = Modifier.size(glyph),
            )
        }
    } else {
        Icon(
            painter = painterResource(id = inboxiesLogoRes(size)),
            contentDescription = "Inboxies Logo",
            tint = colors.ink,
            modifier = modifier.size(size),
        )
    }
}

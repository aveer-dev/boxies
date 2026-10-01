package co.inboxies.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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

/**
 * The official Inboxies app logo / icon component.
 * Renders the Notion-inspired squircle card tile with the faceted origami paper plane.
 */
@Composable
fun AppLogoView(
    modifier: Modifier = Modifier,
    size: Dp = 64.dp,
    showTile: Boolean = true,
) {
    val colors = inboxiesColors()
    val cornerRadius = size * 0.25f

    if (showTile) {
        Box(
            modifier = modifier
                .size(size)
                .shadow(
                    elevation = 6.dp,
                    shape = RoundedCornerShape(cornerRadius),
                    ambientColor = Color.Black.copy(alpha = 0.08f),
                    spotColor = Color.Black.copy(alpha = 0.08f),
                )
                .clip(RoundedCornerShape(cornerRadius))
                .background(colors.surface)
                .border(1.dp, colors.line.copy(alpha = 0.8f), RoundedCornerShape(cornerRadius)),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_launcher_foreground),
                contentDescription = "Inboxies Logo",
                modifier = Modifier.size(size * 0.88f),
            )
        }
    } else {
        Image(
            painter = painterResource(id = R.drawable.ic_launcher_foreground),
            contentDescription = "Inboxies Logo",
            modifier = modifier.size(size),
        )
    }
}

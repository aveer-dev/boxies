package co.inboxies.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.R
import co.inboxies.app.theme.InboxiesColors
import co.inboxies.app.theme.inboxiesColors

/**
 * Private Email product logo:
 * The app's origami paper plane logo with a reduced black and white shield at the top left corner.
 *
 * Colors come from the in-app palette (not `values-night`), so the mark follows the
 * Inboxies theme setting like iOS: plane + shield outline in `ink`, shield halves fixed
 * light / dark.
 */
@Composable
fun PrivateEmailLogoView(
    modifier: Modifier = Modifier,
    size: Dp = 24.dp,
    showTile: Boolean = false,
    alwaysLight: Boolean = false,
) {
    val colors = inboxiesColors()
    val surfaceColor = if (alwaysLight) InboxiesColors.LightSurface else colors.surface
    val lineColor = if (alwaysLight) InboxiesColors.LightLine else colors.line
    val inkColor = if (alwaysLight) InboxiesColors.LightInk else colors.ink
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
                .background(surfaceColor)
                .border(1.dp, lineColor.copy(alpha = 0.8f), RoundedCornerShape(cornerRadius)),
            contentAlignment = Alignment.Center,
        ) {
            PrivateEmailMark(ink = inkColor, modifier = Modifier.size(size * 0.75f))
        }
    } else {
        PrivateEmailMark(ink = inkColor, modifier = modifier.size(size))
    }
}

@Composable
private fun PrivateEmailMark(ink: Color, modifier: Modifier) {
    val shield = remember(ink) { privateEmailShield(ink) }
    Box(modifier = modifier.semantics { contentDescription = "Private Email Logo" }) {
        // Same plane geometry as the 512-viewport private-email drawable.
        Image(
            painter = painterResource(id = R.drawable.ic_inboxies_logo),
            contentDescription = null,
            colorFilter = ColorFilter.tint(ink),
            modifier = Modifier.fillMaxSize(),
        )
        Image(
            painter = rememberVectorPainter(shield),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/** Top-left shield, drawn in the plane drawable's proportions (512 viewport), themed. */
private fun privateEmailShield(ink: Color): ImageVector =
    ImageVector.Builder(
        name = "PrivateEmailShield",
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 512f,
        viewportHeight = 512f,
    )
        .addGroup(translationX = 44f, translationY = 40f, scaleX = 0.4f, scaleY = 0.4f)
        .addPath(
            pathData = addPathNodes("M 108,36 C 96,46 62,56 46,60 L 46,122 C 46,162 80,188 108,198 L 108,36 Z"),
            fill = SolidColor(InboxiesColors.LightSurface),
            stroke = SolidColor(ink),
            strokeLineWidth = 16f,
            strokeLineJoin = StrokeJoin.Round,
        )
        .addPath(
            pathData = addPathNodes("M 108,36 L 108,198 C 136,188 170,162 170,122 L 170,60 C 154,56 120,46 108,36 Z"),
            fill = SolidColor(InboxiesColors.LightInk),
            stroke = SolidColor(ink),
            strokeLineWidth = 16f,
            strokeLineJoin = StrokeJoin.Round,
        )
        .clearGroup()
        .build()

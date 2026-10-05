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
import co.inboxies.app.theme.InboxiesColors
import co.inboxies.app.theme.inboxiesColors

/**
 * Private Email product logo:
 * The app's origami paper plane logo with a reduced black and white shield at the top left corner.
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
            Image(
                painter = painterResource(id = R.drawable.ic_private_email_logo),
                contentDescription = "Private Email Logo",
                modifier = Modifier.size(size * 0.75f),
            )
        }
    } else {
        Image(
            painter = painterResource(id = R.drawable.ic_private_email_logo),
            contentDescription = "Private Email Logo",
            modifier = modifier.size(size),
        )
    }
}

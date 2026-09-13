package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.services.ComposeSession
import co.inboxies.app.services.DraftSaveStatus
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/** Minimized compose dock — Mail-style full-bleed bar flush to the screen bottom. */
@Composable
fun ComposeDockBar(
    session: ComposeSession,
    onExpand: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp)
    Box(modifier = modifier.fillMaxWidth()) {
        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .height(12.dp)
                .offset(y = (-6).dp)
                .background(
                    Brush.verticalGradient(
                        colorStops = arrayOf(
                            0.0f to Color.Transparent,
                            1.0f to Color.Black.copy(alpha = 0.04f),
                        ),
                    ),
                ),
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(
                    elevation = 6.dp,
                    shape = shape,
                    clip = false,
                    ambientColor = Color.Black.copy(alpha = 0.05f),
                    spotColor = Color.Black.copy(alpha = 0.06f),
                )
                .clip(shape)
                .background(colors.surface)
                .clickable(onClick = onExpand)
                .padding(horizontal = 20.dp)
                .padding(top = 26.dp, bottom = 22.dp)
                .navigationBarsPadding(),
            contentAlignment = Alignment.Center,
        ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            Text(
                session.dockTitle,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (session.form.saveStatus == DraftSaveStatus.Saving || session.form.isSavingDraft) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .padding(start = 8.dp)
                        .size(14.dp),
                    strokeWidth = 1.5.dp,
                    color = colors.ink,
                )
            }
            Spacer(Modifier.weight(1f))
        }
        }
    }
}

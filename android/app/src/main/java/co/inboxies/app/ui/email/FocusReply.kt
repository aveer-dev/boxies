package co.inboxies.app.ui.email

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/** Focus & Reply copy shared by the strip and its iOS twin (AVE-193). */
object FocusReplyCopy {
    const val TITLE = "Focus & Reply"

    fun waitingLabel(count: Int): String = "$count waiting"
}

/**
 * Reply Later's "N waiting · Focus & Reply" strip, pinned above the pile (AVE-193).
 * Web twin: the bar in `app/routes/reply-later.tsx`. iOS twin: `FocusReplyStrip`.
 */
@Composable
fun FocusReplyStrip(
    label: String,
    onStart: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val list = AppThemeDims.List
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Column(modifier = modifier.fillMaxWidth().background(colors.background)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = list.rowHorizontalPadding, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = label,
                color = colors.muted,
                fontFamily = InterFontFamily,
                fontSize = list.subject,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Row(
                modifier = Modifier
                    .alpha(if (pressed) 0.55f else 1f)
                    .clip(RoundedCornerShape(50))
                    .background(colors.ink)
                    .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onStart)
                    .semantics { contentDescription = "Focus & Reply. Opens each thread in the pile with a reply ready" }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Reply,
                    contentDescription = null,
                    tint = colors.background,
                    modifier = Modifier.size(14.dp),
                )
                Text(
                    text = FocusReplyCopy.TITLE,
                    color = colors.background,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = list.subject,
                    maxLines = 1,
                )
            }
        }
        HorizontalDivider(
            color = colors.line.copy(alpha = 0.65f),
            thickness = list.separatorHeight,
            modifier = Modifier.padding(horizontal = list.rowHorizontalPadding),
        )
    }
}

/** Reply Later after a Focus & Reply run emptied the pile (AVE-193). */
@Composable
fun FocusReplyDone(modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Column(
        modifier = modifier.fillMaxWidth().padding(top = 48.dp, start = 24.dp, end = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Outlined.CheckCircle,
            contentDescription = null,
            tint = colors.muted,
            modifier = Modifier.size(40.dp),
        )
        Text(
            "All done",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 17.sp,
            color = colors.ink,
        )
        Text(
            "You’ve replied to everything in Reply Later.",
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
    }
}

/** Top of the compose sheet during Focus & Reply: where you are in the pile, and Skip. */
@Composable
fun FocusReplyComposeBar(
    progress: String,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val list = AppThemeDims.List
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            FocusReplyCopy.TITLE,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = list.subject,
            color = colors.ink,
        )
        Spacer(Modifier.width(4.dp))
        Text(
            "· $progress",
            fontFamily = InterFontFamily,
            fontSize = list.subject,
            color = colors.muted,
            modifier = Modifier.weight(1f),
            maxLines = 1,
        )
        Row(
            modifier = Modifier
                .alpha(if (pressed) 0.55f else 1f)
                .clip(RoundedCornerShape(50))
                .background(colors.pillFill)
                .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onSkip)
                .semantics { contentDescription = "Skip. Leaves this thread in the pile and opens the next" }
                .padding(start = 12.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                "Skip",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = list.subject,
                color = colors.ink,
            )
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.ink,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

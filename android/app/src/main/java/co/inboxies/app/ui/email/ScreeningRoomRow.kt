package co.inboxies.app.ui.email

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Shield
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import co.inboxies.app.models.Email
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.AvatarInitials
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/** Screening room copy shared by the Inbox row and the room's subtitle (AVE-136). */
object ScreeningRoom {
    const val TITLE = "Screening room"

    fun waitingLabel(count: Int): String = "$count waiting to be screened"
}

/**
 * Flat pinned row at the top of Inbox: stacked sender avatars, "N waiting to be
 * screened", chevron. Opens the Screening room (AVE-136). Scrolls with the list.
 * iOS twin: `EmailListView.screeningRoomRow`.
 */
@Composable
fun ScreeningRoomRow(
    count: Int,
    senders: List<Email>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val list = AppThemeDims.List
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val label = ScreeningRoom.waitingLabel(count)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.background)
            .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = "$label. Opens the Screening room"
                role = Role.Button
            },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (pressed) 0.55f else 1f)
                .padding(horizontal = list.rowHorizontalPadding, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ScreeningRoomAvatarStack(senders = senders)
            Text(
                text = label,
                color = colors.ink,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = list.title,
                letterSpacing = list.tracking,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(18.dp),
            )
        }
        HorizontalDivider(
            color = colors.line.copy(alpha = 0.65f),
            thickness = list.separatorHeight,
            modifier = Modifier.padding(horizontal = list.rowHorizontalPadding),
        )
    }
}

/**
 * Up to three overlapping sender initials, newest first (mailbox-avatar look:
 * `pillFill` circle, Inter semibold ink). No senders yet: the Screener shield.
 */
@Composable
private fun ScreeningRoomAvatarStack(senders: List<Email>) {
    val colors = inboxiesColors()
    val size = 30.dp
    val shown = senders.take(3)
    Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
        if (shown.isEmpty()) {
            Box(
                modifier = Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(colors.pillFill),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Filled.Shield,
                    contentDescription = null,
                    tint = colors.ink,
                    modifier = Modifier.size(14.dp),
                )
            }
        } else {
            shown.forEachIndexed { index, email ->
                val initials = AvatarInitials.from(email.fromAddress.resolvedName)
                Box(
                    modifier = Modifier
                        .zIndex((shown.size - index).toFloat())
                        .size(size)
                        // Background ring separates overlapping discs.
                        .border(2.dp, colors.background, CircleShape)
                        .padding(1.dp)
                        .clip(CircleShape)
                        .background(colors.pillFill),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = initials,
                        color = colors.ink,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = if (initials.length > 1) 10.sp else 11.sp,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

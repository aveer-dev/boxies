package co.inboxies.wear.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Text
import co.inboxies.wear.data.WatchDates
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailText

enum class PillRole { Primary, Standard, Destructive }

/**
 * Inboxies pills on Wear: `pillFill` stadium chips, the primary action in accent text
 * on a soft accent capsule (the phone's toast action), Report spam in red text.
 */
@Composable
fun WatchPill(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    role: PillRole = PillRole.Standard,
    enabled: Boolean = true,
) {
    val foreground = when (role) {
        PillRole.Primary -> WearColors.accent
        PillRole.Standard -> WearColors.ink
        PillRole.Destructive -> WearColors.destructive
    }
    val background = if (role == PillRole.Primary) WearColors.accentWash else WearColors.pillFill
    Chip(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        label = {
            Text(label, style = WearType.action, maxLines = 2, overflow = TextOverflow.Ellipsis)
        },
        icon = icon?.let {
            {
                Icon(it, contentDescription = null, modifier = Modifier.size(ChipDefaults.SmallIconSize))
            }
        },
        colors = ChipDefaults.chipColors(
            backgroundColor = background,
            contentColor = foreground,
            iconColor = foreground,
        ),
    )
}

/** Flat mail row: unread dot, sender, count, date, subject, one line of preview, hairline. */
@Composable
fun WatchEmailRow(email: WatchEmail, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val unread = email.isUnread
    val label = buildString {
        if (unread) append("Unread. ")
        append(email.displaySender).append(". ").append(email.displaySubject)
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .hairlineBelow(start = WearDims.rowTextInset)
            .padding(vertical = 8.dp, horizontal = 4.dp)
            .clearAndSetSemantics { contentDescription = label },
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .padding(top = 6.dp)
                .size(WearDims.unreadDot)
                .clip(CircleShape)
                .background(if (unread) WearColors.accent else Color.Transparent),
        )
        Spacer(Modifier.width(8.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        email.displaySender,
                        style = if (unread) WearType.sender else WearType.senderRead,
                        color = WearColors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    val count = email.threadCount
                    if (count != null && count > 1) {
                        Spacer(Modifier.width(4.dp))
                        Text("$count", style = WearType.meta, color = WearColors.muted)
                    }
                }
                Spacer(Modifier.width(4.dp))
                if (email.replyLater) {
                    Icon(
                        Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = WearColors.muted,
                        modifier = Modifier.size(10.dp),
                    )
                    Spacer(Modifier.width(3.dp))
                }
                Text(WatchDates.short(email.date), style = WearType.meta, color = WearColors.muted, maxLines = 1)
            }
            Text(
                email.displaySubject,
                style = WearType.subject,
                color = if (unread) WearColors.ink else WearColors.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            val snippet = email.snippet?.let { WatchMailText.plainText(it, limit = 140) }.orEmpty()
            if (snippet.isNotEmpty()) {
                Text(
                    snippet,
                    style = WearType.preview,
                    color = WearColors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** Loading placeholder: the phone's skeleton rows, pulsing (950ms, reverse). */
@Composable
fun WatchRowSkeleton(modifier: Modifier = Modifier) {
    val pulse by rememberInfiniteTransition(label = "skeleton").animateFloat(
        initialValue = 1f,
        targetValue = 0.45f,
        animationSpec = infiniteRepeatable(tween(950), RepeatMode.Reverse),
        label = "skeletonAlpha",
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = WearDims.rowTextInset, top = 10.dp, bottom = 10.dp)
            .alpha(pulse)
            .semantics { contentDescription = "Loading" },
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        SkeletonBar(Modifier.width(90.dp).height(10.dp))
        SkeletonBar(Modifier.fillMaxWidth().height(9.dp))
        SkeletonBar(Modifier.width(110.dp).height(8.dp))
    }
}

@Composable
private fun SkeletonBar(modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(4.dp)).background(WearColors.pillFill))
}

/** Centred muted message (empty Inbox, load failed). */
@Composable
fun WatchNotice(title: String, message: String?, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, style = WearType.title, color = WearColors.ink, textAlign = TextAlign.Center)
        if (!message.isNullOrEmpty()) {
            Text(message, style = WearType.subject, color = WearColors.muted, textAlign = TextAlign.Center)
        }
    }
}

/** 0.5dp `line` hairline along the bottom, starting at [start]. */
fun Modifier.hairlineBelow(start: androidx.compose.ui.unit.Dp = 0.dp): Modifier = drawBehind {
    val y = size.height - WearDims.hairline.toPx() / 2
    drawLine(
        color = WearColors.line,
        start = Offset(start.toPx(), y),
        end = Offset(size.width, y),
        strokeWidth = WearDims.hairline.toPx(),
    )
}

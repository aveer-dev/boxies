package co.inboxies.app.ui.widget

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.AvatarInitials
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.max
import kotlin.math.min

// "Today's inbox" widget, design mocks (AVE-138). Plain composables in the app: no
// Glance yet. The Glance build ports these layouts 1:1 (Row/Column/Box, fixed sizes),
// so they avoid things RemoteViews can't do except where the doc says how to replace
// them (the ambient glow becomes a bitmap / drawable background).
// iOS twin: `Views/WidgetDesign/InboxWidgetMock.swift`.

/** Widget tokens. Colors stay `inboxiesColors()` grey-scale (no `accent`, no new hues); these are sizes and the ink-bloom recipe. */
object InboxWidgetMetrics {
    /** Representative cell sizes on a 4-column phone launcher (Pixel, ~412.dp wide). */
    val smallSize = DpSize(176.dp, 176.dp)
    val mediumSize = DpSize(368.dp, 176.dp)
    /** Matches `@android:dimen/system_app_widget_background_radius` on Pixel launchers. */
    val cornerRadius = 24.dp
    val padding = 16.dp
    val countSize = 46.sp
    val avatarSize = 28.dp
    val rowAvatarSize = 26.dp
    val avatarOverlap = 9.dp
    val avatarRing = 2.dp
    val threadPanelRadius = 16.dp

    /**
     * Ambient ink bloom strength (`ink` alpha at the hot corner): a soft graphite shade in
     * light, a pale moonlit glow in dark. Grows with New, saturates at [glowFullAt].
     */
    const val glowCalm = 0.03f
    const val glowActiveLight = 0.15f
    const val glowActiveDark = 0.17f
    const val glowFullAt = 5

    fun glowStrength(newCount: Int, dark: Boolean): Float {
        if (newCount <= 0) return glowCalm
        val active = if (dark) glowActiveDark else glowActiveLight
        val ratio = min(newCount, glowFullAt).toFloat() / glowFullAt
        // Even one new message is clearly brighter than inbox zero.
        return glowCalm + (active - glowCalm) * (0.55f + 0.45f * ratio)
    }
}

enum class InboxWidgetFamily(val size: DpSize) {
    /** 2×2 cells. */
    Small(InboxWidgetMetrics.smallSize),
    /** 4×2 cells. */
    Medium(InboxWidgetMetrics.mediumSize),
}

/** One "Today's inbox" widget at a family's size: has-mail or inbox-zero, from the snapshot. */
@Composable
fun InboxWidgetMock(
    family: InboxWidgetFamily,
    snapshot: InboxWidgetSnapshot,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(InboxWidgetMetrics.cornerRadius)
    Box(
        modifier = modifier
            .size(family.size)
            .clip(shape)
            .inboxWidgetAmbientBackground(snapshot.newCount)
            .border(0.5.dp, colors.line.copy(alpha = 0.6f), shape)
            .padding(InboxWidgetMetrics.padding),
    ) {
        when {
            family == InboxWidgetFamily.Small && !snapshot.isInboxZero -> SmallHasMail(snapshot)
            family == InboxWidgetFamily.Small -> SmallInboxZero(snapshot)
            !snapshot.isInboxZero -> MediumHasMail(snapshot)
            else -> MediumInboxZero(snapshot)
        }
    }
}

// region Ambient background

/**
 * Surface with a soft ink bloom (grey-scale only): a hot corner top-end and a dimmer echo
 * bottom-start. Deeper as New grows; nearly gone at inbox zero.
 */
@Composable
private fun Modifier.inboxWidgetAmbientBackground(newCount: Int): Modifier {
    val colors = inboxiesColors()
    val strength = InboxWidgetMetrics.glowStrength(newCount, colors.isDark)
    val sheen = Color.White.copy(alpha = if (colors.isDark) 0.05f else 0.35f)
    return this.drawBehind {
        val reach = max(size.width, size.height)
        drawRect(colors.surface)
        drawRect(
            Brush.radialGradient(
                colors = listOf(colors.ink.copy(alpha = strength), colors.ink.copy(alpha = 0f)),
                center = Offset(size.width * 1.0f, size.height * -0.05f),
                radius = reach * 0.95f,
            ),
        )
        drawRect(
            Brush.radialGradient(
                colors = listOf(colors.ink.copy(alpha = strength * 0.45f), colors.ink.copy(alpha = 0f)),
                center = Offset(size.width * -0.1f, size.height * 1.1f),
                radius = reach * 0.7f,
            ),
        )
        // Top sheen so the frosted pills have something to catch.
        drawRect(
            Brush.verticalGradient(
                colors = listOf(sheen, Color.Transparent),
                startY = 0f,
                endY = size.height / 2f,
            ),
        )
    }
}

/**
 * Frosted glass that Glance can reproduce: translucent surface + white hairline, no
 * blur or shadow (RemoteViews can't draw either). Lighter than the app's
 * [co.inboxies.app.theme.liquidGlass] chrome so the glow shows through.
 */
@Composable
private fun Modifier.inboxWidgetFrost(shape: Shape): Modifier {
    val colors = inboxiesColors()
    return this
        .clip(shape)
        .background(colors.surface.copy(alpha = if (colors.isDark) 0.42f else 0.62f), shape)
        .border(0.5.dp, Color.White.copy(alpha = if (colors.isDark) 0.14f else 0.7f), shape)
}

// endregion

// region Small (2×2)

@Composable
private fun SmallHasMail(snapshot: InboxWidgetSnapshot) {
    val colors = inboxiesColors()
    Column(modifier = Modifier.fillMaxSize()) {
        InboxWidgetHeader(isLive = true)
        Spacer(Modifier.weight(1f))
        InboxWidgetCount(snapshot.newCount)
        Text(
            if (snapshot.newCount == 1) "New conversation" else "New conversations",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            color = colors.muted,
            modifier = Modifier.padding(top = 2.dp),
        )
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            InboxWidgetAvatarStack(
                names = snapshot.threads.map { it.senderName },
                extra = max(snapshot.newCount - snapshot.threads.size, 0),
            )
            Spacer(Modifier.weight(1f))
            if (snapshot.replyLaterCount > 0) {
                InboxWidgetReplyLaterPill(snapshot.replyLaterCount, compact = true)
            }
        }
    }
}

@Composable
private fun SmallInboxZero(snapshot: InboxWidgetSnapshot) {
    val colors = inboxiesColors()
    Column(modifier = Modifier.fillMaxSize()) {
        InboxWidgetHeader(isLive = false)
        Spacer(Modifier.weight(1f))
        InboxWidgetZeroMark(38.dp)
        Text(
            "Inbox zero",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 17.sp,
            color = colors.ink,
            modifier = Modifier.padding(top = 10.dp),
        )
        Text(
            InboxWidgetSnapshot.inboxZeroLine(snapshot.updatedAt),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            color = colors.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

// endregion

// region Medium (4×2)

@Composable
private fun MediumHasMail(snapshot: InboxWidgetSnapshot) {
    val colors = inboxiesColors()
    Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(modifier = Modifier.width(108.dp).fillMaxHeight()) {
            InboxWidgetHeader(isLive = true)
            Spacer(Modifier.weight(1f))
            InboxWidgetCount(snapshot.newCount)
            Text(
                "New",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                color = colors.muted,
                modifier = Modifier.padding(top = 2.dp),
            )
            Spacer(Modifier.height(10.dp))
            if (snapshot.replyLaterCount > 0) {
                InboxWidgetReplyLaterPill(snapshot.replyLaterCount, compact = false)
            }
        }
        InboxWidgetThreadPanel(
            threads = snapshot.threads.take(3),
            modifier = Modifier.weight(1f).fillMaxHeight(),
        )
    }
}

@Composable
private fun MediumInboxZero(snapshot: InboxWidgetSnapshot) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier.fillMaxSize(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        InboxWidgetZeroMark(64.dp)
        Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
            InboxWidgetHeader(isLive = false)
            Text(
                "Inbox zero",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                letterSpacing = (-0.3).sp,
                color = colors.ink,
                modifier = Modifier.padding(top = 14.dp),
            )
            Text(
                InboxWidgetSnapshot.inboxZeroLine(snapshot.updatedAt),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 3.dp),
            )
            Spacer(Modifier.weight(1f))
            if (snapshot.replyLaterCount > 0) {
                InboxWidgetReplyLaterPill(snapshot.replyLaterCount, compact = false)
            }
        }
    }
}

// endregion

// region Pieces

/** "Inbox" with the tray glyph; the unread dot when there's something new. */
@Composable
private fun InboxWidgetHeader(isLive: Boolean) {
    val colors = inboxiesColors()
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(Icons.Rounded.Inbox, contentDescription = null, tint = colors.ink, modifier = Modifier.size(13.dp))
        Text(
            "Inbox",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
            color = colors.ink.copy(alpha = 0.8f),
        )
        if (isLive) {
            Box(Modifier.size(5.dp).background(colors.unread, CircleShape))
        }
    }
}

@Composable
private fun InboxWidgetCount(count: Int) {
    Text(
        if (count > 99) "99+" else count.toString(),
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = InboxWidgetMetrics.countSize,
        lineHeight = InboxWidgetMetrics.countSize,
        letterSpacing = (-1.5).sp,
        color = inboxiesColors().ink,
        maxLines = 1,
    )
}

/** Initials avatar: grey ink-tinted disc (lightens down the stack), ringed in surface so overlaps read cleanly. */
@Composable
fun InboxWidgetAvatar(name: String, size: Dp = InboxWidgetMetrics.avatarSize, index: Int = 0) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(size)
            .background(colors.surface, CircleShape)
            .background(colors.ink.copy(alpha = 0.14f - index * 0.03f), CircleShape)
            .border(InboxWidgetMetrics.avatarRing, colors.surface, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            AvatarInitials.from(name),
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.38f).sp,
            color = colors.ink,
            maxLines = 1,
        )
    }
}

@Composable
private fun InboxWidgetAvatarStack(names: List<String>, extra: Int) {
    val colors = inboxiesColors()
    val step = InboxWidgetMetrics.avatarSize - InboxWidgetMetrics.avatarOverlap
    val shown = names.take(3)
    val slots = shown.size + if (extra > 0) 1 else 0
    Box(modifier = Modifier.width(InboxWidgetMetrics.avatarSize + step * (slots - 1).coerceAtLeast(0))) {
        // Draw back to front so the first sender sits on top.
        if (extra > 0) {
            Box(
                modifier = Modifier
                    .offset(x = step * shown.size)
                    .size(InboxWidgetMetrics.avatarSize)
                    .background(colors.pillFill, CircleShape)
                    .border(InboxWidgetMetrics.avatarRing, colors.surface, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "+$extra",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 10.sp,
                    color = colors.muted,
                )
            }
        }
        shown.withIndex().reversed().forEach { (index, name) ->
            Box(Modifier.offset(x = step * index)) { InboxWidgetAvatar(name, index = index) }
        }
    }
}

/** Frosted pill: clock glyph + count ("2" compact, "2 Reply later" otherwise). */
@Composable
private fun InboxWidgetReplyLaterPill(count: Int, compact: Boolean) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .height(24.dp)
            .inboxWidgetFrost(RoundedCornerShape(50))
            .padding(horizontal = if (compact) 8.dp else 9.dp)
            .semantics { contentDescription = "$count Reply later" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(Icons.Outlined.Schedule, contentDescription = null, tint = colors.ink.copy(alpha = 0.85f), modifier = Modifier.size(12.dp))
        Text(
            if (compact) "$count" else "$count Reply later",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 11.sp,
            color = colors.ink.copy(alpha = 0.85f),
            maxLines = 1,
        )
    }
}

/** Inbox-zero mark: ink check inside a frosted disc with a faint ink halo. */
@Composable
private fun InboxWidgetZeroMark(size: Dp) {
    val colors = inboxiesColors()
    Box(modifier = Modifier.size(size).wrapContentSize(unbounded = true), contentAlignment = Alignment.Center) {
        // Soft halo: a radial wash past the disc edge (Glance: a drawable behind the disc).
        Box(
            Modifier
                .size(size * 1.6f)
                .background(
                    Brush.radialGradient(
                        colors = listOf(colors.ink.copy(alpha = 0.12f), colors.ink.copy(alpha = 0f)),
                    ),
                    CircleShape,
                ),
        )
        Box(
            modifier = Modifier.size(size).inboxWidgetFrost(CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Check, contentDescription = null, tint = colors.ink, modifier = Modifier.size(size * 0.48f))
        }
    }
}

/** Top three New threads in one frosted panel with flat rows and hairlines. */
@Composable
private fun InboxWidgetThreadPanel(threads: List<InboxWidgetSnapshot.Thread>, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Column(modifier = modifier.inboxWidgetFrost(RoundedCornerShape(InboxWidgetMetrics.threadPanelRadius))) {
        threads.forEachIndexed { index, thread ->
            if (index > 0) {
                Box(
                    Modifier
                        .padding(start = 10.dp + InboxWidgetMetrics.rowAvatarSize + 9.dp)
                        .fillMaxWidth()
                        .height(AppThemeDims.List.separatorHeight)
                        .background(colors.line.copy(alpha = 0.65f)),
                )
            }
            InboxWidgetThreadRow(thread, index, Modifier.weight(1f))
        }
    }
}

private val rowTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

@Composable
private fun InboxWidgetThreadRow(thread: InboxWidgetSnapshot.Thread, index: Int, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Row(
        modifier = modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        InboxWidgetAvatar(thread.senderName, InboxWidgetMetrics.rowAvatarSize, index)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    thread.senderName,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    thread.receivedAt.format(rowTimeFormatter),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.List.date,
                    color = colors.muted,
                    maxLines = 1,
                    modifier = Modifier.padding(start = 6.dp),
                )
            }
            Text(
                thread.subject,
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                color = colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// endregion

// region Previews

@Composable
private fun WidgetPreviewFrame(dark: Boolean, content: @Composable () -> Unit) {
    InboxiesTheme(themeMode = if (dark) ThemeMode.DARK else ThemeMode.LIGHT) {
        Box(Modifier.background(inboxiesColors().background).padding(12.dp)) { content() }
    }
}

@Preview(name = "2×2 · new mail · light", widthDp = 200, heightDp = 200)
@Composable
private fun SmallHasMailLightPreview() = WidgetPreviewFrame(dark = false) {
    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "2×2 · new mail · dark", widthDp = 200, heightDp = 200)
@Composable
private fun SmallHasMailDarkPreview() = WidgetPreviewFrame(dark = true) {
    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "2×2 · inbox zero · light", widthDp = 200, heightDp = 200)
@Composable
private fun SmallInboxZeroLightPreview() = WidgetPreviewFrame(dark = false) {
    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleInboxZero)
}

@Preview(name = "2×2 · inbox zero · dark", widthDp = 200, heightDp = 200)
@Composable
private fun SmallInboxZeroDarkPreview() = WidgetPreviewFrame(dark = true) {
    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleInboxZero)
}

@Preview(name = "4×2 · new mail · light", widthDp = 392, heightDp = 200)
@Composable
private fun MediumHasMailLightPreview() = WidgetPreviewFrame(dark = false) {
    InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "4×2 · new mail · dark", widthDp = 392, heightDp = 200)
@Composable
private fun MediumHasMailDarkPreview() = WidgetPreviewFrame(dark = true) {
    InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "4×2 · inbox zero · light", widthDp = 392, heightDp = 200)
@Composable
private fun MediumInboxZeroLightPreview() = WidgetPreviewFrame(dark = false) {
    InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleInboxZero)
}

@Preview(name = "4×2 · inbox zero · dark", widthDp = 392, heightDp = 200)
@Composable
private fun MediumInboxZeroDarkPreview() = WidgetPreviewFrame(dark = true) {
    InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleInboxZero)
}

// endregion

package co.inboxies.app.ui.widget

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.min

// "Today's inbox" widget, round 2: depth (AVE-138). A deck of New mail you can flip
// through on the home screen. Glance can do all of it: the back cards (shade + soft
// shadow, no text) are one pre-rendered bitmap background, the front card is a Box with
// cornerRadius, and › is an `actionRunCallback` that bumps the front index in the widget
// state. RemoteViews swaps the content without an animation; the spring here is the
// in-app stand-in only. No gestures, tilt or continuous motion. iOS twin:
// `Views/WidgetDesign/InboxWidgetDepth.swift`.

/** Card-stack tokens. Shade and shadows are black (the glass chrome's shadow color), so the stack stays grey-scale. */
object InboxWidgetDepthMetrics {
    const val backLayers = 2
    /** Each card back shrinks by this much (anchored at its top edge)... */
    const val scaleStep = 0.06f
    /** ...and peeks this far above the card in front of it. */
    val rise = 7.dp
    /** `Color.Black` laid over each card back, per layer (light / dark). */
    const val shadeLight = 0.045f
    const val shadeDark = 0.16f
    /** Dark mode lifts the front card with a little `ink` (elevated surfaces are lighter). */
    const val frontLiftDark = 0.05f
    val cardRadius = 16.dp
    const val cardShadowLight = 0.10f
    const val cardShadowDark = 0.45f
    const val lipLight = 0.95f
    const val lipDark = 0.16f
    val nextButtonSize = 26.dp
    val dotSize = 4.dp
    /** Where a dealt card goes: off to the end side with a slight turn. */
    val dealOffsetX = 52.dp
    val dealOffsetY = 10.dp
    const val dealRotation = 7f
    /** Inbox-zero mark floats this far above its ground shadow (at 64.dp). */
    val floatHeight = 8.dp
}

/** Where a card sits in the deck; same math as iOS `InboxWidgetDeckPose.forSlot`. */
data class InboxWidgetDeckPose(
    val scale: Float = 1f,
    val offsetX: Dp = 0.dp,
    val offsetY: Dp = 0.dp,
    val rotation: Float = 0f,
    val alpha: Float = 1f,
    val depth: Int = 0,
    val z: Float = 0f,
) {
    companion object {
        fun forSlot(slot: Int, count: Int, spread: Float = 1f): InboxWidgetDeckPose {
            val m = InboxWidgetDepthMetrics
            val visible = m.backLayers + 1
            if (count > visible && slot == count - 1) {
                return InboxWidgetDeckPose(
                    offsetX = m.dealOffsetX,
                    offsetY = m.dealOffsetY,
                    rotation = m.dealRotation,
                    alpha = 0f,
                    z = 10f,
                )
            }
            val layer = min(slot, visible)
            return InboxWidgetDeckPose(
                scale = 1f - m.scaleStep * layer,
                offsetY = -(m.rise * spread * layer.toFloat()),
                alpha = if (slot < visible) 1f else 0f,
                depth = layer,
                z = (visible - layer).toFloat(),
            )
        }
    }
}

private val chromeSpring = spring<Float>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

/**
 * One "Today's inbox" widget in the depth direction: a card deck for New mail, a floating
 * check for inbox zero. [onNext] stands in for the Glance `actionRunCallback<ShowNextThread>()`.
 */
@Composable
fun InboxWidgetDepthMock(
    family: InboxWidgetFamily,
    snapshot: InboxWidgetSnapshot,
    modifier: Modifier = Modifier,
    front: Int = 0,
    spread: Float = 1f,
    onNext: (() -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(InboxWidgetMetrics.cornerRadius)
    val deckTop = InboxWidgetDepthMetrics.rise * (InboxWidgetDepthMetrics.backLayers * spread)
    Box(
        modifier = modifier
            .size(family.size)
            .clip(shape)
            .inboxWidgetAmbientBackground(snapshot.newCount)
            .border(0.5.dp, colors.line.copy(alpha = 0.6f), shape)
            .padding(InboxWidgetMetrics.padding),
    ) {
        when {
            family == InboxWidgetFamily.Small && !snapshot.isInboxZero -> Column(Modifier.fillMaxSize()) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    InboxWidgetHeader(isLive = true)
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${snapshot.newCount}",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = colors.ink,
                    )
                    Text(
                        " new",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
                InboxWidgetDeck(
                    threads = snapshot.threads,
                    front = front,
                    compact = true,
                    spread = spread,
                    onNext = onNext,
                    modifier = Modifier.padding(top = 10.dp + deckTop).weight(1f),
                )
            }
            family == InboxWidgetFamily.Small -> Column(Modifier.fillMaxSize()) {
                InboxWidgetHeader(isLive = false)
                Spacer(Modifier.weight(1f))
                InboxWidgetFloatingZeroMark(38.dp)
                Text(
                    "Inbox zero",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(top = 12.dp),
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
            !snapshot.isInboxZero -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.width(108.dp).fillMaxHeight()) {
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
                InboxWidgetDeck(
                    threads = snapshot.threads,
                    front = front,
                    compact = false,
                    spread = spread,
                    onNext = onNext,
                    modifier = Modifier.weight(1f).fillMaxHeight().padding(top = deckTop),
                )
            }
            else -> Row(
                Modifier.fillMaxSize(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                InboxWidgetFloatingZeroMark(64.dp)
                Column(Modifier.weight(1f).fillMaxHeight()) {
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
    }
}

// region Deck

/** Every stored thread is drawn, posed by its slot from [front] (the front card wraps around). */
@Composable
fun InboxWidgetDeck(
    threads: List<InboxWidgetSnapshot.Thread>,
    front: Int,
    compact: Boolean,
    modifier: Modifier = Modifier,
    spread: Float = 1f,
    onNext: (() -> Unit)? = null,
) {
    val count = threads.size
    Box(modifier = modifier.fillMaxWidth()) {
        threads.forEachIndexed { index, thread ->
            androidx.compose.runtime.key(thread.id) {
                val slot = if (count == 0) 0 else ((index - front) % count + count) % count
                val pose = InboxWidgetDeckPose.forSlot(slot, count, spread)
                val scale by animateFloatAsState(pose.scale, chromeSpring, label = "deckScale")
                val x by animateFloatAsState(pose.offsetX.value, chromeSpring, label = "deckX")
                val y by animateFloatAsState(pose.offsetY.value, chromeSpring, label = "deckY")
                val rotation by animateFloatAsState(pose.rotation, chromeSpring, label = "deckRotation")
                val alpha by animateFloatAsState(pose.alpha, chromeSpring, label = "deckAlpha")
                val shade by animateFloatAsState(pose.depth.toFloat(), chromeSpring, label = "deckShade")
                val contentAlpha by animateFloatAsState(if (slot == 0) 1f else 0f, chromeSpring, label = "deckContent")
                InboxWidgetDeckCard(
                    thread = thread,
                    shadeLayers = shade,
                    contentAlpha = contentAlpha,
                    compact = compact,
                    position = index,
                    total = count,
                    onNext = if (slot == 0) onNext else null,
                    modifier = Modifier
                        .zIndex(pose.z)
                        .offset(x = x.dp, y = y.dp)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            rotationZ = rotation
                            this.alpha = alpha
                            transformOrigin = TransformOrigin(0.5f, if (rotation != 0f) 1f else 0f)
                        },
                )
            }
        }
    }
}

/** One card. Back cards keep their content but hide it, so it fades in as they come forward. */
@Composable
private fun InboxWidgetDeckCard(
    thread: InboxWidgetSnapshot.Thread,
    shadeLayers: Float,
    contentAlpha: Float,
    compact: Boolean,
    position: Int,
    total: Int,
    onNext: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val m = InboxWidgetDepthMetrics
    val shape = RoundedCornerShape(m.cardRadius)
    val shade = Color.Black.copy(alpha = (if (colors.isDark) m.shadeDark else m.shadeLight) * shadeLayers)
    val lift = if (colors.isDark) colors.ink.copy(alpha = m.frontLiftDark) else Color.Transparent
    val lip = Color.White.copy(alpha = if (colors.isDark) m.lipDark else m.lipLight)
    Column(
        modifier = modifier
            .fillMaxSize()
            .shadow(
                elevation = 6.dp,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = if (colors.isDark) m.cardShadowDark else m.cardShadowLight),
                spotColor = Color.Black.copy(alpha = if (colors.isDark) m.cardShadowDark else m.cardShadowLight),
            )
            .background(colors.surface, shape)
            .background(lift, shape)
            .background(shade, shape)
            .border(0.5.dp, colors.line.copy(alpha = if (colors.isDark) 0.5f else 0.7f), shape)
            // Light on the top lip, fading down: reads as a card with thickness.
            .border(0.75.dp, Brush.verticalGradient(0f to lip, 0.5f to Color.Transparent), shape)
            .padding(if (compact) 10.dp else 12.dp)
            .graphicsLayer { alpha = contentAlpha },
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp)) {
            InboxWidgetAvatar(thread.senderName, if (compact) 20.dp else 24.dp)
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
            if (!compact) {
                Text(
                    thread.receivedAt.format(deckTimeFormatter),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.List.date,
                    color = colors.muted,
                    maxLines = 1,
                )
            }
        }
        Text(
            thread.subject,
            fontFamily = InterFontFamily,
            fontSize = if (compact) 11.sp else 12.sp,
            lineHeight = if (compact) 14.sp else 16.sp,
            color = colors.muted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = if (compact) 5.dp else 7.dp),
        )
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            InboxWidgetDeckDots(position, total)
            Spacer(Modifier.weight(1f))
            InboxWidgetNextButton(onNext)
        }
    }
}

private val deckTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

@Composable
private fun InboxWidgetDeckDots(position: Int, total: Int) {
    val colors = inboxiesColors()
    val dot = InboxWidgetDepthMetrics.dotSize
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.semantics { contentDescription = "Email ${position + 1} of $total" },
    ) {
        repeat(min(total, InboxWidgetSnapshot.MAX_THREADS)) { index ->
            Box(
                Modifier
                    .size(width = if (index == position) dot * 2.5f else dot, height = dot)
                    .background(colors.ink.copy(alpha = if (index == position) 0.85f else 0.18f), CircleShape),
            )
        }
    }
}

/** The deck's › control. In Glance: `actionRunCallback<ShowNextThreadAction>()`. */
@Composable
fun InboxWidgetNextButton(onNext: (() -> Unit)?) {
    val colors = inboxiesColors()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val pressScale by animateFloatAsState(if (pressed) 0.92f else 1f, chromeSpring, label = "nextPress")
    Box(
        modifier = Modifier
            .size(InboxWidgetDepthMetrics.nextButtonSize)
            .graphicsLayer {
                scaleX = pressScale
                scaleY = pressScale
            }
            .shadow(3.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.18f), spotColor = Color.Black.copy(alpha = 0.18f))
            .background(colors.ink, CircleShape)
            .clickable(interactionSource = interaction, indication = null, enabled = onNext != null) { onNext?.invoke() }
            .semantics { contentDescription = "Next email" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.AutoMirrored.Rounded.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.surface,
            modifier = Modifier.size(18.dp),
        )
    }
}

// endregion

// region Inbox zero

/** The inbox-zero check lifted off the widget over a soft ground shadow (Glance: a drawable/bitmap ellipse). Static. */
@Composable
fun InboxWidgetFloatingZeroMark(size: Dp) {
    val colors = inboxiesColors()
    val lift = InboxWidgetDepthMetrics.floatHeight * (size.value / 64f)
    val shadowAlpha = if (colors.isDark) 0.55f else 0.16f
    Box(
        modifier = Modifier
            .size(size)
            .drawBehind {
                val w = this.size.width * 0.78f
                val h = this.size.height * 0.16f
                val center = Offset(this.size.width / 2f, this.size.height + this.size.height * 0.06f - h / 2f)
                drawOval(
                    brush = Brush.radialGradient(
                        colors = listOf(Color.Black.copy(alpha = shadowAlpha), Color.Transparent),
                        center = center,
                        radius = w / 2f,
                    ),
                    topLeft = Offset(center.x - w / 2f, center.y - h / 2f),
                    size = androidx.compose.ui.geometry.Size(w, h),
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.offset(y = -lift)) { InboxWidgetZeroMark(size) }
    }
}

// endregion

// region Previews

@Composable
private fun DepthPreviewFrame(dark: Boolean, content: @Composable () -> Unit) {
    InboxiesTheme(themeMode = if (dark) ThemeMode.DARK else ThemeMode.LIGHT) {
        Box(Modifier.background(inboxiesColors().background).padding(12.dp)) { content() }
    }
}

@Preview(name = "Depth · 2×2 · new mail · light", widthDp = 200, heightDp = 200)
@Composable
private fun DepthSmallLightPreview() = DepthPreviewFrame(dark = false) {
    InboxWidgetDepthMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "Depth · 2×2 · inbox zero · dark", widthDp = 200, heightDp = 200)
@Composable
private fun DepthSmallZeroDarkPreview() = DepthPreviewFrame(dark = true) {
    InboxWidgetDepthMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleInboxZero)
}

@Preview(name = "Depth · 4×2 · new mail · light", widthDp = 392, heightDp = 200)
@Composable
private fun DepthMediumLightPreview() = DepthPreviewFrame(dark = false) {
    InboxWidgetDepthMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleHasMail)
}

@Preview(name = "Depth · 4×2 · new mail · dark", widthDp = 392, heightDp = 200)
@Composable
private fun DepthMediumDarkPreview() = DepthPreviewFrame(dark = true) {
    InboxWidgetDepthMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleHasMail, front = 2)
}

@Preview(name = "Depth · 4×2 · inbox zero · light", widthDp = 392, heightDp = 200)
@Composable
private fun DepthMediumZeroLightPreview() = DepthPreviewFrame(dark = false) {
    InboxWidgetDepthMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleInboxZero)
}

// endregion

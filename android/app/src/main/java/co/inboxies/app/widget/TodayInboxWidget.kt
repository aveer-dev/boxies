package co.inboxies.app.widget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.annotation.DrawableRes
import androidx.annotation.LayoutRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.layout.wrapContentHeight
import androidx.glance.layout.wrapContentWidth
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.state.GlanceStateDefinition
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.unit.ColorProvider
import co.inboxies.app.MainActivity
import co.inboxies.app.R
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.AvatarInitials
import co.inboxies.app.ui.widget.InboxWidgetDepthMetrics
import co.inboxies.app.ui.widget.InboxWidgetFamily
import co.inboxies.app.ui.widget.InboxWidgetMetrics
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.min

/**
 * "Today's inbox" home-screen widget (AVE-150), round 2 "Depth" from
 * `docs/widget-design.md`. iOS twin: `InboxiesWidget/TodayInboxWidget.swift` (AVE-149).
 *
 * - 2×2 and 4×2 layouts (design sizes 176×176 / 368×176dp), picked by the cell's real
 *   width; the system clips to its widget radius.
 * - New mail is a deck: the front card is a live `Box` (tap → thread, › → next card),
 *   the card backs and every shadow are one bitmap behind it ([InboxWidgetArt]).
 *   RemoteViews can't animate, so › swaps cards instantly.
 * - Inbox zero is the floating check and the daily line.
 * - Grey-scale `InboxiesColors` only. Text is Inter (`res/font`) where the launcher loads
 *   app fonts; RemoteViews usually inflate in a restricted context that skips them, and
 *   then the system sans shows at the same weights.
 *
 * Data comes from [InboxWidgetStore] (written by the app); each widget keeps its own
 * deck position and mailbox in its Glance state ([InboxWidgetDeckState]).
 */
class TodayInboxWidget : GlanceAppWidget() {
    /**
     * Exact, not Responsive: the deck and bloom bitmaps must be drawn at the cell's real
     * size, and launchers' real cells don't match the design sizes (a Pixel 2×2 is
     * about 172×234dp, smaller than the 176×176 breakpoint, so Responsive found no fit
     * and drew stretched bitmaps). The layout is picked by width instead
     * ([MEDIUM_MIN_WIDTH]); the system keeps one RemoteViews per orientation.
     */
    override val sizeMode: SizeMode = SizeMode.Exact

    override val stateDefinition: GlanceStateDefinition<*> = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = InboxWidgetStore.from(context)
        provideContent {
            val prefs = currentState<Preferences>()
            // Read so a data write from the app (which bumps it) recomposes this widget.
            prefs[InboxWidgetDeckState.dataVersionKey]
            val mailboxId = store.resolveMailboxId(InboxWidgetDeckState.configuredMailboxId(prefs))
            val snapshot = mailboxId?.let(store::snapshot)
            TodayInboxContent(snapshot, InboxWidgetDeckState.frontIndex(prefs, snapshot), mailboxId)
        }
    }

    companion object {
        /** The mailbox › flips the deck for. */
        val mailboxParam = ActionParameters.Key<String>("mailboxId")
    }
}

class TodayInboxWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayInboxWidget()
}

// region Layout

private val Padding = InboxWidgetMetrics.padding
private val HeaderHeight = 16.dp
private val Inset = InboxWidgetArt.frontInset

/** From this width the widget uses the 4×2 layout (a Pixel 4×2 is ~330–370dp wide, a 3×2 ~250dp). */
private val MEDIUM_MIN_WIDTH = 300.dp

/** Width of the medium widget's left column (count, "New", Reply later). */
private val MediumColumnWidth = 108.dp
private const val ZERO_PAD_SMALL = 6
private const val ZERO_PAD_MEDIUM = 10

@Composable
private fun TodayInboxContent(snapshot: InboxWidgetSnapshot?, front: Int, mailboxId: String?) {
    val context = LocalContext.current
    val size = LocalSize.current
    val palette = WidgetPalette(isDark = context.isNightMode())
    val family = if (size.width >= MEDIUM_MIN_WIDTH) InboxWidgetFamily.Medium else InboxWidgetFamily.Small
    val newCount = snapshot?.newCount ?: 0
    val bloom = InboxWidgetArt.bloom(size.width.value, size.height.value, newCount, palette)
    Box(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ImageProvider(bloom), ContentScale.FillBounds)
            .cornerRadius(android.R.dimen.system_app_widget_background_radius)
            .appWidgetBackground()
            .clickable(actionStartActivity(widgetIntent(context, InboxWidgetLink.Inbox(snapshot?.mailboxId ?: mailboxId))))
            .semantics { contentDescription = widgetDescription(snapshot) },
    ) {
        when {
            snapshot == null -> SignedOutContent(palette)
            snapshot.isInboxZero && family == InboxWidgetFamily.Small -> SmallInboxZero(snapshot, palette)
            snapshot.isInboxZero -> MediumInboxZero(snapshot, palette)
            family == InboxWidgetFamily.Small -> SmallNewMail(snapshot, front, palette)
            else -> MediumNewMail(snapshot, front, palette)
        }
    }
}

/** No snapshot yet (signed out, or the app hasn't loaded the Inbox): open the app. */
@Composable
private fun SignedOutContent(palette: WidgetPalette) {
    Column(modifier = GlanceModifier.fillMaxSize().padding(Padding)) {
        Header(isLive = false, palette = palette)
        Spacer(GlanceModifier.defaultWeight())
        InterText("Today's inbox", InterWeight.SemiBold, 17.sp, palette.ink)
        Spacer(GlanceModifier.height(2.dp))
        InterText("Open Inboxies to see what's new.", InterWeight.Regular, 12.sp, palette.muted, maxLines = 2)
    }
}

@Composable
private fun SmallNewMail(snapshot: InboxWidgetSnapshot, front: Int, palette: WidgetPalette) {
    val size = LocalSize.current
    Column(modifier = GlanceModifier.fillMaxSize()) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().height(HeaderHeight + Padding).padding(start = Padding, end = Padding, top = Padding),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Header(isLive = true, palette = palette)
            Spacer(GlanceModifier.defaultWeight())
            InterText(countText(snapshot.newCount), InterWeight.Bold, 13.sp, palette.ink)
            InterText(" new", InterWeight.Medium, 12.sp, palette.muted)
        }
        val deckWidth = size.width - (Padding - Inset.start) * 2
        val deckHeight = size.height - Padding - HeaderHeight - 10.dp - (Padding - Inset.bottom)
        Deck(
            snapshot = snapshot,
            front = front,
            compact = true,
            widthDp = deckWidth,
            heightDp = deckHeight,
            palette = palette,
            modifier = GlanceModifier.fillMaxWidth().defaultWeight()
                .padding(start = Padding - Inset.start, end = Padding - Inset.end, top = 10.dp, bottom = Padding - Inset.bottom),
        )
    }
}

@Composable
private fun MediumNewMail(snapshot: InboxWidgetSnapshot, front: Int, palette: WidgetPalette) {
    val size = LocalSize.current
    Row(modifier = GlanceModifier.fillMaxSize()) {
        Column(
            modifier = GlanceModifier.width(Padding + MediumColumnWidth).fillMaxHeight()
                .padding(start = Padding, top = Padding, bottom = Padding),
        ) {
            Header(isLive = true, palette = palette)
            Spacer(GlanceModifier.defaultWeight())
            CountText(snapshot.newCount, palette)
            Spacer(GlanceModifier.height(2.dp))
            InterText("New", InterWeight.Medium, 12.sp, palette.muted)
            Spacer(GlanceModifier.height(10.dp))
            if (snapshot.replyLaterCount > 0) ReplyLaterPill(snapshot.replyLaterCount, compact = false, palette = palette)
        }
        Spacer(GlanceModifier.width(12.dp - Inset.start))
        val deckWidth = size.width - Padding - MediumColumnWidth - (12.dp - Inset.start) - (Padding - Inset.end)
        val deckHeight = size.height - Padding - (Padding - Inset.bottom)
        Deck(
            snapshot = snapshot,
            front = front,
            compact = false,
            widthDp = deckWidth,
            heightDp = deckHeight,
            palette = palette,
            modifier = GlanceModifier.defaultWeight().fillMaxHeight()
                .padding(top = Padding, end = Padding - Inset.end, bottom = Padding - Inset.bottom),
        )
    }
}

@Composable
private fun SmallInboxZero(snapshot: InboxWidgetSnapshot, palette: WidgetPalette) {
    val pad = ZERO_PAD_SMALL.dp
    Column(modifier = GlanceModifier.fillMaxSize().padding(top = Padding, bottom = Padding)) {
        Box(GlanceModifier.padding(horizontal = Padding)) { Header(isLive = false, palette = palette) }
        Spacer(GlanceModifier.defaultWeight())
        Box(GlanceModifier.padding(start = Padding - pad)) { FloatingZeroMark(38.dp, pad, palette) }
        Column(GlanceModifier.padding(horizontal = Padding)) {
            Spacer(GlanceModifier.height(12.dp - pad))
            InterText("Inbox zero", InterWeight.SemiBold, 17.sp, palette.ink)
            Spacer(GlanceModifier.height(2.dp))
            InterText(InboxWidgetSnapshot.inboxZeroLine(ZonedDateTime.now()), InterWeight.Regular, 12.sp, palette.muted, maxLines = 2)
        }
    }
}

@Composable
private fun MediumInboxZero(snapshot: InboxWidgetSnapshot, palette: WidgetPalette) {
    val pad = ZERO_PAD_MEDIUM.dp
    Row(
        modifier = GlanceModifier.fillMaxSize().padding(start = Padding - pad, top = Padding, end = Padding, bottom = Padding),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FloatingZeroMark(64.dp, pad, palette)
        Spacer(GlanceModifier.width(18.dp - pad))
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Header(isLive = false, palette = palette)
            Spacer(GlanceModifier.height(14.dp))
            InterText("Inbox zero", InterWeight.Bold, 22.sp, palette.ink, letterSpacingEm = -0.3f / 22f)
            Spacer(GlanceModifier.height(3.dp))
            InterText(InboxWidgetSnapshot.inboxZeroLine(ZonedDateTime.now()), InterWeight.Regular, 13.sp, palette.muted, maxLines = 2)
            Spacer(GlanceModifier.defaultWeight())
            if (snapshot.replyLaterCount > 0) ReplyLaterPill(snapshot.replyLaterCount, compact = false, palette = palette)
        }
    }
}

// endregion

// region Deck

/**
 * The card deck: one bitmap for the backs and shadows, the live front card on top at
 * [InboxWidgetArt.frontInset]. Only the front card has content and taps.
 */
@Composable
private fun Deck(
    snapshot: InboxWidgetSnapshot,
    front: Int,
    compact: Boolean,
    widthDp: Dp,
    heightDp: Dp,
    palette: WidgetPalette,
    modifier: GlanceModifier,
) {
    val context = LocalContext.current
    val threads = snapshot.threads
    if (threads.isEmpty()) {
        // New count without rows on page 1 (rare): no deck, just the room it would take.
        Spacer(modifier)
        return
    }
    val index = front.coerceIn(0, threads.size - 1)
    val thread = threads[index]
    val backs = InboxWidgetArt.deckBacks(
        widthDp = widthDp.value.coerceAtLeast(1f),
        heightDp = heightDp.value.coerceAtLeast(1f),
        threadCount = threads.size,
        palette = palette,
        density = context.resources.displayMetrics.density,
    )
    Box(modifier = modifier) {
        Image(
            provider = ImageProvider(backs),
            contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = GlanceModifier.fillMaxSize(),
        )
        Box(
            modifier = GlanceModifier.fillMaxSize()
                .padding(start = Inset.start, top = Inset.top, end = Inset.end, bottom = Inset.bottom),
        ) {
            FrontCard(snapshot, thread, index, compact, palette)
        }
    }
}

private val deckTimeFormatter: DateTimeFormatter = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)

/** The live front card: hairline (an outer Box) around the card fill, content, dots and ›. */
@Composable
private fun FrontCard(
    snapshot: InboxWidgetSnapshot,
    thread: InboxWidgetSnapshot.Thread,
    position: Int,
    compact: Boolean,
    palette: WidgetPalette,
) {
    val context = LocalContext.current
    val radius = InboxWidgetDepthMetrics.cardRadius
    Box(
        modifier = GlanceModifier.fillMaxSize()
            .background(palette.cardHairline)
            .cornerRadius(radius)
            .padding(0.5.dp)
            .clickable(actionStartActivity(widgetIntent(context, InboxWidgetLink.Thread(snapshot.mailboxId, thread.id))))
            .semantics { contentDescription = "${thread.senderName}: ${thread.subject}" },
    ) {
        Column(
            modifier = GlanceModifier.fillMaxSize()
                .background(palette.cardFill)
                .cornerRadius(radius - 0.5.dp)
                .padding(if (compact) 10.dp else 12.dp),
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Avatar(thread.senderName, if (compact) 20.dp else 24.dp, palette)
                Spacer(GlanceModifier.width(if (compact) 6.dp else 8.dp))
                InterText(thread.senderName, InterWeight.SemiBold, 12.sp, palette.ink, modifier = GlanceModifier.defaultWeight())
                if (!compact) {
                    Spacer(GlanceModifier.width(6.dp))
                    InterText(thread.receivedAt.format(deckTimeFormatter), InterWeight.Medium, AppThemeDims.List.date, palette.muted)
                }
            }
            Spacer(GlanceModifier.height(if (compact) 5.dp else 7.dp))
            InterText(
                thread.subject,
                InterWeight.Regular,
                if (compact) 11.sp else 12.sp,
                palette.muted,
                maxLines = 2,
                modifier = GlanceModifier.fillMaxWidth(),
            )
            Spacer(GlanceModifier.defaultWeight())
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                DeckDots(position, snapshot.threads.size, palette)
                Spacer(GlanceModifier.defaultWeight())
                NextButton(snapshot.mailboxId, enabled = snapshot.threads.size > 1, palette = palette)
            }
        }
    }
}

/** Which card is in front, out of up to five; the current one is a wider ink capsule. */
@Composable
private fun DeckDots(position: Int, total: Int, palette: WidgetPalette) {
    val dot = InboxWidgetDepthMetrics.dotSize
    val shown = min(total, InboxWidgetSnapshot.MAX_THREADS)
    Row(
        modifier = GlanceModifier.semantics { contentDescription = "Email ${position + 1} of $total" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (index in 0 until shown) {
            if (index > 0) Spacer(GlanceModifier.width(3.dp))
            val current = index == position
            Box(
                GlanceModifier
                    .size(width = if (current) dot * 2.5f else dot, height = dot)
                    .background(palette.ink.copy(alpha = if (current) 0.85f else 0.18f))
                    .cornerRadius(dot / 2),
            ) {}
        }
    }
}

/** ›: an ink disc with a surface chevron. Flips the deck via [ShowNextThreadAction]. */
@Composable
private fun NextButton(mailboxId: String, enabled: Boolean, palette: WidgetPalette) {
    val size = InboxWidgetDepthMetrics.nextButtonSize
    var modifier = GlanceModifier
        .size(size)
        .background(palette.ink)
        .cornerRadius(size / 2)
        .semantics { contentDescription = "Next email" }
    if (enabled) {
        modifier = modifier.clickable(
            actionRunCallback<ShowNextThreadAction>(actionParametersOf(TodayInboxWidget.mailboxParam to mailboxId)),
        )
    }
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Icon(R.drawable.ic_widget_chevron, 18.dp, palette.surface)
    }
}

// endregion

// region Pieces

/** "Inbox" with the tray glyph; the unread dot when there's something New. */
@Composable
private fun Header(isLive: Boolean, palette: WidgetPalette) {
    Row(modifier = GlanceModifier.height(HeaderHeight), verticalAlignment = Alignment.CenterVertically) {
        Icon(R.drawable.ic_widget_inbox, 13.dp, palette.ink)
        Spacer(GlanceModifier.width(5.dp))
        InterText("Inbox", InterWeight.SemiBold, 12.sp, palette.ink.copy(alpha = 0.8f))
        if (isLive) {
            Spacer(GlanceModifier.width(5.dp))
            Box(GlanceModifier.size(5.dp).background(palette.unread).cornerRadius(2.5.dp)) {}
        }
    }
}

@Composable
private fun CountText(count: Int, palette: WidgetPalette) {
    InterText(
        countText(count),
        InterWeight.Bold,
        InboxWidgetMetrics.countSize,
        palette.ink,
        letterSpacingEm = -1.5f / InboxWidgetMetrics.countSize.value,
    )
}

private fun countText(count: Int) = if (count > 99) "99+" else count.toString()

/** Initials on a grey ink-tinted disc (the card is the ring). */
@Composable
private fun Avatar(name: String, size: Dp, palette: WidgetPalette) {
    Box(
        modifier = GlanceModifier.size(size).background(palette.avatarFill()).cornerRadius(size / 2),
        contentAlignment = Alignment.Center,
    ) {
        InterText(AvatarInitials.from(name), InterWeight.SemiBold, (size.value * 0.38f).sp, palette.ink, centered = true)
    }
}

/** Frosted pill: clock glyph + "N Reply later" (count only when compact). */
@Composable
private fun ReplyLaterPill(count: Int, compact: Boolean, palette: WidgetPalette) {
    val tint = palette.ink.copy(alpha = 0.85f)
    Row(
        modifier = GlanceModifier
            .height(24.dp)
            .background(palette.frost)
            .cornerRadius(12.dp)
            .padding(horizontal = if (compact) 8.dp else 9.dp)
            .semantics { contentDescription = "$count Reply later" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(R.drawable.ic_widget_schedule, 12.dp, tint)
        Spacer(GlanceModifier.width(4.dp))
        InterText(if (compact) "$count" else "$count Reply later", InterWeight.SemiBold, 11.sp, tint)
    }
}

/** The floating inbox-zero check: bitmap disc, halo and ground shadow, live check glyph. */
@Composable
private fun FloatingZeroMark(size: Dp, pad: Dp, palette: WidgetPalette) {
    val context = LocalContext.current
    val art = InboxWidgetArt.floatingZeroMark(size.value, pad, palette, context.resources.displayMetrics.density)
    val lift = InboxWidgetArt.zeroLift(size.value)
    Box(modifier = GlanceModifier.size(size + pad * 2), contentAlignment = Alignment.Center) {
        Image(
            provider = ImageProvider(art),
            contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = GlanceModifier.fillMaxSize(),
        )
        // Shift the glyph up by `lift`, with the disc.
        Box(modifier = GlanceModifier.fillMaxSize().padding(bottom = lift * 2), contentAlignment = Alignment.Center) {
            Icon(R.drawable.ic_widget_check, size * 0.48f, palette.ink)
        }
    }
}

@Composable
private fun Icon(@DrawableRes res: Int, size: Dp, tint: Color) {
    Image(
        provider = ImageProvider(res),
        contentDescription = null,
        colorFilter = ColorFilter.tint(ColorProvider(tint)),
        modifier = GlanceModifier.size(size),
    )
}

internal enum class InterWeight(@param:LayoutRes val layout: Int) {
    Regular(R.layout.widget_text_regular),
    Medium(R.layout.widget_text_medium),
    SemiBold(R.layout.widget_text_semibold),
    Bold(R.layout.widget_text_bold),
}

/**
 * Widget text. Glance's `Text` can only name system font families, so this is a small
 * RemoteViews layout whose TextView asks for `@font/inter_*` plus a `textFontWeight`.
 * Most launchers inflate RemoteViews in a restricted context that skips app font
 * resources; there the weight still applies to the system sans.
 */
@Composable
private fun InterText(
    text: String,
    weight: InterWeight,
    size: TextUnit,
    color: Color,
    modifier: GlanceModifier = GlanceModifier,
    maxLines: Int = 1,
    letterSpacingEm: Float = 0f,
    centered: Boolean = false,
) {
    val context = LocalContext.current
    val views = RemoteViews(context.packageName, weight.layout).apply {
        setTextViewText(R.id.widget_text, text)
        setTextColor(R.id.widget_text, color.toArgb())
        setTextViewTextSize(R.id.widget_text, TypedValue.COMPLEX_UNIT_SP, size.value)
        setInt(R.id.widget_text, "setMaxLines", maxLines)
        if (letterSpacingEm != 0f) setFloat(R.id.widget_text, "setLetterSpacing", letterSpacingEm)
        if (centered) setInt(R.id.widget_text, "setGravity", android.view.Gravity.CENTER)
    }
    // Without an explicit size the RemoteViews container fills its parent and pushes
    // later siblings (and weighted spacers) out of a Row / Column.
    AndroidRemoteViews(views, GlanceModifier.wrapContentWidth().wrapContentHeight().then(modifier))
}

// endregion

// region Intents

private fun Context.isNightMode(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

/**
 * A tap on the widget: an explicit MainActivity intent carrying the widget link, which
 * MainActivity routes like a notification tap.
 */
internal fun widgetIntent(context: Context, link: InboxWidgetLink): Intent =
    Intent(context, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        data = Uri.parse(link.url)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }

private fun widgetDescription(snapshot: InboxWidgetSnapshot?): String = when {
    snapshot == null -> "Today's inbox. Open Inboxies."
    snapshot.isInboxZero -> "Inbox zero"
    else -> "${snapshot.newCount} new in Inbox"
}

// endregion

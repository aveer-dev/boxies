package co.inboxies.wear.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Typography
import co.inboxies.watchshared.WatchPalette
import co.inboxies.wear.R

/**
 * The watch's colors: `InboxiesColors`' dark values via [WatchPalette] (shared with
 * `:app`, where `WatchPaletteTest` keeps them in sync). Dark only. Accent for unread
 * dots and the primary action only; Report spam is red text, never a red fill.
 * No Wear Material dynamic color.
 */
object WearColors {
    val background = Color(WatchPalette.BACKGROUND)
    val surface = Color(WatchPalette.SURFACE)
    val ink = Color(WatchPalette.INK)
    val muted = Color(WatchPalette.MUTED)
    val line = Color(WatchPalette.LINE)
    val pillFill = Color(WatchPalette.PILL_FILL)
    val pillActive = Color(WatchPalette.PILL_ACTIVE)
    val accent = Color(WatchPalette.ACCENT)
    val destructive = Color(WatchPalette.DESTRUCTIVE)

    /** The primary action's soft capsule (the phone toast action's accent wash). */
    val accentWash = accent.copy(alpha = 0.16f)
}

val InterFontFamily = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
)

/** Inter at the phone list's sizes, nudged for the wrist (iOS `WatchType`). */
object WearType {
    private fun inter(size: Int, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontFamily = InterFontFamily, fontSize = size.sp, fontWeight = weight)

    val title = inter(16, FontWeight.SemiBold)
    val sender = inter(15, FontWeight.SemiBold)
    val senderRead = inter(15, FontWeight.Medium)
    val subject = inter(13)
    val preview = inter(12)
    val meta = inter(11)
    val body = inter(14)
    val bodyTitle = inter(14, FontWeight.Medium)
    val action = inter(14, FontWeight.Medium)
}

object WearDims {
    val unreadDot = 7.dp
    val hairline = 0.5.dp
    /** Text starts after the unread dot and its gap. */
    val rowTextInset = 15.dp
    val pressedAlpha = 0.55f
}

/** House spring (`inboxies-android-ui`), for the few motions we add ourselves. */
fun <T> inboxiesSpring() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

@Composable
fun InboxiesWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            primary = WearColors.accent,
            primaryVariant = WearColors.accent,
            secondary = WearColors.accent,
            secondaryVariant = WearColors.accent,
            background = WearColors.background,
            surface = WearColors.surface,
            error = WearColors.destructive,
            onPrimary = WearColors.background,
            onSecondary = WearColors.background,
            onBackground = WearColors.ink,
            onSurface = WearColors.ink,
            onSurfaceVariant = WearColors.muted,
            onError = WearColors.background,
        ),
        typography = Typography(defaultFontFamily = InterFontFamily),
        content = content,
    )
}

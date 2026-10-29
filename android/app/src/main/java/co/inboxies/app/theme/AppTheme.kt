package co.inboxies.app.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.R

/** Notion-inspired Inboxies palette — not purple Material You. */
object InboxiesColors {
    val LightBackground = Color(0xFFFAFAFB)
    val LightSurface = Color(0xFFFFFFFF)
    val LightInk = Color(0xFF1F1F24)
    val LightMuted = Color(0xFF73737A)
    val LightLine = Color(0xFFE6E6EB)
    val LightPillFill = Color(0xFFEDEDEF)
    val LightPillActive = Color(0xFFDBDBDF)
    val LightAccent = Color(0xFF2659D9)
    val LightUnread = Color(0xFF38383D)
    val LightDeepDarkRed = Color(0xFF6B141A)

    val DarkBackground = Color(0xFF0D0D0D)
    val DarkSurface = Color(0xFF1C1C1F)
    val DarkInk = Color(0xFFFAFAFC)
    val DarkMuted = Color(0xFF9999A6)
    val DarkLine = Color(0xFF333338)
    val DarkPillFill = Color(0xFF2E2E33)
    val DarkPillActive = Color(0xFF47474D)
    val DarkAccent = Color(0xFF598CFF)
    val DarkUnread = Color(0xFFE6E6EB)
    val DarkDeepDarkRed = Color(0xFFE65959)

    /** Meters nearing a limit (AI usage >= 80%, AVE-45). Same hue as web `kumo-warning`. */
    val LightWarning = Color(0xFFD97706)
    val DarkWarning = Color(0xFFF59E0B)
    /** Meters at a limit; brighter than [LightDeepDarkRed] so a 4dp bar still reads red. */
    val LightDanger = Color(0xFFDC2626)
    val DarkDanger = Color(0xFFEF5350)

    /**
     * Needs attention: a Reply Later reminder fired (AVE-86). Ink, not a hue, so the shell
     * stays grey-scale; attention comes from an ink ring, halo and filled pills. Same values
     * as the light / dark ink. Twin of iOS `AppTheme.attention`, web `--attention`.
     */
    val LightAttention = LightInk
    val DarkAttention = DarkInk

    /** Light "paper" behind designed HTML mail in dark mode (it keeps its own colours). */
    val MailPaper = Color(0xFFFFFFFF)
}

/**
 * Notes to self: a cool mint-sage paper, the one tinted surface in the monochrome
 * shell, so a note reads as paper stuck on the page and stays apart from the mail
 * itself. Calm and low-chroma; same values as iOS `AppTheme.Note` and web `--note-*`.
 */
@Immutable
data class NotePalette(
    val paper: Color,
    val paperEdge: Color,
    val ink: Color,
    val muted: Color,
    val pin: Color,
    val shadow: Color,
    /** 1dp outer ring on the floating sticky: none in light, a faint sage line in dark. */
    val ring: Color,
) {
    companion object {
        val Light = NotePalette(
            paper = Color(0xFFEDF7F4),
            paperEdge = Color(0xFFD3EAE3),
            ink = Color(0xFF1F3A34),
            muted = Color(0xFF5E7D75),
            pin = Color(0xFF4F9A8A),
            // rgb(20,60,50) at the old 20% opacity.
            shadow = Color(0x33143C32),
            ring = Color.Transparent,
        )
        val Dark = NotePalette(
            paper = Color(0xFF1C2A27),
            paperEdge = Color(0xFF27403A),
            ink = Color(0xFFDDEFEA),
            muted = Color(0xFF8FB2A9),
            pin = Color(0xFF6CC2AE),
            shadow = Color(0x8C000000),
            // rgba(200,240,230,0.06)
            ring = Color(0x0FC8F0E6),
        )
    }
}

/** Note geometry and motion — mirrors iOS `AppTheme.Note`. */
object NoteDims {
    /** Resting tilt of a sticky note, in degrees. */
    const val tilt = -1.2f
    /** Resting / lifted sticky shadow (lifted is deeper and softer). */
    val restingElevation = 6.dp
    val liftedElevation = 18.dp
    /** Paper corners: tight, with one softer curled corner (bottom-right). */
    val cornerRadius = 3.dp
    val curlRadius = 14.dp
    /** Inline notes: note paper with a solid paper-edge hairline. */
    val inlineCornerRadius = 12.dp
}

@Immutable
data class InboxiesPalette(
    val background: Color,
    val surface: Color,
    val ink: Color,
    val muted: Color,
    val line: Color,
    val pillFill: Color,
    val pillActive: Color,
    val accent: Color,
    val unread: Color,
    val deepDarkRed: Color,
    val note: NotePalette = NotePalette.Light,
    /** Resolved app theme (System / Light / Dark), for surfaces that can't read the palette, like WebView. */
    val isDark: Boolean = false,
)

val LocalInboxiesPalette = staticCompositionLocalOf {
    InboxiesPalette(
        background = InboxiesColors.LightBackground,
        surface = InboxiesColors.LightSurface,
        ink = InboxiesColors.LightInk,
        muted = InboxiesColors.LightMuted,
        line = InboxiesColors.LightLine,
        pillFill = InboxiesColors.LightPillFill,
        pillActive = InboxiesColors.LightPillActive,
        accent = InboxiesColors.LightAccent,
        unread = InboxiesColors.LightUnread,
        deepDarkRed = InboxiesColors.LightDeepDarkRed,
    )
}

val InterFontFamily = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
    Font(R.font.inter_italic, FontWeight.Normal, FontStyle.Italic),
)

object AppThemeDims {
    object FontSize {
        val largeTitle = 22.sp
        val inlineTitle = 14.sp
        val sender = 13.sp
        val recipient = 12.sp
        val meta = 12.sp
        val chevron = 8.sp
        val body = 13.sp
        val homeSubtitle = 12.sp
    }

    object List {
        val title = 15.sp
        val sender = 15.sp
        val subject = 13.sp
        val preview = 12.sp
        val date = 10.sp
        val badge = 10.sp
        val sectionHeader = 11.sp
        val tracking = 0.25.sp
        val rowVerticalPadding = 18.dp
        val rowTextSpacing = 6.dp
        val rowHorizontalPadding = 20.dp
        val dotToText = 14.dp
        val unreadDotSize = 8.dp
        val unreadDotLineHeight = 22.dp
        val separatorHeight = 0.5.dp
        val separatorLeadingInset get() = rowHorizontalPadding + unreadDotSize + dotToText
        val actionWidth = 72.dp
    }

    /** AI chat typography — mirrors iOS `AppTheme.Chat`. */
    object Chat {
        val body = 13.sp
        val toolAction = 12.sp
        val meta = 11.sp
        val prompt = 14.sp
        val input = 14.sp
        val code = 12.5.sp
        val codeMeta = 11.sp
        val tableCell = 12.sp
        val tracking = 0.25.sp
        const val bodyLineSpacingRatio = 0.28f
    }
}

@Composable
fun InboxiesTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    content: @Composable () -> Unit,
) {
    val dark = when (themeMode) {
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }

    val palette = if (dark) {
        InboxiesPalette(
            background = InboxiesColors.DarkBackground,
            surface = InboxiesColors.DarkSurface,
            ink = InboxiesColors.DarkInk,
            muted = InboxiesColors.DarkMuted,
            line = InboxiesColors.DarkLine,
            pillFill = InboxiesColors.DarkPillFill,
            pillActive = InboxiesColors.DarkPillActive,
            accent = InboxiesColors.DarkAccent,
            unread = InboxiesColors.DarkUnread,
            deepDarkRed = InboxiesColors.DarkDeepDarkRed,
            note = NotePalette.Dark,
            isDark = true,
        )
    } else {
        InboxiesPalette(
            background = InboxiesColors.LightBackground,
            surface = InboxiesColors.LightSurface,
            ink = InboxiesColors.LightInk,
            muted = InboxiesColors.LightMuted,
            line = InboxiesColors.LightLine,
            pillFill = InboxiesColors.LightPillFill,
            pillActive = InboxiesColors.LightPillActive,
            accent = InboxiesColors.LightAccent,
            unread = InboxiesColors.LightUnread,
            deepDarkRed = InboxiesColors.LightDeepDarkRed,
        )
    }

    val colorScheme = if (dark) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            secondary = palette.pillActive,
            onSecondary = palette.ink,
            background = palette.background,
            onBackground = palette.ink,
            surface = palette.surface,
            onSurface = palette.ink,
            surfaceVariant = palette.pillFill,
            onSurfaceVariant = palette.muted,
            outline = palette.line,
            error = palette.deepDarkRed,
        )
    } else {
        lightColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            secondary = palette.pillActive,
            onSecondary = palette.ink,
            background = palette.background,
            onBackground = palette.ink,
            surface = palette.surface,
            onSurface = palette.ink,
            surfaceVariant = palette.pillFill,
            onSurfaceVariant = palette.muted,
            outline = palette.line,
            error = palette.deepDarkRed,
        )
    }

    val typography = MaterialTheme.typography.copy(
        displayLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Bold, fontSize = 34.sp),
        headlineLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Bold, fontSize = 24.sp),
        headlineMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
        titleLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 17.sp),
        titleMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
        bodyLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 15.sp),
        bodyMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 13.sp),
        bodySmall = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 12.sp),
        labelLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp),
        labelMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp),
        labelSmall = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 10.sp),
    )

    CompositionLocalProvider(
        LocalInboxiesPalette provides palette,
        androidx.compose.material3.LocalContentColor provides palette.ink,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = typography,
            content = {
                TransparentSystemBars()
                content()
            },
        )
    }
}

@Composable
fun inboxiesColors(): InboxiesPalette = LocalInboxiesPalette.current

/** Alias used by some screens — same as [LocalInboxiesPalette]. */
val LocalInboxiesColors = LocalInboxiesPalette

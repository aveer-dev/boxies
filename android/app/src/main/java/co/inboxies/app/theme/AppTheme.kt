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
        val body = 13.sp
        val homeSubtitle = 12.sp
    }

    object List {
        val title = 15.sp
        val subject = 13.sp
        val preview = 12.sp
        val date = 10.sp
        val sectionHeader = 11.sp
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
        displayLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = palette.ink),
        headlineLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = palette.ink),
        headlineMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = palette.ink),
        titleLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = palette.ink),
        titleMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = palette.ink),
        bodyLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 15.sp, color = palette.ink),
        bodyMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 13.sp, color = palette.ink),
        bodySmall = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Normal, fontSize = 12.sp, color = palette.muted),
        labelLarge = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = palette.ink),
        labelMedium = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = palette.muted),
        labelSmall = TextStyle(fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 10.sp, color = palette.muted),
    )

    CompositionLocalProvider(LocalInboxiesPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = typography,
            content = content,
        )
    }
}

@Composable
fun inboxiesColors(): InboxiesPalette = LocalInboxiesPalette.current

/** Alias used by some screens — same as [LocalInboxiesPalette]. */
val LocalInboxiesColors = LocalInboxiesPalette

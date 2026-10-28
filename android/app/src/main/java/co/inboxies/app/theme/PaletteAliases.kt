package co.inboxies.app.theme

import androidx.compose.ui.graphics.Color

/** Compatibility aliases used by some screens. */
val InboxiesPalette.gray900: Color get() = ink
val InboxiesPalette.gray500: Color get() = muted
val InboxiesPalette.gray200: Color get() = line
val InboxiesPalette.bgPrimary: Color get() = background
val InboxiesPalette.bgSecondary: Color get() = surface
val InboxiesPalette.blue: Color get() = accent

/** Warning tint (amber) for usage meters near a limit. */
val InboxiesPalette.warning: Color get() = if (isDark) InboxiesColors.DarkWarning else InboxiesColors.LightWarning

/** Destructive red for fills and tints (meters at a limit); text keeps [InboxiesPalette.deepDarkRed]. */
val InboxiesPalette.danger: Color get() = if (isDark) InboxiesColors.DarkDanger else InboxiesColors.LightDanger

package co.inboxies.watchshared

/**
 * The Wear OS app's colors, as ARGB: `InboxiesColors`' dark values (watch screens
 * are OLED and dark only). Not a new palette: `WatchPaletteTest` in `:app` checks
 * every entry against the matching `InboxiesColors.Dark*` token, so the two can't
 * drift. Twin of the iOS `WatchPalette` (AVE-144).
 */
object WatchPalette {
    /** `InboxiesColors.DarkBackground`. */
    const val BACKGROUND: Long = 0xFF0D0D0D

    /** `InboxiesColors.DarkSurface`. */
    const val SURFACE: Long = 0xFF1C1C1F

    /** `InboxiesColors.DarkInk`. */
    const val INK: Long = 0xFFFAFAFC

    /** `InboxiesColors.DarkMuted`. */
    const val MUTED: Long = 0xFF9999A6

    /** `InboxiesColors.DarkLine`. */
    const val LINE: Long = 0xFF333338

    /** `InboxiesColors.DarkPillFill`. */
    const val PILL_FILL: Long = 0xFF2E2E33

    /** `InboxiesColors.DarkPillActive`. */
    const val PILL_ACTIVE: Long = 0xFF47474D

    /** `InboxiesColors.DarkAccent`: unread dots and the primary action only. */
    const val ACCENT: Long = 0xFF598CFF

    /** `InboxiesColors.DarkDeepDarkRed`: Report spam is red text, never a red fill. */
    const val DESTRUCTIVE: Long = 0xFFE65959
}

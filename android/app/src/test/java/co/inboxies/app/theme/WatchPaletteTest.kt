package co.inboxies.app.theme

import androidx.compose.ui.graphics.Color
import co.inboxies.watchshared.WatchPalette
import org.junit.Assert.assertEquals
import org.junit.Test

/** The Wear OS palette is `InboxiesColors`' dark values, not a new palette (AVE-145). */
class WatchPaletteTest {
    @Test
    fun watchPaletteMatchesTheDarkTokens() {
        assertEquals(InboxiesColors.DarkBackground, Color(WatchPalette.BACKGROUND))
        assertEquals(InboxiesColors.DarkSurface, Color(WatchPalette.SURFACE))
        assertEquals(InboxiesColors.DarkInk, Color(WatchPalette.INK))
        assertEquals(InboxiesColors.DarkMuted, Color(WatchPalette.MUTED))
        assertEquals(InboxiesColors.DarkLine, Color(WatchPalette.LINE))
        assertEquals(InboxiesColors.DarkPillFill, Color(WatchPalette.PILL_FILL))
        assertEquals(InboxiesColors.DarkPillActive, Color(WatchPalette.PILL_ACTIVE))
        assertEquals(InboxiesColors.DarkAccent, Color(WatchPalette.ACCENT))
        assertEquals(InboxiesColors.DarkDeepDarkRed, Color(WatchPalette.DESTRUCTIVE))
    }
}

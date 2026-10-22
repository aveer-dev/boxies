package co.inboxies.app.ui.home

import androidx.compose.ui.unit.dp
import co.inboxies.app.models.Email
import co.inboxies.app.theme.HomeChromeMetrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeLayoutModeTest {
    @Test
    fun twoPaneOnlyFromExpandedWidth() {
        assertEquals(HomeLayoutMode.Stacked, HomeLayoutMode.forWidth(411.dp)) // phone
        assertEquals(HomeLayoutMode.Stacked, HomeLayoutMode.forWidth(673.dp)) // folded / medium
        assertEquals(HomeLayoutMode.Stacked, HomeLayoutMode.forWidth(839.dp))
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(840.dp))
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(1280.dp)) // tablet landscape
    }

    @Test
    fun listColumnIsClamped() {
        assertEquals(320.dp, HomeChromeMetrics.listColumnWidth(840.dp))
        assertEquals(380.dp, HomeChromeMetrics.listColumnWidth(1000.dp))
        assertEquals(420.dp, HomeChromeMetrics.listColumnWidth(1600.dp))
    }

    @Test
    fun openRowMatchesEmailOrThread() {
        val open = Email(id = "a", threadId = "t1")
        assertTrue(Email(id = "a").isOpenInReadingPane(open))
        assertTrue(Email(id = "b", threadId = "t1").isOpenInReadingPane(open))
        assertFalse(Email(id = "c", threadId = "t2").isOpenInReadingPane(open))
        assertFalse(Email(id = "a").isOpenInReadingPane(null))
        assertFalse(Email(id = "d").isOpenInReadingPane(Email(id = "e", threadId = "")))
    }
}

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
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(900.dp)) // unfolded foldable
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(1179.dp))
    }

    @Test
    fun threeColumnOnlyFromWideWidth() {
        assertEquals(HomeLayoutMode.ThreeColumn, HomeLayoutMode.forWidth(1180.dp))
        assertEquals(HomeLayoutMode.ThreeColumn, HomeLayoutMode.forWidth(1280.dp)) // tablet landscape
        assertFalse(HomeLayoutMode.allowsFolderColumn(1179.dp))
        assertTrue(HomeLayoutMode.allowsFolderColumn(1180.dp))
    }

    @Test
    fun hiddenFolderColumnFallsBackToTwoPane() {
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(1280.dp, showsFolderColumn = false))
        // The toggle never affects narrower layouts.
        assertEquals(HomeLayoutMode.Stacked, HomeLayoutMode.forWidth(411.dp, showsFolderColumn = false))
        assertEquals(HomeLayoutMode.TwoPane, HomeLayoutMode.forWidth(1000.dp, showsFolderColumn = true))
    }

    @Test
    fun splitModes() {
        assertFalse(HomeLayoutMode.Stacked.isSplit)
        assertTrue(HomeLayoutMode.TwoPane.isSplit)
        assertTrue(HomeLayoutMode.ThreeColumn.isSplit)
    }

    @Test
    fun listColumnIsClamped() {
        assertEquals(320.dp, HomeChromeMetrics.listColumnWidth(840.dp))
        assertEquals(380.dp, HomeChromeMetrics.listColumnWidth(1000.dp))
        assertEquals(420.dp, HomeChromeMetrics.listColumnWidth(1600.dp))
        // At the three-column threshold the reading pane keeps a phone-plus measure.
        val reading = 1180.dp - HomeChromeMetrics.folderColumnWidth - HomeChromeMetrics.listColumnWidth(1180.dp)
        assertTrue(reading >= 500.dp)
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

package co.inboxies.app.widget

import androidx.datastore.preferences.core.mutablePreferencesOf
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * AVE-150: what `ShowNextThreadAction` (›) does to a widget's Glance state, through
 * [InboxWidgetDeckState.advance] — the callback's whole state change.
 */
class ShowNextThreadActionTest {
    private val sample = InboxWidgetSnapshot.SampleHasMail

    @Test
    fun startsOnTheFirstCard() {
        assertEquals(0, InboxWidgetDeckState.frontIndex(mutablePreferencesOf(), sample))
    }

    @Test
    fun flipsThroughEveryThreadAndWraps() {
        val prefs = mutablePreferencesOf()
        val seen = (1..sample.threads.size).map { InboxWidgetDeckState.advance(prefs, sample) }
        assertEquals(listOf(1, 2, 3, 4, 0), seen)
        assertEquals(0, InboxWidgetDeckState.frontIndex(prefs, sample))
    }

    @Test
    fun aNewSnapshotPutsTheDeckBackOnCardOne() {
        val prefs = mutablePreferencesOf()
        InboxWidgetDeckState.advance(prefs, sample)
        InboxWidgetDeckState.advance(prefs, sample)
        assertEquals(2, InboxWidgetDeckState.frontIndex(prefs, sample))

        val changed = sample.copy(newCount = sample.newCount + 1)
        assertEquals(0, InboxWidgetDeckState.frontIndex(prefs, changed))
        assertEquals(1, InboxWidgetDeckState.advance(prefs, changed))
    }

    @Test
    fun aRefreshWithTheSameMailKeepsThePosition() {
        val prefs = mutablePreferencesOf()
        InboxWidgetDeckState.advance(prefs, sample)
        val refreshed = sample.copy(updatedAt = sample.updatedAt.plusMinutes(5))
        assertEquals(1, InboxWidgetDeckState.frontIndex(prefs, refreshed))
    }

    @Test
    fun nothingToFlipWithoutASecondThread() {
        val prefs = mutablePreferencesOf()
        assertNull(InboxWidgetDeckState.advance(prefs, null))
        assertNull(InboxWidgetDeckState.advance(prefs, InboxWidgetSnapshot.SampleInboxZero))
        assertNull(InboxWidgetDeckState.advance(prefs, sample.copy(threads = sample.threads.take(1))))
        assertNull(prefs[InboxWidgetDeckState.frontIndexKey])
    }

    @Test
    fun aStaleIndexStaysInsideTheDeck() {
        val shorter = sample.copy(threads = sample.threads.take(2))
        val prefs = mutablePreferencesOf(
            InboxWidgetDeckState.frontIndexKey to 7,
            InboxWidgetDeckState.frontContentKey to shorter.contentKey,
        )
        assertEquals(1, InboxWidgetDeckState.frontIndex(prefs, shorter))
    }

    @Test
    fun configuredMailboxIgnoresBlank() {
        assertNull(InboxWidgetDeckState.configuredMailboxId(mutablePreferencesOf(InboxWidgetDeckState.mailboxIdKey to " ".trim())))
        assertEquals("mb", InboxWidgetDeckState.configuredMailboxId(mutablePreferencesOf(InboxWidgetDeckState.mailboxIdKey to "mb")))
    }
}

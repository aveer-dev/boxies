package co.inboxies.app.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** AVE-90: launch reopens the last active mailbox while it's still listed. */
class LastMailboxTest {
    @Test
    fun prefersRememberedWhileListed() {
        assertEquals("b", initialMailboxId("b", listOf("a", "b")))
    }

    @Test
    fun staleOrMissingFallsBackToFirst() {
        assertEquals("a", initialMailboxId("gone", listOf("a", "b")))
        assertEquals("a", initialMailboxId(null, listOf("a", "b")))
    }

    @Test
    fun noMailboxesMeansNoSelection() {
        assertNull(initialMailboxId("b", emptyList()))
    }
}

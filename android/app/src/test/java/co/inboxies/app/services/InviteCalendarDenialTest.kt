package co.inboxies.app.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** AVE-236: only a refusal the system won't re-ask hides Check availability. */
class InviteCalendarDenialTest {
    @Test
    fun grantedIsFull() {
        assertEquals(InviteCalendarAccess.Full, InviteCalendar.accessFor(granted = true, showsRationale = false, blocked = true))
    }

    @Test
    fun neverAskedOrSoftRefusedStaysAskable() {
        assertEquals(InviteCalendarAccess.Askable, InviteCalendar.accessFor(granted = false, showsRationale = false, blocked = false))
        // First "Don't allow": the system offers a rationale and will ask again.
        assertEquals(InviteCalendarAccess.Askable, InviteCalendar.accessFor(granted = false, showsRationale = true, blocked = false))
        // A stale block is ignored while the dialog can show again.
        assertEquals(InviteCalendarAccess.Askable, InviteCalendar.accessFor(granted = false, showsRationale = true, blocked = true))
    }

    @Test
    fun hardDenialIsDenied() {
        assertEquals(InviteCalendarAccess.Denied, InviteCalendar.accessFor(granted = false, showsRationale = false, blocked = true))
    }

    @Test
    fun firstDismissalIsNotFinal() {
        assertFalse(InviteCalendar.refusalIsFinal(showsRationale = false, refusedBefore = false, unansweredBefore = false))
    }

    @Test
    fun refusalWithRationaleIsNotFinal() {
        assertFalse(InviteCalendar.refusalIsFinal(showsRationale = true, refusedBefore = true, unansweredBefore = true))
    }

    @Test
    fun secondDontAllowIsFinal() {
        assertTrue(InviteCalendar.refusalIsFinal(showsRationale = false, refusedBefore = true, unansweredBefore = false))
    }

    @Test
    fun silentRefusalAfterUnansweredIsFinal() {
        assertTrue(InviteCalendar.refusalIsFinal(showsRationale = false, refusedBefore = false, unansweredBefore = true))
    }
}

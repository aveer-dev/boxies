package co.inboxies.app.services

import co.inboxies.app.models.Email
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** AVE-193: Focus & Reply works the Reply Later pile one thread at a time (iOS twin in ReplyLaterReminderTests). */
class FocusReplyRunTest {
    private fun pile(id: String, replyLater: Boolean = true) = Email(id = id, subject = id, replyLater = replyLater)

    @Test
    fun worksThePileInOrder() {
        var run = FocusReplyRun.start(listOf(pile("a"), pile("b"), pile("c")))
        assertEquals("a", run.current?.id)
        assertEquals("1 of 3", run.progressLabel)
        run = run.markReplied("a")
        assertEquals("b", run.current?.id)
        assertEquals("2 of 3", run.progressLabel)
        run = run.markSkipped("b")
        assertEquals("c", run.current?.id)
        assertEquals("3 of 3", run.progressLabel)
        run = run.markReplied("c")
        assertNull(run.current)
        assertEquals(FocusReplyResult(replied = 2, skipped = 1), run.result)
        assertEquals("Reached the end · 1 skipped", run.result.summary)
    }

    @Test
    fun undoPutsTheThreadBackFirst() {
        val run = FocusReplyRun.start(listOf(pile("a"), pile("b"))).markReplied("a")
        assertEquals("b", run.current?.id)
        val undone = run.undoReply("a")
        assertEquals("a", undone.current?.id)
        assertEquals("1 of 2", undone.progressLabel)
    }

    @Test
    fun ignoresMailOutsideThePileAndAbsorbsNewRows() {
        val run = FocusReplyRun.start(listOf(pile("a"), pile("x", replyLater = false)))
        assertEquals(1, run.total)
        assertEquals(listOf("a", "b"), run.absorb(listOf(pile("a"), pile("b"))).remaining.map { it.id })
    }
}

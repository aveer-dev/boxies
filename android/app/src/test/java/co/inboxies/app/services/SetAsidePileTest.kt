package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.EmailListResponse
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.PileIds
import co.inboxies.app.models.WorkflowPilesResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** AVE-201: Set Aside pile decoding and the one-pile rule. */
class SetAsidePileTest {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    @Test
    fun decodesBothBuiltinPiles() {
        val raw = """
            {"piles":[
              {"id":"reply_later","name":"Reply Later","builtin":true,"clears_on_reply":true,"count":3,"due_count":1},
              {"id":"set_aside","name":"Set Aside","builtin":true,"clears_on_reply":false,"count":2,"due_count":0}
            ]}
        """.trimIndent()
        val piles = json.decodeFromString<WorkflowPilesResponse>(raw)
        assertEquals(3, piles.count(PileIds.REPLY_LATER))
        assertEquals(1, piles.pile(PileIds.REPLY_LATER)?.dueCount)
        assertEquals(true, piles.pile(PileIds.REPLY_LATER)?.clearsOnReply)
        assertEquals(2, piles.count(PileIds.SET_ASIDE))
        assertEquals("Set Aside", piles.pile(PileIds.SET_ASIDE)?.name)
        assertEquals(false, piles.pile(PileIds.SET_ASIDE)?.clearsOnReply)
    }

    @Test
    fun olderWorkerWithoutSetAsideCountsZero() {
        val piles = json.decodeFromString<WorkflowPilesResponse>(
            """{"piles":[{"id":"reply_later","count":4,"due_count":0}]}""",
        )
        assertEquals(4, piles.count(PileIds.REPLY_LATER))
        assertNull(piles.pile(PileIds.REPLY_LATER)?.name)
        assertEquals(0, piles.count(PileIds.SET_ASIDE))
        assertNull(piles.pile(PileIds.SET_ASIDE))
    }

    @Test
    fun decodesPileIdOnEmailRows() {
        val list = json.decodeFromString<EmailListResponse>(
            """{"emails":[
                 {"id":"a","reply_later":false,"pile_id":"set_aside","pile_at":"2026-11-01T10:00:00.000Z"},
                 {"id":"b","reply_later":true,"pile_id":"reply_later"},
                 {"id":"c","reply_later":true},
                 {"id":"d","pile_id":null}
               ],"totalCount":4}""",
        )
        val (a, b, c, d) = list.emails
        assertEquals(PileIds.SET_ASIDE, a.pileId)
        assertEquals("2026-11-01T10:00:00.000Z", a.pileAt)
        assertTrue(a.isSetAside)
        assertFalse(a.replyLater)
        assertEquals(PileIds.REPLY_LATER, b.currentPileId)
        assertFalse(b.isSetAside)
        // Older Worker: no pile_id, the flag still means Reply Later.
        assertNull(c.pileId)
        assertEquals(PileIds.REPLY_LATER, c.currentPileId)
        assertNull(d.currentPileId)
    }

    @Test
    fun settingAsideMovesOutOfReplyLaterAndDropsTheReminder() {
        val queued = Email(
            id = "a",
            replyLater = true,
            pileId = PileIds.REPLY_LATER,
            replyLaterAt = "2026-11-01T10:00:00.000Z",
            replyLaterRemindAt = "2026-11-02T09:00:00.000Z",
        )
        val aside = queued.inPile(PileIds.SET_ASIDE)
        assertTrue(aside.isSetAside)
        assertFalse(aside.replyLater)
        assertNull(aside.replyLaterAt)
        assertNull(aside.replyLaterRemindAt)

        val back = aside.inPile(PileIds.REPLY_LATER)
        assertTrue(back.replyLater)
        assertFalse(back.isSetAside)
        assertEquals(PileIds.REPLY_LATER, back.pileId)

        val out = aside.inPile(null)
        assertNull(out.currentPileId)
        assertFalse(out.replyLater)
    }

    @Test
    fun setAsideTabListsThePileNotAFolder() {
        val scope = EmailListScope.of("a@x.com", HomeTab.SetAside)!!
        assertTrue(scope.setAside)
        assertFalse(scope.replyLater)
        assertTrue(scope.isPile)
        assertNull(scope.folderId)
        assertTrue(HomeTab.SetAside.isPile)
        assertEquals("Set Aside", HomeTab.SetAside.title)
    }
}

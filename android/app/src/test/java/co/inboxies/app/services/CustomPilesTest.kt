package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.PileIds
import co.inboxies.app.models.WorkflowPile
import co.inboxies.app.models.WorkflowPilesResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** AVE-194: piles people make beside Reply Later and Set Aside. */
class CustomPilesTest {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    @Test
    fun customPilesFollowTheBuiltInOnes() {
        val raw = """
            {"piles":[
              {"id":"reply_later","name":"Reply Later","builtin":true,"clears_on_reply":true,"count":3,"due_count":1},
              {"id":"set_aside","name":"Set Aside","builtin":true,"clears_on_reply":false,"count":2,"due_count":0},
              {"id":"p_0a1b","name":"Waiting on","position":2,"builtin":false,"clears_on_reply":false,"count":4,"due_count":0}
            ]}
        """.trimIndent()
        val custom = MailPiles.custom(json.decodeFromString<WorkflowPilesResponse>(raw).piles)
        assertEquals(listOf("p_0a1b"), custom.map { it.id })
        assertEquals("Waiting on", custom.single().name)
        assertEquals(4, custom.single().count)
        // Older Workers: no `builtin`, only Reply Later.
        val legacy = json.decodeFromString<WorkflowPilesResponse>("""{"piles":[{"id":"reply_later","count":1}]}""")
        assertTrue(MailPiles.custom(legacy.piles).isEmpty())
    }

    @Test
    fun namesMatchTheWorker() {
        assertEquals(MailPiles.NameResult.Ok("Waiting on", "waiting on"), MailPiles.normalizeName("  Waiting   on \n"))
        assertEquals(MailPiles.NameResult.Invalid(MailPiles.NAME_REQUIRED), MailPiles.normalizeName("   "))
        assertEquals(MailPiles.NameResult.Invalid(MailPiles.INVALID_CHARACTERS), MailPiles.normalizeName("bad\u0007name"))
        assertEquals(MailPiles.NameResult.Invalid(MailPiles.NAME_TOO_LONG), MailPiles.normalizeName("x".repeat(41)))
        val waiting = WorkflowPile(id = "p_1", name = "Waiting on", builtin = false)
        assertEquals(MailPiles.DUPLICATE_NAME, MailPiles.validate("waiting ON", listOf(waiting)))
        assertEquals(MailPiles.DUPLICATE_NAME, MailPiles.validate("Set aside", emptyList()))
        assertNull(MailPiles.validate("Waiting On", listOf(waiting), renaming = waiting))
        assertNull(MailPiles.validate("To pay", listOf(waiting)))
        val full = (0 until MailPiles.MAX_CUSTOM).map { WorkflowPile(id = "p_$it", name = "Pile $it", builtin = false) }
        assertEquals(MailPiles.TOO_MANY, MailPiles.validate("One more", full))
    }

    @Test
    fun customPileTabsArePiles() {
        val tab = HomeTab.Pile("p_waiting")
        assertTrue(tab.isPile)
        assertEquals("p_waiting", tab.pileId)
        assertNull(tab.syncFolderId)
        assertEquals("p_waiting", EmailListScope.of("mb", tab)?.customPileId)
        assertTrue(EmailListScope.of("mb", tab)!!.isPile)
        assertFalse(PileIds.isBuiltin("p_waiting"))
        assertTrue(PileIds.isBuiltin(PileIds.SET_ASIDE))
    }

    @Test
    fun movingToACustomPileLeavesReplyLater() {
        val queued = Email(
            id = "e1", subject = "Quote", sender = "a@x.com", recipient = "b@x.com",
            date = "2026-10-10T10:00:00Z", read = true, starred = false,
            replyLater = true, replyLaterAt = "2026-10-10T11:00:00Z",
            replyLaterRemindAt = "2026-10-12T09:00:00Z", pileId = PileIds.REPLY_LATER,
        )
        val moved = queued.inPile("p_waiting")
        assertEquals("p_waiting", moved.currentPileId)
        assertFalse(moved.replyLater)
        assertNull(moved.replyLaterRemindAt)
        assertNull(moved.inPile(null).currentPileId)
    }
}

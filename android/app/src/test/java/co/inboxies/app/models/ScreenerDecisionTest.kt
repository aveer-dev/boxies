package co.inboxies.app.models

import co.inboxies.app.services.ApiClient
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/** Screener Accept / Decline toast copy and what Undo restores (AVE-159). Twin of iOS ClientContractTests. */
class ScreenerDecisionTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    @Test
    fun decisionResponseDecodesMovedIds() {
        val response = json.decodeFromString<SenderTriageDecisionResponse>(
            """{"triage":{"sender":"a@x.com","status":"rejected"},"moved":{"moved":2,"ids":["e1","e2"]}}""",
        )
        assertEquals(listOf("e1", "e2"), response.moved?.ids)
        assertEquals(listOf("e1", "e2"), ScreenerDecision.restoreIds(response, "e2"))
        assertEquals(listOf("e1", "e2", "e3"), ScreenerDecision.restoreIds(response, "e3"))
        val bare = json.decodeFromString<SenderTriageDecisionResponse>("""{"triage":null}""")
        assertEquals(listOf("e9"), ScreenerDecision.restoreIds(bare, "e9"))
        assertEquals(listOf("e9"), ScreenerDecision.restoreIds(null, "e9"))
    }

    @Test
    fun toastCopyMatchesIos() {
        assertEquals("Declined", ScreenerDecision.toastTitle(null))
        assertEquals("Accepted", ScreenerDecision.toastTitle("inbox"))
        assertEquals("Accepted · future mail goes to Promotions", ScreenerDecision.toastTitle("promotions"))
        assertEquals("Accepted · future mail goes to Updates", ScreenerDecision.toastTitle("updates"))
    }

    @Test
    fun senderTriagePathEncodesTheAddress() {
        assertEquals(
            "/api/v1/mailboxes/me%40acme.com/sender-triage/ada%2Bnews%40x.example",
            ApiClient.shared.senderTriagePath("me@acme.com", "ada+news@x.example"),
        )
    }
}

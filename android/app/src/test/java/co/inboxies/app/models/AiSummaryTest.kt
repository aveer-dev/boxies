package co.inboxies.app.models

import co.inboxies.app.services.ApiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import kotlinx.serialization.json.Json

/**
 * AI summary card (AVE-218): `AiSummaryResponse` decoding, the web eligibility rule
 * (`EmailPanel` `summaryEnabled`) and the daily-limit note. iOS twin: `AISummaryTests`.
 */
class AiSummaryTest {
    /** Same settings as `ApiClient.json`. */
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

    private fun decode(text: String) = json.decodeFromString(AiSummaryResponse.serializer(), text)

    @Test
    fun decodesReady() {
        val response = decode(
            """{"status":"ready","cached":false,"summary":{"target_type":"thread","target_id":"t1",
            "summary":"Dana wants owners by Friday.","key_points":["Reply by Friday"],"model":"m",
            "message_count":2,"last_email_id":"e2","created_at":"x","updated_at":"y"}}""",
        )
        val summary = response.readySummary!!
        assertFalse(response.cached)
        assertEquals("Dana wants owners by Friday.", summary.summary)
        assertEquals(listOf("Reply by Friday"), summary.keyPoints)
        assertEquals(2, summary.messageCount)
    }

    @Test
    fun decodesNotEligibleMissingAndUnknown() {
        val notEligible = decode("""{"status":"not_eligible","reason":"too_short"}""")
        assertEquals("too_short", notEligible.reason)
        assertNull(notEligible.readySummary)
        assertNull(decode("""{"status":"missing"}""").readySummary)
        assertNull(decode("""{"status":"later"}""").readySummary)
    }

    @Test
    fun eligibilityNeedsEnoughTextAcrossTheThread() {
        val half = "a".repeat(260)
        val first = Email(id = "a", folderId = "inbox", body = "<p>$half</p>")
        val second = Email(id = "b", folderId = "inbox", body = half)
        assertFalse(AiSummaryEligibility.isEnabled(first, listOf(first)))
        assertTrue(AiSummaryEligibility.isEnabled(second, listOf(first, second)))
    }

    @Test
    fun eligibilitySkipsExcludedFoldersAndDrafts() {
        val long = "word ".repeat(150)
        assertTrue(AiSummaryEligibility.isEnabled(Email(id = "a", folderId = "inbox", body = long), emptyList()))
        for (folder in listOf("screener", "screened_out", "spam", "trash", "draft")) {
            val mail = Email(id = "a", folderId = folder, body = long)
            assertFalse(folder, AiSummaryEligibility.isEnabled(mail, listOf(mail)))
        }
        // A draft reply's text doesn't count toward the thread.
        val short = Email(id = "a", folderId = "inbox", body = "Short note")
        val draft = Email(id = "d", folderId = "draft", body = long)
        assertFalse(AiSummaryEligibility.isEnabled(short, listOf(short, draft)))
    }

    @Test
    fun plainTextMatchesWebStripHtml() {
        assertEquals(
            "Hi there Dana",
            AiSummaryEligibility.plainText("<style>p{}</style><p>Hi&nbsp;there</p>\n\n<b>Dana</b>"),
        )
    }

    @Test
    fun quotaNote() {
        val now = Instant.parse("2026-06-01T18:00:00Z")
        assertEquals("Daily AI limit reached. Resets in 6h.", AiSummaryQuota.text(now))
        assertTrue(AiSummaryQuota.isQuotaError(ApiException.Http(429, "limit")))
        assertFalse(AiSummaryQuota.isQuotaError(ApiException.Http(502, "failed")))
    }
}

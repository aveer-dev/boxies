package co.inboxies.app.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Locks the Worker response shapes the Android models must decode. */
class ServerContractDecodingTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    @Test
    fun aliasDecodesIntOrBoolIsActiveAndMissingMailboxId() {
        val fromInt = json.decodeFromString<MaskedAlias>(
            """{"id":"a1","alias_email":"x@private.example.com","is_active":0}""",
        )
        assertFalse(fromInt.isActive)
        assertNull(fromInt.mailboxId)

        val fromBool = json.decodeFromString<MaskedAlias>(
            """{"id":"a2","mailbox_id":"me@example.com","alias_email":"y@private.example.com","is_active":true}""",
        )
        assertTrue(fromBool.isActive)
        assertEquals("me@example.com", fromBool.mailboxId)
    }

    @Test
    fun conversationAcceptsCamelAndSnakeDates() {
        val camel = json.decodeFromString<AgentConversation>(
            """{"id":"c1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}""",
        )
        assertEquals("2026-01-02T00:00:00Z", camel.updatedAt)
        val snake = json.decodeFromString<AgentConversation>(
            """{"id":"c2","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-03T00:00:00Z"}""",
        )
        assertEquals("2026-01-03T00:00:00Z", snake.updatedAt)
    }

    @Test
    fun pricingPrefersDomainFee() {
        val pricing = json.decodeFromString<DomainPricingBreakdown>(
            """{"domainFeeUsd":10.44,"domainWholesaleUsd":9.0,"platformFeeUsd":9.56,"totalAnnualUsd":20.0,"billingInterval":"year"}""",
        )
        assertEquals(10.44, pricing.domainUsd!!, 0.0001)
        assertEquals("year", pricing.resolvedInterval)
    }

    @Test
    fun exportJobDecodesServerShape() {
        val job = json.decodeFromString<ExportJob>(
            """{"exportId":"e1","domain":"example.com","status":"completed","progress":{"processedCount":3,"totalCount":3,"percent":100},"totalEmails":3,"fileSizeBytes":1024,"downloadUrl":"/api/v1/exports/e1/download","expiresAt":null,"createdAt":"2026-01-01T00:00:00Z"}""",
        )
        assertEquals("e1", job.resolvedId)
        assertEquals(100, job.progress?.percent)
    }

    @Test
    fun transferLockSuccessIsOptional() {
        val res = json.decodeFromString<DomainTransferLockResponse>("""{"domain":"example.com","locked":false}""")
        assertTrue(res.success)
        assertFalse(res.locked)
    }
}

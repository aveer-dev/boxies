package co.inboxies.app.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class MaskedAliasTest {
    /** Same decoding flags as `ApiClient.json`. */
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
    }

    private fun row(isActive: String, expiresAt: String = "null") = """
        {
          "id": "a1",
          "alias_email": "k8m2p9v4@inboxies.email",
          "domain": "inboxies.email",
          "base_domain": "inboxies.email",
          "label": null,
          "is_active": $isActive,
          "paused_action": "reject",
          "expires_at": $expiresAt,
          "created_at": "2026-10-01T10:00:00.000Z",
          "stats_received": 12,
          "stats_blocked": 3
        }
    """.trimIndent()

    @Test
    fun decodesSqliteIntegerBooleans() {
        assertTrue(json.decodeFromString<MaskedAlias>(row("1")).isActive)
        assertFalse(json.decodeFromString<MaskedAlias>(row("0")).isActive)
    }

    @Test
    fun stillAcceptsJsonBooleans() {
        assertTrue(json.decodeFromString<MaskedAlias>(row("true")).isActive)
        assertFalse(json.decodeFromString<MaskedAlias>(row("false")).isActive)
    }

    @Test
    fun mapsStatsAndRules() {
        val alias = json.decodeFromString<MaskedAlias>(row("1"))
        assertEquals("k8m2p9v4@inboxies.email", alias.aliasEmail)
        assertEquals(12, alias.statsReceived)
        assertEquals(3, alias.statsBlocked)
        assertEquals(MaskedAlias.PAUSED_REJECT, alias.pausedAction)
        assertNull(alias.label)
    }

    @Test
    fun listResponseDecodes() {
        val list = json.decodeFromString<AliasesResponse>("""{"aliases":[${row("1")}]}""")
        assertEquals(1, list.aliases.size)
    }

    @Test
    fun expiryIsSeparateFromActive() {
        val now = Instant.parse("2026-10-07T12:00:00Z")
        val past = json.decodeFromString<MaskedAlias>(row("1", "\"2026-10-01T00:00:00.000Z\""))
        val future = json.decodeFromString<MaskedAlias>(row("1", "\"2026-11-01T00:00:00Z\""))
        val never = json.decodeFromString<MaskedAlias>(row("1"))
        assertTrue(past.isActive)
        assertTrue(past.isExpired(now))
        assertFalse(future.isExpired(now))
        assertFalse(never.isExpired(now))
    }

    @Test
    fun emailCarriesAliasBinding() {
        val email = json.decodeFromString<Email>(
            """{"id":"e1","alias_id":"a1","alias_email":"k8m2p9v4@inboxies.email","alias_active":false}""",
        )
        assertEquals("a1", email.aliasId)
        assertEquals("k8m2p9v4@inboxies.email", email.aliasEmail)
        assertEquals(false, email.aliasActive)

        val plain = json.decodeFromString<Email>("""{"id":"e2"}""")
        assertNull(plain.aliasId)
        assertNull(plain.aliasEmail)
        assertNull(plain.aliasActive)
    }
}

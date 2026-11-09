package co.inboxies.app.ui.settings

import co.inboxies.app.models.SecurityActivityItem
import co.inboxies.app.models.SecurityActivityResponse
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

/** Recent security activity (AVE-151): Worker shape + labels; mirrors iOS `ClientContractTests` and web. */
class SecurityActivityTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    private fun item(
        kind: String,
        newDevice: Boolean = false,
        provider: String? = null,
        device: String? = null,
        location: String? = null,
    ) = SecurityActivityItem(
        id = "x", kind = kind, createdAt = "", device = device, location = location,
        newDevice = newDevice, provider = provider,
    )

    @Test
    fun decodesWorkerShape() {
        val response = json.decodeFromString<SecurityActivityResponse>(
            """
            {"since":"2026-10-03T12:00:00.000Z","events":[
              {"id":"e1","kind":"sign_in","createdAt":"2026-11-01T09:00:00.000Z","device":"Chrome on macOS",
               "location":"Lagos, Nigeria","country":"NG","newDevice":true,"provider":null},
              {"id":"e2","kind":"sign_in_method_added","createdAt":"2026-10-30T09:00:00.000Z","device":null,
               "location":null,"country":null,"newDevice":false,"provider":"google"},
              {"id":"e3","kind":"some_future_kind","createdAt":"2026-10-29T09:00:00.000Z"}
            ]}
            """.trimIndent(),
        )
        assertEquals(3, response.events.size)
        assertTrue(response.events[0].newDevice)
        assertEquals("Lagos, Nigeria", response.events[0].location)
        assertEquals("google", response.events[1].provider)
        assertFalse(response.events[2].newDevice)
        assertEquals(SECURITY_EVENT_FALLBACK_TITLE, securityEventTitle(response.events[2]))
    }

    @Test
    fun everyWorkerKindHasALabel() {
        // Keep in sync with SECURITY_EVENT_KINDS in workers/auth/security-activity.ts.
        val kinds = listOf(
            "sign_in", "password_changed", "password_added", "password_reset",
            "two_factor_enabled", "two_factor_disabled", "passkey_added", "passkey_removed",
            "sign_in_method_added", "sign_in_method_removed", "recovery_email_set", "recovery_email_removed",
        )
        for (kind in kinds) {
            val title = securityEventTitle(item(kind))
            assertNotEquals(kind, SECURITY_EVENT_FALLBACK_TITLE, title)
            assertFalse(kind, title.contains("_"))
        }
    }

    @Test
    fun titlesMatchIosAndWeb() {
        assertEquals("Signed in", securityEventTitle(item("sign_in")))
        assertEquals("Signed in from a new device", securityEventTitle(item("sign_in", newDevice = true)))
        assertEquals("Two-factor authentication turned off", securityEventTitle(item("two_factor_disabled")))
        assertEquals("Recovery email changed", securityEventTitle(item("recovery_email_set")))
        assertEquals("Google sign-in connected", securityEventTitle(item("sign_in_method_added", provider = "google")))
        assertEquals("Apple sign-in removed", securityEventTitle(item("sign_in_method_removed", provider = "apple")))
        assertEquals("Password sign-in connected", securityEventTitle(item("sign_in_method_added", provider = "credential")))
        assertEquals("Sign-in method removed", securityEventTitle(item("sign_in_method_removed")))
    }

    @Test
    fun detailShowsDeviceAndApproximateLocationOnly() {
        assertEquals(
            "Chrome on macOS · Lagos, Nigeria",
            securityEventDetail(item("sign_in", device = "Chrome on macOS", location = "Lagos, Nigeria")),
        )
        assertEquals("Nigeria", securityEventDetail(item("sign_in", location = "Nigeria")))
        assertEquals("", securityEventDetail(item("sign_in", device = " ")))
    }

    @Test
    fun relativeTimeBuckets() {
        val now = Instant.parse("2026-11-02T12:00:00Z")
        assertEquals("just now", relative(now.minusSeconds(10), now))
        assertEquals("just now", relative(now.plusSeconds(60), now))
        assertEquals("5 min ago", relative(now.minus(Duration.ofMinutes(5)), now))
        assertEquals("3 hr ago", relative(now.minus(Duration.ofHours(3)), now))
        assertEquals("yesterday", relative(now.minus(Duration.ofHours(30)), now))
        assertEquals("4 days ago", relative(now.minus(Duration.ofDays(4)), now))
    }
}

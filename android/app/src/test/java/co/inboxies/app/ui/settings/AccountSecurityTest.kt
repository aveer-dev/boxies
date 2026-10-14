package co.inboxies.app.ui.settings

import co.inboxies.app.models.AccountSession
import co.inboxies.app.models.InviteAcceptResponse
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.models.MailboxMember
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.services.ApiClient
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Members, sessions and invites on the new sign-in (R3); mirrors iOS `AccountSecurityTests`. */
class AccountSecurityTest {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    private fun session(label: String? = null, agent: String? = null) = AccountSession(
        id = "s", label = label, userAgent = agent, createdAt = "", lastActiveAt = "", expiresAt = "",
    )

    @Test
    fun sessionTitlesFromLabelsAndUserAgents() {
        assertEquals("Browser extension", sessionTitle(session(label = "Browser extension")))
        assertEquals("Inboxies for Android", sessionTitle(session(agent = "okhttp/4.12.0")))
        assertEquals("Inboxies for iPhone", sessionTitle(session(agent = "Inboxies/1 CFNetwork/1490 Darwin/24.0.0")))
        assertEquals(
            "Safari on Mac",
            sessionTitle(session(agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15")),
        )
        assertEquals(
            "Chrome on Windows",
            sessionTitle(session(agent = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36")),
        )
        assertEquals("Unknown device", sessionTitle(session()))
    }

    @Test
    fun settingsSaveNeverSendsAcl() {
        val payload = ApiClient.shared.settingsPayload(
            MailboxSettings(fromName = "Alex", acl = MailboxAcl(owners = listOf("email:a@example.com"))),
        ).jsonObject
        assertFalse(payload.containsKey("acl"))
        assertTrue(payload.containsKey("fromName"))
    }

    @Test
    fun inviteAcceptDecodesWithoutTokenWhenSignedIn() {
        val decoded = json.decodeFromString<InviteAcceptResponse>(
            """{"mailboxId":"team@inboxies.email","userId":"u1","accountId":"u1"}""",
        )
        assertNull(decoded.token)
        assertEquals("team@inboxies.email", decoded.mailboxId)
    }

    @Test
    fun membersDecodeWithYouFlag() {
        val members = json.decodeFromString<List<MailboxMember>>(
            """[{"userId":"u1","email":"a@example.com","name":null,"role":"owner","you":true},
                {"userId":"u2","email":"b@example.com","role":"member"}]""",
        )
        assertTrue(members[0].isOwner && members[0].you)
        assertFalse(members[1].isOwner || members[1].you)
    }
}

package co.inboxies.watchshared

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WatchHandoffTest {
    private val grant = WatchSessionGrant(
        token = "tok_watch",
        apiBaseUrl = "https://inboxies.email",
        mailboxId = "hello@ada.studio",
        issuedAt = 1_700_000_000_000,
    )

    @Test
    fun grantRoundTrips() {
        assertEquals(grant, WatchSessionGrant.decode(grant.encode(), allowLocalHttp = false))
        assertEquals(
            WatchSessionReply.Granted(grant),
            WatchSessionReply.decode(WatchSessionReply.Granted(grant).encode(), allowLocalHttp = false),
        )
    }

    @Test
    fun grantWithoutMailboxDropsIt() {
        val noMailbox = grant.copy(mailboxId = "")
        assertNull(WatchSessionGrant.decode(noMailbox.encode(), allowLocalHttp = false)!!.mailboxId)
    }

    @Test
    fun grantNeedsTokenAndHttpsOrigin() {
        assertNull(WatchSessionGrant.decode(grant.copy(token = " ").encode(), allowLocalHttp = false))
        assertNull(WatchSessionGrant.decode(grant.copy(apiBaseUrl = "http://inboxies.email").encode(), allowLocalHttp = true))
        assertNull(WatchSessionGrant.decode(grant.copy(apiBaseUrl = "ftp://inboxies.email").encode(), allowLocalHttp = false))
        // A grant with a bad origin is not a session: the watch keeps asking.
        assertEquals(
            WatchSessionReply.Unavailable,
            WatchSessionReply.decode(grant.copy(apiBaseUrl = "javascript:alert(1)").encode(), allowLocalHttp = false),
        )
    }

    @Test
    fun grantNeverPrintsItsToken() {
        assertFalse(grant.toString().contains("tok_watch"))
    }

    @Test
    fun repliesRoundTrip() {
        for (reply in listOf(WatchSessionReply.SignedOut, WatchSessionReply.Revoked, WatchSessionReply.Unavailable)) {
            assertEquals(reply, WatchSessionReply.decode(reply.encode(), allowLocalHttp = false))
        }
    }

    @Test
    fun unreadableRepliesAreUnavailable() {
        assertEquals(WatchSessionReply.Unavailable, WatchSessionReply.decode(null, allowLocalHttp = false))
        assertEquals(WatchSessionReply.Unavailable, WatchSessionReply.decode(ByteArray(0), allowLocalHttp = false))
        assertEquals(WatchSessionReply.Unavailable, WatchSessionReply.decode("not json".toByteArray(), allowLocalHttp = false))
        assertEquals(WatchSessionReply.Unavailable, WatchSessionReply.decode("""{"kind":"???"}""".toByteArray(), allowLocalHttp = false))
        // Unknown fields from a newer phone are ignored.
        assertEquals(
            WatchSessionReply.SignedOut,
            WatchSessionReply.decode("""{"kind":"signedOut","extra":1}""".toByteArray(), allowLocalHttp = false),
        )
    }

    @Test
    fun manualFlagOnlyFromAWellFormedRequest() {
        assertTrue(WatchHandoff.isManualRequest(WatchHandoff.encodeRequest(manual = true)))
        assertFalse(WatchHandoff.isManualRequest(WatchHandoff.encodeRequest(manual = false)))
        assertFalse(WatchHandoff.isManualRequest(null))
        assertFalse(WatchHandoff.isManualRequest("""{"kind":"session","manual":true}""".toByteArray()))
    }

    @Test
    fun originRules() {
        assertEquals("https://inboxies.email", WatchHandoff.acceptedOrigin("https://inboxies.email/", allowLocalHttp = false))
        assertNull(WatchHandoff.acceptedOrigin("http://10.0.2.2:5173", allowLocalHttp = false))
        assertEquals("http://10.0.2.2:5173", WatchHandoff.acceptedOrigin("http://10.0.2.2:5173", allowLocalHttp = true))
        assertNull(WatchHandoff.acceptedOrigin("http://evil.example", allowLocalHttp = true))
        assertNull(WatchHandoff.acceptedOrigin("https://user:pw@inboxies.email", allowLocalHttp = false))
        assertNull(WatchHandoff.acceptedOrigin("", allowLocalHttp = true))
        assertNull(WatchHandoff.acceptedOrigin(null, allowLocalHttp = true))
    }

    @Test
    fun contextRoundTripsWithoutAToken() {
        val context = WatchPhoneContext(signedIn = true, mailboxId = "hello@ada.studio", apiBaseUrl = "https://inboxies.email", updatedAt = 5)
        val bytes = context.encode()
        assertEquals(context, WatchPhoneContext.decode(bytes, allowLocalHttp = false))
        assertFalse(bytes.toString(Charsets.UTF_8).contains("token"))
        // A context is never read as a grant, nor a grant as a context.
        assertNull(WatchSessionGrant.decode(bytes, allowLocalHttp = false))
        assertNull(WatchPhoneContext.decode(grant.encode(), allowLocalHttp = false))
    }

    @Test
    fun signedOutContextWipesOnlyOlderGrants() {
        val signedOut = WatchPhoneContext(signedIn = false, mailboxId = null, apiBaseUrl = null, updatedAt = 1_000)
        assertTrue(signedOut.wipes(grantIssuedAt = 900))
        assertTrue(signedOut.wipes(grantIssuedAt = 1_000))
        assertTrue(signedOut.wipes(grantIssuedAt = null))
        // A stale "signed out" synced after a newer grant leaves it alone.
        assertFalse(signedOut.wipes(grantIssuedAt = 1_100))
        assertFalse(signedOut.copy(signedIn = true).wipes(grantIssuedAt = 900))
    }
}

package co.inboxies.app.services

import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.watchshared.WatchSessionReply
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** The phone's answers to the Wear OS app's session requests (AVE-145). */
class WatchSessionResponderTest {
    private val granted = WatchSessionReply.Granted(WatchSessionGrant("tok", "https://inboxies.email", null, 1))

    private suspend fun respond(manual: Boolean, revoked: Boolean, signedIn: Boolean): Pair<WatchSessionReply, Int> {
        var mints = 0
        val reply = WatchSessionResponder.respond(manual, revoked, signedIn) {
            mints += 1
            granted
        }
        return reply to mints
    }

    @Test
    fun mintsForASignedInPhone() = runTest {
        assertEquals(granted to 1, respond(manual = false, revoked = false, signedIn = true))
    }

    @Test
    fun aSignedOutPhoneNeverMints() = runTest {
        assertEquals(WatchSessionReply.SignedOut to 0, respond(manual = false, revoked = false, signedIn = false))
        assertEquals(WatchSessionReply.SignedOut to 0, respond(manual = true, revoked = false, signedIn = false))
        assertEquals(WatchSessionReply.SignedOut to 0, respond(manual = false, revoked = true, signedIn = false))
    }

    @Test
    fun aRevokeSticksForAutomaticRequests() = runTest {
        assertEquals(WatchSessionReply.Revoked to 0, respond(manual = false, revoked = true, signedIn = true))
    }

    @Test
    fun aConnectTapLiftsARevoke() = runTest {
        assertEquals(granted to 1, respond(manual = true, revoked = true, signedIn = true))
    }

    @Test
    fun mintFailures() {
        assertEquals(WatchSessionReply.SignedOut, WatchSessionResponder.mintFailure(ApiException.SessionExpired()))
        assertEquals(WatchSessionReply.SignedOut, WatchSessionResponder.mintFailure(ApiException.Http(403, "Sign in on your phone first")))
        assertEquals(WatchSessionReply.SignedOut, WatchSessionResponder.mintFailure(ApiException.Http(401, "")))
        assertEquals(WatchSessionReply.Unavailable, WatchSessionResponder.mintFailure(ApiException.Http(503, "")))
        assertEquals(WatchSessionReply.Unavailable, WatchSessionResponder.mintFailure(ApiException.Transport(java.io.IOException("offline"))))
    }
}

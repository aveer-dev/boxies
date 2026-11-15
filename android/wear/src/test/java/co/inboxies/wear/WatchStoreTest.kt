package co.inboxies.wear

import co.inboxies.watchshared.WatchPhoneContext
import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.wear.data.WatchApiClient
import co.inboxies.wear.data.WatchApiException
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailbox
import co.inboxies.wear.data.WatchMoveTarget
import co.inboxies.wear.session.MemoryWatchSessionStorage
import co.inboxies.wear.session.PhoneAnswer
import co.inboxies.wear.session.PhoneSessionSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class WatchStoreTest {
    private val mailbox = WatchMailbox("hello@ada.studio", "hello@ada.studio", "Ada Studio")
    private val email = WatchEmail(id = "e1", threadId = "t1", subject = "Hi", sender = "maya@northwind.co", read = false)

    private fun grant(token: String, issuedAt: Long = 100) =
        WatchSessionGrant(token, "https://inboxies.email", mailbox.id, issuedAt)

    /** Records each call with the token it used; tokens in [dead] answer 401. */
    private class FakeApi(override val token: String, private val log: MutableList<String>, private val dead: Set<String>) :
        WatchApiClient {
        private fun check(call: String) {
            log += "$call:$token"
            if (token in dead) throw WatchApiException.SignedOut()
        }

        override suspend fun mailboxes(): List<WatchMailbox> {
            log += "mailboxes:$token"
            if (token in dead) throw WatchApiException.SignedOut()
            return listOf(WatchMailbox("hello@ada.studio", "hello@ada.studio", "Ada Studio"))
        }

        override suspend fun inbox(mailboxId: String, limit: Int): List<WatchEmail> {
            log += "inbox:$token"
            if (token in dead) throw WatchApiException.SignedOut()
            return listOf(WatchEmail(id = "e1", threadId = "t1", subject = "Hi", sender = "maya@northwind.co"))
        }

        override suspend fun email(mailboxId: String, id: String): WatchEmail {
            check("email")
            return WatchEmail(id = id, body = "Body")
        }

        override suspend fun setRead(read: Boolean, mailboxId: String, email: WatchEmail) = check("read=$read")

        override suspend fun replyLater(mailboxId: String, id: String) = check("replyLater")

        override suspend fun move(mailboxId: String, id: String, to: WatchMoveTarget) = check("move=${to.folderId}")

        override suspend fun quickReply(mailboxId: String, id: String, text: String, idempotencyKey: String) =
            check("reply[$idempotencyKey]")
    }

    private class FakePhone(private val answers: ArrayDeque<PhoneAnswer>) : PhoneSessionSource {
        var calls = 0

        override suspend fun requestSession(manual: Boolean): PhoneAnswer {
            calls += 1
            return answers.removeFirstOrNull() ?: PhoneAnswer.Unreachable
        }
    }

    private class Harness(
        scope: TestScope,
        val storage: MemoryWatchSessionStorage = MemoryWatchSessionStorage(),
        answers: List<PhoneAnswer> = emptyList(),
        val dead: MutableSet<String> = mutableSetOf(),
        delays: List<kotlin.time.Duration> = listOf(0.seconds, 2.seconds),
    ) {
        val log = mutableListOf<String>()
        val phone = FakePhone(ArrayDeque(answers))
        val store = WatchStore(
            // Foreground work on the test scheduler, so advanceUntilIdle runs it.
            scope = CoroutineScope(StandardTestDispatcher(scope.testScheduler) + SupervisorJob()),
            storage = storage,
            phone = phone,
            apiFactory = { _, token -> FakeApi(token, log, dead) },
            reconnectDelays = delays,
        )
    }

    @Test
    fun firstLaunchAsksThePhoneThenLoadsTheInbox() = runTest {
        val h = Harness(this, answers = listOf(PhoneAnswer.Granted(grant("tok_1"))))
        h.store.start()
        advanceUntilIdle()

        val state = h.store.state.value
        assertEquals(Connection.Connected, state.connection)
        assertEquals(listOf("e1"), state.emails.map { it.id })
        assertEquals(mailbox.id, state.activeMailboxId)
        assertEquals("tok_1", h.storage.token)
        assertEquals(1, h.phone.calls)
    }

    @Test
    fun aStoredTokenIsUsedWithoutAskingThePhone() = runTest {
        val h = Harness(this, storage = MemoryWatchSessionStorage(token = "tok_1", grantIssuedAt = 1))
        h.store.start()
        advanceUntilIdle()

        assertEquals(0, h.phone.calls)
        assertEquals(listOf("mailboxes:tok_1", "inbox:tok_1"), h.log)
    }

    @Test
    fun anActionThatHitsA401WaitsForTheQuietReconnectAndRetriesWithTheSameKey() = runTest {
        val h = Harness(
            this,
            storage = MemoryWatchSessionStorage(token = "old", grantIssuedAt = 1),
            answers = listOf(PhoneAnswer.Granted(grant("new"))),
        )
        h.store.start()
        advanceUntilIdle()
        h.dead += "old"

        h.store.reply(email, "  Thanks!  ", idempotencyKey = "key-1")

        assertEquals(listOf("reply[key-1]:old", "reply[key-1]:new"), h.log.filter { it.startsWith("reply") })
        assertEquals("new", h.storage.token)
        assertEquals(1, h.phone.calls)
        assertEquals(Connection.Connected, h.store.state.value.connection)
    }

    @Test
    fun aSignedOutPhoneEndsTheActionAndShowsConnect() = runTest {
        val h = Harness(
            this,
            storage = MemoryWatchSessionStorage(token = "old", grantIssuedAt = 1),
            answers = listOf(PhoneAnswer.SignedOut),
        )
        h.store.start()
        advanceUntilIdle()
        h.dead += "old"

        try {
            h.store.archive(email)
            fail("expected SignedOut")
        } catch (_: WatchApiException.SignedOut) {
        }
        advanceUntilIdle()
        assertEquals(Connection.NeedsPhone(WatchStore.SIGNED_OUT_MESSAGE), h.store.state.value.connection)
        assertNull(h.storage.token)
        assertTrue(h.store.state.value.emails.isEmpty())
        // The row wasn't dropped locally: the archive never happened.
        assertEquals(1, h.log.count { it.startsWith("move=archive") })
    }

    @Test
    fun aRevokeFromThePhoneShowsTheRevokedMessage() = runTest {
        val h = Harness(this, answers = listOf(PhoneAnswer.Revoked))
        h.store.start()
        advanceUntilIdle()
        assertEquals(Connection.NeedsPhone(WatchStore.REVOKED_MESSAGE), h.store.state.value.connection)
    }

    @Test
    fun anActionGivesUpAfterSixSecondsWhileStillReconnecting() = runTest {
        val h = Harness(
            this,
            storage = MemoryWatchSessionStorage(token = "old", grantIssuedAt = 1),
            delays = listOf(0.seconds, 10.seconds),
        )
        h.store.start()
        advanceUntilIdle()
        h.dead += "old"

        val started = testScheduler.currentTime
        try {
            h.store.setRead(true, email)
            fail("expected Reconnecting")
        } catch (_: WatchApiException.Reconnecting) {
        }
        assertEquals(6_000L, testScheduler.currentTime - started)
    }

    @Test
    fun whenThePhoneCantMintConnectSaysSo() = runTest {
        val h = Harness(this, answers = listOf(PhoneAnswer.Unreachable, PhoneAnswer.Unavailable))
        h.store.start()
        advanceUntilIdle()
        assertEquals(Connection.NeedsPhone(WatchStore.UNAVAILABLE_MESSAGE), h.store.state.value.connection)
    }

    @Test
    fun afterTheQuietRetriesConnectTriesAgain() = runTest {
        val h = Harness(this, answers = listOf(PhoneAnswer.Unreachable, PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant("tok"))))
        h.store.start()
        advanceUntilIdle()
        assertEquals(Connection.NeedsPhone(WatchStore.UNREACHABLE_MESSAGE), h.store.state.value.connection)

        h.store.connect()
        advanceUntilIdle()
        assertEquals(Connection.Connected, h.store.state.value.connection)
        assertEquals(3, h.phone.calls)
    }

    @Test
    fun clearFromThePhoneWipesEverything() = runTest {
        val h = Harness(this, storage = MemoryWatchSessionStorage(token = "tok", grantIssuedAt = 1))
        h.store.start()
        advanceUntilIdle()

        h.store.receiveClear()
        advanceUntilIdle()

        assertNull(h.storage.token)
        assertEquals(Connection.NeedsPhone(WatchStore.CLEARED_MESSAGE), h.store.state.value.connection)
        assertTrue(h.store.state.value.mailboxes.isEmpty())
        // A wipe is not followed by polling the phone.
        assertEquals(0, h.phone.calls)
    }

    @Test
    fun aSignedOutContextWipesOnlyAnOlderGrant() = runTest {
        val h = Harness(this, storage = MemoryWatchSessionStorage(token = "tok", grantIssuedAt = 500))
        h.store.start()
        advanceUntilIdle()

        h.store.receiveContext(WatchPhoneContext(signedIn = false, mailboxId = null, apiBaseUrl = null, updatedAt = 400))
        advanceUntilIdle()
        assertEquals("tok", h.storage.token)
        assertEquals(Connection.Connected, h.store.state.value.connection)

        h.store.receiveContext(WatchPhoneContext(signedIn = false, mailboxId = null, apiBaseUrl = null, updatedAt = 600))
        advanceUntilIdle()
        assertNull(h.storage.token)
        assertEquals(Connection.NeedsPhone(WatchStore.CLEARED_MESSAGE), h.store.state.value.connection)
    }

    @Test
    fun aPushedGrantConnects() = runTest {
        val h = Harness(this, answers = listOf(PhoneAnswer.SignedOut))
        h.store.start()
        advanceUntilIdle()

        h.store.receiveGrant(grant("pushed"))
        advanceUntilIdle()

        assertEquals(Connection.Connected, h.store.state.value.connection)
        assertEquals("pushed", h.storage.token)
        assertEquals(listOf("e1"), h.store.state.value.emails.map { it.id })
    }

    @Test
    fun actionsUpdateTheList() = runTest {
        val h = Harness(this, storage = MemoryWatchSessionStorage(token = "tok", grantIssuedAt = 1))
        h.store.start()
        advanceUntilIdle()
        val row = h.store.state.value.emails.single()

        h.store.setRead(true, row)
        assertTrue(!h.store.state.value.emails.single().isUnread)
        h.store.replyLater(row)
        assertTrue(h.store.state.value.emails.single().replyLater)
        h.store.archive(row)
        assertTrue(h.store.state.value.emails.isEmpty())
        assertEquals(listOf("read=true:tok", "replyLater:tok", "move=archive:tok"), h.log.drop(2))
    }

    @Test
    fun aBlankReplySendsNothing() = runTest {
        val h = Harness(this, storage = MemoryWatchSessionStorage(token = "tok", grantIssuedAt = 1))
        h.store.start()
        advanceUntilIdle()
        h.store.reply(email, "   ", idempotencyKey = "k")
        assertTrue(h.log.none { it.startsWith("reply") })
    }
}

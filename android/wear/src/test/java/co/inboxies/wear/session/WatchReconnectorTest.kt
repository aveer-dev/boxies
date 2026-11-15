package co.inboxies.wear.session

import co.inboxies.watchshared.WatchSessionGrant
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.seconds

@OptIn(ExperimentalCoroutinesApi::class)
class WatchReconnectorTest {
    private val grant = WatchSessionGrant("tok_new", "https://inboxies.email", "hello@ada.studio", issuedAt = 1)

    /** Answers from [answers] in order (then [fallback]), recording (virtual time, manual). */
    private class FakePhone(
        private val scope: TestScope,
        answers: List<PhoneAnswer> = emptyList(),
        private val fallback: PhoneAnswer = PhoneAnswer.Unreachable,
        private val latencyMs: Long = 0,
        private val answer: ((manual: Boolean) -> PhoneAnswer)? = null,
    ) : PhoneSessionSource {
        private val queue = ArrayDeque(answers)
        val calls = mutableListOf<Pair<Long, Boolean>>()

        override suspend fun requestSession(manual: Boolean): PhoneAnswer {
            calls += scope.testScheduler.currentTime to manual
            if (latencyMs > 0) delay(latencyMs)
            answer?.let { return it(manual) }
            return queue.removeFirstOrNull() ?: fallback
        }
    }

    @Test
    fun backsOffNowThen2_5_10_20_30sAndGivesUp() = runTest {
        val phone = FakePhone(this)
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val outcome = reconnector.reconnect()

        assertEquals(WatchReconnector.Outcome.GaveUp(PhoneAnswer.Unreachable), outcome)
        assertEquals(listOf(0L, 2_000L, 7_000L, 17_000L, 37_000L, 67_000L), phone.calls.map { it.first })
        assertTrue(phone.calls.none { it.second })
        assertEquals(6, reconnector.attempts)
        assertFalse(reconnector.isRunning)
    }

    @Test
    fun givingUpReportsTheLastAnswer() = runTest {
        val phone = FakePhone(this, fallback = PhoneAnswer.Unavailable)
        val outcome = WatchReconnector(backgroundScope, request = phone).reconnect()
        assertEquals(WatchReconnector.Outcome.GaveUp(PhoneAnswer.Unavailable), outcome)
    }

    @Test
    fun stopsAtTheFirstGrant() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Unavailable, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        assertEquals(WatchReconnector.Outcome.Connected(grant), reconnector.reconnect())
        assertEquals(listOf(0L, 2_000L, 7_000L), phone.calls.map { it.first })
        assertEquals(3, reconnector.attempts)
    }

    @Test
    fun stopsAtOnceWhenThePhoneIsSignedOut() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.SignedOut))
        val outcome = WatchReconnector(backgroundScope, request = phone).reconnect()

        assertEquals(WatchReconnector.Outcome.Stopped(PhoneAnswer.SignedOut), outcome)
        // A signed-out phone is never polled in a loop.
        assertEquals(2, phone.calls.size)
    }

    @Test
    fun stopsAtOnceWhenTheWatchWasRevoked() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Revoked))
        val outcome = WatchReconnector(backgroundScope, request = phone).reconnect()

        assertEquals(WatchReconnector.Outcome.Stopped(PhoneAnswer.Revoked), outcome)
        assertEquals(1, phone.calls.size)
    }

    @Test
    fun concurrentCallersShareOneRun() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val first = async { reconnector.reconnect() }
        runCurrent()
        advanceTimeBy(1_000)
        // A 401 from an action and the phone becoming reachable, mid-wait.
        val second = async { reconnector.reconnect() }
        val third = async { reconnector.reconnect() }

        val outcomes = listOf(first.await(), second.await(), third.await())
        assertTrue(outcomes.all { it == WatchReconnector.Outcome.Connected(grant) })
        // Asked once per attempt, not once per caller.
        assertEquals(2, phone.calls.size)
    }

    @Test
    fun aCallerGoingAwayDoesNotCancelTheRunForOthers() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val leaving = launch { reconnector.reconnect() }
        runCurrent()
        val staying = async { reconnector.reconnect() }
        runCurrent()
        leaving.cancel()

        assertEquals(WatchReconnector.Outcome.Connected(grant), staying.await())
    }

    @Test
    fun skipWaitAsksNowInsteadOfFinishingTheWait() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val run = async { reconnector.reconnect() }
        runCurrent()
        advanceTimeBy(500)
        reconnector.skipWait()

        assertEquals(WatchReconnector.Outcome.Connected(grant), run.await())
        assertEquals(listOf(0L, 500L), phone.calls.map { it.first })
    }

    @Test
    fun skipWaitDuringARequestSkipsTheNextWait() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant)), latencyMs = 1_000)
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val run = async { reconnector.reconnect() }
        runCurrent()
        advanceTimeBy(300)
        reconnector.skipWait()

        assertEquals(WatchReconnector.Outcome.Connected(grant), run.await())
        assertEquals(listOf(0L, 1_000L), phone.calls.map { it.first })
    }

    @Test
    fun skipWaitWithoutARunDoesNothing() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.Unreachable, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, request = phone)
        reconnector.skipWait()

        reconnector.reconnect()
        // The stale skip didn't carry into the new run.
        assertEquals(listOf(0L, 2_000L), phone.calls.map { it.first })
    }

    @Test
    fun connectTapIsAManualRequestThatLiftsARevoke() = runTest {
        val phone = FakePhone(this, answer = { manual -> if (manual) PhoneAnswer.Granted(grant) else PhoneAnswer.Revoked })
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        assertEquals(WatchReconnector.Outcome.Stopped(PhoneAnswer.Revoked), reconnector.reconnect())
        assertEquals(WatchReconnector.Outcome.Connected(grant), reconnector.reconnect(manual = true))
        assertEquals(listOf(false, true), phone.calls.map { it.second })
        assertEquals(1, reconnector.attempts)
    }

    @Test
    fun connectTapJoiningAnAutomaticRequestAsksAgainAsThePerson() = runTest {
        val phone = FakePhone(
            this,
            latencyMs = 1_000,
            answer = { manual -> if (manual) PhoneAnswer.Granted(grant) else PhoneAnswer.Revoked },
        )
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val automatic = async { reconnector.reconnect() }
        runCurrent()
        advanceTimeBy(500)
        val connect = async { reconnector.reconnect(manual = true) }

        assertEquals(WatchReconnector.Outcome.Connected(grant), automatic.await())
        assertEquals(WatchReconnector.Outcome.Connected(grant), connect.await())
        assertEquals(listOf(0L to false, 1_000L to true), phone.calls)
    }

    @Test
    fun connectTapSkipsTheCurrentWait() = runTest {
        val phone = FakePhone(this, answer = { manual -> if (manual) PhoneAnswer.Granted(grant) else PhoneAnswer.Unreachable })
        val reconnector = WatchReconnector(backgroundScope, request = phone)

        val automatic = async { reconnector.reconnect() }
        runCurrent()
        advanceTimeBy(1_000)
        reconnector.reconnect(manual = true)

        assertEquals(WatchReconnector.Outcome.Connected(grant), automatic.await())
        assertEquals(listOf(0L to false, 1_000L to true), phone.calls)
    }

    @Test
    fun aNewRunStartsAfterTheLastEndsAndResetsManual() = runTest {
        val phone = FakePhone(this, listOf(PhoneAnswer.SignedOut, PhoneAnswer.Granted(grant)))
        val reconnector = WatchReconnector(backgroundScope, delays = listOf(0.seconds, 2.seconds), request = phone)

        assertEquals(WatchReconnector.Outcome.Stopped(PhoneAnswer.SignedOut), reconnector.reconnect(manual = true))
        assertEquals(WatchReconnector.Outcome.Connected(grant), reconnector.reconnect())
        assertEquals(listOf(true, false), phone.calls.map { it.second })
    }
}

package co.inboxies.wear.session

import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.watchshared.WatchSessionReply
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/** What the phone answered when the watch asked it for a session. */
sealed interface PhoneAnswer {
    data class Granted(val grant: WatchSessionGrant) : PhoneAnswer

    /** No signed-in session on the phone. Retrying won't help. */
    data object SignedOut : PhoneAnswer

    /**
     * The watch session was signed out from the phone (Devices & sessions) and the
     * request wasn't a Connect tap. Retrying won't help.
     */
    data object Revoked : PhoneAnswer

    /** The phone isn't reachable right now (not paired, out of range, app missing). */
    data object Unreachable : PhoneAnswer

    /** The phone was reached but couldn't mint one (offline, server error). */
    data object Unavailable : PhoneAnswer

    companion object {
        fun from(reply: WatchSessionReply): PhoneAnswer = when (reply) {
            is WatchSessionReply.Granted -> Granted(reply.grant)
            WatchSessionReply.SignedOut -> SignedOut
            WatchSessionReply.Revoked -> Revoked
            WatchSessionReply.Unavailable -> Unavailable
        }
    }
}

/** Asks the phone for a session. `manual`: the person tapped Connect. */
fun interface PhoneSessionSource {
    suspend fun requestSession(manual: Boolean): PhoneAnswer
}

/**
 * Silent reconnect for the watch (AVE-145; iOS twin `WatchReconnector`, AVE-144):
 * when the watch has no session (first launch, a 401 after a revoke or a replaced
 * token), it asks the phone for one a few times with growing gaps, without the
 * person doing anything. Stops at the first grant, or as soon as the phone says it's
 * signed out or the watch was revoked from it, so a signed-out phone is never polled
 * in a loop. Only after every attempt has failed does the watch show Connect.
 *
 * One run at a time: concurrent callers (launch, a 401 from the list and one from an
 * action, the phone becoming reachable) all await the same run, so the phone is
 * asked at most once per attempt. The run lives in [scope], so a caller that goes
 * away doesn't cancel it for the others.
 */
class WatchReconnector(
    private val scope: CoroutineScope,
    val delays: List<Duration> = DEFAULT_DELAYS,
    private val request: PhoneSessionSource,
) {
    sealed interface Outcome {
        data class Connected(val grant: WatchSessionGrant) : Outcome

        /** The phone answered [PhoneAnswer.SignedOut] or [PhoneAnswer.Revoked]: stop and show Connect. */
        data class Stopped(val answer: PhoneAnswer) : Outcome

        /** Every attempt came back unreachable / unavailable (the last answer). */
        data class GaveUp(val last: PhoneAnswer) : Outcome
    }

    init {
        require(delays.isNotEmpty()) { "WatchReconnector needs at least one attempt" }
    }

    private val lock = Any()
    private var run: Deferred<Outcome>? = null
    private var wait: CompletableDeferred<Unit>? = null

    /** [skipWait] arrived mid-request: don't wait before the next attempt. */
    private var skipNextWait = false

    /** A Connect tap joined the run: the remaining attempts are manual. */
    @Volatile
    private var manual = false

    /** Attempts made by the current or last run (tests). */
    @Volatile
    var attempts = 0
        private set

    val isRunning: Boolean get() = synchronized(lock) { run != null }

    /**
     * Starts a run, or joins the one in flight. [manual] (Connect) skips the current
     * wait and marks the remaining requests as the person's, which lifts a revoke.
     */
    suspend fun reconnect(manual: Boolean = false): Outcome {
        val deferred = synchronized(lock) {
            if (manual) {
                this.manual = true
                skipWaitLocked()
            }
            run ?: scope.async(start = CoroutineStart.LAZY) { attemptAll() }.also {
                run = it
                attempts = 0
                skipNextWait = false
            }
        }
        deferred.start()
        return deferred.await()
    }

    /** The phone just became reachable or the app came forward: try now instead of finishing the wait. */
    fun skipWait() {
        synchronized(lock) { skipWaitLocked() }
    }

    private fun skipWaitLocked() {
        if (run == null) return
        val pending = wait
        if (pending != null) {
            wait = null
            pending.complete(Unit)
        } else {
            skipNextWait = true
        }
    }

    private suspend fun attemptAll(): Outcome {
        try {
            var last: PhoneAnswer = PhoneAnswer.Unreachable
            for (delay in delays) {
                if (delay > Duration.ZERO) pause(delay)
                var result: PhoneAnswer
                while (true) {
                    val asked = manual
                    attempts += 1
                    result = request.requestSession(asked)
                    // A Connect tap that joined during an automatic request asks again as
                    // the person, which is what lifts a revoke.
                    if (result == PhoneAnswer.Revoked && !asked && manual) continue
                    break
                }
                when (result) {
                    is PhoneAnswer.Granted -> return Outcome.Connected(result.grant)
                    PhoneAnswer.SignedOut, PhoneAnswer.Revoked -> return Outcome.Stopped(result)
                    PhoneAnswer.Unreachable, PhoneAnswer.Unavailable -> last = result
                }
            }
            return Outcome.GaveUp(last)
        } finally {
            synchronized(lock) {
                run = null
                wait = null
                manual = false
            }
        }
    }

    private suspend fun pause(delay: Duration) {
        val signal = synchronized(lock) {
            if (skipNextWait) {
                skipNextWait = false
                null
            } else {
                CompletableDeferred<Unit>().also { wait = it }
            }
        } ?: return
        withTimeoutOrNull(delay) { signal.await() }
        synchronized(lock) { if (wait === signal) wait = null }
    }

    companion object {
        /** Wait before each attempt: now, then 2s, 5s, 10s, 20s, 30s (about a minute in all). */
        val DEFAULT_DELAYS: List<Duration> =
            listOf(Duration.ZERO, 2.seconds, 5.seconds, 10.seconds, 20.seconds, 30.seconds)
    }
}

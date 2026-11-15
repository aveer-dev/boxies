package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import co.inboxies.app.config.AppConfig
import co.inboxies.watchshared.WatchHandoff
import co.inboxies.watchshared.WatchPhoneContext
import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.watchshared.WatchSessionReply
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.PutDataRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.TaskCompletionSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.tasks.await

/**
 * Phone side of the Wear OS handoff (AVE-145, docs/watch-companion-plan.md phase 2;
 * iOS twin `WatchSessionBridge`, AVE-144). The watch app talks to the Worker
 * directly with its own `watch`-scoped session; this mints that session from the
 * app's full one and sends it over the Wearable Data Layer. The app's full session
 * never leaves the phone.
 *
 * - After sign-in a watch with Inboxies gets one session without asking ([handOverIfNeeded]).
 * - Afterwards the phone mints only when the watch asks ([WatchPhoneListenerService]).
 *   The watch asks on its own whenever it has no session (first launch, a 401), with a
 *   few retries, so a replaced or expired token heals without the person doing anything.
 * - A revoke in Devices & sessions on this phone sticks: until the person taps Connect
 *   on the watch (a `manual` request), the phone answers `revoked`.
 * - Sign-out tells the watch to wipe (a message, plus "signed out" in the context
 *   DataItem for a watch out of range) and hands back the watch session's id so
 *   sign-out can end it on the server. The server also ends it with the phone session
 *   (`parent_session_id`, AVE-143).
 */
object WatchSessionBridge {
    private const val TAG = "WatchSessionBridge"
    private const val PREFS = "inboxies_watch_bridge"

    /** The last watch session minted here, for revoking it and matching it in Devices & sessions. Not a secret. */
    private const val SESSION_ID_KEY = "watchSessionId"

    /** Set once the watch was handed a session since this sign-in, so launches don't re-mint. */
    private const val HANDED_OVER_KEY = "watchSessionHandedOver"

    /** The watch session was ended from this phone: automatic requests get `revoked` until a Connect tap. */
    private const val REVOKED_KEY = "watchSessionRevoked"

    private var app: Context? = null
    private var prefs: SharedPreferences? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val handOver = Mutex()

    @Volatile
    private var activeMailboxId: String? = null

    @Volatile
    private var lastContext: WatchPhoneContext? = null

    fun init(context: Context) {
        app = context.applicationContext
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    val storedId: String?
        get() = prefs?.getString(SESSION_ID_KEY, null)?.takeIf { it.isNotEmpty() }

    private val isSignedIn: Boolean
        get() = !ApiClient.shared.authTokenProvider().isNullOrEmpty()

    /** DEBUG previews hold a fixture session: never mint or publish from one. */
    private val isPreview: Boolean
        get() = PreviewNetworkGuard.isBlocking

    // MARK: App hooks

    /** Signed in with a watch that has Inboxies: hand it a session once per sign-in. */
    suspend fun handOverIfNeeded() {
        val prefs = prefs ?: return
        if (isPreview || !isSignedIn) return
        if (prefs.getBoolean(HANDED_OVER_KEY, false) || prefs.getBoolean(REVOKED_KEY, false)) return
        // Launch and a watch installing the app both hand over; only one mints.
        if (!handOver.tryLock()) return
        try {
            val nodes = watchNodes()
            if (nodes.isEmpty()) return
            val reply = mint()
            if (reply !is WatchSessionReply.Granted) return
            val bytes = reply.encode()
            nodes.forEach { send(it, WatchHandoff.SESSION_PATH, bytes) }
        } finally {
            handOver.unlock()
        }
    }

    /** Mirrors the active mailbox and API origin (no token) for the watch. */
    fun publish(mailboxId: String?) {
        if (prefs == null || isPreview) return
        activeMailboxId = mailboxId
        val signedIn = isSignedIn
        val last = lastContext
        if (last != null && last.signedIn == signedIn && last.mailboxId == mailboxId) return
        putContext(WatchPhoneContext(signedIn, mailboxId, AppConfig.apiBaseURL, System.currentTimeMillis()))
    }

    /**
     * Every sign-out path: tells the watch to wipe and returns the watch session's id so
     * the caller can end it on the server. Idempotent.
     */
    fun forget(): String? {
        val prefs = prefs ?: return null
        val id = storedId
        val alreadyForgotten = id == null &&
            !prefs.getBoolean(HANDED_OVER_KEY, false) &&
            lastContext?.signedIn == false
        prefs.edit(commit = true) {
            remove(SESSION_ID_KEY)
            remove(HANDED_OVER_KEY)
            remove(REVOKED_KEY)
        }
        activeMailboxId = null
        if (alreadyForgotten) return null
        tellWatchesToWipe()
        putContext(WatchPhoneContext(signedIn = false, mailboxId = null, apiBaseUrl = null, updatedAt = System.currentTimeMillis()))
        return id
    }

    /**
     * The watch session was ended on the server from this phone (Devices & sessions). The
     * watch wipes now; it gets a new session only when the person taps Connect.
     */
    fun revokedOnServer() {
        val prefs = prefs ?: return
        prefs.edit(commit = true) {
            remove(SESSION_ID_KEY)
            putBoolean(REVOKED_KEY, true)
        }
        tellWatchesToWipe()
    }

    // MARK: The watch's request

    /** Answers a [WatchHandoff.REQUEST_SESSION_PATH] request. */
    suspend fun answer(request: ByteArray?): WatchSessionReply {
        val prefs = prefs ?: return WatchSessionReply.Unavailable
        val reply = WatchSessionResponder.respond(
            manual = WatchHandoff.isManualRequest(request),
            revoked = prefs.getBoolean(REVOKED_KEY, false),
            signedIn = isSignedIn,
            mint = ::mint,
        )
        if (reply is WatchSessionReply.Granted) prefs.edit { remove(REVOKED_KEY) }
        return reply
    }

    private suspend fun mint(): WatchSessionReply {
        if (isPreview) return WatchSessionReply.Unavailable
        if (!isSignedIn) return WatchSessionReply.SignedOut
        return try {
            val minted = ApiClient.shared.createWatchSession()
            prefs?.edit(commit = true) {
                putString(SESSION_ID_KEY, minted.id)
                putBoolean(HANDED_OVER_KEY, true)
            }
            WatchSessionReply.Granted(
                WatchSessionGrant(
                    token = minted.token,
                    apiBaseUrl = AppConfig.apiBaseURL,
                    mailboxId = activeMailboxId,
                    issuedAt = System.currentTimeMillis(),
                ),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            WatchSessionResponder.mintFailure(e)
        }
    }

    // MARK: Data Layer

    private suspend fun watchNodes(): Set<Node> {
        val context = app ?: return emptySet()
        return try {
            Wearable.getCapabilityClient(context)
                .getCapability(WatchHandoff.WEAR_CAPABILITY, CapabilityClient.FILTER_REACHABLE)
                .await()
                .nodes
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // No Wear OS app / Play services on this phone.
            emptySet()
        }
    }

    private suspend fun send(node: Node, path: String, bytes: ByteArray) {
        val context = app ?: return
        try {
            Wearable.getMessageClient(context).sendMessage(node.id, path, bytes).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.i(TAG, "Couldn't reach the watch ($path): ${e.javaClass.simpleName}")
        }
    }

    private fun tellWatchesToWipe() {
        scope.launch {
            watchNodes().forEach { send(it, WatchHandoff.CLEAR_PATH, ByteArray(0)) }
        }
    }

    /**
     * The context DataItem. It syncs to a watch that's out of range when it comes back,
     * which is how a far-away watch hears about a sign-out. Never holds a token.
     */
    private fun putContext(context: WatchPhoneContext) {
        val appContext = app ?: return
        lastContext = context
        scope.launch {
            try {
                val request = PutDataRequest.create(WatchHandoff.CONTEXT_PATH).setData(context.encode()).setUrgent()
                Wearable.getDataClient(appContext).putDataItem(request).await()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.i(TAG, "Couldn't publish the watch context: ${e.javaClass.simpleName}")
            }
        }
    }

    // MARK: Listener service plumbing

    internal fun answerAsync(request: ByteArray?): Task<ByteArray> {
        val result = TaskCompletionSource<ByteArray>()
        scope.launch {
            val reply = try {
                answer(request)
            } catch (e: Exception) {
                WatchSessionReply.Unavailable
            }
            result.setResult(reply.encode())
        }
        return result.task
    }

    internal fun watchAppChanged() {
        scope.launch { handOverIfNeeded() }
    }
}

/** The decisions behind [WatchSessionBridge.answer]. Pure, so they're unit-tested. */
internal object WatchSessionResponder {
    /**
     * A revoke made on this phone sticks for automatic requests; only a Connect tap
     * ([manual]) mints again. Otherwise mint (signed out → [WatchSessionReply.SignedOut]).
     */
    suspend fun respond(
        manual: Boolean,
        revoked: Boolean,
        signedIn: Boolean,
        mint: suspend () -> WatchSessionReply,
    ): WatchSessionReply {
        if (!manual && revoked) return if (signedIn) WatchSessionReply.Revoked else WatchSessionReply.SignedOut
        if (!signedIn) return WatchSessionReply.SignedOut
        return mint()
    }

    /**
     * A failed mint: the phone's own session is gone (or isn't a live full session the
     * Worker will mint from) → signed out; anything else (offline, 5xx) → unavailable,
     * so the watch tries again.
     */
    fun mintFailure(error: Throwable): WatchSessionReply = when (error) {
        is ApiException.SessionExpired -> WatchSessionReply.SignedOut
        is ApiException.Http ->
            if (error.code == 401 || error.code == 403) WatchSessionReply.SignedOut else WatchSessionReply.Unavailable
        else -> WatchSessionReply.Unavailable
    }
}

/**
 * The paired watch asking for a session, and watches installing / removing the Wear
 * OS app. The Data Layer only delivers from the same package and signing key.
 */
class WatchPhoneListenerService : WearableListenerService() {
    override fun onRequest(nodeId: String, path: String, request: ByteArray): Task<ByteArray>? {
        if (path != WatchHandoff.REQUEST_SESSION_PATH) return null
        return WatchSessionBridge.answerAsync(request)
    }

    override fun onCapabilityChanged(info: CapabilityInfo) {
        if (info.name == WatchHandoff.WEAR_CAPABILITY && info.nodes.isNotEmpty()) {
            WatchSessionBridge.watchAppChanged()
        }
    }
}

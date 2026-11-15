package co.inboxies.wear

import co.inboxies.watchshared.WatchPhoneContext
import co.inboxies.watchshared.WatchSessionGrant
import co.inboxies.wear.data.WatchApiClient
import co.inboxies.wear.data.WatchApiException
import co.inboxies.wear.data.WatchEmail
import co.inboxies.wear.data.WatchMailbox
import co.inboxies.wear.data.WatchMoveTarget
import co.inboxies.wear.glance.WatchGlance
import co.inboxies.wear.glance.WatchGlanceSink
import co.inboxies.wear.session.PhoneAnswer
import co.inboxies.wear.session.PhoneSessionSource
import co.inboxies.wear.session.WatchReconnector
import co.inboxies.wear.session.WatchSessionStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * The Wear OS app's state (AVE-145; iOS twin `WatchStore`, AVE-144): the handed-over
 * session, the active mailbox and its newest Inbox conversations. Talks to the
 * Worker directly with the `watch` token; the phone is only asked for a token.
 *
 * Confined to [scope]'s dispatcher (Main in the app): call it from there. The
 * Data Layer service hands its events over with [receiveGrant] / [receiveClear] /
 * [receiveContext], which write storage right away and update state on [scope].
 */
class WatchStore(
    private val scope: CoroutineScope,
    private val storage: WatchSessionStorage,
    private val phone: PhoneSessionSource,
    private val apiFactory: (baseUrl: String, token: String) -> WatchApiClient,
    reconnectDelays: List<Duration> = WatchReconnector.DEFAULT_DELAYS,
    /** How long an action waits for a quiet reconnect before giving up. */
    private val actionReconnectWait: Duration = 6.seconds,
    /** DEBUG fixtures: no phone, no network, actions only change local state. */
    val isPreview: Boolean = false,
    initialState: WatchState = WatchState(),
    /** The Inbox Tile / unread complication snapshot (AVE-147). */
    private val glance: WatchGlanceSink = WatchGlanceSink.None,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(initialState)
    val state: StateFlow<WatchState> = _state.asStateFlow()

    private val token = MutableStateFlow<String?>(null)
    private var apiBaseUrl: String = DEFAULT_API_BASE
    private var started = false
    private var backgroundRefresh: Job? = null

    private val reconnector = WatchReconnector(scope, reconnectDelays, phone)

    private val api: WatchApiClient?
        get() = token.value?.let { apiFactory(apiBaseUrl, it) }

    // MARK: Launch

    /** First launch of the UI: the stored session, or a quiet request to the phone. */
    fun start() {
        if (isPreview || started) return
        started = true
        storage.apiBaseUrl?.let { apiBaseUrl = it }
        _state.update { it.copy(activeMailboxId = storage.mailboxId) }
        val stored = storage.token
        if (stored != null) {
            token.value = stored
            _state.update { it.copy(connection = Connection.Connected) }
            scope.launch { refresh() }
        } else {
            scope.launch { reconnect() }
        }
    }

    // MARK: Phone handoff

    /** The Connect button: try now, and lift a revoke made on the phone. */
    suspend fun connect() {
        if (isPreview) return
        _state.update { it.copy(connection = Connection.Connecting) }
        reconnect(manual = true)
    }

    /**
     * The app came forward or the phone became reachable: if the watch still has no
     * session, ask now (joining a run in flight and skipping its wait).
     */
    fun retryNowIfDisconnected() {
        if (isPreview || !started || token.value != null) return
        reconnector.skipWait()
        if (!reconnector.isRunning) scope.launch { reconnect() }
    }

    /**
     * Asks the phone for a session without the person doing anything, retrying with
     * backoff ([WatchReconnector]); concurrent callers share one run. Shows Connect
     * only when the phone is signed out, revoked the watch, or never answered.
     */
    private suspend fun reconnect(manual: Boolean = false): Boolean {
        if (isPreview) return false
        if (token.value != null) return true
        // A quiet retry from the Connect screen keeps the button up.
        if (!(state.value.connection is Connection.NeedsPhone && !manual)) {
            _state.update { it.copy(connection = Connection.Connecting) }
        }
        val outcome = reconnector.reconnect(manual)
        // A grant pushed by the phone may have landed meanwhile.
        if (token.value != null) return true
        when (outcome) {
            is WatchReconnector.Outcome.Connected -> accept(outcome.grant)
            is WatchReconnector.Outcome.Stopped ->
                wipe(if (outcome.answer == PhoneAnswer.Revoked) REVOKED_MESSAGE else SIGNED_OUT_MESSAGE)
            is WatchReconnector.Outcome.GaveUp -> _state.update {
                it.copy(
                    connection = Connection.NeedsPhone(
                        if (outcome.last == PhoneAnswer.Unavailable) UNAVAILABLE_MESSAGE else UNREACHABLE_MESSAGE,
                    ),
                )
            }
        }
        return token.value != null
    }

    /** The phone pushed a grant (after sign-in). Safe from any thread. */
    fun receiveGrant(grant: WatchSessionGrant) {
        if (isPreview) return
        storage.saveGrant(grant.token, grant.issuedAt, grant.apiBaseUrl)
        scope.launch { accept(grant) }
    }

    /** The phone signed out, or signed this watch out. Safe from any thread. */
    fun receiveClear() {
        if (isPreview) return
        storage.clearToken()
        glance.clear()
        scope.launch { wipe(CLEARED_MESSAGE) }
    }

    /**
     * The phone's context changed. Hints only (active mailbox, origin), plus the wipe a
     * watch that was out of range when the phone signed out gets ([WatchPhoneContext.wipes]).
     * Safe from any thread.
     */
    fun receiveContext(context: WatchPhoneContext) {
        if (isPreview) return
        if (storage.token != null && context.wipes(storage.grantIssuedAt)) {
            storage.clearToken()
            glance.clear()
            scope.launch { wipe(CLEARED_MESSAGE) }
            return
        }
        if (!context.signedIn) return
        scope.launch {
            if (token.value == null) context.apiBaseUrl?.let { setApiBaseUrl(it) }
            if (state.value.activeMailboxId == null) context.mailboxId?.let { setActiveMailbox(it) }
            // The phone signed (back) in: a watch without a session asks now.
            retryNowIfDisconnected()
        }
    }

    private suspend fun accept(grant: WatchSessionGrant) {
        if (grant.token == token.value) return
        storage.saveGrant(grant.token, grant.issuedAt, grant.apiBaseUrl)
        token.value = grant.token
        setApiBaseUrl(grant.apiBaseUrl)
        if (state.value.activeMailboxId == null) grant.mailboxId?.let { setActiveMailbox(it) }
        _state.update { it.copy(connection = Connection.Connected) }
        if (started) refresh()
    }

    /** Drops the session and everything read with it (phone sign-out or revoke). */
    private fun wipe(message: String) {
        storage.clearToken()
        glance.clear()
        storage.saveMailboxId(null)
        token.value = null
        _state.update {
            it.copy(
                connection = Connection.NeedsPhone(message),
                mailboxes = emptyList(),
                activeMailboxId = null,
                emails = emptyList(),
                listState = ListState.Idle,
            )
        }
    }

    /**
     * A 401: the token is dead (revoked elsewhere, replaced, ended with the phone's
     * session). Drop it and ask the phone for a new one quietly; what's on screen
     * stays until that settles.
     */
    private fun sessionEnded(deadToken: String) {
        if (token.value != deadToken) return
        storage.clearToken()
        token.value = null
        scope.launch { reconnect() }
    }

    /**
     * The API to use for an action: the current one, or the one a quiet reconnect
     * brings within [actionReconnectWait]. Throws [WatchApiException.SignedOut] when
     * the reconnect stopped (Connect is showing), or [WatchApiException.Reconnecting]
     * while it's still trying.
     */
    private suspend fun connectedApi(): WatchApiClient {
        api?.let { return it }
        retryNowIfDisconnected()
        withTimeoutOrNull(actionReconnectWait) {
            combine(token, state) { t, s -> t != null || s.connection is Connection.NeedsPhone }.first { it }
        }
        api?.let { return it }
        if (state.value.connection is Connection.NeedsPhone) throw WatchApiException.SignedOut()
        throw WatchApiException.Reconnecting()
    }

    private fun setApiBaseUrl(url: String) {
        apiBaseUrl = url
        storage.saveApiBaseUrl(url)
    }

    private fun setActiveMailbox(id: String) {
        storage.saveMailboxId(id)
        _state.update { it.copy(activeMailboxId = id) }
    }

    // MARK: Inbox

    suspend fun refresh() {
        if (isPreview) return
        val api = api ?: return
        if (state.value.emails.isEmpty()) _state.update { it.copy(listState = ListState.Loading) }
        try {
            val mailboxes = api.mailboxes()
            _state.update { it.copy(mailboxes = mailboxes) }
            val active = state.value.activeMailboxId
            if ((active == null || mailboxes.none { it.id == active }) && mailboxes.isNotEmpty()) {
                setActiveMailbox(mailboxes.first().id)
            }
            val mailboxId = state.value.activeMailbox?.id
            if (mailboxId == null) {
                _state.update { it.copy(emails = emptyList(), listState = ListState.Loaded) }
                return
            }
            val emails = api.inbox(mailboxId)
            // A switch while loading: this list belongs to the old mailbox.
            if (state.value.activeMailbox?.id != mailboxId) return
            _state.update { it.copy(emails = emails, listState = ListState.Loaded) }
            publishGlance(api, mailboxId, emails)
        } catch (e: WatchApiException) {
            if (e is WatchApiException.SignedOut) sessionEnded(api.token)
            if (state.value.emails.isEmpty() && token.value != null) {
                _state.update { it.copy(listState = ListState.Failed(e.message.orEmpty())) }
            }
        }
    }

    /**
     * The Tile's unread total: the server's Inbox count when the folders call answers,
     * else the unread rows on the page. Never fails the refresh.
     */
    private suspend fun publishGlance(api: WatchApiClient, mailboxId: String, emails: List<WatchEmail>) {
        val inboxUnread = try {
            api.folders(mailboxId).firstOrNull { it.id == INBOX_FOLDER_ID }?.unread
        } catch (e: WatchApiException) {
            null
        }
        // Signed out or switched mailbox meanwhile: don't write the old one back.
        if (token.value == null || state.value.activeMailbox?.id != mailboxId) return
        glance.publish(WatchGlance.snapshot(mailboxId, inboxUnread, emails, clock()))
    }

    /**
     * After an action changed the rows: moves the published count by the change in
     * unread rows (the server total includes mail past the first page).
     */
    private fun republishGlance(unreadBefore: Int) {
        val mailboxId = state.value.activeMailbox?.id ?: return
        val previous = glance.read()?.takeIf { it.mailboxId == mailboxId } ?: return
        val unread = state.value.emails.filter { it.isUnread }
        val delta = unread.size - unreadBefore
        if (delta == 0) return
        glance.publish(
            WatchGlance.snapshot(mailboxId, previous.unreadCount + delta, unread, clock()),
        )
    }

    private fun unreadRows(): Int = state.value.emails.count { it.isUnread }

    /**
     * The Tile or complication found the snapshot stale (AVE-147): read the Inbox again
     * with the stored session, without the UI. Never asks the phone: no stored token,
     * nothing to do (the Tile shows "Open Inboxies").
     */
    fun refreshInBackground() {
        if (isPreview) return
        if (!started) {
            if (storage.token == null) return
            // start() reads the stored session and refreshes.
            start()
            return
        }
        if (token.value == null || backgroundRefresh?.isActive == true) return
        backgroundRefresh = scope.launch { refresh() }
    }

    fun selectMailbox(id: String) {
        if (id == state.value.activeMailboxId) return
        setActiveMailbox(id)
        _state.update { it.copy(emails = emptyList(), listState = if (isPreview) ListState.Loaded else ListState.Loading) }
        if (isPreview) return
        scope.launch { refresh() }
    }

    // MARK: Message

    suspend fun loadMessage(email: WatchEmail): WatchEmail {
        if (isPreview) return email
        var loaded: WatchEmail? = null
        runAction { api, mailboxId -> loaded = api.email(mailboxId, email.id) }
        return loaded ?: throw WatchApiException.Decoding()
    }

    // MARK: Actions (phase 1 set: Archive, Mark read/unread, Reply Later, Report spam, Reply)

    suspend fun setRead(read: Boolean, email: WatchEmail) {
        runAction { api, mailboxId -> api.setRead(read, mailboxId, email) }
        val before = unreadRows()
        updateRow(email.id) { it.withRead(read) }
        republishGlance(before)
    }

    suspend fun replyLater(email: WatchEmail) {
        runAction { api, mailboxId -> api.replyLater(mailboxId, email.id) }
        updateRow(email.id) { it.copy(replyLater = true) }
    }

    suspend fun archive(email: WatchEmail) {
        runAction { api, mailboxId -> api.move(mailboxId, email.id, WatchMoveTarget.ARCHIVE) }
        val before = unreadRows()
        removeRow(email.id)
        republishGlance(before)
    }

    suspend fun reportSpam(email: WatchEmail) {
        runAction { api, mailboxId -> api.move(mailboxId, email.id, WatchMoveTarget.SPAM) }
        val before = unreadRows()
        removeRow(email.id)
        republishGlance(before)
    }

    /** [idempotencyKey]: one per reply attempt, reused on retries, so a reply can't send twice. */
    suspend fun reply(email: WatchEmail, text: String, idempotencyKey: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        runAction { api, mailboxId -> api.quickReply(mailboxId, email.id, trimmed, idempotencyKey) }
    }

    /**
     * Runs an API call; after a 401 it waits briefly for the quiet reconnect and tries
     * once more with the new token (replies carry their idempotency key).
     */
    private suspend fun runAction(call: suspend (WatchApiClient, String) -> Unit) {
        if (isPreview) return
        var retried = false
        while (true) {
            val api = connectedApi()
            val mailboxId = state.value.activeMailbox?.id ?: state.value.activeMailboxId
                ?: throw WatchApiException.SignedOut()
            try {
                call(api, mailboxId)
                return
            } catch (e: WatchApiException.SignedOut) {
                sessionEnded(api.token)
                if (retried) {
                    if (state.value.connection is Connection.NeedsPhone) throw WatchApiException.SignedOut()
                    throw WatchApiException.Reconnecting()
                }
                retried = true
            }
        }
    }

    private fun updateRow(id: String, change: (WatchEmail) -> WatchEmail) {
        _state.update { s -> s.copy(emails = s.emails.map { if (it.id == id) change(it) else it }) }
    }

    private fun removeRow(id: String) {
        _state.update { s -> s.copy(emails = s.emails.filterNot { it.id == id }) }
    }

    companion object {
        const val DEFAULT_API_BASE = "https://inboxies.email"
        const val INBOX_FOLDER_ID = "inbox"

        const val SIGNED_OUT_MESSAGE = "Signed out. Sign in to Inboxies on your phone, then tap Connect."
        const val CLEARED_MESSAGE = "Signed out. Open Inboxies on your phone, then tap Connect."
        const val REVOKED_MESSAGE = "This watch was signed out from your phone. Tap Connect to sign it back in."
        const val UNAVAILABLE_MESSAGE = "Your phone couldn't connect to Inboxies. Tap Connect to try again."
        const val UNREACHABLE_MESSAGE = "Open Inboxies on your phone, then tap Connect."
    }
}

sealed interface Connection {
    /** No token; asking the phone quietly. The Inbox stays up if it already has something to show. */
    data object Connecting : Connection

    /** No token: the phone is signed out, revoked the watch, or every quiet attempt failed. Shows Connect. */
    data class NeedsPhone(val message: String) : Connection

    data object Connected : Connection
}

sealed interface ListState {
    data object Idle : ListState
    data object Loading : ListState
    data object Loaded : ListState
    data class Failed(val message: String) : ListState
}

data class WatchState(
    val connection: Connection = Connection.Connecting,
    val mailboxes: List<WatchMailbox> = emptyList(),
    val activeMailboxId: String? = null,
    val emails: List<WatchEmail> = emptyList(),
    val listState: ListState = ListState.Idle,
) {
    /** Follows the phone's active mailbox until the person picks another here. */
    val activeMailbox: WatchMailbox?
        get() = mailboxes.firstOrNull { it.id == activeMailboxId } ?: mailboxes.firstOrNull()

    /** Reconnecting quietly after a 401 keeps the Inbox (and an open message) up. */
    val showsInbox: Boolean
        get() = connection == Connection.Connected ||
            (connection == Connection.Connecting && mailboxes.isNotEmpty())
}

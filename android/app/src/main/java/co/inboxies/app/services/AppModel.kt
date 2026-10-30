package co.inboxies.app.services

import androidx.compose.ui.graphics.vector.ImageVector
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.AgentConversation
import co.inboxies.app.models.AiUsageSnapshot
import co.inboxies.app.models.AppToast
import co.inboxies.app.models.ToastAction
import co.inboxies.app.models.ChatSession
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.ComposePresentation
import co.inboxies.app.models.DomainService
import co.inboxies.app.models.Email
import co.inboxies.app.models.SpamVerdictToast
import co.inboxies.app.models.ThreadNote
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.InboxDigest
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.ScreenerSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import co.inboxies.app.ui.widget.InboxWidgetSnapshot
import co.inboxies.app.widget.InboxWidgetPublisher
import co.inboxies.app.widget.make
import java.time.Instant
import java.util.UUID

data class UndoableAction(
    val id: String = UUID.randomUUID().toString(),
    val message: String,
    val execute: suspend () -> Unit,
    val rollback: () -> Unit,
)

/** Central app state ≈ iOS AppModel. */
class AppModel {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val db get() = DatabaseService.shared
    private val streamClient = RealTimeStreamClient.shared

    private val _mailboxes = MutableStateFlow<List<Mailbox>>(emptyList())
    val mailboxes: StateFlow<List<Mailbox>> = _mailboxes.asStateFlow()

    private val _selectedMailboxId = MutableStateFlow<String?>(null)
    val selectedMailboxId: StateFlow<String?> = _selectedMailboxId.asStateFlow()

    init {
        // Autofill creates private emails in the mailbox last chosen here (never a preview fixture).
        scope.launch {
            _selectedMailboxId.collect { id ->
                if (id != null && !isDebugPreview) AutofillMailboxPreference.save(id)
            }
        }
    }

    private val _folders = MutableStateFlow<List<Folder>>(emptyList())
    val folders: StateFlow<List<Folder>> = _folders.asStateFlow()

    private val _selectedTab = MutableStateFlow<HomeTab>(HomeTab.Folder(FolderIds.INBOX))
    val selectedTab: StateFlow<HomeTab> = _selectedTab.asStateFlow()

    private val _emails = MutableStateFlow<List<Email>>(emptyList())
    val emails: StateFlow<List<Email>> = _emails.asStateFlow()
    /**
     * Page 1 of the Screener folder, kept while Inbox shows so its "N waiting to be
     * screened" row can count senders and show their avatars (AVE-136).
     */
    private val _screenerQueue = MutableStateFlow<List<Email>>(emptyList())
    val screenerQueue: StateFlow<List<Email>> = _screenerQueue.asStateFlow()

    /** Inbox page 1's server New total, for the list it came from (AVE-23). */
    data class InboxNewTotal(val scope: EmailListScope, val count: Int)
    private val _inboxNewTotal = MutableStateFlow<InboxNewTotal?>(null)
    val inboxNewTotal: StateFlow<InboxNewTotal?> = _inboxNewTotal.asStateFlow()

    /** Server New total for the inbox on screen; null before page 1 lands. */
    fun inboxNewCountFor(total: InboxNewTotal?): Int? =
        total?.takeIf { it.scope == currentListScope && it.scope.folderId == FolderIds.INBOX }?.count

    private fun rememberInboxNewCount(scope: EmailListScope, count: Int?) {
        if (scope.folderId != FolderIds.INBOX) return
        _inboxNewTotal.value = count?.let { InboxNewTotal(scope, it) }
    }

    /** Optimistic read / unread on the inbox keeps "Show N more new" honest until the next sync. */
    private fun adjustInboxNewCount(wasUnread: Boolean, isUnread: Boolean) {
        if (wasUnread == isUnread) return
        val current = _inboxNewTotal.value ?: return
        if (current.scope != currentListScope) return
        _inboxNewTotal.value = current.copy(count = maxOf(0, current.count + if (isUnread) 1 else -1))
    }

    private val _replyLaterCount = MutableStateFlow(0)
    val replyLaterCount: StateFlow<Int> = _replyLaterCount.asStateFlow()

    /**
     * Reply Later mails whose reminder fired and are still unread (AVE-86): piles
     * `due_count`, falling back to locally known due mails. Drives the bottom-bar
     * attention state.
     */
    private val _replyLaterDueCount = MutableStateFlow(0)
    val replyLaterDueCount: StateFlow<Int> = _replyLaterDueCount.asStateFlow()

    /** Mail the "Remind me" picker is open for (AVE-86); `null` when closed. */
    private val _reminderPickerEmail = MutableStateFlow<Email?>(null)
    val reminderPickerEmail: StateFlow<Email?> = _reminderPickerEmail.asStateFlow()

    private val _identities = MutableStateFlow<List<LinkedIdentity>?>(null)
    val identities: StateFlow<List<LinkedIdentity>?> = _identities.asStateFlow()

    private val _adminMailboxes = MutableStateFlow<List<AdminMailboxRow>?>(null)
    val adminMailboxes: StateFlow<List<AdminMailboxRow>?> = _adminMailboxes.asStateFlow()

    private val _administeredDomains = MutableStateFlow<List<String>>(emptyList())
    val administeredDomains: StateFlow<List<String>> = _administeredDomains.asStateFlow()

    /** Billing service state per domain, from `GET /billing/domains/:domain/service`. */
    private val _domainServices = MutableStateFlow<Map<String, DomainService>>(emptyMap())
    val domainServices: StateFlow<Map<String, DomainService>> = _domainServices.asStateFlow()

    /** The selected mailbox's domain service ended: hide every write but read/star flags. */
    val selectedMailboxReadOnly: StateFlow<Boolean> =
        combine(_mailboxes, _selectedMailboxId) { list, id ->
            list.firstOrNull { it.id == id }?.isReadOnly == true
        }.stateIn(scope, SharingStarted.Eagerly, false)

    /** The selected mailbox's service: the full endpoint answer when fetched, else the detail summary. */
    val selectedDomainService: StateFlow<DomainService?> =
        combine(_mailboxes, _selectedMailboxId, _domainServices) { list, id, services ->
            list.firstOrNull { it.id == id }?.let { services[it.domain] ?: it.service }
        }.stateIn(scope, SharingStarted.Eagerly, null)

    private val _inboxDigest = MutableStateFlow<InboxDigest?>(null)
    val inboxDigest: StateFlow<InboxDigest?> = _inboxDigest.asStateFlow()

    private val _isDigestLoading = MutableStateFlow(false)
    val isDigestLoading: StateFlow<Boolean> = _isDigestLoading.asStateFlow()

    private val _conversations = MutableStateFlow<List<AgentConversation>>(emptyList())
    val conversations: StateFlow<List<AgentConversation>> = _conversations.asStateFlow()

    private val _activeConversationId = MutableStateFlow<String?>(null)
    val activeConversationId: StateFlow<String?> = _activeConversationId.asStateFlow()

    private val _chatSession = MutableStateFlow<ChatSession>(ChatSession.Dismissed)
    val chatSession: StateFlow<ChatSession> = _chatSession.asStateFlow()

    private val pendingConversationIds = mutableSetOf<String>()

    private val _isMailboxLoading = MutableStateFlow(true)
    val isMailboxLoading: StateFlow<Boolean> = _isMailboxLoading.asStateFlow()

    private val _isAdmin = MutableStateFlow(false)
    val isAdmin: StateFlow<Boolean> = _isAdmin.asStateFlow()

    private val _mailDomain = MutableStateFlow("inboxies.email")
    val mailDomain: StateFlow<String> = _mailDomain.asStateFlow()

    private val _domains = MutableStateFlow(listOf("inboxies.email"))
    val domains: StateFlow<List<String>> = _domains.asStateFlow()

    private val _pendingInviteToken = MutableStateFlow<String?>(null)
    val pendingInviteToken: StateFlow<String?> = _pendingInviteToken.asStateFlow()

    fun setPendingInviteToken(token: String?) {
        _pendingInviteToken.value = token
    }

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _isEmailDetailLoading = MutableStateFlow(false)
    val isEmailDetailLoading: StateFlow<Boolean> = _isEmailDetailLoading.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private val _selectedEmail = MutableStateFlow<Email?>(null)
    val selectedEmail: StateFlow<Email?> = _selectedEmail.asStateFlow()

    private val _threadEmails = MutableStateFlow<List<Email>>(emptyList())
    val threadEmails: StateFlow<List<Email>> = _threadEmails.asStateFlow()

    /** Notes to self on the open conversation (the signed-in user's own only). */
    private val _threadNotes = MutableStateFlow<List<ThreadNote>>(emptyList())
    val threadNotes: StateFlow<List<ThreadNote>> = _threadNotes.asStateFlow()

    /** `mailboxId|threadKey` that [threadNotes] belongs to; null before the first load. */
    private val _threadNotesKey = MutableStateFlow<String?>(null)
    val threadNotesKey: StateFlow<String?> = _threadNotesKey.asStateFlow()

    /** DEBUG previews keep notes in memory per conversation key (no server). */
    val previewThreadNotes: MutableMap<String, List<ThreadNote>> = mutableMapOf()

    private val _composeSession = MutableStateFlow<ComposeSession?>(null)
    val composeSession: StateFlow<ComposeSession?> = _composeSession.asStateFlow()

    private val _toast = MutableStateFlow<AppToast?>(null)
    val toast: StateFlow<AppToast?> = _toast.asStateFlow()

    private val _pendingUndoAction = MutableStateFlow<UndoableAction?>(null)
    val pendingUndoAction: StateFlow<UndoableAction?> = _pendingUndoAction.asStateFlow()

    private val _swipePreferences = MutableStateFlow(
        runCatching { SwipeActionPreferences.load() }.getOrElse { SwipeActionPreferences() },
    )
    val swipePreferences: StateFlow<SwipeActionPreferences> = _swipePreferences.asStateFlow()

    private val _mailboxesLoadFailed = MutableStateFlow(false)
    /** The mailbox list request failed with nothing cached: RootView shows an error, never onboarding. */
    val mailboxesLoadFailed: StateFlow<Boolean> = _mailboxesLoadFailed.asStateFlow()

    private val _emailListError = MutableStateFlow<String?>(null)
    /** The visible list's fetch failed with nothing cached: error + Retry instead of "This folder is empty". */
    val emailListError: StateFlow<String?> = _emailListError.asStateFlow()

    private val _paging = MutableStateFlow(EmailPagingState())
    /** Infinite-scroll cursor for [emails]; the list shows a skeleton row while [EmailPagingState.isLoadingMore]. */
    val paging: StateFlow<EmailPagingState> = _paging.asStateFlow()

    private var toastDismissJob: Job? = null
    private var pendingUndoJob: Job? = null

    /** Process-level foreground state (ProcessLifecycleOwner); sync only runs while true. */
    @Volatile
    private var isAppInForeground = false

    val selectedMailbox: Mailbox?
        get() = _mailboxes.value.firstOrNull { it.id == _selectedMailboxId.value }

    /** The folder / pile [emails] currently represents. */
    private val currentListScope: EmailListScope?
        get() = EmailListScope.of(_selectedMailboxId.value, _selectedTab.value)

    // Every async load captures the mailbox (and list scope) before its first await and
    // applies results through these, so a slow response can't land on a newer selection.
    // All writes happen on Main, so the check and the write can't interleave.
    private inline fun <T> ifStillSelected(mailboxId: String, block: () -> T): T? =
        co.inboxies.app.services.ifStillSelected(mailboxId, _selectedMailboxId.value, block)

    private inline fun <T> ifStillShowing(scope: EmailListScope, block: () -> T): T? =
        co.inboxies.app.services.ifStillShowing(scope, currentListScope, block)

    private fun isSelected(mailboxId: String) = _selectedMailboxId.value == mailboxId

    /** Ids on page 1 of the list [firstPageScope] last synced; only they get the New/Seen split. */
    private var firstPageIds: Set<String>? = null
    private var firstPageScope: EmailListScope? = null

    private fun rememberFirstPage(scope: EmailListScope, ids: Set<String>) {
        firstPageScope = scope
        firstPageIds = ids
    }

    /** Inbox: New/Seen with later pages appended to Seen; other folders: as cached (newest first). */
    private fun displayOrder(folderId: String, emails: List<Email>): List<Email> {
        if (folderId != FolderIds.INBOX) return emails
        val ids = firstPageIds.takeIf { firstPageScope != null && firstPageScope == currentListScope }
        return EmailPaging.orderInbox(emails, ids)
    }

    fun updateSwipePreferences(transform: (SwipeActionPreferences) -> SwipeActionPreferences) {
        val current = _swipePreferences.value
        val next = transform(current).let { prefs ->
            prefs.copy(
                leftActions = prefs.leftActions
                    .distinct()
                    .take(SwipeActionPreferences.MAX_ACTIONS_PER_EDGE),
                rightActions = prefs.rightActions
                    .distinct()
                    .take(SwipeActionPreferences.MAX_ACTIONS_PER_EDGE),
            )
        }
        next.save()
        _swipePreferences.value = next
    }

    fun unreadCount(forFolderId: String): Int =
        _folders.value.firstOrNull { it.id == forFolderId }?.unreadCount ?: 0

    /** Screener is on unless the selected mailbox turned it off (AVE-104). */
    val isScreenerEnabled: Boolean
        get() = selectedMailbox?.settings?.screener?.enabled != false

    /**
     * First-time senders waiting in the Screening room: one email per sender, newest
     * first. Feeds the Inbox "N waiting to be screened" row and its avatars (AVE-136).
     */
    fun screenerSenders(queue: List<Email> = _screenerQueue.value): List<Email> =
        queue.filter { it.sender.trim().isNotEmpty() }.distinctBy { it.sender.trim().lowercase() }

    val screenerSenderCount: Int
        get() = screenerSenderCount(_screenerQueue.value)

    fun screenerSenderCount(queue: List<Email>): Int {
        val distinct = screenerSenders(queue).size
        if (distinct > 0) return distinct
        return unreadCount(forFolderId = FolderIds.SCREENER)
    }

    /**
     * Re-reads the Screener queue behind the Inbox row: cache first, then page 1 from the
     * server. Off (AVE-104) clears it so no row shows. DEBUG fixtures set it themselves.
     */
    suspend fun refreshScreenerQueue() {
        val mailboxId = _selectedMailboxId.value
        if (mailboxId == null || !isScreenerEnabled) {
            _screenerQueue.value = emptyList()
            return
        }
        if (isDebugPreview) return
        val cached = db.getEmails(mailboxId, FolderIds.SCREENER, limit = EmailPaging.PAGE_SIZE)
        if (cached.isNotEmpty() || _screenerQueue.value.isEmpty()) _screenerQueue.value = cached
        // Window prune: keep deeper pages the Screening room may have loaded.
        val synced = runCatching {
            MailboxSyncService.syncFolder(mailboxId, FolderIds.SCREENER, page = 1) { FolderPrune.Window }
        }.getOrNull() ?: return
        ifStillSelected(mailboxId) { _screenerQueue.value = synced.emails.take(EmailPaging.PAGE_SIZE) }
    }

    /** DEBUG previews: seed the Screening room queue from fixtures. */
    fun setScreenerQueueForPreview(queue: List<Email>) {
        _screenerQueue.value = queue
    }

    fun adjustFolderUnread(folderId: String, delta: Int) {
        if (delta == 0) return
        _folders.update { list ->
            list.map {
                if (it.id != folderId) it
                else it.copy(unreadCount = maxOf(0, it.unreadCount + delta))
            }
        }
        val mailboxId = _selectedMailboxId.value ?: return
        scope.launch { db.updateFolderUnread(mailboxId, folderId, delta) }
    }

    fun adjustFolderUnread(email: Email, wasUnread: Boolean, isUnread: Boolean) {
        if (wasUnread == isUnread) return
        val folderId = email.folderId ?: _selectedTab.value.syncFolderId ?: return
        adjustFolderUnread(folderId, if (isUnread) 1 else -1)
        if (folderId == FolderIds.INBOX) adjustInboxNewCount(wasUnread, isUnread)
    }

    /**
     * The launch pick came from a cache that lacked the remembered mailbox (AVE-90);
     * the server list gets a second chance to restore it.
     */
    private var selectionIsProvisional = false

    /** Token the last [bootstrap] ran for — lets a recreated Activity skip a redundant reload. */
    @Volatile
    private var bootstrappedToken: String? = null

    fun hasBootstrapped(authToken: String?): Boolean =
        authToken != null && authToken == bootstrappedToken

    /** Fresh Activity launch (not a config change): let RootView bootstrap/refresh again. */
    fun invalidateBootstrap() {
        bootstrappedToken = null
    }

    suspend fun bootstrap(authToken: String?) {
        bootstrappedToken = authToken
        // A failure from a previous session must not flash the error gate on sign-in.
        _mailboxesLoadFailed.value = false
        // AuthStore owns ApiClient.authTokenProvider (a live read of its token), so a
        // sign-out stops sending the old token; don't pin it to this snapshot here.
        val cached = db.getMailboxes()
        if (cached.isNotEmpty()) {
            _mailboxes.value = cached
            if (_selectedMailboxId.value == null) {
                // Reopen the mailbox the user last had open (AVE-90).
                val remembered = if (isDebugPreview) null else LastMailboxPreference.mailboxId()
                val pick = initialMailboxId(remembered, cached.map { it.id })
                _selectedMailboxId.value = pick
                selectionIsProvisional = remembered != null && pick != remembered
            }
            _isMailboxLoading.value = false
            _selectedMailboxId.value?.let { id ->
                val folders = db.getFolders(id)
                if (folders.isNotEmpty()) _folders.value = folders
                _replyLaterCount.value = db.getReplyLaterCount(id)
                _replyLaterDueCount.value = db.getReplyLaterDueCount(id)
                if (_selectedTab.value is HomeTab.ReplyLater) {
                    val emails = db.getReplyLaterEmails(id)
                    if (emails.isNotEmpty()) {
                        _emails.value = emails
                        _isLoading.value = false
                    }
                } else {
                    _selectedTab.value.syncFolderId?.let { folderId ->
                        val emails = db.getEmails(id, folderId)
                        if (emails.isNotEmpty()) {
                            _emails.value = emails
                            _isLoading.value = false
                        }
                    }
                }
                scope.launch { refreshReplyLaterCount() }
            }
        }
        setupRealTimeStream()
        refreshMailboxes(showLoading = _emails.value.isEmpty())
    }

    private fun setupRealTimeStream() {
        val mailboxId = _selectedMailboxId.value ?: return
        // Callbacks carry the mailbox the stream was started for; a blocking read can
        // still deliver an old-mailbox event right after a switch, so drop mismatches.
        streamClient.onNewEmailReceived = { streamMailboxId, email ->
            scope.launch {
                ifStillSelected(streamMailboxId) { handleIncomingRealTimeEmail(streamMailboxId, email) }
            }
        }
        streamClient.onSyncRequested = { streamMailboxId ->
            scope.launch {
                if (isSelected(streamMailboxId)) refreshCurrentTabSilently()
            }
        }
        // Backgrounded: ProcessLifecycleOwner's ON_START restarts it (onAppForegrounded).
        if (isAppInForeground) streamClient.start(mailboxId)
        PushNotificationManager.shared.registerMailboxes(
            (_mailboxes.value.map { it.id } + mailboxId).distinct(),
        )
    }

    /** ProcessLifecycleOwner ON_START: resume live sync and catch up once. */
    fun onAppForegrounded(isSignedIn: Boolean) {
        isAppInForeground = true
        if (isDebugPreview || !isSignedIn || bootstrappedToken == null) return
        val mailboxId = _selectedMailboxId.value ?: return
        if (!streamClient.isRunning) setupRealTimeStream()
        scope.launch {
            if (isSelected(mailboxId)) refreshCurrentTabSilently()
        }
    }

    /** ProcessLifecycleOwner ON_STOP: no SSE socket or 20 s poll while nothing is visible. */
    fun onAppBackgrounded() {
        isAppInForeground = false
        streamClient.stop()
        // Leave the "Today's inbox" widget current (AVE-150).
        publishInboxWidgetNow()
    }

    private fun handleIncomingRealTimeEmail(mailboxId: String, email: Email) {
        val currentFolder = currentListScope?.folderId
        if (currentFolder != null) {
            val target = email.folderId ?: "inbox"
            if (target.equals(currentFolder, ignoreCase = true)) {
                db.upsertEmails(mailboxId, listOf(email), defaultFolder = target)
                if (_emails.value.none { it.id == email.id }) {
                    // Newest mail belongs to page 1 (and its New/Seen split).
                    firstPageIds = firstPageIds?.plus(email.id)
                    _emails.value = listOf(email) + _emails.value
                }
            }
            if (_selectedTab.value is HomeTab.AiInbox) {
                scope.launch { loadInboxDigest(showLoading = false) }
            }
        }
        if (email.isUnread) {
            adjustFolderUnread(email.folderId ?: "inbox", 1)
        }
    }

    suspend fun refreshMailboxes(showLoading: Boolean = true) {
        if (showLoading) {
            _isMailboxLoading.value = selectedMailbox == null
            _isLoading.value = _emails.value.isEmpty()
        }
        _errorMessage.value = null
        try {
            runCatching { ApiClient.shared.getConfig() }.getOrNull()?.let { config ->
                _mailDomain.value = config.mailDomain
                _domains.value = config.domains.ifEmpty { listOf(config.mailDomain) }
            }
            runCatching { ApiClient.shared.getMe() }.getOrNull()?.let { me ->
                _isAdmin.value = me.isAdmin == true
                _administeredDomains.value = me.administeredDomains
                me.mailDomain?.takeIf { it.isNotBlank() }?.let { _mailDomain.value = it }
                if (me.domains.isNotEmpty()) _domains.value = me.domains
            }
            val list = ApiClient.shared.listMailboxes()
            val previous = _mailboxes.value.associateBy { it.id }
            val merged = list.map { incoming ->
                val existing = previous[incoming.id]
                // The list carries neither settings nor the service summary; keep the detail's.
                incoming.copy(
                    settings = incoming.settings ?: existing?.settings,
                    service = incoming.service ?: existing?.service,
                )
            }
            _mailboxes.value = merged
            _mailboxesLoadFailed.value = false
            db.upsertMailboxes(merged)
            val selected = _selectedMailboxId.value
            // Keep the selection if it's still listed; otherwise reopen the remembered
            // mailbox, else the first one. loadMailbox does the switch itself, so the old
            // mailbox's rows are cleared, and remembers the result.
            val ids = list.map { it.id }
            val remembered = if (isDebugPreview) null else LastMailboxPreference.mailboxId()
            val target = selected?.takeIf { it in ids && !selectionIsProvisional }
                ?: initialMailboxId(remembered, ids)
            selectionIsProvisional = false
            if (ids.isEmpty() && !isDebugPreview) LastMailboxPreference.clear()
            _isMailboxLoading.value = false
            if (target != null) {
                loadMailbox(target)
            } else {
                // No mailboxes left (or none yet): nothing to stream or show.
                streamClient.stop()
                _selectedMailboxId.value = null
                _emails.value = emptyList()
                _folders.value = emptyList()
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
                _paging.value = _paging.value.cleared()
                _isLoading.value = false
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
            // Only "the server returned zero mailboxes" leads to onboarding; a failed
            // request with nothing cached is an error state with Retry.
            _mailboxesLoadFailed.value = _mailboxes.value.isEmpty()
            _isLoading.value = false
            _isMailboxLoading.value = false
        }
    }

    /** True once the server created the mailbox; failures are toasted here. */
    suspend fun createMailbox(name: String, email: String): Boolean {
        val mailbox = try {
            ApiClient.shared.createMailbox(name, email)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            showToast("Failed to create mailbox: ${e.message}", isError = true)
            return false
        }
        // List the new mailbox right away. The full refresh also reloads the selected
        // mailbox's mail, so it reconciles in the background instead of holding the dialog.
        if (_mailboxes.value.none { it.id == mailbox.id }) {
            _mailboxes.value = _mailboxes.value + mailbox
            db.upsertMailboxes(listOf(mailbox))
        }
        showToast("Mailbox created")
        scope.launch { refreshMailboxes(showLoading = false) }
        return true
    }

    suspend fun loadIdentities(forceRefresh: Boolean = false): List<LinkedIdentity> {
        if (!forceRefresh) {
            _identities.value?.let { return it }
        }
        val res = ApiClient.shared.listIdentities()
        _identities.value = res.identities
        return res.identities
    }

    fun setIdentities(list: List<LinkedIdentity>) {
        _identities.value = list
    }

    fun invalidateIdentities() {
        _identities.value = null
    }

    suspend fun loadAdminMailboxes(forceRefresh: Boolean = false): List<AdminMailboxRow> {
        if (!forceRefresh) {
            _adminMailboxes.value?.let { return it }
        }
        val rows = ApiClient.shared.listAdminMailboxes()
        _adminMailboxes.value = rows
        return rows
    }

    fun setAdminMailboxes(list: List<AdminMailboxRow>) {
        _adminMailboxes.value = list
    }

    fun invalidateAdminMailboxes() {
        _adminMailboxes.value = null
    }

    suspend fun loadMailbox(id: String) {
        if (_selectedMailboxId.value != id) {
            _activeConversationId.value = null
            pendingConversationIds.clear()
            _conversations.value = emptyList()
            _inboxDigest.value = null
            _isDigestLoading.value = false
            if (_chatSession.value !is ChatSession.Dismissed) {
                _chatSession.value = ChatSession.Dismissed
            }
            // Never show the previous mailbox's rows, folders or open thread under the new one.
            _emails.value = emptyList()
            _screenerQueue.value = emptyList()
            _folders.value = emptyList()
            _selectedEmail.value = null
            _threadEmails.value = emptyList()
            _paging.value = _paging.value.cleared()
            _emailListError.value = null
            _isLoading.value = true
            _aiUsage.value = null
        }
        _selectedMailboxId.value = id
        selectionIsProvisional = false
        // Every real switch (picker, notification tap, refresh) is the next launch's mailbox.
        if (!isDebugPreview) LastMailboxPreference.save(id)
        setupRealTimeStream()

        val cachedFolders = db.getFolders(id)
        if (cachedFolders.isNotEmpty()) {
            _folders.value = cachedFolders
            _isMailboxLoading.value = false
        }
        _replyLaterCount.value = db.getReplyLaterCount(id)
        _replyLaterDueCount.value = db.getReplyLaterDueCount(id)
        _reminderPickerEmail.value = null
        if (_selectedTab.value is HomeTab.ReplyLater) {
            val cachedEmails = db.getReplyLaterEmails(id)
            if (cachedEmails.isNotEmpty()) {
                _emails.value = cachedEmails
                _isLoading.value = false
            }
        } else {
            _selectedTab.value.syncFolderId?.let { folderId ->
                val cached = db.getEmails(id, folderId)
                if (cached.isNotEmpty()) {
                    _emails.value = displayOrder(folderId, cached)
                    _isLoading.value = false
                }
            }
        }

        _isSyncing.value = true
        try {
            try {
                val detailed = ApiClient.shared.getMailbox(id)
                _mailboxes.update { list ->
                    list.map { if (it.id == detailed.id) detailed else it }
                }
                db.upsertMailboxes(listOf(detailed))
                // Ended, or set to end: fetch who may renew and until when.
                if (detailed.isReadOnly || detailed.service?.isEnding == true) {
                    scope.launch { loadDomainService(detailed.domain) }
                }
            } catch (e: ApiException.ServiceEnded) {
                // Reads aren't refused for this, but if one is, access is intact: keep the
                // mailbox (read-only) rather than dropping it like a lost-access 403.
                noteServiceEnded(e)
            } catch (e: ApiException.Http) {
                if (e.code == 403 || e.code == 404) {
                    dropInaccessibleMailbox(id)
                    return
                }
                throw e
            }
            if (!isSelected(id)) return
            _isMailboxLoading.value = false
            coroutineScope {
                val foldersDeferred = async { MailboxSyncService.syncMailbox(id) }
                val conversationsDeferred = async { runCatching { ApiClient.shared.listConversations(id) }.getOrNull() }
                val replyLaterDeferred = async { refreshReplyLaterCount() }
                val folders = foldersDeferred.await()
                ifStillSelected(id) { _folders.value = folders }
                conversationsDeferred.await()?.let { server ->
                    ifStillSelected(id) {
                        _conversations.value = visibleConversations(server)
                        dropStaleActiveConversation()
                    }
                }
                if (isSelected(id)) {
                    loadEmailsForCurrentTab(showLoading = _emails.value.isEmpty(), resetPaging = true)
                }
                if (isSelected(id) && _selectedTab.value is HomeTab.AiInbox) {
                    loadInboxDigest(showLoading = _inboxDigest.value == null)
                }
                replyLaterDeferred.await()
            }
        } catch (e: Exception) {
            // Transport failures (no HTTP status) never drop the mailbox; show the list error.
            ifStillSelected(id) {
                _errorMessage.value = e.message
                if (_emails.value.isEmpty() && currentListScope != null) _emailListError.value = e.message
                _isMailboxLoading.value = false
                _isLoading.value = false
            }
        } finally {
            // A newer selection owns the spinner; its own load clears it.
            ifStillSelected(id) { _isSyncing.value = false }
        }
    }

    private suspend fun dropInaccessibleMailbox(id: String) {
        db.deleteMailbox(id)
        _mailboxes.update { it.filterNot { m -> m.id == id } }
        // The user may have switched away while the 403/404 was in flight; leave that alone.
        if (_selectedMailboxId.value != id) return
        _isMailboxLoading.value = false
        val next = _mailboxes.value.firstOrNull()?.id
        if (next != null) {
            // Switching through loadMailbox clears the dropped mailbox's rows first.
            loadMailbox(next)
        } else {
            _selectedMailboxId.value = null
            streamClient.stop()
            _emails.value = emptyList()
            _folders.value = emptyList()
            _inboxDigest.value = null
            _conversations.value = emptyList()
            _activeConversationId.value = null
            _paging.value = _paging.value.cleared()
            _isLoading.value = false
            _isSyncing.value = false
        }
    }

    // MARK: - Domain service (subscription ended → read-only)

    /** Fetch and cache [domain]'s service state; null when it can't be read (403, offline). */
    suspend fun loadDomainService(domain: String): DomainService? {
        val key = domain.lowercase()
        if (isDebugPreview) return _domainServices.value[key]
        return try {
            val service = ApiClient.shared.getDomainService(key)
            _domainServices.update { it + (key to service) }
            service
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            null
        }
    }

    /**
     * A write bounced with `service_ended`: the domain went read-only mid-session. Mark
     * its mailboxes read-only so the UI hides writes; never drop them or sign out.
     */
    fun noteServiceEnded(error: Throwable): Boolean {
        val ended = error as? ApiException.ServiceEnded ?: return false
        val domain = ended.domain?.lowercase() ?: selectedMailbox?.domain ?: return true
        _mailboxes.update { list ->
            list.map { if (it.domain == domain && !it.isReadOnly) it.copy(readOnly = true) else it }
        }
        db.upsertMailboxes(_mailboxes.value.filter { it.domain == domain })
        scope.launch { loadDomainService(domain) }
        return true
    }

    /** Writes are hidden for a read-only mailbox; this backs that up for any path that slips through. */
    private fun blockIfReadOnly(): Boolean {
        val mailbox = selectedMailbox ?: return false
        if (!mailbox.isReadOnly) return false
        showToast("${mailbox.domain} is read-only. Its subscription ended.", isError = true)
        return true
    }

    sealed interface RenewOutcome {
        /** A scheduled cancellation was taken back; still in service. */
        data object Resumed : RenewOutcome
        /** Local dev: renewed on the spot. */
        data object Renewed : RenewOutcome
        /** Open Stripe Checkout; it returns via `inboxies://billing/renewed|renew-cancelled`. */
        data class Checkout(val url: String) : RenewOutcome
        data class Failed(val message: String) : RenewOutcome
    }

    /** Renew an ended domain or keep one set to end (domain admins only). */
    suspend fun renewDomain(domain: String): RenewOutcome {
        val key = domain.lowercase()
        if (isDebugPreview) return RenewOutcome.Failed("Renewal isn't available in previews.")
        return try {
            val res = ApiClient.shared.renewDomain(key)
            when {
                res.resumed == true -> {
                    res.service?.let { s -> _domainServices.update { it + (key to s) } }
                    refreshAfterRenewal(key)
                    showToast("Subscription for $key kept")
                    RenewOutcome.Resumed
                }
                !res.checkoutUrl.isNullOrBlank() -> RenewOutcome.Checkout(res.checkoutUrl)
                res.renewed == true -> {
                    refreshAfterRenewal(key)
                    showToast("$key renewed")
                    RenewOutcome.Renewed
                }
                else -> RenewOutcome.Failed("Couldn't start the renewal.")
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // 409 (already active / window closed) carries the current state: show it.
            if ((e as? ApiException.Http)?.code == 409) loadDomainService(key)
            RenewOutcome.Failed((e as? ApiException)?.serverMessage ?: e.message ?: "Couldn't renew $key.")
        }
    }

    /** `inboxies://billing/renewed|renew-cancelled?domain=` from the renewal checkout. */
    fun handleRenewalReturn(domain: String, cancelled: Boolean) {
        if (cancelled) {
            showToast("Renewal for ${domain.lowercase()} cancelled")
        } else {
            // App scope, not the Activity's: the poll outlives a recreated Activity.
            scope.launch { completeRenewal(domain) }
        }
    }

    /**
     * Back from a paid renewal checkout. The webhook restores the domain within seconds,
     * so poll the service briefly before refreshing mailboxes.
     */
    private suspend fun completeRenewal(domain: String) {
        val key = domain.lowercase()
        showToast("Renewing $key…", isLoading = true, durationMs = 20_000)
        var service: DomainService? = null
        withTimeoutOrNull(20_000) {
            while (true) {
                service = loadDomainService(key)
                if (service != null && service?.isEnded == false) break
                delay(2_000)
            }
        }
        refreshAfterRenewal(key)
        if (service?.isEnded == false) {
            showToast("$key renewed")
        } else {
            showToast("Payment received. $key will be back in a moment; pull to refresh.")
        }
    }

    private suspend fun refreshAfterRenewal(domain: String) {
        loadDomainService(domain)
        refreshMailboxes(showLoading = false)
    }

    suspend fun deleteMailbox(id: String) {
        try {
            ApiClient.shared.deleteMailbox(id)
            db.deleteMailbox(id)
            _mailboxes.update { it.filterNot { m -> m.id == id } }
            if (_mailboxes.value.isEmpty()) {
                _selectedMailboxId.value = null
                _emails.value = emptyList()
                _folders.value = emptyList()
                _inboxDigest.value = null
                _conversations.value = emptyList()
                _activeConversationId.value = null
                pendingConversationIds.clear()
                _chatSession.value = ChatSession.Dismissed
            } else if (_selectedMailboxId.value == id) {
                loadMailbox(_mailboxes.value.first().id)
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    fun selectTab(tab: HomeTab) {
        _selectedTab.value = tab
        _selectedEmail.value = null
        _paging.value = _paging.value.cleared()
        _emailListError.value = null

        if (tab is HomeTab.ReplyLater) {
            _selectedMailboxId.value?.let { mailboxId ->
                val cached = db.getReplyLaterEmails(mailboxId)
                if (cached.isNotEmpty()) {
                    _emails.value = cached
                    _isLoading.value = false
                } else if (_replyLaterCount.value > 0) {
                    _emails.value = emptyList()
                    _isLoading.value = true
                } else {
                    _emails.value = emptyList()
                    _isLoading.value = false
                }
            } ?: run {
                _emails.value = emptyList()
                _isLoading.value = false
            }
        } else {
            tab.syncFolderId?.let { folderId ->
                _selectedMailboxId.value?.let { mailboxId ->
                    val cached = db.getEmails(mailboxId, folderId)
                    if (cached.isNotEmpty()) {
                        _emails.value = displayOrder(folderId, cached)
                        _isLoading.value = false
                    } else {
                        _emails.value = emptyList()
                        _isLoading.value = true
                    }
                }
            }
        }

        scope.launch {
            loadEmailsForCurrentTab(showLoading = _emails.value.isEmpty(), resetPaging = true)
            if (tab is HomeTab.AiInbox) {
                loadInboxDigest(showLoading = _inboxDigest.value == null)
            }
        }
    }

    /**
     * Load page 1 of the current folder / pile. [resetPaging] (tab or mailbox switch,
     * pull-to-refresh) starts the list over at page 1; otherwise rows from pages already
     * loaded by infinite scroll are kept so a background refresh never collapses the list.
     */
    suspend fun loadEmailsForCurrentTab(showLoading: Boolean = true, resetPaging: Boolean = false) {
        val mailboxId = _selectedMailboxId.value
        if (mailboxId == null) {
            _isLoading.value = false
            return
        }

        if (isDebugPreview) {
            _isLoading.value = false
            _isSyncing.value = false
            return
        }

        val listScope = currentListScope
        if (listScope == null) {
            _emails.value = emptyList()
            _isLoading.value = false
            return
        }
        // Whether deeper pages survive is decided once the response is in (paging may have
        // moved on meanwhile): Reply Later merges, folders pick the prune mode in syncFolder.

        if (listScope.replyLater) {
            if (showLoading && _emails.value.isEmpty()) _isLoading.value = true
            _isSyncing.value = true
            try {
                val response = ApiClient.shared.listReplyLaterEmails(mailboxId)
                db.upsertEmails(mailboxId, response.emails)
                ifStillSelected(mailboxId) { _replyLaterCount.value = response.totalCount }
                ifStillShowing(listScope) {
                    _emailListError.value = null
                    if (!resetPaging && _paging.value.keepsLoadedPages(listScope)) {
                        _emails.value = EmailPaging.mergeFirstPage(response.emails, _emails.value)
                    } else {
                        _emails.value = response.emails
                        _paging.value = _paging.value.restarted(
                            listScope,
                            received = response.emails.size,
                            totalCount = response.totalCount,
                            loadedCount = response.emails.size,
                        )
                    }
                }
            } catch (e: Exception) {
                ifStillShowing(listScope) {
                if (_emails.value.isEmpty()) {
                    _errorMessage.value = e.message
                    _emailListError.value = e.message ?: "Couldn't load emails"
                }
            }
            } finally {
                ifStillShowing(listScope) {
                    _isLoading.value = false
                    _isSyncing.value = false
                }
            }
            return
        }

        val folderId = listScope.folderId ?: return
        val cached = db.getEmails(mailboxId, folderId)
        if (cached.isNotEmpty()) {
            _emails.value = displayOrder(folderId, cached)
            _isLoading.value = false
        } else if (showLoading) {
            _isLoading.value = true
        }
        _isSyncing.value = true
        try {
            // A full prune would also evict the older pages infinite scroll loaded (or one
            // landing right now), so keep them unless this is an explicit restart.
            var restart = true
            val synced = MailboxSyncService.syncFolder(mailboxId, folderId, page = 1) {
                restart = resetPaging || !_paging.value.keepsLoadedPages(listScope)
                if (restart) FolderPrune.Full else FolderPrune.Window
            }
            ifStillShowing(listScope) {
                rememberFirstPage(listScope, synced.pageIds)
                rememberInboxNewCount(listScope, synced.newCount)
                _emails.value = displayOrder(folderId, synced.emails)
                _emailListError.value = null
                if (restart || _paging.value.scope != listScope) {
                    _paging.value = _paging.value.restarted(
                        listScope,
                        received = synced.received,
                        totalCount = synced.totalCount,
                        loadedCount = synced.emails.size,
                    )
                }
                if (folderId == FolderIds.SCREENER) _screenerQueue.value = _emails.value
            }
            refreshReplyLaterCount()
            if (folderId == FolderIds.INBOX) refreshScreenerQueue()
        } catch (e: Exception) {
            ifStillShowing(listScope) {
                if (_emails.value.isEmpty()) {
                    _errorMessage.value = e.message
                    _emailListError.value = e.message ?: "Couldn't load emails"
                }
            }
        } finally {
            ifStillShowing(listScope) {
                _isLoading.value = false
                _isSyncing.value = false
            }
        }
    }

    /**
     * Infinite scroll: fetch the next page of the current folder / pile and append it.
     * No-op while a page is already loading or nothing is left. Results are dropped if
     * the mailbox or tab changed meanwhile. DEBUG previews keep the skeleton row up.
     */
    suspend fun loadMoreEmails() {
        val listScope = currentListScope ?: return
        val page = _paging.value.nextPage(listScope) ?: return
        val generation = _paging.value.generation
        _paging.value = _paging.value.beginLoadMore()
        // Fixture: no network; leave the bottom skeleton row visible for the emulator preview.
        if (isDebugPreview) return
        try {
            if (listScope.replyLater) {
                val response = ApiClient.shared.listReplyLaterEmails(listScope.mailboxId, page = page)
                db.upsertEmails(listScope.mailboxId, response.emails)
                if (ifStillShowing(listScope) { _paging.value.accepts(listScope, generation) } == true) {
                    val known = _emails.value.map { it.id }.toSet()
                    val appended = _emails.value + response.emails.filterNot { it.id in known }
                    _emails.value = appended
                    _paging.value = _paging.value.afterPage(
                        page,
                        received = response.emails.size,
                        totalCount = response.totalCount,
                        loadedCount = appended.size,
                    )
                }
            } else {
                val folderId = listScope.folderId ?: return
                val synced = MailboxSyncService.syncFolder(listScope.mailboxId, folderId, page = page)
                // A restart (pull-to-refresh, tab switch, pruning reload) since this page was
                // requested means it no longer follows what's on screen: drop it.
                if (ifStillShowing(listScope) { _paging.value.accepts(listScope, generation) } == true) {
                    _emails.value = displayOrder(folderId, synced.emails)
                    _paging.value = _paging.value.afterPage(
                        page,
                        received = synced.received,
                        totalCount = synced.totalCount,
                        loadedCount = synced.emails.size,
                    )
                }
            }
        } catch (_: Exception) {
            // hasMore stays set; the footer swaps to "Couldn't load more · Retry".
            if (_paging.value.accepts(listScope, generation)) _paging.value = _paging.value.failLoad()
        } finally {
            if (_paging.value.accepts(listScope, generation) && _paging.value.isLoadingMore) {
                _paging.value = _paging.value.cancelLoad()
            }
        }
    }

    suspend fun refreshReplyLaterCount() {
        val mailboxId = _selectedMailboxId.value ?: run {
            _replyLaterCount.value = 0
            _replyLaterDueCount.value = 0
            return
        }
        val localCount = db.getReplyLaterCount(mailboxId)
        if (isDebugPreview) {
            _replyLaterCount.value = localCount
            _replyLaterDueCount.value = db.getReplyLaterDueCount(mailboxId)
            return
        }
        if (localCount > 0 || _replyLaterCount.value == 0) {
            _replyLaterCount.value = localCount
        }
        val replyLaterScope = EmailListScope(mailboxId, folderId = null, replyLater = true)
        try {
            val response = ApiClient.shared.listReplyLaterEmails(mailboxId)
            db.upsertEmails(mailboxId, response.emails)
            ifStillSelected(mailboxId) { _replyLaterCount.value = response.totalCount }
            ifStillShowing(replyLaterScope) {
                // Only page 1 came back; don't collapse a pile infinite scroll extended.
                _emails.value = if (_paging.value.keepsLoadedPages(replyLaterScope)) {
                    EmailPaging.mergeFirstPage(response.emails, _emails.value)
                } else {
                    response.emails
                }
            }
        } catch (_: Exception) {
            runCatching { ApiClient.shared.listWorkflowPiles(mailboxId) }.getOrNull()?.let { piles ->
                ifStillSelected(mailboxId) {
                    _replyLaterCount.value = piles.piles.firstOrNull { it.id == "reply_later" }?.count ?: 0
                }
            }
        }
        refreshReplyLaterDueCount(mailboxId)
    }

    /** Piles `due_count` (0 on older Workers), never below what the local cache knows is due. */
    private suspend fun refreshReplyLaterDueCount(mailboxId: String) {
        val localDue = db.getReplyLaterDueCount(mailboxId)
        val serverDue = runCatching { ApiClient.shared.listWorkflowPiles(mailboxId) }.getOrNull()
            ?.piles?.firstOrNull { it.id == "reply_later" }?.dueCount
        ifStillSelected(mailboxId) {
            _replyLaterDueCount.value = maxOf(serverDue ?: 0, localDue)
        }
    }

    fun openReminderPicker(email: Email) {
        hideToast()
        _reminderPickerEmail.value = email
    }

    fun dismissReminderPicker() {
        _reminderPickerEmail.value = null
    }

    /**
     * Set (`time`) or clear (`null`) a Reply Later reminder (AVE-86). Setting one also adds
     * the mail to Reply Later. Optimistic like the other flag mutations; rolls back on failure.
     */
    suspend fun setReplyLaterReminder(email: Email, time: java.time.ZonedDateTime?) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = _emails.value.firstOrNull { it.id == email.id }
            ?: _threadEmails.value.firstOrNull { it.id == email.id }
            ?: email
        val iso = time?.let { ReplyLaterReminderPresets.toIso(it) }
        db.updateReplyLaterReminder(target.id, iso)
        applyEmailUpdate(target.withReplyLaterReminder(iso))
        val successMessage = if (time != null) {
            "Reminder set for ${ReplyLaterReminderPresets.fullLabel(time, java.time.ZonedDateTime.now(time.zone))}"
        } else {
            "Reminder removed"
        }
        if (isDebugPreview) {
            showToast(successMessage)
            refreshReplyLaterCount()
            return
        }
        runCatching {
            ApiClient.shared.setReplyLaterReminder(mailboxId, target.id, iso)
        }.onSuccess {
            showToast(successMessage)
        }.onFailure {
            db.upsertEmails(mailboxId, listOf(target))
            applyEmailUpdate(target)
            showToast(if (time != null) "Couldn't set reminder" else "Couldn't remove reminder", isError = true)
        }
        refreshReplyLaterCount()
        if (_selectedTab.value is HomeTab.ReplyLater) {
            loadEmailsForCurrentTab(showLoading = false)
        }
    }

    /** Pull-to-refresh: start the list over at page 1. */
    suspend fun refreshCurrentTab() {
        when (val tab = _selectedTab.value) {
            is HomeTab.Folder, is HomeTab.AiInbox, is HomeTab.ReplyLater -> {
                loadEmailsForCurrentTab(showLoading = false, resetPaging = true)
                if (tab is HomeTab.AiInbox) loadInboxDigest(showLoading = false)
            }
            is HomeTab.Chats -> refreshConversations()
        }
    }

    /** SSE / 20 s poll / after send: refresh page 1 without collapsing loaded pages. */
    suspend fun refreshCurrentTabSilently() {
        val mailboxId = _selectedMailboxId.value ?: return
        val listScope = currentListScope
        val folderId = listScope?.folderId
        if (listScope != null && folderId != null) {
            var restart = false
            runCatching {
                // Decided once the response is in: a next page loaded (or loading) by then stays.
                MailboxSyncService.syncFolder(mailboxId, folderId, page = 1) {
                    restart = !_paging.value.keepsLoadedPages(listScope)
                    if (restart) FolderPrune.Full else FolderPrune.Window
                }
            }.getOrNull()?.let { synced ->
                ifStillShowing(listScope) {
                    rememberFirstPage(listScope, synced.pageIds)
                    rememberInboxNewCount(listScope, synced.newCount)
                rememberInboxNewCount(listScope, synced.newCount)
                    _emails.value = displayOrder(folderId, synced.emails)
                    // A full prune left exactly page 1; say so, which also voids any page
                    // request started against the old list.
                    if (restart && _paging.value.scope == listScope) {
                        _paging.value = _paging.value.restarted(
                            listScope,
                            received = synced.received,
                            totalCount = synced.totalCount,
                            loadedCount = synced.emails.size,
                        )
                    }
                }
            }
            if (isSelected(mailboxId) && _selectedTab.value is HomeTab.AiInbox) {
                loadInboxDigest(showLoading = false)
            }
            if (isSelected(mailboxId) && folderId == FolderIds.INBOX) refreshScreenerQueue()
        }
        if (isSelected(mailboxId)) refreshOpenEmailDetailSilently()
    }

    /** Keep an open thread's delivery badges in sync when SSE/`email_updated` triggers a silent refresh. */
    private suspend fun refreshOpenEmailDetailSilently() {
        val mailboxId = _selectedMailboxId.value ?: return
        val email = _selectedEmail.value ?: return
        try {
            val threadId = email.threadId
            val shouldLoadThread = threadId != null && (
                (email.threadCount ?: 1) > 1 ||
                    _threadEmails.value.size > 1 ||
                    _threadEmails.value.any { it.isDraft }
            )
            if (threadId != null && shouldLoadThread) {
                val remote = ApiClient.shared.getThread(mailboxId, threadId)
                db.upsertEmails(mailboxId, remote, defaultFolder = email.folderId)
                if (isSelected(mailboxId) &&
                    (_selectedEmail.value?.id == email.id || _selectedEmail.value?.threadId == threadId)
                ) {
                    _threadEmails.value = remote
                    remote.firstOrNull { it.id == email.id }?.let { updated ->
                        _selectedEmail.value = mergeListMetadata(email, updated)
                    }
                }
            } else {
                val full = ApiClient.shared.getEmail(mailboxId, email.id)
                db.upsertEmails(mailboxId, listOf(full), defaultFolder = email.folderId)
                if (isSelected(mailboxId) && _selectedEmail.value?.id == email.id) {
                    _selectedEmail.value = mergeListMetadata(email, full)
                    if (_threadEmails.value.size <= 1) {
                        _threadEmails.value = listOf(full)
                    } else {
                        _threadEmails.update { list ->
                            list.map { if (it.id == full.id) full else it }
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }
    }

    suspend fun loadInboxDigest(showLoading: Boolean = true) {
        val mailboxId = _selectedMailboxId.value
        if (mailboxId == null) {
            _inboxDigest.value = null
            _isDigestLoading.value = false
            return
        }
        if (showLoading && _inboxDigest.value == null) _isDigestLoading.value = true
        try {
            val digest = ApiClient.shared.getInboxDigest(mailboxId)
            ifStillSelected(mailboxId) { _inboxDigest.value = digest }
        } catch (e: Exception) {
            ifStillSelected(mailboxId) { if (_inboxDigest.value == null) _errorMessage.value = e.message }
        } finally {
            // A mailbox switch resets the flag itself (loadMailbox).
            ifStillSelected(mailboxId) { _isDigestLoading.value = false }
        }
    }

    suspend fun completeDigestTodo(id: String) {
        val mailboxId = _selectedMailboxId.value ?: return
        _inboxDigest.update { digest ->
            digest?.copy(todos = digest.todos.filterNot { it.id == id })
        }
        try {
            ApiClient.shared.completeDigestTodo(mailboxId, id)
            loadEmailsForCurrentTab(showLoading = false)
            loadInboxDigest(showLoading = false)
        } catch (_: Exception) {
            showToast("Couldn't complete to-do", isError = true)
            loadInboxDigest(showLoading = false)
        }
    }

    suspend fun markDigestTopicRead(topicId: String, emailIds: List<String>) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (emailIds.isEmpty()) return
        try {
            ApiClient.shared.markDigestTopicRead(mailboxId, topicId, emailIds)
            loadEmailsForCurrentTab(showLoading = false)
            loadInboxDigest(showLoading = false)
        } catch (_: Exception) {
            showToast("Couldn't mark topic read", isError = true)
        }
    }

    suspend fun openEmail(email: Email) {
        if (email.isDraft || _selectedTab.value == HomeTab.Folder("draft")) {
            openDraft(email)
            return
        }
        val mailboxId = _selectedMailboxId.value ?: return
        val localEmail = db.getEmail(email.id) ?: email
        val localThread = localEmail.threadId?.let { db.getThreadEmails(mailboxId, it) }.orEmpty()
        _selectedEmail.value = localEmail
        _threadEmails.value = if (localThread.isNotEmpty()) localThread else listOf(localEmail)
        val hasBody = !localEmail.body.isNullOrEmpty()
        _isEmailDetailLoading.value = !hasBody

        if (email.isUnread) {
            val threadId = email.threadId
            val isMulti = (email.threadCount ?: 1) > 1 || localThread.size > 1
            if (threadId != null && isMulti) {
                localThread.filter { it.isUnread }.forEach { db.updateEmailFlags(it.id, read = true) }
                db.updateEmailFlags(email.id, read = true)
            } else {
                db.updateEmailFlags(email.id, read = true)
            }
            _emails.update { list ->
                val updated = list.map {
                    if (it.id == email.id || (threadId != null && isMulti && it.threadId == threadId)) {
                        it.copy(read = true, threadUnreadCount = 0, listSection = "seen")
                    } else it
                }
                if (_selectedTab.value.syncFolderId == FolderIds.INBOX) {
                    orderNewThenSeen(updated)
                } else {
                    updated
                }
            }
            _selectedEmail.update { it?.copy(read = true, threadUnreadCount = 0, listSection = "seen") }
            adjustFolderUnread(email, wasUnread = true, isUnread = false)
            scope.launch {
                try {
                    if (threadId != null && isMulti) {
                        ApiClient.shared.markThreadRead(mailboxId, threadId)
                    } else {
                        ApiClient.shared.markRead(mailboxId, email.id)
                    }
                } catch (_: Exception) {
                }
            }
        }

        val shouldLoadThread = email.hasDraft == true || (email.threadCount ?: 1) > 1 ||
            localThread.any { it.isDraft }
        scope.launch {
            try {
                if (email.threadId != null && shouldLoadThread) {
                    val remote = ApiClient.shared.getThread(mailboxId, email.threadId)
                    db.pruneLocalOnlyDrafts(mailboxId, email.threadId, remote.map { it.id }.toSet())
                    db.upsertEmails(mailboxId, remote, defaultFolder = email.folderId)
                    if (isStillOpen(mailboxId, email)) {
                        _threadEmails.value = remote
                    }
                } else if (!hasBody) {
                    val full = ApiClient.shared.getEmail(mailboxId, email.id)
                    db.upsertEmails(mailboxId, listOf(full), defaultFolder = email.folderId)
                    if (isSelected(mailboxId) && _selectedEmail.value?.id == email.id) {
                        _selectedEmail.value = mergeListMetadata(email, full)
                        _threadEmails.value = listOf(full)
                    }
                }
            } catch (_: Exception) {
            } finally {
                // Opening another message (or closing) already reset the flag for it.
                if (isStillOpen(mailboxId, email)) _isEmailDetailLoading.value = false
            }
        }
    }

    /**
     * Open an email targeted by a push notification.
     * Resolves and opens the message first; folder list sync runs in the background
     * so notification taps are not blocked on a full folder refresh.
     */
    suspend fun openEmailFromNotification(mailboxId: String, emailId: String, folderId: String?) {
        if (_selectedMailboxId.value != mailboxId) {
            loadMailbox(mailboxId)
        }

        val resolved = _emails.value.firstOrNull { it.id == emailId }
            ?: db.getEmail(emailId)
            ?: runCatching {
                ApiClient.shared.getEmail(mailboxId, emailId).also { remote ->
                    db.upsertEmails(mailboxId, listOf(remote), defaultFolder = remote.folderId ?: folderId)
                }
            }.getOrElse {
                if (isSelected(mailboxId)) showToast("Couldn’t open email", isError = true)
                return
            }
        // The user switched mailboxes while this resolved; don't yank them back.
        if (!isSelected(mailboxId)) return

        val folder = folderId?.takeIf { it.isNotBlank() }
        if (folder != null) {
            val tab = if (folder == "inbox" && _selectedTab.value is HomeTab.AiInbox) {
                _selectedTab.value
            } else {
                HomeTab.Folder(folder)
            }
            // Assign tab directly — `selectTab` clears selected email and awaits folder sync.
            if (_selectedTab.value != tab) {
                _selectedTab.value = tab
                _paging.value = _paging.value.cleared()
                scope.launch { loadEmailsForCurrentTab(showLoading = false, resetPaging = true) }
            }
        }

        openEmail(resolved)
    }

    suspend fun openDraft(draft: Email) {
        val original = resolveReplyOriginal(draft)
        val isReplyDraft = original != null || !draft.inReplyTo.isNullOrEmpty()
        // A "Fwd:" draft reopens as a forward, so it keeps the forwarded-message quote (AVE-133).
        val mode = when {
            isReplyDraft && draft.subject.lowercase().startsWith("fwd:") -> ComposeMode.Forward
            isReplyDraft -> ComposeMode.Reply
            else -> ComposeMode.EditDraft
        }
        startCompose(mode = mode, original = original, draft = draft)
    }

    private suspend fun resolveReplyOriginal(draft: Email): Email? {
        val inReplyTo = draft.inReplyTo?.takeIf { it.isNotEmpty() } ?: return null
        _threadEmails.value.firstOrNull { it.id == inReplyTo || it.messageId == inReplyTo }?.let { return it }
        db.getEmail(inReplyTo)?.let { return it }
        val mailboxId = _selectedMailboxId.value ?: return null
        return runCatching { ApiClient.shared.getEmail(mailboxId, inReplyTo) }.getOrNull()
    }

    /** The detail sheet still shows [email] (or its thread) from [mailboxId]. */
    private fun isStillOpen(mailboxId: String, email: Email): Boolean {
        if (!isSelected(mailboxId)) return false
        val open = _selectedEmail.value ?: return false
        return open.id == email.id || (email.threadId != null && open.threadId == email.threadId)
    }

    private fun mergeListMetadata(listRow: Email, full: Email): Email = full.copy(
        folderId = full.folderId ?: listRow.folderId,
        folderName = full.folderName ?: listRow.folderName,
        threadCount = full.threadCount ?: listRow.threadCount,
        needsReply = full.needsReply ?: listRow.needsReply,
        hasDraft = full.hasDraft ?: listRow.hasDraft,
    )

    suspend fun startCompose(
        mode: ComposeMode,
        original: Email? = null,
        draft: Email? = null,
        initialTo: List<MailAddress> = emptyList(),
    ) {
        var mailbox = selectedMailbox ?: run {
            _errorMessage.value = "No mailbox selected."
            return
        }
        val mailboxId = mailbox.id
        if (blockIfReadOnly()) return
        if (mailbox.settings == null) {
            runCatching { ApiClient.shared.getMailbox(mailboxId) }.getOrNull()?.let { detailed ->
                mailbox = detailed
                _mailboxes.update { list -> list.map { if (it.id == detailed.id) detailed else it } }
                db.upsertMailboxes(listOf(detailed))
            }
        }
        var enrichedOriginal = original
        var enrichedDraft = draft
        if (original != null) {
            enrichedOriginal = runCatching {
                ApiClient.shared.getEmail(mailbox.id, original.id)
            }.getOrNull() ?: original
        } else if (!draft?.inReplyTo.isNullOrEmpty()) {
            enrichedOriginal = db.getEmail(draft!!.inReplyTo!!)
                ?: runCatching { ApiClient.shared.getEmail(mailbox.id, draft.inReplyTo!!) }.getOrNull()
        }
        if (draft != null) {
            enrichedDraft = runCatching {
                ApiClient.shared.getEmail(mailbox.id, draft.id)
            }.getOrNull() ?: draft
        }
        // Switched mailboxes while the original / draft loaded: don't open a stale compose.
        if (!isSelected(mailboxId)) return
        val form = ComposeFormModel(
            mode = mode,
            mailbox = mailbox,
            original = enrichedOriginal ?: original,
            draft = enrichedDraft ?: draft,
            initialTo = initialTo,
        )
        form.onDraftSaved = { id, threadId, originalId, subject, body, recipient ->
            markThreadHasDraft(id, threadId, originalId, subject, body, recipient, hasDraft = true)
        }
        form.onDraftDeleted = { id, threadId, originalId ->
            markThreadHasDraft(id, threadId, originalId, null, null, null, hasDraft = false)
        }
        _composeSession.value = ComposeSession(form, ComposePresentation.Expanded)
        _selectedEmail.value = null
    }

    fun closeEmail() {
        _selectedEmail.value = null
        _threadEmails.value = emptyList()
        _isEmailDetailLoading.value = false
    }

    // Notes to self (AVE-62). Private to the signed-in user; the Worker scopes every
    // call to them. DEBUG previews keep notes in memory.

    fun threadNotesStoreKey(mailboxId: String, threadKey: String): String = "$mailboxId|$threadKey"

    suspend fun loadThreadNotes(threadKey: String) {
        val mailboxId = _selectedMailboxId.value ?: return
        val key = threadNotesStoreKey(mailboxId, threadKey)
        if (_threadNotesKey.value != key) {
            _threadNotes.value = emptyList()
            _threadNotesKey.value = key
        }
        if (isDebugPreview) {
            _threadNotes.value = previewThreadNotes[threadKey].orEmpty()
            return
        }
        try {
            val notes = ApiClient.shared.listThreadNotes(mailboxId, threadKey)
            // Another conversation opened while the request was out: drop the result.
            if (_threadNotesKey.value != key) return
            _threadNotes.value = notes
            applyThreadNoteSummary(threadKey)
        } catch (_: Exception) {
            // Notes are extra context; the conversation still reads fine without them.
        }
    }

    /** Adds a note. A sticky with no position opens top-right (cascading), like web/iOS. */
    suspend fun createThreadNote(
        threadKey: String,
        body: String,
        noteType: String,
        emailId: String? = null,
    ): Boolean {
        val mailboxId = _selectedMailboxId.value ?: return false
        val key = threadNotesStoreKey(mailboxId, threadKey)
        val created = if (isDebugPreview) {
            val now = Instant.now().toString()
            ThreadNote(
                id = UUID.randomUUID().toString(),
                threadId = threadKey,
                emailId = emailId,
                noteType = noteType,
                body = body,
                createdAt = now,
                updatedAt = now,
            )
        } else {
            try {
                ApiClient.shared.createThreadNote(mailboxId, threadKey, body, noteType, emailId)
            } catch (_: Exception) {
                showToast("Couldn’t save the note", isError = true)
                return false
            }
        }
        if (_threadNotesKey.value != key) return true
        _threadNotes.update { it + created }
        didChangeThreadNotes(threadKey)
        return true
    }

    suspend fun updateThreadNoteBody(note: ThreadNote, body: String): Boolean {
        val mailboxId = _selectedMailboxId.value ?: return false
        val updated = if (isDebugPreview) {
            note.copy(body = body, updatedAt = Instant.now().toString())
        } else {
            try {
                ApiClient.shared.updateThreadNote(mailboxId, note.id, body = body)
            } catch (_: Exception) {
                showToast("Couldn’t save the note", isError = true)
                return false
            }
        }
        replaceThreadNote(updated)
        didChangeThreadNotes(note.threadId)
        return true
    }

    /** Saves where a sticky was dropped (dp). Moves at once; puts it back if the save fails. */
    suspend fun moveThreadNote(note: ThreadNote, x: Float, y: Float) {
        val mailboxId = _selectedMailboxId.value ?: return
        replaceThreadNote(note.copy(posX = x.toDouble(), posY = y.toDouble()))
        if (isDebugPreview) {
            previewThreadNotes[note.threadId] = _threadNotes.value
            return
        }
        try {
            val saved = ApiClient.shared.updateThreadNote(
                mailboxId,
                note.id,
                posX = x.toDouble(),
                posY = y.toDouble(),
            )
            replaceThreadNote(saved)
        } catch (_: Exception) {
            replaceThreadNote(note)
            showToast("Couldn’t move the note", isError = true)
        }
    }

    /** Deletes a note at once; restores it if the server refuses. */
    suspend fun deleteThreadNote(note: ThreadNote) {
        val mailboxId = _selectedMailboxId.value ?: return
        val index = _threadNotes.value.indexOfFirst { it.id == note.id }
        if (index < 0) return
        _threadNotes.update { list -> list.filter { it.id != note.id } }
        didChangeThreadNotes(note.threadId)
        if (isDebugPreview) return
        try {
            ApiClient.shared.deleteThreadNote(mailboxId, note.id)
        } catch (_: Exception) {
            if (_threadNotes.value.none { it.id == note.id }) {
                _threadNotes.update { list ->
                    list.toMutableList().apply { add(index.coerceAtMost(size), note) }
                }
                didChangeThreadNotes(note.threadId)
            }
            showToast("Couldn’t delete the note", isError = true)
        }
    }

    private fun replaceThreadNote(note: ThreadNote) {
        _threadNotes.update { list -> list.map { if (it.id == note.id) note else it } }
    }

    private fun didChangeThreadNotes(threadKey: String) {
        if (isDebugPreview) previewThreadNotes[threadKey] = _threadNotes.value
        applyThreadNoteSummary(threadKey)
    }

    /**
     * Mirrors the open conversation's notes onto its list row (memory and cache),
     * so the sticky strip and private-note count update before the next sync.
     */
    private fun applyThreadNoteSummary(threadKey: String) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (_threadNotesKey.value != threadNotesStoreKey(mailboxId, threadKey)) return
        val summary = ThreadNoteSummary.of(_threadNotes.value)
        fun Email.withSummary() = copy(
            hasStickyNote = summary.hasStickyNote,
            stickyNoteText = summary.stickyNoteText,
            inlineNoteCount = summary.inlineNoteCount,
        )
        _emails.update { list -> list.map { if (it.noteThreadKey == threadKey) it.withSummary() else it } }
        _selectedEmail.update { if (it?.noteThreadKey == threadKey) it.withSummary() else it }
        db.updateThreadNoteSummary(mailboxId, threadKey, summary)
    }

    /** Preview / Simulator fixture — open a thread without hitting the network. */
    fun seedOpenThreadForPreview(email: Email, thread: List<Email> = listOf(email)) {
        _selectedEmail.value = email
        _threadEmails.value = thread.ifEmpty { listOf(email) }
        _isEmailDetailLoading.value = false
        _isLoading.value = false
        _isMailboxLoading.value = false
    }

    /** Readable (non-draft) emails in the current list, in display order. */
    val navigableEmails: List<Email>
        get() = _emails.value.filter { !it.isDraft }

    val canOpenPreviousEmail: Boolean
        get() {
            val current = _selectedEmail.value ?: return false
            val idx = navigableEmails.indexOfFirst { it.id == current.id }
            return idx > 0
        }

    val canOpenNextEmail: Boolean
        get() {
            val current = _selectedEmail.value ?: return false
            val idx = navigableEmails.indexOfFirst { it.id == current.id }
            return idx in 0 until navigableEmails.lastIndex
        }

    suspend fun openAdjacentEmail(offset: Int) {
        val current = _selectedEmail.value ?: return
        val idx = navigableEmails.indexOfFirst { it.id == current.id }
        if (idx < 0) return
        val next = idx + offset
        if (next !in navigableEmails.indices) return
        openEmail(navigableEmails[next])
    }

    /** Prefer the latest message from someone else; fall back to latest non-draft. */
    val actionSourceEmail: Email?
        get() {
            val selfAddresses = setOfNotNull(
                selectedMailbox?.email?.lowercase()?.takeIf { it.isNotEmpty() },
                selectedMailbox?.id?.lowercase()?.takeIf { it.isNotEmpty() },
            )
            val thread = _threadEmails.value
            thread.lastOrNull { !it.isDraft && it.sender.lowercase() !in selfAddresses }?.let { return it }
            return thread.lastOrNull { !it.isDraft } ?: _selectedEmail.value
        }

    suspend fun deleteCurrentEmail() {
        val email = _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        deleteEmail(email)
    }

    suspend fun archiveCurrentEmail() {
        val email = _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        archiveEmail(email)
    }

    /** Discard a draft in the open thread without closing the conversation. */
    suspend fun deleteThreadDraft(draft: Email) {
        if (!draft.isDraft) return
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        try {
            ApiClient.shared.deleteEmail(mailboxId, draft.id)
            db.deleteEmail(draft.id)
            _threadEmails.update { it.filterNot { e -> e.id == draft.id } }
            _emails.update { it.filterNot { e -> e.id == draft.id } }

            if (_selectedEmail.value?.id == draft.id || _threadEmails.value.isEmpty()) {
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
                loadEmailsForCurrentTab(showLoading = false)
                return
            }

            val stillHasDraft = _threadEmails.value.any { it.isDraft }
            _selectedEmail.update { it?.copy(hasDraft = stillHasDraft) }
            _selectedEmail.value?.id?.let { selectedId ->
                _emails.update { list ->
                    list.map { if (it.id == selectedId) it.copy(hasDraft = stillHasDraft) else it }
                }
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    fun markThreadHasDraft(
        draftId: String,
        threadId: String?,
        originalEmailId: String?,
        draftSubject: String?,
        draftBody: String?,
        draftRecipient: String?,
        hasDraft: Boolean,
    ) {
        fun matches(e: Email): Boolean {
            val mt = !threadId.isNullOrEmpty() && (e.threadId == threadId || e.id == threadId)
            val mo = !originalEmailId.isNullOrEmpty() &&
                (e.id == originalEmailId || e.threadId == originalEmailId)
            return mt || mo
        }
        _emails.update { list ->
            list.map { e ->
                if (!matches(e)) e
                else {
                    val was = e.hasDraft == true
                    val count = when {
                        hasDraft && !was -> (e.threadCount ?: 1) + 1
                        !hasDraft && was -> maxOf(1, (e.threadCount ?: 2) - 1)
                        else -> e.threadCount
                    }
                    e.copy(hasDraft = hasDraft, threadCount = count)
                }
            }
        }
        _selectedEmail.update { selected ->
            selected?.let { e ->
                if (!matches(e)) e
                else {
                    val was = e.hasDraft == true
                    val count = when {
                        hasDraft && !was -> (e.threadCount ?: 1) + 1
                        !hasDraft && was -> maxOf(1, (e.threadCount ?: 2) - 1)
                        else -> e.threadCount
                    }
                    e.copy(hasDraft = hasDraft, threadCount = count)
                }
            }
        }
        scope.launch {
            val mailboxId = _selectedMailboxId.value ?: return@launch
            if (hasDraft) {
                db.deleteDrafts(mailboxId, threadId, originalEmailId, draftId)
                db.upsertEmails(
                    mailboxId,
                    listOf(
                        Email(
                            id = draftId,
                            threadId = threadId,
                            folderId = "draft",
                            subject = draftSubject.orEmpty(),
                            sender = selectedMailbox?.email.orEmpty(),
                            senderName = selectedMailbox?.name,
                            recipient = draftRecipient.orEmpty(),
                            date = Instant.now().toString(),
                            read = true,
                            starred = false,
                            body = draftBody,
                            inReplyTo = originalEmailId,
                        ),
                    ),
                    defaultFolder = "draft",
                )
            } else {
                db.deleteEmail(draftId)
                db.deleteDrafts(mailboxId, threadId, originalEmailId, null)
            }
        }
    }

    fun showToast(
        message: String,
        isError: Boolean = false,
        isLoading: Boolean = false,
        isUndo: Boolean = false,
        icon: ImageVector? = null,
        action: ToastAction? = null,
        durationMs: Long = 2500,
    ) {
        toastDismissJob?.cancel()
        _toast.value = AppToast(
            message = message,
            isError = isError,
            isLoading = isLoading,
            isUndo = isUndo,
            icon = icon,
            action = action,
        )
        if (durationMs > 0) {
            toastDismissJob = scope.launch {
                delay(durationMs)
                _toast.value = null
            }
        }
    }

    fun hideToast() {
        toastDismissJob?.cancel()
        _toast.value = null
    }

    fun clearToast() = hideToast()

    /**
     * Unregister this device's push token from every mailbox while the session is
     * still valid, then end the session. Runs on the app-scoped [scope] so leaving
     * the current screen doesn't cancel it.
     */
    fun signOut(auth: AuthStore) {
        val mailboxIds = _mailboxes.value.map { it.id }
        scope.launch {
            val revokesOnServer = !isDebugPreview
            if (revokesOnServer) {
                withTimeoutOrNull(PUSH_UNREGISTER_TIMEOUT_MS) {
                    PushNotificationManager.shared.unregisterAll(mailboxIds)
                }
            }
            val sessionToken = auth.currentToken()
            auth.signOut()
            reset()
            // After the local sign-out, so nothing in flight reads the revoked
            // session as "expired"; pinned to the outgoing token.
            if (revokesOnServer && sessionToken != null) {
                withTimeoutOrNull(PUSH_UNREGISTER_TIMEOUT_MS) {
                    runCatching { ApiClient.shared.logout(sessionToken) }
                }
            }
        }
    }

    /** Settings → Notifications off: unregister this device from every mailbox. */
    fun disablePushNotifications() {
        val mailboxIds = _mailboxes.value.map { it.id }
        scope.launch {
            withTimeoutOrNull(PUSH_UNREGISTER_TIMEOUT_MS) {
                PushNotificationManager.shared.disableNotifications(mailboxIds)
            }
        }
    }

    /**
     * DELETE /api/v1/me — sole-owned mailboxes are purged, shared ones are left.
     * Throws on failure so the caller can keep the confirmation UI up.
     */
    suspend fun deleteAccount(auth: AuthStore) = withContext(NonCancellable) {
        // NonCancellable: once started, leaving Settings must not strand a half-deleted session.
        val mailboxIds = _mailboxes.value.map { it.id }
        withTimeoutOrNull(PUSH_UNREGISTER_TIMEOUT_MS) {
            PushNotificationManager.shared.unregisterAll(mailboxIds)
        }
        ApiClient.shared.deleteAccount()
        auth.signOut()
        reset()
    }

    fun reset() {
        bootstrappedToken = null
        streamClient.stop()
        _mailboxes.value = emptyList()
        _selectedMailboxId.value = null
        _folders.value = emptyList()
        _emails.value = emptyList()
        _inboxDigest.value = null
        _selectedEmail.value = null
        _threadEmails.value = emptyList()
        _threadNotes.value = emptyList()
        _threadNotesKey.value = null
        previewThreadNotes.clear()
        _composeSession.value = null
        _chatSession.value = ChatSession.Dismissed
        _conversations.value = emptyList()
        _isMailboxLoading.value = true
        _isLoading.value = true
        _isAdmin.value = false
        _administeredDomains.value = emptyList()
        _domainServices.value = emptyMap()
        // A pending invite survives sign-out / a signed-out cold start: the
        // invite screen clears it when it is accepted or closed.
        _errorMessage.value = null
        _toast.value = null
        _replyLaterDueCount.value = 0
        _reminderPickerEmail.value = null
        // Sign-out forgets the last mailbox; the next account starts on its own first one.
        if (!isDebugPreview) LastMailboxPreference.clear()
        selectionIsProvisional = false
        isDebugPreview = false
        AutofillMailboxPreference.clear()
        DatabaseService.shared.clearAll()
    }

    /**
     * Seed in-memory mailbox state for DEBUG emulator previews.
     * Skips network/bootstrap; [isDebugPreview] stays true so RootView must not call [bootstrap].
     */
    fun applyDebugPreview(
        mailboxes: List<Mailbox>,
        selectedMailboxId: String?,
        folders: List<Folder>,
        emails: List<Email>,
        selectedTab: HomeTab,
        selectedEmail: Email?,
        threadEmails: List<Email>,
        replyLaterCount: Int,
        isAdmin: Boolean,
        hasMorePages: Boolean = false,
        mailboxesLoadFailed: Boolean = false,
        emailListError: String? = null,
        errorMessage: String? = null,
        administeredDomains: List<String> = emptyList(),
        domainServices: Map<String, DomainService> = emptyMap(),
    ) {
        streamClient.stop()
        isDebugPreview = true
        val generation = _paging.value.generation + 1
        _paging.value = EmailListScope.of(selectedMailboxId, selectedTab)
            ?.let { EmailPagingState(scope = it, page = 1, hasMore = hasMorePages, generation = generation) }
            ?: EmailPagingState(generation = generation)
        _mailboxesLoadFailed.value = mailboxesLoadFailed
        _emailListError.value = emailListError
        _administeredDomains.value = administeredDomains
        _domainServices.value = domainServices
        _mailboxes.value = mailboxes
        _selectedMailboxId.value = selectedMailboxId
        _folders.value = folders
        _emails.value = emails
        _selectedTab.value = selectedTab
        _selectedEmail.value = selectedEmail
        _threadEmails.value = threadEmails
        _replyLaterCount.value = replyLaterCount
        _replyLaterDueCount.value = selectedMailboxId?.let { db.getReplyLaterDueCount(it) } ?: 0
        _reminderPickerEmail.value = null
        _isAdmin.value = isAdmin
        _inboxDigest.value = null
        _composeSession.value = null
        _chatSession.value = ChatSession.Dismissed
        _conversations.value = emptyList()
        _pendingInviteToken.value = null
        _errorMessage.value = errorMessage
        _toast.value = null
        _isMailboxLoading.value = false
        _isLoading.value = false
    }

    /** When true, UI must not call [bootstrap] / real-time sync (DEBUG preview fixtures). */
    @Volatile
    var isDebugPreview: Boolean = false
        private set

    // region "Today's inbox" widget (AVE-150)

    // Declared after every state it reads, so the collectors start on initialised fields.
    init {
        // Debounced: list refreshes, SSE, reads and archives arrive in bursts. The
        // publisher also skips writes whose content didn't change.
        scope.launch {
            combine(_selectedMailboxId, _emails, _inboxNewTotal, _replyLaterCount) { _, _, _, _ -> Unit }
                .collectLatest {
                    delay(INBOX_WIDGET_DEBOUNCE_MS)
                    publishInboxWidgetNow()
                }
        }
        scope.launch {
            _mailboxes.collect { list ->
                if (publishesInboxWidget && list.isNotEmpty()) InboxWidgetPublisher.publishMailboxes(list)
            }
        }
    }

    private val publishesInboxWidget: Boolean
        get() = !isDebugPreview && bootstrappedToken != null

    /**
     * Writes the active mailbox's Inbox to the widget now (also when the app goes to the
     * background). Built from the cached Inbox, not the visible list, so it's right
     * whichever folder is open. iOS twin: `AppModel.publishInboxWidgetNow()`.
     */
    fun publishInboxWidgetNow() {
        if (!publishesInboxWidget) return
        val mailbox = selectedMailbox ?: return
        val inboxRows = db.getEmails(mailbox.id, FolderIds.INBOX)
        val serverNewCount = _inboxNewTotal.value
            ?.takeIf { it.scope.mailboxId == mailbox.id && it.scope.folderId == FolderIds.INBOX }
            ?.count
        // The Inbox hasn't loaded for this mailbox yet: keep the last snapshot rather
        // than claim inbox zero.
        if (inboxRows.isEmpty() && serverNewCount == null) return
        InboxWidgetPublisher.publish(
            InboxWidgetSnapshot.make(
                mailbox = mailbox,
                inboxRows = inboxRows,
                serverNewCount = serverNewCount,
                replyLaterCount = _replyLaterCount.value,
            ),
        )
    }

    /** Widget tap outside the cards: the Inbox of the widget's mailbox. */
    suspend fun openInboxFromWidget(mailboxId: String?) {
        if (mailboxId != null && mailboxId != _selectedMailboxId.value && _mailboxes.value.any { it.id == mailboxId }) {
            loadMailbox(mailboxId)
        }
        val inbox = HomeTab.Folder(FolderIds.INBOX)
        if (_selectedTab.value != inbox || _selectedEmail.value != null) selectTab(inbox)
    }

    // endregion

    fun updateComposeFromMailbox(mailboxId: String) {
        val session = _composeSession.value ?: return
        // Private-email replies are pinned to the alias by the server.
        if (session.form.isAliasBound) return
        val mailbox = _mailboxes.value.firstOrNull { it.id == mailboxId } ?: return
        session.form.selectFrom(mailbox)
        _composeSession.value = session
    }

    suspend fun sendCompose() {
        val session = _composeSession.value ?: run {
            showToast("Send failed", isError = true)
            return
        }
        val form = session.form
        if (form.isSending) return
        form.isSending = true
        form.errorMessage = null
        form.suppressedRecipients = emptyList()
        showToast("Sending…", isLoading = true)
        try {
            runCatching {
                form.commitPendingTokens()
                if (form.toTokens.isEmpty()) error("Add at least one recipient.")
                val mailboxId = form.fromMailboxId.ifBlank {
                    _selectedMailboxId.value ?: error("No mailbox")
                }
                val html = form.sizedHtml()
                val text = form.outgoingPlainText()
                val estimated = co.inboxies.app.util.OutboundLimits.estimateMessageBytes(
                    html,
                    text,
                    form.attachments.map { it.size },
                )
                if (estimated > co.inboxies.app.util.OutboundLimits.MAX_MESSAGE_BYTES) {
                    error(co.inboxies.app.util.OutboundLimits.SIZE_ERROR)
                }
                val payload = form.toSendPayload()
                when (form.mode) {
                    ComposeMode.Reply, ComposeMode.ReplyAll, ComposeMode.Forward ->
                        sendReplyOrForward(form, mailboxId, payload)
                    else -> ApiClient.shared.sendEmail(mailboxId, payload, form.sendIdempotencyKey)
                }
            }.onSuccess {
                form.deleteSavedDraft()
                showToast("Sent")
                closeCompose()
                refreshCurrentTabSilently()
            }.onFailure {
                // Server errors (e.g. 409 `alias_inactive` for a paused private email) carry a
                // readable `error` message; keep it on the form so the open sheet can show it.
                val message = it.message?.takeIf { msg -> msg.isNotBlank() } ?: "Send failed"
                noteServiceEnded(it)
                if (it is ApiException.RecipientSuppressed) {
                    // Shown inline with Un-suppress; the server's sentence goes in the toast.
                    form.suppressedRecipients = it.suppressed
                } else {
                    form.errorMessage = message
                }
                showToast(message, isError = true)
            }
        } finally {
            form.isSending = false
        }
    }

    /**
     * Compose "Un-suppress and send": lifts every suppression the open compose still
     * addresses, then sends again through [sendCompose] with the same `Idempotency-Key`.
     * One already lifted (404) is skipped; any other failure stops before sending.
     */
    suspend fun unsuppressAndSendCompose() {
        val form = _composeSession.value?.form ?: return
        if (form.isSending || form.isUnsuppressing) return
        form.commitPendingTokens()
        val targets = form.visibleSuppressedRecipients()
        if (targets.isEmpty() || targets.any { !it.canUnsuppress }) return
        form.isUnsuppressing = true
        form.errorMessage = null
        try {
            for (target in targets) {
                try {
                    ApiClient.shared.unsuppress(form.fromMailboxId, target.address)
                } catch (e: ApiException.Http) {
                    // Already lifted (by someone else, or an earlier attempt): carry on.
                    if (e.code != 404) throw e
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = e.message?.takeIf { it.isNotBlank() } ?: "Couldn't un-suppress the address."
            noteServiceEnded(e)
            form.errorMessage = message
            showToast(message, isError = true)
            return
        } finally {
            form.isUnsuppressing = false
        }
        val lifted = targets.map { it.address }.toSet()
        form.suppressedRecipients = form.suppressedRecipients.filterNot { it.address in lifted }
        sendCompose()
    }

    /**
     * Reply / forward through the server route that threads against the original.
     * A reopened reply draft may never have loaded its original (deleted, or not
     * reachable when the draft opened), so fall back to [ComposeFormModel.originalEmailId]
     * (the draft's `in_reply_to`), which the route resolves server-side. When there is no
     * id at all, or the route can't find it (404), send what the user wrote as a new
     * message instead of failing — threading and server-side quoting are lost, the text isn't.
     */
    private suspend fun sendReplyOrForward(form: ComposeFormModel, mailboxId: String, payload: JsonObject) {
        val targetId = form.original?.id ?: form.originalEmailId?.takeIf { it.isNotBlank() }
        // One key for the whole compose, so the 404 fallback below and any retry share it.
        val key = form.sendIdempotencyKey
        if (targetId == null) {
            ApiClient.shared.sendEmail(mailboxId, payload, key)
            return
        }
        try {
            if (form.mode == ComposeMode.Forward) {
                ApiClient.shared.forwardEmail(mailboxId, targetId, payload, key)
            } else {
                ApiClient.shared.replyToEmail(mailboxId, targetId, payload, key)
            }
        } catch (e: ApiException.Http) {
            if (e.code != 404 || form.original != null) throw e
            ApiClient.shared.sendEmail(mailboxId, payload, key)
        }
    }

    suspend fun saveDraft() {
        val form = _composeSession.value?.form ?: return
        if (form.isEmpty) return
        if (form.saveDraft(explicit = true)) {
            showToast("Draft saved")
        } else if (!form.isSending) {
            showToast("Couldn't save draft", isError = true)
        }
    }

    fun scheduleUndoableAction(
        optimistic: () -> Unit,
        commit: suspend () -> Unit,
        rollback: () -> Unit,
        pendingMessage: String?,
        completedMessage: String,
    ) {
        scheduleUndoableAction(
            action = UndoableAction(message = completedMessage, execute = commit, rollback = rollback),
            optimistic = optimistic,
            pendingMessage = pendingMessage,
        )
    }

    /** Shows [action]'s Undo toast and commits it when the toast times out or the next action starts. */
    private fun scheduleUndoableAction(
        action: UndoableAction,
        optimistic: () -> Unit,
        pendingMessage: String?,
    ) {
        val completedMessage = action.message
        optimistic()
        commitPendingActionImmediately()
        val actionId = action.id
        _pendingUndoAction.value = action
        pendingUndoJob = scope.launch {
            if (pendingMessage != null) {
                showToast(pendingMessage, isLoading = true, durationMs = 1000)
                delay(1000)
            }
            if (_pendingUndoAction.value?.id != actionId) return@launch
            showToast(completedMessage, isUndo = true, durationMs = 5000)
            delay(5000)
            if (_pendingUndoAction.value?.id != actionId) return@launch
            commitPendingActionImmediately()
        }
    }

    fun commitPendingActionImmediately() {
        pendingUndoJob?.cancel()
        val action = _pendingUndoAction.value
        _pendingUndoAction.value = null
        if (action != null) {
            scope.launch { action.execute() }
        }
    }

    fun undoPendingAction() {
        pendingUndoJob?.cancel()
        _pendingUndoAction.value?.rollback?.invoke()
        _pendingUndoAction.value = null
        hideToast()
    }

    suspend fun performSwipeAction(action: SwipeQuickAction, on: Email) {
        when (action) {
            SwipeQuickAction.DELETE -> deleteEmail(on)
            SwipeQuickAction.ARCHIVE -> archiveEmail(on)
            SwipeQuickAction.STAR -> toggleStar(on)
            SwipeQuickAction.TOGGLE_READ -> toggleRead(on)
            SwipeQuickAction.REPLY -> startCompose(ComposeMode.Reply, original = on)
        }
    }

    suspend fun toggleStar(on: Email? = null) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = on ?: _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        val next = !target.starred
        db.updateEmailFlags(target.id, starred = next)
        applyEmailUpdate(target.copy(starred = next))
        try {
            ApiClient.shared.updateEmail(mailboxId, target.id, starred = next)
        } catch (_: Exception) {
            showToast("Couldn't update star", isError = true)
        }
    }

    suspend fun toggleReplyLater(on: Email? = null) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = on ?: _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        val next = !target.replyLater
        db.updateEmailFlags(target.id, replyLater = next)
        val updated = target.copy(
            replyLater = next,
            replyLaterAt = if (next) java.time.Instant.now().toString() else null,
            replyLaterRemindAt = if (next) target.replyLaterRemindAt else null,
            replyLaterRemindedAt = if (next) target.replyLaterRemindedAt else null,
        )
        applyEmailUpdate(updated)
        runCatching {
            ApiClient.shared.updateEmail(mailboxId, target.id, replyLater = next)
        }.onSuccess {
            if (next) showAddedToReplyLaterToast(updated) else showToast("Removed from Reply Later")
        }.onFailure {
            // Roll back optimistic update on failure
            db.updateEmailFlags(target.id, replyLater = !next)
            applyEmailUpdate(target)
            showToast("Couldn't update Reply Later", isError = true)
        }
        refreshReplyLaterCount()
        if (_selectedTab.value is HomeTab.ReplyLater) {
            loadEmailsForCurrentTab(showLoading = false)
        }
    }

    /** "Added to Reply Later" + "Add reminder" (opens the picker), held a little longer (AVE-86). */
    fun showAddedToReplyLaterToast(email: Email) {
        if (email.hasPendingReplyLaterReminder) {
            showToast("Added to Reply Later")
            return
        }
        showToast(
            "Added to Reply Later",
            action = ToastAction("Add reminder", ink = true) { openReminderPicker(email) },
            durationMs = REMINDER_TOAST_DURATION_MS,
        )
    }

    suspend fun setReplyLater(ids: Set<String>, replyLater: Boolean) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (ids.isEmpty()) return
        for (id in ids) {
            db.updateEmailFlags(id, replyLater = replyLater)
            _emails.value.firstOrNull { it.id == id }?.let { email ->
                applyEmailUpdate(
                    email.copy(
                        replyLater = replyLater,
                        replyLaterAt = if (replyLater) java.time.Instant.now().toString() else null,
                        replyLaterRemindAt = if (replyLater) email.replyLaterRemindAt else null,
                        replyLaterRemindedAt = if (replyLater) email.replyLaterRemindedAt else null,
                    ),
                )
            }
        }
        refreshReplyLaterCount()
        if (!isDebugPreview) {
            for (id in ids) {
                runCatching {
                    ApiClient.shared.updateEmail(mailboxId, id, replyLater = replyLater)
                }.onSuccess { applyEmailUpdate(it) }
            }
            refreshReplyLaterCount()
        }
        if (_selectedTab.value is HomeTab.ReplyLater) {
            loadEmailsForCurrentTab(showLoading = false)
        }
    }

    suspend fun toggleRead(on: Email? = null) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = on ?: _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        val next = !target.read
        db.updateEmailFlags(target.id, read = next)
        applyEmailUpdate(
            target.copy(
                read = next,
                threadUnreadCount = if (next) 0 else maxOf(1, target.threadUnreadCount ?: 1),
                listSection = if (next) "seen" else "new",
            ),
        )
        try {
            ApiClient.shared.updateEmail(mailboxId, target.id, read = next)
        } catch (_: Exception) {
            showToast("Couldn't update read state", isError = true)
        }
    }

    fun applyEmailUpdate(updated: Email) {
        val previous = _emails.value.firstOrNull { it.id == updated.id }
        if (_selectedEmail.value?.id == updated.id) _selectedEmail.value = updated
        _threadEmails.update { list -> list.map { if (it.id == updated.id) updated else it } }
        _emails.update { list ->
            if (_selectedTab.value is HomeTab.ReplyLater && !updated.replyLater) {
                list.filterNot { it.id == updated.id }
            } else {
                val mapped = list.map {
                    if (it.id != updated.id) it
                    else it.copy(
                        read = updated.read,
                        starred = updated.starred,
                        replyLater = updated.replyLater,
                        replyLaterAt = updated.replyLaterAt,
                        replyLaterRemindAt = updated.replyLaterRemindAt,
                        replyLaterRemindedAt = updated.replyLaterRemindedAt,
                        threadUnreadCount = if (updated.read) 0 else it.threadUnreadCount,
                        listSection = if (updated.read) "seen" else "new",
                    )
                }
                if (_selectedTab.value.syncFolderId == FolderIds.INBOX) orderNewThenSeen(mapped) else mapped
            }
        }
        if (previous != null) {
            adjustFolderUnread(previous, wasUnread = !previous.read, isUnread = !updated.read)
            // Reading (or un-queueing) a due mail clears the attention state right away.
            if (previous.isReplyLaterDue != updated.isReplyLaterDue) {
                _replyLaterDueCount.update { (it + if (updated.isReplyLaterDue) 1 else -1).coerceAtLeast(0) }
            }
        }
    }

    fun removeEmailLocally(email: Email) {
        _threadEmails.update { it.filterNot { e -> e.id == email.id } }
        _emails.update { it.filterNot { e -> e.id == email.id } }
        if (_threadEmails.value.isEmpty()) {
            _selectedEmail.value = null
        } else if (_selectedEmail.value?.id == email.id) {
            _selectedEmail.value = _threadEmails.value.lastOrNull { !it.isDraft }
                ?: _threadEmails.value.lastOrNull()
        }
        if (email.isUnread) {
            adjustFolderUnread(email, wasUnread = true, isUnread = false)
        }
    }

    /**
     * Server DELETE moves to Trash unless the message is already in Trash/Drafts,
     * where it is permanent. Mirror that locally so the cache matches the next sync.
     */
    suspend fun deleteEmail(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        val isPermanent = email.isDraft || email.folderId == FolderIds.TRASH
        scheduleUndoableAction(
            optimistic = { removeEmailLocally(email) },
            commit = {
                try {
                    ApiClient.shared.deleteEmail(mailboxId, email.id)
                    if (isPermanent) db.deleteEmail(email.id) else db.moveEmail(email.id, FolderIds.TRASH)
                } catch (e: Exception) {
                    loadEmailsForCurrentTab(showLoading = false)
                    val ended = noteServiceEnded(e)
                    showToast(if (ended) e.message.orEmpty() else "Couldn't delete", isError = true)
                }
            },
            rollback = { scope.launch { loadEmailsForCurrentTab(showLoading = false) } },
            pendingMessage = "Deleting...",
            completedMessage = if (isPermanent) "Deleted" else "Moved to Trash",
        )
    }

    suspend fun archiveEmail(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        scheduleUndoableAction(
            optimistic = { removeEmailLocally(email) },
            commit = {
                try {
                    ApiClient.shared.moveEmail(mailboxId, email.id, FolderIds.ARCHIVE)
                    db.moveEmail(email.id, FolderIds.ARCHIVE)
                } catch (e: Exception) {
                    loadEmailsForCurrentTab(showLoading = false)
                    val ended = noteServiceEnded(e)
                    showToast(if (ended) e.message.orEmpty() else "Couldn't archive", isError = true)
                }
            },
            rollback = { scope.launch { loadEmailsForCurrentTab(showLoading = false) } },
            pendingMessage = "Archiving...",
            completedMessage = "Archived",
        )
    }

    suspend fun moveEmailToFolder(
        email: Email,
        folderId: String,
        setSenderPreference: Boolean = false,
        unsubscribe: Boolean = false,
        refileSender: Boolean = true,
    ) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        db.moveEmail(email.id, folderId)
        removeEmailLocally(email)
        runCatching {
            ApiClient.shared.moveEmail(
                mailboxId,
                email.id,
                folderId,
                setSenderPreference = setSenderPreference,
                unsubscribe = unsubscribe,
                refileSender = refileSender,
            )
        }.onSuccess { response ->
            // Into / out of Spam is Not spam / Report spam: "· N more moved"
            // toast with Undo (AVE-98).
            if ((response.rescuedCount ?: 0) > 0) loadEmailsForCurrentTab(showLoading = false)
            val title = SpamVerdictToast.title(response, folderId, email.sender)
            val token = response.undoToken
            if (title != null && !token.isNullOrEmpty()) {
                showSpamVerdictUndoToast(title, mailboxId, token)
            } else if (title != null) {
                showToast(title)
            }
        }.onFailure {
            if (noteServiceEnded(it)) {
                loadEmailsForCurrentTab(showLoading = false)
                showToast(it.message.orEmpty(), isError = true)
            } else {
                showToast("Couldn't sync move", isError = true)
            }
        }
        if (folderId == "trash" || folderId == "spam") {
            refreshReplyLaterCount()
            if (_selectedTab.value is HomeTab.ReplyLater) {
                loadEmailsForCurrentTab(showLoading = false)
            }
        }
    }

    /**
     * Move to Spam and reject the sender: their future mail is screened out.
     * With [unsubscribe], the Worker also sends the RFC 8058 one-click POST;
     * with [refileSender] (the default), their Inbox / Promotions / Updates
     * mail moves to Spam too (AVE-98). The toast comes from [moveEmailToFolder].
     */
    suspend fun reportSpam(email: Email, unsubscribe: Boolean = false, refileSender: Boolean = true) {
        moveEmailToFolder(
            email,
            "spam",
            setSenderPreference = true,
            unsubscribe = unsubscribe,
            refileSender = refileSender,
        )
    }

    /** Move back to Inbox and allow the sender; their other recent Spam is rescued (AVE-98). */
    suspend fun markNotSpam(email: Email) {
        moveEmailToFolder(email, "inbox", setSenderPreference = true)
    }

    /**
     * Verdict toast with Undo. The verdict is already on the server, so Undo
     * calls `sender-rules/undo` instead of cancelling a delayed commit.
     */
    private fun showSpamVerdictUndoToast(message: String, mailboxId: String, undoToken: String) {
        commitPendingActionImmediately()
        val action = UndoableAction(
            message = message,
            execute = {},
            rollback = {
                scope.launch {
                    runCatching { ApiClient.shared.undoSenderVerdict(mailboxId, undoToken) }
                        .onSuccess {
                            loadEmailsForCurrentTab(showLoading = false)
                            refreshReplyLaterCount()
                            showToast("Undone")
                        }
                        .onFailure { showToast("Couldn't undo", isError = true) }
                }
            },
        )
        val actionId = action.id
        _pendingUndoAction.value = action
        showToast(message, isUndo = true, durationMs = 6000)
        pendingUndoJob = scope.launch {
            delay(6000)
            if (_pendingUndoAction.value?.id == actionId) _pendingUndoAction.value = null
        }
    }

    suspend fun approveScreenerSender(email: Email, destinationFolderId: String) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        val sender = email.sender.trim().lowercase()
        if (sender.isEmpty()) return
        try {
            ApiClient.shared.approveSender(
                mailboxId = mailboxId,
                sender = sender,
                destinationFolderId = destinationFolderId,
                emailId = email.id,
                displayName = email.senderName,
            )
            val queued = (_emails.value + _screenerQueue.value).filter {
                it.sender.trim().lowercase() == sender &&
                    (it.folderId == FolderIds.SCREENER || it.id == email.id)
            }.distinctBy { it.id }
            queued.forEach { db.moveEmail(it.id, destinationFolderId) }
            val queuedIds = queued.map { it.id }.toSet()
            _emails.update { list -> list.filterNot { it.id in queuedIds } }
            _screenerQueue.update { list -> list.filterNot { it.id in queuedIds } }
            if (_selectedEmail.value?.id in queuedIds ||
                _selectedEmail.value?.sender?.trim()?.lowercase() == sender
            ) {
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
            }
            loadEmailsForCurrentTab(showLoading = false)
            runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { folders ->
                ifStillSelected(mailboxId) { _folders.value = folders }
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    suspend fun rejectScreenerSender(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        val sender = email.sender.trim().lowercase()
        if (sender.isEmpty()) return
        try {
            ApiClient.shared.rejectSender(
                mailboxId = mailboxId,
                sender = sender,
                emailId = email.id,
                displayName = email.senderName,
            )
            val queued = (_emails.value + _screenerQueue.value).filter {
                it.sender.trim().lowercase() == sender &&
                    (it.folderId == FolderIds.SCREENER || it.id == email.id)
            }.distinctBy { it.id }
            queued.forEach { db.moveEmail(it.id, FolderIds.SCREENED_OUT) }
            val queuedIds = queued.map { it.id }.toSet()
            _emails.update { list -> list.filterNot { it.id in queuedIds } }
            _screenerQueue.update { list -> list.filterNot { it.id in queuedIds } }
            if (_selectedEmail.value?.id in queuedIds ||
                _selectedEmail.value?.sender?.trim()?.lowercase() == sender
            ) {
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
            }
            loadEmailsForCurrentTab(showLoading = false)
            runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { folders ->
                ifStillSelected(mailboxId) { _folders.value = folders }
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    suspend fun markEmailsRead(ids: Set<String>, read: Boolean) {
        val mailboxId = _selectedMailboxId.value ?: return
        ids.forEach { id ->
            db.updateEmailFlags(id, read = read)
            _emails.value.firstOrNull { it.id == id }?.let {
                applyEmailUpdate(
                    it.copy(
                        read = read,
                        threadUnreadCount = if (read) 0 else maxOf(1, it.threadUnreadCount ?: 1),
                        listSection = if (read) "seen" else "new",
                    ),
                )
            }
        }
        ids.forEach { id ->
            try {
                ApiClient.shared.updateEmail(mailboxId, id, read = read)
            } catch (_: Exception) {
            }
        }
    }

    suspend fun starEmails(ids: Set<String>, starred: Boolean) {
        val mailboxId = _selectedMailboxId.value ?: return
        ids.forEach { id ->
            db.updateEmailFlags(id, starred = starred)
            _emails.value.firstOrNull { it.id == id }?.let { applyEmailUpdate(it.copy(starred = starred)) }
        }
        ids.forEach { id ->
            try {
                ApiClient.shared.updateEmail(mailboxId, id, starred = starred)
            } catch (_: Exception) {
            }
        }
    }

    /**
     * Multi-select archive: one undoable action for the whole selection, so Undo restores
     * every row (AVE-163). The server calls run per id inside that single commit.
     */
    suspend fun archiveEmails(ids: Set<String>) {
        val mailboxId = _selectedMailboxId.value ?: return
        val targets = ids.mapNotNull { id -> _emails.value.firstOrNull { it.id == id } }
        if (targets.isEmpty()) return
        if (blockIfReadOnly()) return
        val action = bulkUndoableAction(
            ids = targets.map { it.id },
            message = "Archived",
            perform = { id ->
                ApiClient.shared.moveEmail(mailboxId, id, FolderIds.ARCHIVE)
                db.moveEmail(id, FolderIds.ARCHIVE)
            },
            onFailures = { _, error ->
                loadEmailsForCurrentTab(showLoading = false)
                val ended = noteServiceEnded(error)
                showToast(if (ended) error.message.orEmpty() else "Couldn't archive", isError = true)
            },
            rollback = { scope.launch { loadEmailsForCurrentTab(showLoading = false) } },
        )
        scheduleUndoableAction(
            action = action,
            optimistic = { targets.forEach { removeEmailLocally(it) } },
            pendingMessage = "Archiving...",
        )
    }

    /**
     * Multi-select delete: one undoable action for the whole selection (AVE-163). Each row
     * keeps [deleteEmail]'s Trash-vs-permanent rule.
     */
    suspend fun deleteEmails(ids: Set<String>) {
        val mailboxId = _selectedMailboxId.value ?: return
        val targets = ids.mapNotNull { id -> _emails.value.firstOrNull { it.id == id } }
        if (targets.isEmpty()) return
        if (blockIfReadOnly()) return
        val permanentIds = targets
            .filter { it.isDraft || it.folderId == FolderIds.TRASH }
            .mapTo(mutableSetOf()) { it.id }
        val action = bulkUndoableAction(
            ids = targets.map { it.id },
            message = if (permanentIds.size == targets.size) "Deleted" else "Moved to Trash",
            perform = { id ->
                ApiClient.shared.deleteEmail(mailboxId, id)
                if (id in permanentIds) db.deleteEmail(id) else db.moveEmail(id, FolderIds.TRASH)
            },
            onFailures = { _, error ->
                loadEmailsForCurrentTab(showLoading = false)
                val ended = noteServiceEnded(error)
                showToast(if (ended) error.message.orEmpty() else "Couldn't delete", isError = true)
            },
            rollback = { scope.launch { loadEmailsForCurrentTab(showLoading = false) } },
        )
        scheduleUndoableAction(
            action = action,
            optimistic = { targets.forEach { removeEmailLocally(it) } },
            pendingMessage = "Deleting...",
        )
    }

    fun clearSelectedEmail() {
        _selectedEmail.value = null
        _threadEmails.value = emptyList()
    }

    fun minimizeCompose() {
        val session = _composeSession.value ?: return
        session.form.commitPendingTokens()
        _composeSession.value = ComposeSession(session.form, ComposePresentation.Minimized)
        val form = session.form
        if (!form.isEmpty && form.hasUnsavedChanges) {
            scope.launch {
                if (!form.saveDraft(explicit = false) && !form.isSending) {
                    showToast("Couldn't save draft", isError = true)
                }
            }
        }
    }

    fun expandCompose() {
        val session = _composeSession.value ?: return
        _composeSession.value = ComposeSession(session.form, ComposePresentation.Expanded)
    }

    /**
     * Screener on/off for the selected mailbox (AVE-104). Turning it off moves the
     * server's Screener mail to Inbox; mirror that in the local cache.
     */
    suspend fun setScreenerEnabled(enabled: Boolean): Boolean {
        val wasEnabled = isScreenerEnabled
        val ok = updateMailboxSettings { it.copy(screener = ScreenerSettings(enabled = enabled)) }
        if (!ok || !wasEnabled || enabled) return ok
        val mailboxId = _selectedMailboxId.value ?: return ok
        db.getEmails(mailboxId, FolderIds.SCREENER).forEach { db.moveEmail(it.id, FolderIds.INBOX) }
        _screenerQueue.value = emptyList()
        if ((_selectedTab.value as? HomeTab.Folder)?.id == FolderIds.SCREENER) {
            _selectedTab.value = HomeTab.Folder(FolderIds.INBOX)
        }
        runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { folders ->
            ifStillSelected(mailboxId) { _folders.value = folders }
        }
        loadEmailsForCurrentTab(showLoading = false)
        return ok
    }

    suspend fun updateMailboxSettings(transform: (MailboxSettings) -> MailboxSettings): Boolean {
        val mailboxId = _selectedMailboxId.value ?: return false
        if (blockIfReadOnly()) return false
        val current = selectedMailbox?.settings ?: MailboxSettings()
        val next = transform(current)
        return try {
            val response = ApiClient.shared.updateMailbox(mailboxId, next)
            val previous = _mailboxes.value.firstOrNull { it.id == response.id }
            val updated = response.copy(
                readOnly = response.readOnly ?: previous?.readOnly,
                service = response.service ?: previous?.service,
            )
            _mailboxes.update { list -> list.map { if (it.id == updated.id) updated else it } }
            db.upsertMailboxes(listOf(updated))
            true
        } catch (e: Exception) {
            noteServiceEnded(e)
            _errorMessage.value = e.message
            false
        }
    }

    fun closeCompose() {
        _composeSession.value?.form?.cancelAutoSave()
        _composeSession.value = null
    }

    fun openChatSession(existingId: String? = null, resumeActive: Boolean = true, forceNew: Boolean = false) {
        if (!existingId.isNullOrEmpty() && existingId != AUTO_CONVERSATION_ID) {
            _chatSession.value = ChatSession.Conversation(existingId)
            if (isKnownConversation(existingId)) _activeConversationId.value = existingId
            return
        }
        if (forceNew) {
            _chatSession.value = ChatSession.Conversation(ChatSession.newConversationId())
            return
        }
        if (resumeActive) {
            validatedActiveConversationId()?.let {
                _chatSession.value = ChatSession.Conversation(it)
                return
            }
        }
        _chatSession.value = ChatSession.Conversation(ChatSession.newConversationId())
    }

    // ---- AI usage (AVE-45) ----

    private val _aiUsage = MutableStateFlow<AiUsageSnapshot?>(null)
    /** Today's AI usage for the selected mailbox; null until fetched (or on failure). */
    val aiUsage: StateFlow<AiUsageSnapshot?> = _aiUsage.asStateFlow()

    /** DEBUG preview fixture: when set, [refreshAiUsage] serves it instead of the network. */
    private var previewAiUsage: AiUsageSnapshot? = null

    fun applyPreviewAiUsage(snapshot: AiUsageSnapshot) {
        previewAiUsage = snapshot
        _aiUsage.value = snapshot
    }

    /** Fetch today's usage for the selected mailbox. Failures keep the last value. */
    suspend fun refreshAiUsage() {
        if (isDebugPreview) {
            previewAiUsage?.let { _aiUsage.value = it }
            return
        }
        val mailboxId = _selectedMailboxId.value ?: return
        val usage = runCatching { ApiClient.shared.getAiUsage(mailboxId) }.getOrNull() ?: return
        // Drop a late reply for a mailbox the user already left.
        if (_selectedMailboxId.value == mailboxId) _aiUsage.value = usage
    }

    fun showChatList() {
        _chatSession.value = ChatSession.List
    }

    fun startNewChat() = openChatSession(forceNew = true)

    fun dismissChatSession() {
        _chatSession.value = ChatSession.Dismissed
    }

    /** Titles empty chats from the first user message; deletes empty duplicates. */
    suspend fun pruneEmptyConversations(authToken: String? = ApiClient.shared.authTokenProvider()) {
        val mailboxId = _selectedMailboxId.value ?: return
        val preserve = pendingConversationIds.toMutableSet()
        _activeConversationId.value?.let { preserve.add(it) }
        _chatSession.value.conversationId?.let { preserve.add(it) }

        val visible = _conversations.value.filter { it.id != AUTO_CONVERSATION_ID }

        for (conv in visible.filter { it.title == "New chat" }.take(8)) {
            if (conv.id in preserve) continue
            val msgs = AgentChatClient.fetchMessages(mailboxId, conv.id, authToken) ?: continue
            // update/delete below act on the selected mailbox; stop if it changed.
            if (!isSelected(mailboxId)) return
            val firstUser = msgs.firstOrNull { it.role == "user" && it.text.isNotEmpty() }
            if (firstUser != null) {
                val derived = ConversationTitleHelper.deriveTitle(firstUser.text)
                val lastText = msgs.lastOrNull()?.text ?: firstUser.text
                updateConversation(conv.id, derived, lastText.take(120))
            } else if (msgs.isEmpty()) {
                deleteConversation(conv.id)
            }
        }

        val grouped = _conversations.value
            .filter { it.id != AUTO_CONVERSATION_ID }
            .groupBy { it.title.trim().lowercase() }
        for ((_, group) in grouped) {
            if (group.size <= 1) continue
            for (conv in group) {
                if (conv.id in preserve) continue
                val msgs = AgentChatClient.fetchMessages(mailboxId, conv.id, authToken) ?: continue
                if (!isSelected(mailboxId)) return
                if (msgs.isEmpty()) deleteConversation(conv.id)
            }
        }
    }

    fun dismissChat() = dismissChatSession()

    fun notePendingConversation(id: String, title: String, lastMessagePreview: String?) {
        pendingConversationIds.add(id)
        val now = Instant.now().toString()
        upsertLocalConversation(
            AgentConversation(id, title, now, now, lastMessagePreview),
        )
    }

    suspend fun createConversation(
        id: String? = null,
        title: String? = null,
        lastMessagePreview: String? = null,
    ): AgentConversation? {
        val mailboxId = _selectedMailboxId.value ?: return null
        val targetId = id ?: ChatSession.newConversationId()
        if (targetId == AUTO_CONVERSATION_ID) return null
        val finalTitle = title?.trim()?.takeIf { it.isNotEmpty() } ?: "New chat"
        val now = Instant.now().toString()
        val optimistic = AgentConversation(targetId, finalTitle, now, now, lastMessagePreview)
        upsertLocalConversation(optimistic)
        pendingConversationIds.add(targetId)
        return try {
            val created = ApiClient.shared.createConversation(mailboxId, targetId, finalTitle, lastMessagePreview)
            if (!isSelected(mailboxId)) return created
            if (created.id == targetId) {
                upsertLocalConversation(created)
                pendingConversationIds.remove(targetId)
                created
            } else {
                _conversations.update { it.filterNot { c -> c.id == created.id } }
                pendingConversationIds.remove(created.id)
                runCatching { ApiClient.shared.deleteConversation(mailboxId, created.id) }
                _conversations.value.firstOrNull { it.id == targetId } ?: optimistic
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
            optimistic
        }
    }

    suspend fun refreshConversations() {
        val mailboxId = _selectedMailboxId.value ?: return
        try {
            val server = ApiClient.shared.listConversations(mailboxId)
            if (!isSelected(mailboxId)) return
            val visible = visibleConversations(server)
            val serverIds = visible.map { it.id }.toSet()
            pendingConversationIds.retainAll { it !in serverIds }
            val inFlight = _conversations.value.filter {
                it.id in pendingConversationIds && it.id !in serverIds
            }
            _conversations.value = visible
            inFlight.asReversed().forEach { local ->
                if (_conversations.value.none { it.id == local.id }) {
                    _conversations.value = listOf(local) + _conversations.value
                }
            }
            dropStaleActiveConversation()
        } catch (e: Exception) {
            ifStillSelected(mailboxId) { _errorMessage.value = e.message }
        }
    }

    suspend fun updateConversation(
        id: String,
        title: String? = null,
        lastMessagePreview: String? = null,
    ): AgentConversation? {
        val mailboxId = _selectedMailboxId.value ?: return null
        applyLocalConversationUpdate(id, title, lastMessagePreview)
        return try {
            val updated = ApiClient.shared.updateConversation(mailboxId, id, title, lastMessagePreview)
            ifStillSelected(mailboxId) { upsertLocalConversation(updated) }
            updated
        } catch (e: ApiException.Http) {
            // Re-creating would land in whichever mailbox is selected now.
            if (e.code == 404 && isSelected(mailboxId)) {
                val local = _conversations.value.firstOrNull { it.id == id }
                createConversation(id, title ?: local?.title, lastMessagePreview ?: local?.lastMessagePreview)
            } else null
        } catch (_: Exception) {
            null
        }
    }

    suspend fun deleteConversation(id: String) {
        val mailboxId = _selectedMailboxId.value ?: return
        _conversations.update { it.filterNot { c -> c.id == id } }
        pendingConversationIds.remove(id)
        if (_activeConversationId.value == id) _activeConversationId.value = null
        if (_chatSession.value.conversationId == id) _chatSession.value = ChatSession.List
        try {
            ApiClient.shared.deleteConversation(mailboxId, id)
        } catch (e: Exception) {
            _errorMessage.value = e.message
            refreshConversations()
        }
    }

    suspend fun notifyAIToolCompleted() {
        val mailboxId = _selectedMailboxId.value ?: return
        runCatching { MailboxSyncService.syncFolder(mailboxId, "draft") }
        if (!isSelected(mailboxId)) return
        if (_selectedTab.value.syncFolderId != null) {
            loadEmailsForCurrentTab(showLoading = false)
        }
        if (isSelected(mailboxId) && _selectedTab.value is HomeTab.AiInbox) {
            loadInboxDigest(showLoading = false)
        }
    }

    private fun upsertLocalConversation(conversation: AgentConversation) {
        _conversations.update { list ->
            val without = list.filterNot { it.id == conversation.id }
            listOf(conversation) + without
        }
    }

    private fun applyLocalConversationUpdate(id: String, title: String?, lastMessagePreview: String?) {
        _conversations.update { list ->
            val idx = list.indexOfFirst { it.id == id }
            if (idx < 0) return@update list
            val updated = list[idx].copy(
                title = title?.takeIf { it.isNotEmpty() } ?: list[idx].title,
                lastMessagePreview = lastMessagePreview ?: list[idx].lastMessagePreview,
                updatedAt = Instant.now().toString(),
            )
            listOf(updated) + list.filterIndexed { i, _ -> i != idx }
        }
    }

    private fun isKnownConversation(id: String) =
        id in pendingConversationIds || _conversations.value.any { it.id == id }

    private fun validatedActiveConversationId(): String? {
        dropStaleActiveConversation()
        return _activeConversationId.value
    }

    private fun dropStaleActiveConversation() {
        val active = _activeConversationId.value ?: return
        if (!isKnownConversation(active)) _activeConversationId.value = null
    }

    companion object {
        private const val AUTO_CONVERSATION_ID = "auto"
        private const val PUSH_UNREGISTER_TIMEOUT_MS = 4_000L
        /** Quiet period before the widget snapshot is written (iOS uses 1 s too). */
        private const val INBOX_WIDGET_DEBOUNCE_MS = 1_000L

        /** "Added to Reply Later · Add reminder" stays up longer than a plain toast (AVE-86). */
        const val REMINDER_TOAST_DURATION_MS = 5_000L

        private fun visibleConversations(conversations: List<AgentConversation>) =
            conversations.filter { it.id != AUTO_CONVERSATION_ID }

        /** Inbox New then Seen (by list section), each by date DESC. */
        fun orderNewThenSeen(emails: List<Email>): List<Email> = EmailPaging.orderNewThenSeen(emails)
    }
}

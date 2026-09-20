package co.inboxies.app.services

import co.inboxies.app.models.AgentConversation
import co.inboxies.app.models.AppToast
import co.inboxies.app.models.ChatSession
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.ComposePresentation
import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.InboxDigest
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
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

    private val _folders = MutableStateFlow<List<Folder>>(emptyList())
    val folders: StateFlow<List<Folder>> = _folders.asStateFlow()

    private val _selectedTab = MutableStateFlow<HomeTab>(HomeTab.AiInbox)
    val selectedTab: StateFlow<HomeTab> = _selectedTab.asStateFlow()

    private val _emails = MutableStateFlow<List<Email>>(emptyList())
    val emails: StateFlow<List<Email>> = _emails.asStateFlow()

    private val _replyLaterCount = MutableStateFlow(0)
    val replyLaterCount: StateFlow<Int> = _replyLaterCount.asStateFlow()

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

    private var toastDismissJob: Job? = null
    private var pendingUndoJob: Job? = null

    val selectedMailbox: Mailbox?
        get() = _mailboxes.value.firstOrNull { it.id == _selectedMailboxId.value }

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
    }

    suspend fun bootstrap(authToken: String?) {
        ApiClient.shared.authTokenProvider = { authToken }
        val cached = db.getMailboxes()
        if (cached.isNotEmpty()) {
            _mailboxes.value = cached
            if (_selectedMailboxId.value == null) _selectedMailboxId.value = cached.first().id
            _isMailboxLoading.value = false
            _selectedMailboxId.value?.let { id ->
                val folders = db.getFolders(id)
                if (folders.isNotEmpty()) _folders.value = folders
                _selectedTab.value.syncFolderId?.let { folderId ->
                    val emails = db.getEmails(id, folderId, 50)
                    if (emails.isNotEmpty()) {
                        _emails.value = emails
                        _isLoading.value = false
                    }
                }
            }
        }
        setupRealTimeStream()
        refreshMailboxes(showLoading = _emails.value.isEmpty())
    }

    private fun setupRealTimeStream() {
        val mailboxId = _selectedMailboxId.value ?: return
        streamClient.onNewEmailReceived = { email ->
            scope.launch { handleIncomingRealTimeEmail(email) }
        }
        streamClient.onSyncRequested = {
            scope.launch { refreshCurrentTabSilently() }
        }
        streamClient.start(mailboxId)
        PushNotificationManager.shared.requestPermissionAndRegister(mailboxId)
    }

    private suspend fun handleIncomingRealTimeEmail(email: Email) {
        val currentFolder = _selectedTab.value.syncFolderId
        if (currentFolder != null) {
            val target = email.folderId ?: "inbox"
            if (target.equals(currentFolder, ignoreCase = true) &&
                _emails.value.none { it.id == email.id }
            ) {
                _emails.value = listOf(email) + _emails.value
            }
            if (_selectedTab.value is HomeTab.AiInbox) {
                loadInboxDigest(showLoading = false)
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
                me.mailDomain?.takeIf { it.isNotBlank() }?.let { _mailDomain.value = it }
                if (me.domains.isNotEmpty()) _domains.value = me.domains
            }
            val list = ApiClient.shared.listMailboxes()
            val previous = _mailboxes.value.associateBy { it.id }
            val merged = list.map { incoming ->
                val existing = previous[incoming.id]
                if (incoming.settings == null && existing?.settings != null) {
                    incoming.copy(settings = existing.settings)
                } else {
                    incoming
                }
            }
            _mailboxes.value = merged
            db.upsertMailboxes(merged)
            val selected = _selectedMailboxId.value
            if (selected != null && list.none { it.id == selected }) {
                _selectedMailboxId.value = list.firstOrNull()?.id
            }
            if (_selectedMailboxId.value == null) {
                _selectedMailboxId.value = list.firstOrNull()?.id
            }
            _isMailboxLoading.value = false
            _selectedMailboxId.value?.let { loadMailbox(it) } ?: run { _isLoading.value = false }
        } catch (e: Exception) {
            _errorMessage.value = e.message
            _isLoading.value = false
            _isMailboxLoading.value = false
        }
    }

    suspend fun createMailbox(name: String, email: String) {
        try {
            ApiClient.shared.createMailbox(name, email)
            refreshMailboxes(showLoading = true)
            showToast("Mailbox created")
        } catch (e: Exception) {
            showToast("Failed to create mailbox: ${e.message}", isError = true)
        }
    }

    suspend fun loadMailbox(id: String) {
        if (_selectedMailboxId.value != id) {
            _activeConversationId.value = null
            pendingConversationIds.clear()
            _conversations.value = emptyList()
            _inboxDigest.value = null
            if (_chatSession.value !is ChatSession.Dismissed) {
                _chatSession.value = ChatSession.Dismissed
            }
        }
        _selectedMailboxId.value = id
        setupRealTimeStream()

        val cachedFolders = db.getFolders(id)
        if (cachedFolders.isNotEmpty()) {
            _folders.value = cachedFolders
            _isMailboxLoading.value = false
        }
        _selectedTab.value.syncFolderId?.let { folderId ->
            val cached = db.getEmails(id, folderId, 50)
            if (cached.isNotEmpty()) {
                _emails.value = cached
                _isLoading.value = false
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
            } catch (e: ApiException.Http) {
                if (e.code == 403 || e.code == 404) {
                    dropInaccessibleMailbox(id)
                    return
                }
                throw e
            }
            _isMailboxLoading.value = false
            _folders.value = MailboxSyncService.syncMailbox(id)
            runCatching { ApiClient.shared.listConversations(id) }.getOrNull()?.let { server ->
                _conversations.value = visibleConversations(server)
                dropStaleActiveConversation()
            }
            loadEmailsForCurrentTab(showLoading = _emails.value.isEmpty())
            if (_selectedTab.value is HomeTab.AiInbox) {
                loadInboxDigest(showLoading = _inboxDigest.value == null)
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
            _isMailboxLoading.value = false
            _isLoading.value = false
        } finally {
            _isSyncing.value = false
        }
    }

    private suspend fun dropInaccessibleMailbox(id: String) {
        db.deleteMailbox(id)
        _mailboxes.update { it.filterNot { m -> m.id == id } }
        if (_selectedMailboxId.value == id) {
            _selectedMailboxId.value = _mailboxes.value.firstOrNull()?.id
        }
        _isMailboxLoading.value = false
        val next = _selectedMailboxId.value
        if (next != null && next != id) {
            loadMailbox(next)
        } else {
            _emails.value = emptyList()
            _folders.value = emptyList()
            _inboxDigest.value = null
            _conversations.value = emptyList()
            _activeConversationId.value = null
            _isLoading.value = false
        }
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

    suspend fun selectTab(tab: HomeTab) {
        _selectedTab.value = tab
        _selectedEmail.value = null
        tab.syncFolderId?.let { folderId ->
            _selectedMailboxId.value?.let { mailboxId ->
                val cached = db.getEmails(mailboxId, folderId, 50)
                if (cached.isNotEmpty()) {
                    _emails.value = cached
                    _isLoading.value = false
                } else {
                    _isLoading.value = true
                }
            }
        }
        loadEmailsForCurrentTab(showLoading = _emails.value.isEmpty())
        if (tab is HomeTab.AiInbox) {
            loadInboxDigest(showLoading = _inboxDigest.value == null)
        }
    }

    suspend fun loadEmailsForCurrentTab(showLoading: Boolean = true) {
        val mailboxId = _selectedMailboxId.value
        if (mailboxId == null) {
            _isLoading.value = false
            return
        }

        if (_selectedTab.value is HomeTab.ReplyLater) {
            if (showLoading && _emails.value.isEmpty()) _isLoading.value = true
            _isSyncing.value = true
            try {
                val response = ApiClient.shared.listReplyLaterEmails(mailboxId)
                _emails.value = response.emails
                _replyLaterCount.value = response.totalCount
            } catch (e: Exception) {
                if (_emails.value.isEmpty()) _errorMessage.value = e.message
            } finally {
                _isLoading.value = false
                _isSyncing.value = false
            }
            return
        }

        val folderId = _selectedTab.value.syncFolderId
        if (folderId == null) {
            _emails.value = emptyList()
            _isLoading.value = false
            return
        }
        val cached = db.getEmails(mailboxId, folderId, 50)
        if (cached.isNotEmpty()) {
            _emails.value = if (folderId == FolderIds.INBOX) orderNewThenSeen(cached) else cached
            _isLoading.value = false
        } else if (showLoading) {
            _isLoading.value = true
        }
        _isSyncing.value = true
        try {
            val synced = MailboxSyncService.syncFolder(mailboxId, folderId)
            _emails.value = if (folderId == FolderIds.INBOX) orderNewThenSeen(synced) else synced
            refreshReplyLaterCount()
        } catch (e: Exception) {
            if (_emails.value.isEmpty()) _errorMessage.value = e.message
        } finally {
            _isLoading.value = false
            _isSyncing.value = false
        }
    }

    suspend fun refreshReplyLaterCount() {
        val mailboxId = _selectedMailboxId.value ?: run {
            _replyLaterCount.value = 0
            return
        }
        try {
            val piles = ApiClient.shared.listWorkflowPiles(mailboxId)
            _replyLaterCount.value = piles.piles.firstOrNull { it.id == "reply_later" }?.count ?: 0
        } catch (_: Exception) {
        }
    }

    suspend fun refreshCurrentTab() {
        when (val tab = _selectedTab.value) {
            is HomeTab.Folder, is HomeTab.AiInbox, is HomeTab.ReplyLater -> {
                loadEmailsForCurrentTab(showLoading = false)
                if (tab is HomeTab.AiInbox) loadInboxDigest(showLoading = false)
            }
            is HomeTab.Chats -> refreshConversations()
        }
    }

    suspend fun refreshCurrentTabSilently() {
        val mailboxId = _selectedMailboxId.value ?: return
        val folderId = _selectedTab.value.syncFolderId
        if (folderId != null) {
            runCatching { MailboxSyncService.syncFolder(mailboxId, folderId) }.getOrNull()?.let {
                _emails.value = it
            }
            if (_selectedTab.value is HomeTab.AiInbox) {
                loadInboxDigest(showLoading = false)
            }
        }
        refreshOpenEmailDetailSilently()
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
                if (_selectedEmail.value?.id == email.id ||
                    _selectedEmail.value?.threadId == threadId
                ) {
                    _threadEmails.value = remote
                    remote.firstOrNull { it.id == email.id }?.let { updated ->
                        _selectedEmail.value = mergeListMetadata(email, updated)
                    }
                }
            } else {
                val full = ApiClient.shared.getEmail(mailboxId, email.id)
                db.upsertEmails(mailboxId, listOf(full), defaultFolder = email.folderId)
                if (_selectedEmail.value?.id == email.id) {
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
            _inboxDigest.value = ApiClient.shared.getInboxDigest(mailboxId)
        } catch (e: Exception) {
            if (_inboxDigest.value == null) _errorMessage.value = e.message
        } finally {
            _isDigestLoading.value = false
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
                    if (_selectedEmail.value?.id == email.id ||
                        _selectedEmail.value?.threadId == email.threadId
                    ) {
                        _threadEmails.value = remote
                    }
                } else if (!hasBody) {
                    val full = ApiClient.shared.getEmail(mailboxId, email.id)
                    db.upsertEmails(mailboxId, listOf(full), defaultFolder = email.folderId)
                    if (_selectedEmail.value?.id == email.id) {
                        _selectedEmail.value = mergeListMetadata(email, full)
                        _threadEmails.value = listOf(full)
                    }
                }
            } catch (_: Exception) {
            } finally {
                _isEmailDetailLoading.value = false
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
                showToast("Couldn’t open email", isError = true)
                return
            }

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
                scope.launch { loadEmailsForCurrentTab(showLoading = false) }
            }
        }

        openEmail(resolved)
    }

    suspend fun openDraft(draft: Email) {
        val original = resolveReplyOriginal(draft)
        val mode = if (original != null || !draft.inReplyTo.isNullOrEmpty()) {
            ComposeMode.Reply
        } else {
            ComposeMode.EditDraft
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
        if (mailbox.settings == null) {
            runCatching { ApiClient.shared.getMailbox(mailbox.id) }.getOrNull()?.let { detailed ->
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
        val form = ComposeFormModel(
            mode = mode,
            mailbox = mailbox,
            original = enrichedOriginal ?: original,
            draft = enrichedDraft ?: draft,
            initialTo = initialTo,
        )
        _composeSession.value = ComposeSession(form, ComposePresentation.Expanded)
        _selectedEmail.value = null
    }

    fun closeEmail() {
        _selectedEmail.value = null
        _threadEmails.value = emptyList()
        _isEmailDetailLoading.value = false
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
        durationMs: Long = 2500,
    ) {
        toastDismissJob?.cancel()
        _toast.value = AppToast(message = message, isError = isError, isLoading = isLoading, isUndo = isUndo)
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

    fun reset() {
        streamClient.stop()
        _mailboxes.value = emptyList()
        _selectedMailboxId.value = null
        _folders.value = emptyList()
        _emails.value = emptyList()
        _inboxDigest.value = null
        _selectedEmail.value = null
        _threadEmails.value = emptyList()
        _composeSession.value = null
        _chatSession.value = ChatSession.Dismissed
        _conversations.value = emptyList()
        _isMailboxLoading.value = true
        _isLoading.value = true
        _isAdmin.value = false
        _pendingInviteToken.value = null
        _errorMessage.value = null
        _toast.value = null
        isDebugPreview = false
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
    ) {
        streamClient.stop()
        isDebugPreview = true
        _mailboxes.value = mailboxes
        _selectedMailboxId.value = selectedMailboxId
        _folders.value = folders
        _emails.value = emails
        _selectedTab.value = selectedTab
        _selectedEmail.value = selectedEmail
        _threadEmails.value = threadEmails
        _replyLaterCount.value = replyLaterCount
        _isAdmin.value = isAdmin
        _inboxDigest.value = null
        _composeSession.value = null
        _chatSession.value = ChatSession.Dismissed
        _conversations.value = emptyList()
        _pendingInviteToken.value = null
        _errorMessage.value = null
        _toast.value = null
        _isMailboxLoading.value = false
        _isLoading.value = false
    }

    /** When true, UI must not call [bootstrap] / real-time sync (DEBUG preview fixtures). */
    @Volatile
    var isDebugPreview: Boolean = false
        private set

    fun updateComposeFromMailbox(mailboxId: String) {
        val session = _composeSession.value ?: return
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
        showToast("Sending…", isLoading = true)
        try {
            runCatching {
                form.commitPendingTokens()
                if (form.toTokens.isEmpty()) error("Add at least one recipient.")
                val mailboxId = form.fromMailboxId.ifBlank {
                    _selectedMailboxId.value ?: error("No mailbox")
                }
                val html = form.bodyHtml
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
                    ComposeMode.Reply -> {
                        val origId = form.original?.id ?: error("Missing original")
                        ApiClient.shared.replyToEmail(mailboxId, origId, payload)
                    }
                    ComposeMode.ReplyAll -> {
                        val origId = form.original?.id ?: error("Missing original")
                        ApiClient.shared.replyToEmail(mailboxId, origId, payload)
                    }
                    ComposeMode.Forward -> {
                        val origId = form.original?.id ?: error("Missing original")
                        ApiClient.shared.forwardEmail(mailboxId, origId, payload)
                    }
                    else -> ApiClient.shared.sendEmail(mailboxId, payload)
                }
            }.onSuccess {
                showToast("Sent")
                closeCompose()
                refreshCurrentTabSilently()
            }.onFailure {
                showToast(it.message ?: "Send failed", isError = true)
            }
        } finally {
            form.isSending = false
        }
    }

    fun saveDraft() {
        scope.launch {
            _composeSession.value?.form?.saveDraft(explicit = true)
            showToast("Draft saved")
        }
    }

    fun scheduleUndoableAction(
        optimistic: () -> Unit,
        commit: suspend () -> Unit,
        rollback: () -> Unit,
        pendingMessage: String?,
        completedMessage: String,
    ) {
        optimistic()
        commitPendingActionImmediately()
        val action = UndoableAction(message = completedMessage, execute = commit, rollback = rollback)
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
        applyEmailUpdate(
            target.copy(
                replyLater = next,
                replyLaterAt = if (next) java.time.Instant.now().toString() else null,
            ),
        )
        runCatching {
            ApiClient.shared.updateEmail(mailboxId, target.id, replyLater = next)
        }.onFailure {
            // Roll back optimistic update on failure
            db.updateEmailFlags(target.id, replyLater = !next)
            applyEmailUpdate(target)
        }
        refreshReplyLaterCount()
        if (_selectedTab.value is HomeTab.ReplyLater) {
            loadEmailsForCurrentTab(showLoading = false)
        }
    }

    suspend fun setReplyLater(ids: Set<String>, replyLater: Boolean) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (ids.isEmpty()) return
        for (id in ids) {
            runCatching {
                ApiClient.shared.updateEmail(mailboxId, id, replyLater = replyLater)
            }.onSuccess { applyEmailUpdate(it) }
        }
        refreshReplyLaterCount()
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
            val mapped = list.map {
                if (it.id != updated.id) it
                else it.copy(
                    read = updated.read,
                    starred = updated.starred,
                    threadUnreadCount = if (updated.read) 0 else it.threadUnreadCount,
                    listSection = if (updated.read) "seen" else "new",
                )
            }
            if (_selectedTab.value.syncFolderId == FolderIds.INBOX) orderNewThenSeen(mapped) else mapped
        }
        if (previous != null) {
            adjustFolderUnread(previous, wasUnread = !previous.read, isUnread = !updated.read)
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

    suspend fun deleteEmail(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        scheduleUndoableAction(
            optimistic = { removeEmailLocally(email) },
            commit = {
                db.deleteEmail(email.id)
                db.enqueueMutation(mailboxId, email.id, "delete")
                OutboxQueueWorker.trigger()
            },
            rollback = { scope.launch { loadEmailsForCurrentTab(showLoading = false) } },
            pendingMessage = "Deleting...",
            completedMessage = "Deleted",
        )
    }

    suspend fun archiveEmail(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        scheduleUndoableAction(
            optimistic = { removeEmailLocally(email) },
            commit = {
                db.moveEmail(email.id, "archive")
                db.enqueueMutation(mailboxId, email.id, "move", mapOf("folderId" to "archive"))
                OutboxQueueWorker.trigger()
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
    ) {
        val mailboxId = _selectedMailboxId.value ?: return
        db.moveEmail(email.id, folderId)
        removeEmailLocally(email)
        runCatching {
            ApiClient.shared.moveEmail(
                mailboxId,
                email.id,
                folderId,
                setSenderPreference = setSenderPreference,
            )
        }.onFailure {
            showToast("Couldn't sync move", isError = true)
        }
        if (folderId == "trash" || folderId == "spam") {
            refreshReplyLaterCount()
            if (_selectedTab.value is HomeTab.ReplyLater) {
                loadEmailsForCurrentTab(showLoading = false)
            }
        }
    }

    suspend fun approveScreenerSender(email: Email, destinationFolderId: String) {
        val mailboxId = _selectedMailboxId.value ?: return
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
            val queued = _emails.value.filter {
                it.sender.trim().lowercase() == sender &&
                    (it.folderId == FolderIds.SCREENER || it.id == email.id)
            }
            queued.forEach { db.moveEmail(it.id, destinationFolderId) }
            val queuedIds = queued.map { it.id }.toSet()
            _emails.update { list -> list.filterNot { it.id in queuedIds } }
            if (_selectedEmail.value?.id in queuedIds ||
                _selectedEmail.value?.sender?.trim()?.lowercase() == sender
            ) {
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
            }
            loadEmailsForCurrentTab(showLoading = false)
            runCatching { _folders.value = MailboxSyncService.syncMailbox(mailboxId) }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    suspend fun rejectScreenerSender(email: Email) {
        val mailboxId = _selectedMailboxId.value ?: return
        val sender = email.sender.trim().lowercase()
        if (sender.isEmpty()) return
        try {
            ApiClient.shared.rejectSender(
                mailboxId = mailboxId,
                sender = sender,
                emailId = email.id,
                displayName = email.senderName,
            )
            val queued = _emails.value.filter {
                it.sender.trim().lowercase() == sender &&
                    (it.folderId == FolderIds.SCREENER || it.id == email.id)
            }
            queued.forEach { db.moveEmail(it.id, FolderIds.SCREENED_OUT) }
            val queuedIds = queued.map { it.id }.toSet()
            _emails.update { list -> list.filterNot { it.id in queuedIds } }
            if (_selectedEmail.value?.id in queuedIds ||
                _selectedEmail.value?.sender?.trim()?.lowercase() == sender
            ) {
                _selectedEmail.value = null
                _threadEmails.value = emptyList()
            }
            loadEmailsForCurrentTab(showLoading = false)
            runCatching { _folders.value = MailboxSyncService.syncMailbox(mailboxId) }
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

    suspend fun archiveEmails(ids: Set<String>) {
        ids.mapNotNull { id -> _emails.value.firstOrNull { it.id == id } }.forEach { archiveEmail(it) }
    }

    suspend fun deleteEmails(ids: Set<String>) {
        ids.mapNotNull { id -> _emails.value.firstOrNull { it.id == id } }.forEach { deleteEmail(it) }
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
            scope.launch { form.saveDraft(explicit = false) }
        }
    }

    fun expandCompose() {
        val session = _composeSession.value ?: return
        _composeSession.value = ComposeSession(session.form, ComposePresentation.Expanded)
    }

    suspend fun updateMailboxSettings(transform: (MailboxSettings) -> MailboxSettings): Boolean {
        val mailboxId = _selectedMailboxId.value ?: return false
        val current = selectedMailbox?.settings ?: MailboxSettings()
        val next = transform(current)
        return try {
            val updated = ApiClient.shared.updateMailbox(mailboxId, next)
            _mailboxes.update { list -> list.map { if (it.id == updated.id) updated else it } }
            db.upsertMailboxes(listOf(updated))
            true
        } catch (e: Exception) {
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
            _errorMessage.value = e.message
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
            upsertLocalConversation(updated)
            updated
        } catch (e: ApiException.Http) {
            if (e.code == 404) {
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
        _selectedTab.value.syncFolderId?.let { folderId ->
            runCatching { MailboxSyncService.syncFolder(mailboxId, folderId) }
            loadEmailsForCurrentTab(showLoading = false)
        }
        if (_selectedTab.value is HomeTab.AiInbox) {
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

        private fun visibleConversations(conversations: List<AgentConversation>) =
            conversations.filter { it.id != AUTO_CONVERSATION_ID }

        /** Inbox New (unread) then Seen, each by date DESC. */
        fun orderNewThenSeen(emails: List<Email>): List<Email> {
            val (newEmails, seenEmails) = emails.partition { it.isUnread }
            fun byDateDesc(a: Email, b: Email) = b.date.compareTo(a.date)
            return newEmails.sortedWith(::byDateDesc) + seenEmails.sortedWith(::byDateDesc)
        }
    }
}

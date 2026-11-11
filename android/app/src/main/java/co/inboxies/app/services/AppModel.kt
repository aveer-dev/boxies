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
import co.inboxies.app.models.EmailListResponse
import co.inboxies.app.models.ScreenerDecision
import co.inboxies.app.models.SpamVerdictToast
import co.inboxies.app.models.ThreadNote
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.PileIds
import co.inboxies.app.models.WorkflowPile
import co.inboxies.app.models.InboxDigest
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.MailTag
import co.inboxies.app.models.TagRef
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

    /**
     * Inbox page 1 landed. Its `newCount` is also the Inbox's unread count (the same Worker
     * count, AVE-228), so the header and the folder list move with it.
     */
    private fun rememberInboxNewCount(scope: EmailListScope, count: Int?) {
        if (scope.folderId != FolderIds.INBOX) return
        _inboxNewTotal.value = count?.let { InboxNewTotal(scope, it) }
        if (count != null && scope.mailboxId == _selectedMailboxId.value) setInboxUnread(count)
    }

    /** Sets the Inbox folder's unread count without touching [_inboxNewTotal]. */
    private fun setInboxUnread(count: Int) {
        val current = _folders.value.firstOrNull { it.id == FolderIds.INBOX } ?: return
        if (current.unreadCount == count) return
        val delta = count - current.unreadCount
        _folders.update { list -> list.map { if (it.id == FolderIds.INBOX) it.copy(unreadCount = count) else it } }
        val mailboxId = _selectedMailboxId.value ?: return
        scope.launch { db.updateFolderUnread(mailboxId, FolderIds.INBOX, delta) }
    }

    /** Mailbox whose [folders] came from the server this session; the widget trusts only those. */
    @Volatile
    private var foldersSyncedMailboxId: String? = null

    /** Server folder list for [mailboxId]: counts are authoritative, the Inbox's is New. */
    private fun applyServerFolders(mailboxId: String, fresh: List<Folder>) {
        ifStillSelected(mailboxId) {
            _folders.value = fresh
            foldersSyncedMailboxId = mailboxId
            val inbox = fresh.firstOrNull { it.id == FolderIds.INBOX }
            val total = _inboxNewTotal.value
            if (inbox != null && total != null && total.scope.mailboxId == mailboxId) {
                _inboxNewTotal.value = total.copy(count = inbox.unreadCount)
            }
        }
    }

    private var folderCountsJob: Job? = null

    /**
     * Live mail / a sync nudge / back to the foreground: re-read folder counts shortly. A new
     * message in an unread conversation doesn't add an unread conversation, so counting
     * locally would drift (AVE-228).
     */
    fun scheduleFolderCountsRefresh() {
        if (isDebugPreview || bootstrappedToken == null) return
        val mailboxId = _selectedMailboxId.value ?: return
        folderCountsJob?.cancel()
        folderCountsJob = scope.launch {
            delay(FOLDER_COUNTS_DEBOUNCE_MS)
            runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { fresh ->
                applyServerFolders(mailboxId, fresh)
            }
        }
    }

    private val _replyLaterCount = MutableStateFlow(0)
    val replyLaterCount: StateFlow<Int> = _replyLaterCount.asStateFlow()

    /** Set Aside pile size (AVE-201): workflow-piles `set_aside.count`, 0 on older Workers. */
    private val _setAsideCount = MutableStateFlow(0)
    val setAsideCount: StateFlow<Int> = _setAsideCount.asStateFlow()

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

    /** The mailbox's tags (AVE-242), sorted by name, with unread counts. */
    private val _tags = MutableStateFlow<List<MailTag>>(emptyList())
    val tags: StateFlow<List<MailTag>> = _tags.asStateFlow()

    /** Conversation the tag picker is open for (reader, row menu, actions sheet). */
    private val _tagPickerEmail = MutableStateFlow<Email?>(null)
    val tagPickerEmail: StateFlow<Email?> = _tagPickerEmail.asStateFlow()

    /** Phone home's Tags sheet (folders menu → Tags). */
    private val _showsTagList = MutableStateFlow(false)
    val showsTagList: StateFlow<Boolean> = _showsTagList.asStateFlow()

    /** Piles people made (AVE-194), in the Worker's order, with their counts. */
    private val _customPiles = MutableStateFlow<List<WorkflowPile>>(emptyList())
    val customPiles: StateFlow<List<WorkflowPile>> = _customPiles.asStateFlow()

    /** Mail the Move to pile picker is open for (row menu, actions sheet). */
    private val _pilePickerEmail = MutableStateFlow<Email?>(null)
    val pilePickerEmail: StateFlow<Email?> = _pilePickerEmail.asStateFlow()

    /** Phone home's Piles sheet (folders menu → Piles). */
    private val _showsPileList = MutableStateFlow(false)
    val showsPileList: StateFlow<Boolean> = _showsPileList.asStateFlow()

    /** A pile view asked for from outside home's tab state (reader chip); home opens it. */
    private val _pileViewRequest = MutableStateFlow<String?>(null)
    val pileViewRequest: StateFlow<String?> = _pileViewRequest.asStateFlow()

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

    /** Focus & Reply run through the Reply Later pile (AVE-193); null when not focusing. */
    private val _focusReply = MutableStateFlow<FocusReplyRun?>(null)
    val focusReply: StateFlow<FocusReplyRun?> = _focusReply.asStateFlow()

    /** How the last run ended; Reply Later shows "All done" from it until you leave the pile. */
    private val _focusReplyResult = MutableStateFlow<FocusReplyResult?>(null)
    val focusReplyResult: StateFlow<FocusReplyResult?> = _focusReplyResult.asStateFlow()

    /** Full copies of the next thread in the run, fetched while you write the current reply. */
    private val focusReplyPrefetch = mutableMapOf<String, Email>()

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

    // Custom folders ("tags", AVE-158)

    /**
     * Creates a tag. Names the Worker would refuse throw [CustomFolders.ValidationException]
     * with the Worker's sentence, before any request.
     */
    suspend fun createCustomFolder(raw: String): Folder {
        val name = CustomFolders.normalizedName(raw)
        CustomFolders.validateCreate(name, _folders.value)?.let { throw CustomFolders.ValidationException(it) }
        val created = if (isDebugPreview) {
            Folder(id = CustomFolders.slug(name), name = name, unreadCount = 0)
        } else {
            val mailboxId = _selectedMailboxId.value
                ?: throw CustomFolders.ValidationException(CustomFolders.NO_MAILBOX)
            val folder = ApiClient.shared.createFolder(mailboxId, name)
            if (_selectedMailboxId.value != mailboxId) return folder
            folder
        }
        _folders.update { list -> list.filterNot { it.id == created.id } + created }
        _selectedMailboxId.value?.let { if (!isDebugPreview) db.upsertFolders(it, _folders.value) }
        return created
    }

    /** Renames a tag; its id (and the mail in it) stay put. */
    suspend fun renameCustomFolder(folder: Folder, raw: String) {
        val name = CustomFolders.normalizedName(raw)
        if (name == folder.name) return
        CustomFolders.validateRename(name, folder, _folders.value)?.let { throw CustomFolders.ValidationException(it) }
        val newName = if (isDebugPreview) {
            name
        } else {
            val mailboxId = _selectedMailboxId.value
                ?: throw CustomFolders.ValidationException(CustomFolders.NO_MAILBOX)
            val renamed = ApiClient.shared.renameFolder(mailboxId, folder.id, name)
            if (_selectedMailboxId.value != mailboxId) return
            renamed.name
        }
        _folders.update { list -> list.map { if (it.id == folder.id) it.copy(name = newName) else it } }
        _selectedMailboxId.value?.let { if (!isDebugPreview) db.upsertFolders(it, _folders.value) }
    }

    /**
     * Deletes a tag. The Worker moves its mail to the Inbox first; if the tag is open, the
     * list goes back to Inbox.
     */
    suspend fun deleteCustomFolder(folder: Folder) {
        if (!CustomFolders.isCustom(folder)) return
        val mailboxId = _selectedMailboxId.value
        if (!isDebugPreview) {
            mailboxId ?: throw CustomFolders.ValidationException(CustomFolders.NO_MAILBOX)
            ApiClient.shared.deleteFolder(mailboxId, folder.id)
            if (_selectedMailboxId.value != mailboxId) return
            db.deleteFolder(mailboxId, folder.id)
        }
        val unread = _folders.value.firstOrNull { it.id == folder.id }?.unreadCount ?: 0
        _folders.update { list -> list.filterNot { it.id == folder.id } }
        adjustFolderUnread(FolderIds.INBOX, unread)
        if (_selectedTab.value == HomeTab.Folder(folder.id)) {
            selectTab(HomeTab.Folder(FolderIds.INBOX))
        }
        if (!isDebugPreview && mailboxId != null) {
            // Settle counts with the server (the moved mail lands in Inbox).
            runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { fresh ->
                applyServerFolders(mailboxId, fresh)
            }
        }
    }

    // Tags (AVE-242): many per email, on top of its one folder. API: shared/tags.ts.

    /** Fetches the mailbox's tags and counts; DEBUG previews keep their fixtures. */
    suspend fun refreshTags() {
        if (isDebugPreview) return
        val mailboxId = _selectedMailboxId.value ?: return
        val fresh = runCatching { ApiClient.shared.listTags(mailboxId) }.getOrNull() ?: return
        ifStillSelected(mailboxId) { _tags.value = MailTags.sorted(fresh) }
    }

    fun tag(id: String): MailTag? = _tags.value.firstOrNull { it.id == id }

    /** The tag view's title: its name, or "Tag" while the list loads. */
    fun tagTitle(id: String): String = tag(id)?.name ?: HomeTab.Tag(id).title

    fun openTagPicker(email: Email) {
        hideToast()
        _tagPickerEmail.value = email
    }

    fun dismissTagPicker() {
        _tagPickerEmail.value = null
    }

    /** DEBUG previews: fixture tags (no network). */
    fun setTagsForPreview(tags: List<MailTag>) {
        _tags.value = MailTags.sorted(tags)
    }

    fun setTagListVisible(visible: Boolean) {
        _showsTagList.value = visible
    }

    /** A tag view asked for from outside home's tab state (reader chip); home opens it. */
    private val _tagViewRequest = MutableStateFlow<String?>(null)
    val tagViewRequest: StateFlow<String?> = _tagViewRequest.asStateFlow()

    fun requestTagView(tagId: String) {
        _tagViewRequest.value = tagId
    }

    fun consumeTagViewRequest() {
        _tagViewRequest.value = null
    }

    /** Every tag on the open conversation (or [email]'s own row when another is open). */
    fun conversationTags(email: Email): List<TagRef> {
        val key = MailTags.threadKey(email)
        val open = _selectedEmail.value
        val messages = if (open != null && MailTags.threadKey(open) == key) {
            _threadEmails.value + open
        } else {
            emptyList()
        }
        val rows = _emails.value.filter { MailTags.threadKey(it) == key }
        return MailTags.unionTags(messages + rows + email)
    }

    /**
     * Adds ([on]) or removes [tag] on the whole conversation of [email]. Optimistic: list
     * rows, the open thread and the cache change first; a failure puts them back.
     */
    suspend fun setTag(email: Email, tag: TagRef, on: Boolean) {
        if (blockIfReadOnly()) return
        val mailboxId = _selectedMailboxId.value ?: return
        val threadKey = MailTags.threadKey(email)
        val before = Snapshot(_emails.value, _selectedEmail.value, _threadEmails.value)
        val cachedBefore = db.getThreadEmails(mailboxId, threadKey) +
            listOfNotNull(db.getEmail(email.id))
        val viewTagId = (_selectedTab.value as? HomeTab.Tag)?.id
        val dropsRow = !on && viewTagId == tag.id

        fun patch(list: List<Email>) = MailTags.patchThreadTag(list, threadKey, tag, on)
        _emails.value = if (dropsRow) {
            _emails.value.filterNot { MailTags.threadKey(it) == threadKey }
        } else {
            patch(_emails.value)
        }
        _selectedEmail.value = _selectedEmail.value?.let { patch(listOf(it)).first() }
        _threadEmails.value = patch(_threadEmails.value)
        db.updateThreadTags(mailboxId, threadKey) { MailTags.withTag(it, tag, on) }
        _tags.update { list ->
            list.map { t ->
                if (t.id != tag.id) t else t.copy(emailCount = (t.emailCount + if (on) 1 else -1).coerceAtLeast(0))
            }
        }
        if (dropsRow) showToast(MailTags.removedToast(tag.name))

        if (isDebugPreview) return
        try {
            val response = ApiClient.shared.setThreadTag(mailboxId, threadKey, tag.id, on)
            ifStillSelected(mailboxId) {
                if (!dropsRow) _emails.value = MailTags.setThreadTags(_emails.value, threadKey, response.tags)
            }
            refreshTags()
        } catch (e: Exception) {
            ifStillSelected(mailboxId) {
                _emails.value = before.emails
                _selectedEmail.value = before.selected
                _threadEmails.value = before.thread
                db.upsertEmails(mailboxId, cachedBefore)
                showToast(MailTags.UPDATE_FAILED, isError = true)
            }
            refreshTags()
        }
    }

    private data class Snapshot(val emails: List<Email>, val selected: Email?, val thread: List<Email>)

    /** Thrown with the sentence to show when a tag name is refused (client or server). */
    class TagException(message: String) : Exception(message)

    /** Creates a tag; names the Worker would refuse throw [TagException] before any request. */
    suspend fun createTag(raw: String): MailTag {
        MailTags.validate(raw, _tags.value)?.let { throw TagException(it) }
        val name = (MailTags.normalizeName(raw) as MailTags.NameResult.Ok).name
        val created = if (isDebugPreview) {
            MailTag(id = "tag_" + UUID.randomUUID().toString().take(8), name = name)
        } else {
            val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
            try {
                ApiClient.shared.createTag(mailboxId, name)
            } catch (e: ApiException.Http) {
                throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailTags.CREATE_FAILED)
            }
        }
        _tags.update { list -> MailTags.sorted(list.filterNot { it.id == created.id } + created) }
        return created
    }

    suspend fun renameTag(tag: MailTag, raw: String) {
        MailTags.validate(raw, _tags.value, ignoringId = tag.id)?.let { throw TagException(it) }
        val name = (MailTags.normalizeName(raw) as MailTags.NameResult.Ok).name
        if (name == tag.name) return
        val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
        val renamed = if (isDebugPreview) {
            tag.copy(name = name)
        } else {
            try {
                ApiClient.shared.renameTag(mailboxId, tag.id, name)
            } catch (e: ApiException.Http) {
                throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailTags.RENAME_FAILED)
            }
        }
        ifStillSelected(mailboxId) {
            _tags.update { list -> MailTags.sorted(list.map { if (it.id == tag.id) renamed else it }) }
            renameTagOnScreen(mailboxId, tag.id, renamed.name)
        }
    }

    /** Deletes a tag (its emails stay put); if its view is open, the list goes back to Inbox. */
    suspend fun deleteTag(tag: MailTag) {
        val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
        if (!isDebugPreview) {
            try {
                ApiClient.shared.deleteTag(mailboxId, tag.id)
            } catch (e: ApiException.Http) {
                // Already gone elsewhere: treat as deleted.
                if (e.code != 404) throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailTags.DELETE_FAILED)
            }
        }
        ifStillSelected(mailboxId) {
            _tags.update { list -> list.filterNot { it.id == tag.id } }
            renameTagOnScreen(mailboxId, tag.id, null)
            if (_selectedTab.value == HomeTab.Tag(tag.id)) selectTab(HomeTab.Folder(FolderIds.INBOX))
        }
    }

    /** Rows, the open thread and the cache follow a renamed (or deleted: `name` null) tag. */
    private fun renameTagOnScreen(mailboxId: String, tagId: String, name: String?) {
        fun Email.follow(): Email {
            val tags = tags ?: return this
            if (tags.none { it.id == tagId }) return this
            val next = tags.mapNotNull { t -> if (t.id != tagId) t else name?.let { t.copy(name = it) } }
            return copy(tags = next.sortedWith(MailTags.order))
        }
        _emails.update { list -> list.map { it.follow() } }
        _selectedEmail.update { it?.follow() }
        _threadEmails.update { list -> list.map { it.follow() } }
        db.updateTagEverywhere(mailboxId, tagId, name)
    }

    // Piles people make (AVE-194), beside Reply Later and Set Aside. API: shared/piles.ts.
    // They work like Set Aside: the mail stays until taken out, replying leaves it, and a
    // mail is in one pile at a time (joining moves it out of Reply Later).

    fun customPile(id: String): WorkflowPile? = _customPiles.value.firstOrNull { it.id == id }

    /** The custom pile [email] is in, if any. */
    fun customPileOf(email: Email): WorkflowPile? =
        email.currentPileId?.takeUnless { PileIds.isBuiltin(it) }?.let { customPile(it) }

    /** A custom pile view's title: its name, or "Pile" while the list loads. */
    fun pileTitle(id: String): String = customPile(id)?.let(MailPiles::displayName) ?: HomeTab.Pile(id).title

    fun openPilePicker(email: Email) {
        hideToast()
        _pilePickerEmail.value = email
    }

    fun dismissPilePicker() {
        _pilePickerEmail.value = null
    }

    /** DEBUG previews: fixture custom piles (no network). */
    fun setCustomPilesForPreview(piles: List<WorkflowPile>) {
        _customPiles.value = piles
    }

    fun setPileListVisible(visible: Boolean) {
        _showsPileList.value = visible
    }

    fun requestPileView(pileId: String) {
        _pileViewRequest.value = pileId
    }

    fun consumePileViewRequest() {
        _pileViewRequest.value = null
    }

    /** Fresh pile list and counts (Set Aside and custom piles); previews keep fixtures. */
    suspend fun refreshPiles() {
        if (isDebugPreview) return
        val mailboxId = _selectedMailboxId.value ?: return
        val piles = runCatching { ApiClient.shared.listWorkflowPiles(mailboxId) }.getOrNull() ?: return
        ifStillSelected(mailboxId) {
            _customPiles.value = MailPiles.custom(piles.piles)
            piles.pile(PileIds.SET_ASIDE)?.let { _setAsideCount.value = it.count }
        }
    }

    /**
     * Put [email] in a pile people made, or take it out of its pile with `null`. Reply Later
     * and Set Aside keep their own flows. Optimistic like [toggleSetAside]; rolled back with
     * a toast when the Worker refuses.
     */
    suspend fun setPile(email: Email, pileId: String?) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = _emails.value.firstOrNull { it.id == email.id } ?: email
        val previous = target.currentPileId
        if (previous == pileId) return
        when {
            pileId == PileIds.REPLY_LATER || (pileId == null && previous == PileIds.REPLY_LATER) -> {
                toggleReplyLater(target)
                return
            }
            pileId == PileIds.SET_ASIDE || (pileId == null && previous == PileIds.SET_ASIDE) -> {
                toggleSetAside(target)
                return
            }
        }
        db.updateEmailPile(target.id, pileId)
        applyEmailUpdate(target.inPile(pileId))
        previous?.let { adjustPileCount(it, -1) }
        pileId?.let { adjustPileCount(it, +1) }
        val ok = isDebugPreview ||
            runCatching { ApiClient.shared.setEmailPile(mailboxId, target.id, pileId) }.isSuccess
        if (ok) {
            val name = (pileId ?: previous)?.let { customPile(it) }?.let(MailPiles::displayName) ?: "pile"
            showToast(if (pileId != null) MailPiles.movedToast(name) else MailPiles.removedToast(name))
        } else {
            db.upsertEmails(mailboxId, listOf(target))
            applyEmailUpdate(target)
            pileId?.let { adjustPileCount(it, -1) }
            previous?.let { adjustPileCount(it, +1) }
            showToast(MailPiles.UPDATE_FAILED, isError = true)
        }
        if (!isDebugPreview) refreshReplyLaterCount()
    }

    private fun adjustPileCount(pileId: String, delta: Int) {
        when (pileId) {
            PileIds.REPLY_LATER -> _replyLaterCount.update { maxOf(0, it + delta) }
            PileIds.SET_ASIDE -> _setAsideCount.update { maxOf(0, it + delta) }
            else -> setCustomPileCount(pileId) { it + delta }
        }
    }

    /** Makes a pile; names the Worker would refuse throw [TagException] before any request. */
    suspend fun createPile(raw: String): WorkflowPile {
        MailPiles.validate(raw, _customPiles.value)?.let { throw TagException(it) }
        val name = (MailPiles.normalizeName(raw) as MailPiles.NameResult.Ok).name
        val created = if (isDebugPreview) {
            WorkflowPile(id = "p_" + UUID.randomUUID().toString().take(8), name = name, builtin = false, clearsOnReply = false)
        } else {
            val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
            try {
                ApiClient.shared.createPile(mailboxId, name)
            } catch (e: ApiException.Http) {
                throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailPiles.CREATE_FAILED)
            }
        }
        _customPiles.update { list -> list.filterNot { it.id == created.id } + created }
        return created
    }

    /** Makes [raw] and puts [email] in it (the picker's New pile row). */
    suspend fun createPile(raw: String, applyingTo: Email) {
        val created = createPile(raw)
        setPile(applyingTo, created.id)
    }

    suspend fun renamePile(pile: WorkflowPile, raw: String) {
        MailPiles.validate(raw, _customPiles.value, renaming = pile)?.let { throw TagException(it) }
        val name = (MailPiles.normalizeName(raw) as MailPiles.NameResult.Ok).name
        if (name == pile.name) return
        val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
        if (!isDebugPreview) {
            try {
                ApiClient.shared.renamePile(mailboxId, pile.id, name)
            } catch (e: ApiException.Http) {
                throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailPiles.RENAME_FAILED)
            }
        }
        ifStillSelected(mailboxId) {
            _customPiles.update { list -> list.map { if (it.id == pile.id) it.copy(name = name) else it } }
        }
    }

    /** Deletes a pile: its mail comes out of it and stays put. Its open view goes to Inbox. */
    suspend fun deletePile(pile: WorkflowPile) {
        val mailboxId = _selectedMailboxId.value ?: throw TagException(CustomFolders.NO_MAILBOX)
        if (!isDebugPreview) {
            try {
                ApiClient.shared.deletePile(mailboxId, pile.id)
            } catch (e: ApiException.Http) {
                // Already gone elsewhere: treat as deleted.
                if (e.code != 404) throw TagException(e.message?.takeIf { it.isNotBlank() } ?: MailPiles.DELETE_FAILED)
            }
        }
        ifStillSelected(mailboxId) {
            _customPiles.update { list -> list.filterNot { it.id == pile.id } }
            db.clearPile(mailboxId, pile.id)
            fun Email.out() = if (pileId == pile.id) copy(pileId = null, pileAt = null) else this
            _emails.update { list -> list.map { it.out() } }
            _selectedEmail.update { it?.out() }
            _threadEmails.update { list -> list.map { it.out() } }
            if (_selectedTab.value == HomeTab.Pile(pile.id)) selectTab(HomeTab.Folder(FolderIds.INBOX))
        }
    }

    /**
     * Optimistic unread change, in conversations (AVE-228). The Inbox's count is also the New
     * total, so "Show N more new" and the widget move with it (read, archive, delete, move).
     */
    fun adjustFolderUnread(folderId: String, delta: Int) {
        if (delta == 0) return
        _folders.update { list ->
            list.map {
                if (it.id != folderId) it
                else it.copy(unreadCount = maxOf(0, it.unreadCount + delta))
            }
        }
        if (folderId == FolderIds.INBOX) {
            _inboxNewTotal.value?.takeIf { it.scope.mailboxId == _selectedMailboxId.value }?.let { total ->
                _inboxNewTotal.value = total.copy(count = maxOf(0, total.count + delta))
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
                _setAsideCount.value = db.getSetAsideCount(id)
                if (_selectedTab.value.isPile) {
                    val emails = cachedPileEmails(id, _selectedTab.value)
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
        // Mail read or filed elsewhere while away: settle the counts (AVE-228).
        scheduleFolderCountsRefresh()
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
        // A new unread conversation counts at once; mail joining one that's already unread
        // doesn't (counts are conversations, AVE-228). The server settles it either way.
        if (email.isUnread) {
            val joinsUnread = email.threadId?.let { threadId ->
                _emails.value.any { it.id != email.id && it.threadId == threadId && it.isUnread }
            } ?: false
            if (!joinsUnread) adjustFolderUnread(email.folderId ?: "inbox", 1)
        }
        scheduleFolderCountsRefresh()
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
            // Tags belong to a mailbox: a tag view can't follow into the next one.
            _tags.value = emptyList()
            _tagPickerEmail.value = null
            if (_selectedTab.value is HomeTab.Tag) _selectedTab.value = HomeTab.Folder(FolderIds.INBOX)
            // So do custom piles (AVE-194).
            _customPiles.value = emptyList()
            _pilePickerEmail.value = null
            if (_selectedTab.value is HomeTab.Pile) _selectedTab.value = HomeTab.Folder(FolderIds.INBOX)
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
        _setAsideCount.value = db.getSetAsideCount(id)
        _reminderPickerEmail.value = null
        if (_selectedTab.value.isPile) {
            val cachedEmails = cachedPileEmails(id, _selectedTab.value)
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
                val tagsDeferred = async { refreshTags() }
                val folders = foldersDeferred.await()
                applyServerFolders(id, folders)
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
                tagsDeferred.await()
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

        if (tab is HomeTab.Tag) {
            // Cached rows that carry the tag show at once; the server list replaces them.
            val cached = _selectedMailboxId.value?.let { db.getTaggedEmails(it, tab.id) }.orEmpty()
            _emails.value = cached
            _isLoading.value = cached.isEmpty()
        } else if (tab.isPile) {
            _selectedMailboxId.value?.let { mailboxId ->
                val cached = cachedPileEmails(mailboxId, tab)
                val pileCount = pileCount(tab)
                if (cached.isNotEmpty()) {
                    _emails.value = cached
                    _isLoading.value = false
                } else if (pileCount > 0) {
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

        if (listScope.isPile || listScope.tagId != null) {
            if (showLoading && _emails.value.isEmpty()) _isLoading.value = true
            _isSyncing.value = true
            try {
                val response = serverListPage(listScope, page = 1)
                db.upsertEmails(mailboxId, response.emails)
                if (listScope.isPile) ifStillSelected(mailboxId) { setPileCount(listScope, response.totalCount) }
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
            if (listScope.isPile || listScope.tagId != null) {
                val response = serverListPage(listScope, page = page)
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
            _setAsideCount.value = db.getSetAsideCount(mailboxId)
            return
        }
        if (localCount > 0 || _replyLaterCount.value == 0) {
            _replyLaterCount.value = localCount
        }
        val replyLaterScope = EmailListScope(mailboxId, folderId = null, replyLater = true)
        var replyLaterFailed = false
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
            replyLaterFailed = true
        }
        refreshPileSummary(mailboxId, replyLaterFromPiles = replyLaterFailed)
    }

    /**
     * One `workflow-piles` read: Reply Later's `due_count` (never below what the local cache
     * knows is due) and Set Aside's count (AVE-201; an older Worker lists no Set Aside → 0).
     * [replyLaterFromPiles]: the Reply Later list failed, so take its count from here too.
     */
    private suspend fun refreshPileSummary(mailboxId: String, replyLaterFromPiles: Boolean = false) {
        val localDue = db.getReplyLaterDueCount(mailboxId)
        val piles = runCatching { ApiClient.shared.listWorkflowPiles(mailboxId) }.getOrNull()
        ifStillSelected(mailboxId) {
            _replyLaterDueCount.value = maxOf(piles?.pile(PileIds.REPLY_LATER)?.dueCount ?: 0, localDue)
            if (piles != null) {
                if (replyLaterFromPiles) _replyLaterCount.value = piles.count(PileIds.REPLY_LATER)
                _setAsideCount.value = piles.count(PileIds.SET_ASIDE)
                if (!isDebugPreview) _customPiles.value = MailPiles.custom(piles.piles)
            } else {
                val localSetAside = db.getSetAsideCount(mailboxId)
                if (localSetAside > 0 || _setAsideCount.value == 0) _setAsideCount.value = localSetAside
            }
        }
    }

    /** Cached rows for a pile tab (Reply Later / Set Aside), in the Worker's order. */
    private fun cachedPileEmails(mailboxId: String, tab: HomeTab): List<Email> = when (tab) {
        HomeTab.SetAside -> db.getSetAsideEmails(mailboxId)
        is HomeTab.Pile -> db.getPileEmails(mailboxId, tab.id)
        else -> db.getReplyLaterEmails(mailboxId)
    }

    /** What a pile tab holds, as last counted. */
    fun pileCount(tab: HomeTab): Int = when (tab) {
        HomeTab.SetAside -> _setAsideCount.value
        is HomeTab.Pile -> customPile(tab.id)?.count ?: 0
        else -> _replyLaterCount.value
    }

    private fun setPileCount(listScope: EmailListScope, count: Int) {
        val custom = listScope.customPileId
        when {
            custom != null -> setCustomPileCount(custom) { count }
            listScope.setAside -> _setAsideCount.value = count
            else -> _replyLaterCount.value = count
        }
    }

    private fun setCustomPileCount(pileId: String, next: (Int) -> Int) {
        _customPiles.update { list ->
            list.map { if (it.id == pileId) it.copy(count = maxOf(0, next(it.count))) else it }
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
            is HomeTab.Folder, is HomeTab.AiInbox, is HomeTab.ReplyLater, is HomeTab.SetAside, is HomeTab.Tag, is HomeTab.Pile -> {
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
        // Tag views and tag counts: `email_updated {tags}` and `tags_changed` land here too.
        if (listScope?.tagId != null) loadEmailsForCurrentTab(showLoading = false)
        if (isSelected(mailboxId)) refreshTags()
        if (isSelected(mailboxId)) refreshOpenEmailDetailSilently()
        scheduleFolderCountsRefresh()
    }

    /** Page [page] of a list the server builds (a pile, a tag view). */
    private suspend fun serverListPage(listScope: EmailListScope, page: Int): EmailListResponse {
        val tagId = listScope.tagId
        return when {
            tagId != null -> ApiClient.shared.listTaggedEmails(listScope.mailboxId, tagId, page = page)
            listScope.setAside -> ApiClient.shared.listPileEmails(listScope.mailboxId, PileIds.SET_ASIDE, page = page)
            listScope.customPileId != null ->
                ApiClient.shared.listPileEmails(listScope.mailboxId, listScope.customPileId, page = page)
            else -> ApiClient.shared.listReplyLaterEmails(listScope.mailboxId, page = page)
        }
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
        val form = newComposeForm(mode, mailbox, enrichedOriginal ?: original, enrichedDraft ?: draft, initialTo)
        _composeSession.value = ComposeSession(form, ComposePresentation.Expanded)
        _selectedEmail.value = null
    }

    private fun newComposeForm(
        mode: ComposeMode,
        mailbox: Mailbox,
        original: Email?,
        draft: Email?,
        initialTo: List<MailAddress> = emptyList(),
    ): ComposeFormModel {
        val form = ComposeFormModel(
            mode = mode,
            mailbox = mailbox,
            original = original,
            draft = draft,
            initialTo = initialTo,
        )
        form.onDraftSaved = { id, threadId, originalId, subject, body, recipient ->
            markThreadHasDraft(id, threadId, originalId, subject, body, recipient, hasDraft = true)
        }
        form.onDraftDeleted = { id, threadId, originalId ->
            markThreadHasDraft(id, threadId, originalId, null, null, null, hasDraft = false)
        }
        return form
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
        _focusReply.value = null
        _focusReplyResult.value = null
        focusReplyPrefetch.clear()
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
        _setAsideCount.value = 0
        _reminderPickerEmail.value = null
        _tags.value = emptyList()
        _tagPickerEmail.value = null
        _showsTagList.value = false
        _customPiles.value = emptyList()
        _pilePickerEmail.value = null
        _showsPileList.value = false
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
        tags: List<MailTag> = emptyList(),
        customPiles: List<WorkflowPile> = emptyList(),
    ) {
        streamClient.stop()
        isDebugPreview = true
        _tags.value = MailTags.sorted(tags)
        _tagPickerEmail.value = null
        _showsTagList.value = false
        _customPiles.value = customPiles
        _pilePickerEmail.value = null
        _showsPileList.value = false
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
        // The Inbox's unread count is its New conversations (AVE-228): one number in the
        // fixture's header and New section.
        val inboxRows = emails.filter { (it.folderId ?: FolderIds.INBOX) == FolderIds.INBOX }
        _folders.value = if (inboxRows.isEmpty()) folders else folders.map { folder ->
            if (folder.id == FolderIds.INBOX) folder.copy(unreadCount = inboxRows.count { it.isUnread }) else folder
        }
        _emails.value = emails
        _selectedTab.value = selectedTab
        _selectedEmail.value = selectedEmail
        _threadEmails.value = threadEmails
        _replyLaterCount.value = replyLaterCount
        _replyLaterDueCount.value = selectedMailboxId?.let { db.getReplyLaterDueCount(it) } ?: 0
        _setAsideCount.value = selectedMailboxId?.let { db.getSetAsideCount(it) } ?: 0
        _reminderPickerEmail.value = null
        _isAdmin.value = isAdmin
        _inboxDigest.value = null
        _composeSession.value = null
        _focusReply.value = null
        _focusReplyResult.value = null
        focusReplyPrefetch.clear()
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
            combine(_selectedMailboxId, _emails, _inboxNewTotal, _replyLaterCount, _folders) { _, _, _, _, _ -> Unit }
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
        // The count is the server's New total (AVE-228), never the cached rows: the cache
        // holds a capped page plus whatever older pages left behind, so counting it drifted
        // (8, then 4). With no server number for this mailbox yet, keep the last snapshot.
        val serverNewCount = _folders.value.firstOrNull { it.id == FolderIds.INBOX }
            ?.takeIf { foldersSyncedMailboxId == mailbox.id }
            ?.unreadCount
            ?: _inboxNewTotal.value
                ?.takeIf { it.scope.mailboxId == mailbox.id && it.scope.folderId == FolderIds.INBOX }
                ?.count
            ?: return
        InboxWidgetPublisher.publish(
            InboxWidgetSnapshot.make(
                mailbox = mailbox,
                inboxRows = inboxRows,
                newCount = serverNewCount,
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
                    form.allAttachmentBytes(),
                )
                if (estimated > co.inboxies.app.util.OutboundLimits.MAX_MESSAGE_BYTES) {
                    error(co.inboxies.app.util.OutboundLimits.SIZE_ERROR)
                }
                // The original's files go out like any other attachment (AVE-181).
                val forwarded = form.loadForwardedAttachments { mailbox, email, attachment ->
                    ApiClient.shared.getAttachment(mailbox, email, attachment)
                }
                val payload = form.toSendPayload(forwarded)
                when (form.mode) {
                    ComposeMode.Reply, ComposeMode.ReplyAll, ComposeMode.Forward ->
                        sendReplyOrForward(form, mailboxId, payload)
                    else -> ApiClient.shared.sendEmail(mailboxId, payload, form.sendIdempotencyKey)
                }
            }.onSuccess {
                form.deleteSavedDraft()
                showToast("Sent")
                // Focus & Reply (AVE-193): the next thread's reply takes this one's place.
                if (!focusReplySent(session)) closeCompose()
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
            SwipeQuickAction.SET_ASIDE -> toggleSetAside(on)
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
        // A Set Aside mail moves over to Reply Later: one pile at a time (AVE-201).
        val updated = target.inPile(if (next) PileIds.REPLY_LATER else null)
        applyEmailUpdate(updated)
        runCatching {
            ApiClient.shared.updateEmail(mailboxId, target.id, replyLater = next)
        }.onSuccess {
            if (next) showAddedToReplyLaterToast(updated) else showToast("Removed from Reply Later")
        }.onFailure {
            // Roll back optimistic update on failure
            db.upsertEmails(mailboxId, listOf(target))
            applyEmailUpdate(target)
            showToast("Couldn't update Reply Later", isError = true)
        }
        refreshReplyLaterCount()
        if (_selectedTab.value.isPile) {
            loadEmailsForCurrentTab(showLoading = false)
        }
    }

    /**
     * Set a thread aside, or take it out of Set Aside (AVE-201). Same optimistic flow as
     * [toggleReplyLater]; a Reply Later mail moves over (and loses its reminder). No reminders,
     * and replying leaves it where it is.
     */
    suspend fun toggleSetAside(on: Email? = null) {
        val mailboxId = _selectedMailboxId.value ?: return
        val target = on?.let { e -> _emails.value.firstOrNull { it.id == e.id } ?: e }
            ?: _selectedEmail.value ?: _threadEmails.value.lastOrNull() ?: return
        val next = !target.isSetAside
        val pile = if (next) PileIds.SET_ASIDE else null
        db.updateEmailPile(target.id, pile)
        applyEmailUpdate(target.inPile(pile))
        val ok = if (isDebugPreview) {
            true
        } else {
            runCatching { ApiClient.shared.setEmailPile(mailboxId, target.id, pile) }.isSuccess
        }
        if (ok) {
            showToast(if (next) "Set aside" else "Removed from Set Aside")
        } else {
            db.upsertEmails(mailboxId, listOf(target))
            applyEmailUpdate(target)
            showToast("Couldn't update Set Aside", isError = true)
        }
        refreshReplyLaterCount()
        if (_selectedTab.value.isPile && !isDebugPreview) {
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
                if (replyLater || email.replyLater) {
                    applyEmailUpdate(email.inPile(if (replyLater) PileIds.REPLY_LATER else null))
                }
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
        if (_selectedTab.value.isPile) {
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
            val leftPile = when (val tab = _selectedTab.value) {
                HomeTab.ReplyLater -> !updated.replyLater
                HomeTab.SetAside -> !updated.isSetAside
                is HomeTab.Pile -> updated.currentPileId != tab.id
                else -> false
            }
            if (leftPile) {
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
                        pileId = updated.pileId,
                        pileAt = updated.pileAt,
                        threadUnreadCount = if (updated.read) 0 else it.threadUnreadCount,
                        listSection = if (updated.read) "seen" else "new",
                    )
                }
                if (_selectedTab.value.syncFolderId == FolderIds.INBOX) orderNewThenSeen(mapped) else mapped
            }
        }
        if (previous != null) {
            // Conversations, like the counts (AVE-228): the row's unread state, not one message's.
            val row = _emails.value.firstOrNull { it.id == updated.id }
            adjustFolderUnread(previous, wasUnread = previous.isUnread, isUnread = row?.isUnread ?: !updated.read)
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
            if (_selectedTab.value.isPile) {
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

    /** Screener-lite: allow the sender and file their queued mail to a purpose box. */
    suspend fun approveScreenerSender(email: Email, destinationFolderId: String) {
        decideScreenerSender(email, destinationFolderId)
    }

    /** Screener-lite: reject the sender into Screened out (silent). */
    suspend fun rejectScreenerSender(email: Email) {
        decideScreenerSender(email, destinationFolderId = null)
    }

    /** Accept ([destinationFolderId]) or Decline (null), then a toast with Undo (AVE-159). */
    private suspend fun decideScreenerSender(email: Email, destinationFolderId: String?) {
        val mailboxId = _selectedMailboxId.value ?: return
        if (blockIfReadOnly()) return
        val sender = email.sender.trim().lowercase()
        if (sender.isEmpty()) return
        val localFolderId = destinationFolderId ?: FolderIds.SCREENED_OUT
        try {
            val response = if (destinationFolderId != null) {
                ApiClient.shared.approveSender(
                    mailboxId = mailboxId,
                    sender = sender,
                    destinationFolderId = destinationFolderId,
                    emailId = email.id,
                    displayName = email.senderName,
                )
            } else {
                ApiClient.shared.rejectSender(
                    mailboxId = mailboxId,
                    sender = sender,
                    emailId = email.id,
                    displayName = email.senderName,
                )
            }
            val queued = (_emails.value + _screenerQueue.value).filter {
                it.sender.trim().lowercase() == sender &&
                    (it.folderId == FolderIds.SCREENER || it.id == email.id)
            }.distinctBy { it.id }
            queued.forEach { db.moveEmail(it.id, localFolderId) }
            val queuedIds = queued.map { it.id }.toSet()
            _emails.update { list -> list.filterNot { it.id in queuedIds } }
            _screenerQueue.update { list -> list.filterNot { it.id in queuedIds } }
            val restoreIds = ScreenerDecision.restoreIds(response, email.id)
            if (_selectedEmail.value?.id in queuedIds ||
                _selectedEmail.value?.sender?.trim()?.lowercase() == sender
            ) {
                if (destinationFolderId != null) {
                    // Accept keeps the reader open (AVE-182): the message is
                    // filed where it was accepted to, so the Screener bar goes.
                    refileOpenThread(queuedIds + restoreIds, localFolderId)
                } else {
                    _selectedEmail.value = null
                    _threadEmails.value = emptyList()
                }
            }
            showScreenerUndoToast(
                ScreenerDecision.toastTitle(destinationFolderId),
                mailboxId = mailboxId,
                sender = sender,
                restoreIds = restoreIds,
            )
            loadEmailsForCurrentTab(showLoading = false)
            runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { folders ->
                applyServerFolders(mailboxId, folders)
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
        }
    }

    /**
     * Decision toast with Undo. The decision is already on the server, so Undo
     * calls `DELETE sender-triage/:sender` and moves the refiled mail back to the
     * Screener (same shape as [showSpamVerdictUndoToast]). If the DELETE fails the
     * decision stands and an error toast says so.
     */
    private fun showScreenerUndoToast(
        message: String,
        mailboxId: String,
        sender: String,
        restoreIds: List<String>,
    ) {
        commitPendingActionImmediately()
        val action = UndoableAction(
            message = message,
            execute = {},
            rollback = { scope.launch { undoScreenerDecision(mailboxId, sender, restoreIds) } },
        )
        val actionId = action.id
        _pendingUndoAction.value = action
        showToast(message, isUndo = true, durationMs = 6000)
        pendingUndoJob = scope.launch {
            delay(6000)
            if (_pendingUndoAction.value?.id == actionId) _pendingUndoAction.value = null
        }
    }

    /** Re-files messages of the open reader in place, without closing it. */
    private fun refileOpenThread(ids: Set<String>, folderId: String) {
        _selectedEmail.update { selected ->
            if (selected != null && selected.id in ids) {
                selected.copy(folderId = folderId, folderName = null)
            } else {
                selected
            }
        }
        _threadEmails.update { thread ->
            thread.map { if (it.id in ids) it.copy(folderId = folderId, folderName = null) else it }
        }
    }

    private suspend fun undoScreenerDecision(mailboxId: String, sender: String, restoreIds: List<String>) {
        val deleted = runCatching { ApiClient.shared.deleteSenderTriage(mailboxId, sender) }
        if (deleted.isFailure) {
            showToast("Couldn't undo", isError = true)
            return
        }
        // Undecided again: put what the decision filed back in the Screening room.
        // Best effort per message; the next folder sync settles any that failed.
        restoreIds.forEach { id ->
            db.moveEmail(id, FolderIds.SCREENER)
            runCatching { ApiClient.shared.moveEmail(mailboxId, id, FolderIds.SCREENER) }
        }
        // A reader left open after Accept (AVE-182) shows the Screener bar again.
        refileOpenThread(restoreIds.toSet(), FolderIds.SCREENER)
        refreshScreenerQueue()
        loadEmailsForCurrentTab(showLoading = false)
        runCatching { MailboxSyncService.syncMailbox(mailboxId) }.getOrNull()?.let { folders ->
            applyServerFolders(mailboxId, folders)
        }
        showToast("Undone")
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
        endFocusReply()
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
            applyServerFolders(mailboxId, folders)
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
        endFocusReply()
        _composeSession.value?.form?.cancelAutoSave()
        _composeSession.value = null
    }

    // Focus & Reply (AVE-193). Web twin: `app/routes/reply-later.tsx`; iOS twin:
    // `AppModel.startFocusReply`.

    /**
     * Opens the first thread in the Reply Later pile with a reply ready. Sending or
     * skipping moves on to the next; the run ends with "All done" on the pile.
     */
    suspend fun startFocusReply() {
        if (_selectedTab.value !is HomeTab.ReplyLater) return
        if (_composeSession.value != null) {
            showToast("Send or close the open message first")
            return
        }
        val run = FocusReplyRun.start(_emails.value)
        val first = run.current ?: return
        _focusReplyResult.value = null
        focusReplyPrefetch.clear()
        _focusReply.value = run
        startCompose(ComposeMode.Reply, original = first)
        // Read-only mailbox or switched away: compose didn't open, so there is nothing to focus.
        if (_composeSession.value == null || _focusReply.value == null) {
            _focusReply.value = null
            return
        }
        prefetchNextFocusReply()
    }

    /**
     * Focus & Reply "Skip": leave this thread in the pile and move on. Anything typed
     * is kept as a draft. The sheet persists its fields to the form first.
     */
    fun skipFocusReply() {
        val run = _focusReply.value ?: return
        val session = _composeSession.value ?: return
        val id = session.form.originalEmailId ?: return
        val form = session.form
        form.commitPendingTokens()
        form.cancelAutoSave()
        if (form.hasTypedReply) {
            scope.launch { form.saveDraft(explicit = false) }
        }
        _focusReply.value = run.markSkipped(id)
        advanceFocusReply()
    }

    /** Leaving the run (close, minimize, sign-out) without reaching the end. */
    fun endFocusReply() {
        if (_focusReply.value == null) return
        _focusReply.value = null
        focusReplyPrefetch.clear()
    }

    /** DEBUG preview: the pile right after a run emptied it. */
    fun applyFocusReplyResultForPreview(result: FocusReplyResult) {
        _focusReplyResult.value = result
    }

    /** "All done" belongs to the visit to the pile that earned it. */
    fun clearFocusReplyResult() {
        _focusReplyResult.value = null
    }

    /** After a successful send: true when Focus & Reply took over the open compose. */
    private fun focusReplySent(session: ComposeSession): Boolean {
        val run = _focusReply.value ?: return false
        if (_composeSession.value !== session) return false
        val id = session.form.originalEmailId ?: return false
        _focusReply.value = run.markReplied(id)
        // The server took it out of the pile with the reply; mirror that before the refresh.
        removeFromReplyLaterPile(id)
        advanceFocusReply()
        return true
    }

    private fun advanceFocusReply() {
        // Rows that joined the pile since the start (a later page) join the end of the run.
        val run = _focusReply.value?.let {
            if (_selectedTab.value is HomeTab.ReplyLater) it.absorb(_emails.value) else it
        } ?: return
        _focusReply.value = run
        val next = run.current
        val mailbox = selectedMailbox
        if (next == null || mailbox == null || mailbox.isReadOnly) {
            finishFocusReply()
            return
        }
        val original = focusReplyPrefetch.remove(next.id) ?: db.getEmail(next.id) ?: next
        _composeSession.value?.form?.cancelAutoSave()
        val session = ComposeSession(newComposeForm(ComposeMode.Reply, mailbox, original, null), ComposePresentation.Expanded)
        // Swap in place so compose stays up between threads.
        _composeSession.value = session
        _selectedEmail.value = null
        if (original.body == null) enrichFocusReply(session, next.id, mailbox.id)
        prefetchNextFocusReply()
    }

    private fun finishFocusReply() {
        val run = _focusReply.value ?: return
        _focusReply.value = null
        focusReplyPrefetch.clear()
        _focusReplyResult.value = run.result
        _composeSession.value?.form?.cancelAutoSave()
        _composeSession.value = null
    }

    private fun removeFromReplyLaterPile(id: String) {
        val wasDue = _emails.value.firstOrNull { it.id == id }?.isReplyLaterDue == true
        if (_selectedTab.value is HomeTab.ReplyLater) {
            _emails.update { list -> list.filterNot { it.id == id } }
        }
        _replyLaterCount.update { (it - 1).coerceAtLeast(0) }
        if (wasDue) _replyLaterDueCount.update { (it - 1).coerceAtLeast(0) }
    }

    private fun prefetchNextFocusReply() {
        if (isDebugPreview) return
        val run = _focusReply.value ?: return
        val mailboxId = _selectedMailboxId.value ?: return
        val next = run.remaining.drop(1).firstOrNull() ?: return
        if (focusReplyPrefetch.containsKey(next.id)) return
        scope.launch {
            val full = runCatching { ApiClient.shared.getEmail(mailboxId, next.id) }.getOrNull() ?: return@launch
            if (_focusReply.value != null) focusReplyPrefetch[next.id] = full
        }
    }

    /** The next thread opened before its full copy arrived: swap it in if nothing was typed yet. */
    private fun enrichFocusReply(session: ComposeSession, emailId: String, mailboxId: String) {
        if (isDebugPreview) return
        scope.launch {
            val full = runCatching { ApiClient.shared.getEmail(mailboxId, emailId) }.getOrNull() ?: return@launch
            val mailbox = selectedMailbox ?: return@launch
            if (_composeSession.value !== session || session.form.hasTypedReply || mailbox.id != mailboxId) return@launch
            session.form.cancelAutoSave()
            _composeSession.value = ComposeSession(newComposeForm(ComposeMode.Reply, mailbox, full, null), ComposePresentation.Expanded)
        }
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
        private const val FOLDER_COUNTS_DEBOUNCE_MS = 800L

        /** "Added to Reply Later · Add reminder" stays up longer than a plain toast (AVE-86). */
        const val REMINDER_TOAST_DURATION_MS = 5_000L

        private fun visibleConversations(conversations: List<AgentConversation>) =
            conversations.filter { it.id != AUTO_CONVERSATION_ID }

        /** Inbox New then Seen (by list section), each by date DESC. */
        fun orderNewThenSeen(emails: List<Email>): List<Email> = EmailPaging.orderNewThenSeen(emails)
    }
}

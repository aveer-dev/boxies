import Foundation
import Observation

/// App-wide state ≈ Zustand `useUIStore` + React Query cache for the active mailbox.
@Observable
@MainActor
final class AppModel {
    var mailboxes: [Mailbox] = []
    var selectedMailboxId: String?
    var folders: [Folder] = []
    var selectedTab: HomeTab = .aiInbox
    var emails: [Email] = []
    var inboxDigest: InboxDigest?
    var isDigestLoading = false
    var conversations: [AgentConversation] = []
    /// The chat Ask AI should resume. Empty drafts are never stored here; it is set on the first message.
    var activeConversationId: String?
    /// Current chat sheet screen. Stored here so sheet remounts keep the same conversation.
    var chatSession: ChatSession = .dismissed
    /// Client ids waiting for the server registry to catch up. Refresh must not drop these.
    private var pendingConversationIds: Set<String> = []
    /// True until the first mailbox identity is available (top bar skeleton).
    var isMailboxLoading = true
    /// True while the current folder's email list is fetching with no cached data.
    var isLoading = true
    /// True while the open email's body/thread is fetching with no cached body.
    var isEmailDetailLoading = false
    /// Non-intrusive background sync state (does not hide emails).
    var isSyncing = false
    var lastSyncedAt: Date?
    var errorMessage: String?
    var selectedEmail: Email?
    var threadEmails: [Email] = []
    var composeSession: ComposeSession?
    var toast: AppToast?
    private var toastDismissTask: Task<Void, Never>?
    
    struct UndoableAction: Identifiable {
        let id = UUID()
        let message: String
        let execute: @Sendable () async -> Void
        let rollback: @MainActor () -> Void
    }
    
    var pendingUndoAction: UndoableAction?
    private var pendingUndoTask: Task<Void, Never>?

    private let db = DatabaseService.shared
    private let syncService = MailboxSyncService.shared
    private let outbox = OutboxQueueWorker.shared
    private let streamClient = RealTimeStreamClient.shared

    /// Observable swipe prefs so list rows refresh when settings change.
    var swipePreferences = SwipeActionPreferences.current
    /// Preview hosts skip UserDefaults so Canvas cannot overwrite real swipe prefs.
    var persistsPreferences = true

    var selectedMailbox: Mailbox? {
        mailboxes.first { $0.id == selectedMailboxId }
    }

    func updateSwipePreferences(_ transform: (inout SwipeActionPreferences) -> Void) {
        var prefs = swipePreferences
        transform(&prefs)
        prefs.leftActions = Array(prefs.leftActions.prefix(SwipeActionPreferences.maxActionsPerEdge))
        prefs.rightActions = Array(prefs.rightActions.prefix(SwipeActionPreferences.maxActionsPerEdge))
        if persistsPreferences {
            prefs.save()
        }
        swipePreferences = prefs
    }

    func unreadCount(forFolderId folderId: String) -> Int {
        folders.first(where: { $0.id == folderId })?.unreadCount ?? 0
    }

    func adjustFolderUnread(folderId: String, delta: Int) {
        guard delta != 0,
              let index = folders.firstIndex(where: { $0.id == folderId }) else { return }
        let current = folders[index]
        let next = max(0, current.unreadCount + delta)
        guard next != current.unreadCount else { return }
        folders[index] = Folder(id: current.id, name: current.name, unreadCount: next)
        if let mailboxId = selectedMailboxId {
            db.updateFolderUnread(mailboxId: mailboxId, folderId: folderId, delta: delta)
        }
    }

    func adjustFolderUnread(for email: Email, wasUnread: Bool, isUnread: Bool) {
        guard wasUnread != isUnread else { return }
        let folderId = email.folderId ?? selectedTab.syncFolderId
        guard let folderId else { return }
        adjustFolderUnread(folderId: folderId, delta: isUnread ? 1 : -1)
    }

    func bootstrap(authToken: String?) async {
        let token = authToken
        APIClient.shared.authTokenProvider = { token }

        // 1. Instant local read (0ms) — eliminate cold start spinners
        let cachedMailboxes = db.getMailboxes()
        if !cachedMailboxes.isEmpty {
            mailboxes = cachedMailboxes
            if selectedMailboxId == nil {
                selectedMailboxId = cachedMailboxes.first?.id
            }
            isMailboxLoading = false
            if let id = selectedMailboxId {
                let cachedFolders = db.getFolders(mailboxId: id)
                if !cachedFolders.isEmpty {
                    folders = cachedFolders
                }
                if let folderId = selectedTab.syncFolderId {
                    let cachedEmails = db.getEmails(mailboxId: id, folderId: folderId, limit: 50)
                    if !cachedEmails.isEmpty {
                        emails = cachedEmails
                        isLoading = false
                    }
                }
            }
        }

        setupRealTimeStream()

        // 2. Silent background sync
        await refreshMailboxes(showLoading: emails.isEmpty)
    }

    private func setupRealTimeStream() {
        guard let mailboxId = selectedMailboxId else { return }
        streamClient.onNewEmailReceived = { [weak self] newEmail in
            Task { @MainActor in
                self?.handleIncomingRealTimeEmail(newEmail)
            }
        }
        streamClient.onSyncRequested = { [weak self] in
            Task { @MainActor in
                await self?.refreshCurrentTabSilently()
            }
        }
        streamClient.start(mailboxId: mailboxId)
        PushNotificationManager.shared.requestPermissionAndRegister(mailboxId: mailboxId)
    }

    private func handleIncomingRealTimeEmail(_ email: Email) {
        // If email matches current tab folder, insert at top with smooth animation
        if let currentFolder = selectedTab.syncFolderId {
            let targetFolder = email.folderId ?? "inbox"
            if targetFolder.caseInsensitiveCompare(currentFolder) == .orderedSame {
                if !emails.contains(where: { $0.id == email.id }) {
                    emails.insert(email, at: 0)
                }
            }
            if selectedTab == .aiInbox {
                Task { await loadInboxDigest(showLoading: false) }
            }
        }
        if email.isUnread {
            adjustFolderUnread(folderId: email.folderId ?? "inbox", delta: 1)
        }
    }

    func refreshMailboxes(showLoading: Bool = true) async {
        if showLoading {
            isMailboxLoading = selectedMailbox == nil
            isLoading = emails.isEmpty
        }
        errorMessage = nil
        do {
			mailboxes = try await APIClient.shared.listMailboxes()
            db.upsertMailboxes(mailboxes)
            if let selected = selectedMailboxId, !mailboxes.contains(where: { $0.id == selected }) {
                selectedMailboxId = mailboxes.first?.id
            }
            if selectedMailboxId == nil {
                selectedMailboxId = mailboxes.first?.id
            }
            isMailboxLoading = false
            if let id = selectedMailboxId {
                await loadMailbox(id)
            } else {
                isLoading = false
            }
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
            isMailboxLoading = false
        }
    }

    func createMailbox(name: String, email: String) async {
        do {
            let _ = try await APIClient.shared.createMailbox(name: name, email: email)
            await refreshMailboxes(showLoading: true)
            showToast("Mailbox created")
        } catch {
            showToast("Failed to create mailbox: \(error.localizedDescription)", isError: true)
        }
    }

    func loadMailbox(_ id: String) async {
        if selectedMailboxId != id {
            activeConversationId = nil
            pendingConversationIds.removeAll()
            conversations = []
            inboxDigest = nil
            if chatSession != .dismissed {
                chatSession = .dismissed
            }
        }
        selectedMailboxId = id
        setupRealTimeStream()

        // Instant local read
        let cachedFolders = db.getFolders(mailboxId: id)
        if !cachedFolders.isEmpty {
            folders = cachedFolders
            isMailboxLoading = false
        }
        if let folderId = selectedTab.syncFolderId {
            let cachedEmails = db.getEmails(mailboxId: id, folderId: folderId, limit: 50)
            if !cachedEmails.isEmpty {
                emails = cachedEmails
                isLoading = false
            }
        }

        isSyncing = true
        defer { isSyncing = false }
        do {
            let detailed = try await APIClient.shared.getMailbox(mailboxId: id)
            if let idx = mailboxes.firstIndex(where: { $0.id == detailed.id }) {
                mailboxes[idx] = detailed
                db.upsertMailboxes([detailed])
            }
            isMailboxLoading = false
            async let foldersTask = syncService.syncMailbox(mailboxId: id)
            async let conversationsTask = APIClient.shared.listConversations(mailboxId: id)
            folders = try await foldersTask
            if let server = try? await conversationsTask {
                conversations = Self.visibleConversations(server)
                dropStaleActiveConversation()
            }
            await loadEmailsForCurrentTab(showLoading: emails.isEmpty)
            if selectedTab == .aiInbox {
                await loadInboxDigest(showLoading: inboxDigest == nil)
            }
        } catch let error as APIError {
            if case .http(let code, _) = error, code == 403 || code == 404 {
                await dropInaccessibleMailbox(id)
                return
            }
            errorMessage = error.localizedDescription
            isMailboxLoading = false
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isMailboxLoading = false
            isLoading = false
        }
    }

    private func dropInaccessibleMailbox(_ id: String) async {
        db.deleteMailbox(id: id)
        mailboxes.removeAll(where: { $0.id == id })
        if selectedMailboxId == id {
            selectedMailboxId = mailboxes.first?.id
        }
        isMailboxLoading = false
        if let next = selectedMailboxId, next != id {
            await loadMailbox(next)
        } else {
            emails = []
            folders = []
            inboxDigest = nil
            conversations = []
            activeConversationId = nil
            isLoading = false
        }
    }

    func deleteMailbox(id: String) async {
        do {
            try await APIClient.shared.deleteMailbox(mailboxId: id)
            db.deleteMailbox(id: id)
            mailboxes.removeAll(where: { $0.id == id })
            if mailboxes.isEmpty {
                selectedMailboxId = nil
                emails = []
                folders = []
                inboxDigest = nil
                conversations = []
                activeConversationId = nil
                pendingConversationIds.removeAll()
                chatSession = .dismissed
            } else {
                if selectedMailboxId == id {
                    await loadMailbox(mailboxes[0].id)
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectTab(_ tab: HomeTab) async {
        selectedTab = tab
        selectedEmail = nil

        // Instant local query for folder-backed tabs (< 2ms)
        if let folderId = tab.syncFolderId, let mailboxId = selectedMailboxId {
            let cached = db.getEmails(mailboxId: mailboxId, folderId: folderId, limit: 50)
            if !cached.isEmpty {
                emails = cached
                isLoading = false
            } else {
                isLoading = true
            }
        }
        await loadEmailsForCurrentTab(showLoading: emails.isEmpty)
        if tab == .aiInbox {
            await loadInboxDigest(showLoading: inboxDigest == nil)
        }
    }

    func loadEmailsForCurrentTab(showLoading: Bool = true) async {
        guard let mailboxId = selectedMailboxId else {
            isLoading = false
            return
        }
        guard let folderId = selectedTab.syncFolderId else {
            emails = []
            isLoading = false
            return
        }

        let cached = db.getEmails(mailboxId: mailboxId, folderId: folderId, limit: 50)
        if !cached.isEmpty {
            emails = cached
            isLoading = false
        } else if showLoading {
            isLoading = true
        }

        isSyncing = true
        defer {
            isLoading = false
            isSyncing = false
        }

        do {
            let synced = try await syncService.syncFolder(mailboxId: mailboxId, folderId: folderId)
            emails = synced
            lastSyncedAt = Date()
        } catch {
            if emails.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Reloads the visible tab without swapping in the list skeleton.
    func refreshCurrentTab() async {
        switch selectedTab {
        case .folder, .aiInbox:
            await loadEmailsForCurrentTab(showLoading: false)
            if selectedTab == .aiInbox {
                await loadInboxDigest(showLoading: false)
            }
        case .chats:
            await refreshConversations()
        }
    }

    func refreshCurrentTabSilently() async {
        if let folderId = selectedTab.syncFolderId, let mailboxId = selectedMailboxId {
            if let synced = try? await syncService.syncFolder(mailboxId: mailboxId, folderId: folderId) {
                emails = synced
                lastSyncedAt = Date()
            }
            if selectedTab == .aiInbox {
                await loadInboxDigest(showLoading: false)
            }
        }
    }

    func loadInboxDigest(showLoading: Bool = true) async {
        guard let mailboxId = selectedMailboxId else {
            inboxDigest = nil
            isDigestLoading = false
            return
        }
        if showLoading && inboxDigest == nil {
            isDigestLoading = true
        }
        defer { isDigestLoading = false }
        do {
            inboxDigest = try await APIClient.shared.getInboxDigest(mailboxId: mailboxId)
        } catch {
            if inboxDigest == nil {
                errorMessage = error.localizedDescription
            }
        }
    }

    func completeDigestTodo(id: String) async {
        guard let mailboxId = selectedMailboxId else { return }
        if var digest = inboxDigest {
            digest.todos.removeAll { $0.id == id }
            inboxDigest = digest
        }
        do {
            _ = try await APIClient.shared.completeDigestTodo(mailboxId: mailboxId, todoId: id)
            await loadEmailsForCurrentTab(showLoading: false)
            await loadInboxDigest(showLoading: false)
        } catch {
            showToast("Couldn’t complete to-do", isError: true)
            await loadInboxDigest(showLoading: false)
        }
    }

    func markDigestTopicRead(topicId: String, emailIds: [String]) async {
        guard let mailboxId = selectedMailboxId, !emailIds.isEmpty else { return }
        do {
            _ = try await APIClient.shared.markDigestTopicRead(
                mailboxId: mailboxId,
                topicId: topicId,
                emailIds: emailIds
            )
            await loadEmailsForCurrentTab(showLoading: false)
            await loadInboxDigest(showLoading: false)
        } catch {
            showToast("Couldn’t mark topic read", isError: true)
        }
    }

    func openEmail(_ email: Email) async {
        // Drafts open in compose, not read-only detail
        if email.isDraft || (selectedTab == .folder("draft")) {
            await openDraft(email)
            return
        }

        guard let mailboxId = selectedMailboxId else { return }

        // 1. Instant local read: check if body and thread are cached
        let localEmail = db.getEmail(id: email.id) ?? email
        let localThread = localEmail.threadId.map { db.getThreadEmails(mailboxId: mailboxId, threadId: $0) } ?? []

        selectedEmail = localEmail
        if !localThread.isEmpty {
            threadEmails = localThread
        } else {
            threadEmails = [localEmail]
        }

        // If body is already cached, zero skeleton delay!
        let hasBody = (localEmail.body != nil && !(localEmail.body?.isEmpty ?? true))
        isEmailDetailLoading = !hasBody

        // 2. Optimistic mark read
        if email.isUnread {
            db.updateEmailFlags(id: email.id, read: true)
            db.enqueueMutation(mailboxId: mailboxId, emailId: email.id, actionType: "mark_read", payload: ["read": true])
            outbox.trigger()

            if let idx = emails.firstIndex(where: { $0.id == email.id }) {
                emails[idx].read = true
                emails[idx].threadUnreadCount = 0
            }
            selectedEmail?.read = true
            selectedEmail?.threadUnreadCount = 0
            adjustFolderUnread(for: email, wasUnread: true, isUnread: false)
        }

        // 3. Silent fetch of full thread / body if needed
        let localHasDraft = localThread.contains(where: \.isDraft)
        let shouldLoadThread = email.hasDraft == true || (email.threadCount ?? 1) > 1 || localHasDraft
        Task {
            do {
                if let threadId = email.threadId, shouldLoadThread {
                    let remoteThread = try await APIClient.shared.getThread(mailboxId: mailboxId, threadId: threadId)
                    db.pruneLocalOnlyDrafts(
                        mailboxId: mailboxId,
                        threadId: threadId,
                        keepingIds: Set(remoteThread.map(\.id))
                    )
                    db.upsertEmails(mailboxId: mailboxId, emails: remoteThread, defaultFolder: email.folderId)
                    if selectedEmail?.id == email.id || selectedEmail?.threadId == threadId {
                        threadEmails = remoteThread
                    }
                } else if !hasBody {
                    let full = try await APIClient.shared.getEmail(mailboxId: mailboxId, id: email.id)
                    db.upsertEmails(mailboxId: mailboxId, emails: [full], defaultFolder: email.folderId)
                    if selectedEmail?.id == email.id {
                        selectedEmail = mergeListMetadata(email, with: full)
                        threadEmails = [full]
                    }
                }
            } catch {
                // Ignore background detail fetch error
            }
            isEmailDetailLoading = false
        }
    }

    /// Open an email from a push notification payload.
    /// Resolves and opens the message first; folder tab sync runs in the background
    /// so notification taps are not blocked on a full list refresh.
    func openEmailFromNotification(mailboxId: String, emailId: String, folderId: String?) async {
        if selectedMailboxId != mailboxId {
            await loadMailbox(mailboxId)
        }

        let resolved: Email
        if let local = emails.first(where: { $0.id == emailId }) ?? db.getEmail(id: emailId) {
            resolved = local
        } else {
            do {
                let remote = try await APIClient.shared.getEmail(mailboxId: mailboxId, id: emailId)
                db.upsertEmails(mailboxId: mailboxId, emails: [remote], defaultFolder: remote.folderId ?? folderId)
                resolved = remote
            } catch {
                showToast("Couldn’t open email", isError: true)
                return
            }
        }

        if let folderId, !folderId.isEmpty {
            let tab: HomeTab = (folderId == "inbox" && selectedTab == .aiInbox)
                ? selectedTab
                : .folder(folderId)
            // Assign tab directly — `selectTab` clears `selectedEmail` and awaits a folder sync.
            if selectedTab != tab {
                selectedTab = tab
                Task { await loadEmailsForCurrentTab(showLoading: false) }
            }
        }

        await openEmail(resolved)
    }

    /// Readable (non-draft) emails in the current list, in display order.
    var navigableEmails: [Email] {
        emails.filter { !$0.isDraft }
    }

    var canOpenPreviousEmail: Bool {
        guard let current = selectedEmail,
              let idx = navigableEmails.firstIndex(where: { $0.id == current.id }) else { return false }
        return idx > 0
    }

    var canOpenNextEmail: Bool {
        guard let current = selectedEmail,
              let idx = navigableEmails.firstIndex(where: { $0.id == current.id }) else { return false }
        return idx < navigableEmails.count - 1
    }

    func openAdjacentEmail(offset: Int) async {
        guard let current = selectedEmail,
              let idx = navigableEmails.firstIndex(where: { $0.id == current.id }) else { return }
        let next = idx + offset
        guard navigableEmails.indices.contains(next) else { return }
        await openEmail(navigableEmails[next])
    }

    private func mergeListMetadata(_ listRow: Email, with full: Email) -> Email {
        var merged = full
        if merged.folderId == nil { merged.folderId = listRow.folderId }
        if merged.folderName == nil { merged.folderName = listRow.folderName }
        if merged.threadCount == nil { merged.threadCount = listRow.threadCount }
        if merged.needsReply == nil { merged.needsReply = listRow.needsReply }
        if merged.hasDraft == nil { merged.hasDraft = listRow.hasDraft }
        return merged
    }

    func startCompose(
        mode: ComposeMode,
        original: Email? = nil,
        draft: Email? = nil,
        initialTo: [MailAddress] = []
    ) async {
        guard let mailbox = selectedMailbox else {
            errorMessage = "No mailbox selected."
            return
        }

        var enrichedOriginal = original
        var enrichedDraft = draft
        if let original {
            enrichedOriginal = (try? await APIClient.shared.getEmail(mailboxId: mailbox.id, id: original.id)) ?? original
        } else if let inReplyTo = draft?.inReplyTo, !inReplyTo.isEmpty {
            if let cached = db.getEmail(id: inReplyTo) {
                enrichedOriginal = cached
            } else {
                enrichedOriginal = try? await APIClient.shared.getEmail(mailboxId: mailbox.id, id: inReplyTo)
            }
        }
        if let draft {
            enrichedDraft = (try? await APIClient.shared.getEmail(mailboxId: mailbox.id, id: draft.id)) ?? draft
        }

        let form = ComposeFormModel(
            mode: mode,
            mailbox: mailbox,
            original: enrichedOriginal ?? original,
            draft: enrichedDraft ?? draft,
            initialTo: initialTo
        )
        form.onDraftSaved = { [weak self] draftId, threadId, originalEmailId, subject, body, recipient in
            self?.markThreadHasDraft(
                draftId: draftId,
                threadId: threadId,
                originalEmailId: originalEmailId,
                draftSubject: subject,
                draftBody: body,
                draftRecipient: recipient,
                hasDraft: true
            )
        }
        form.onDraftDeleted = { [weak self] draftId, threadId, originalEmailId in
            self?.markThreadHasDraft(
                draftId: draftId,
                threadId: threadId,
                originalEmailId: originalEmailId,
                draftSubject: nil,
                draftBody: nil,
                hasDraft: false
            )
        }
        composeSession = ComposeSession(form: form, presentation: .expanded)
        selectedEmail = nil
    }

    /// Open a saved draft in compose. Reply-drafts keep reply send semantics.
    func openDraft(_ draft: Email) async {
        let original = await resolveReplyOriginal(for: draft)
        let mode: ComposeMode = original != nil || (draft.inReplyTo?.isEmpty == false) ? .reply : .editDraft
        await startCompose(mode: mode, original: original, draft: draft)
    }

    private func resolveReplyOriginal(for draft: Email) async -> Email? {
        guard let inReplyTo = draft.inReplyTo, !inReplyTo.isEmpty else { return nil }
        if let fromThread = threadEmails.first(where: { $0.id == inReplyTo || $0.messageId == inReplyTo }) {
            return fromThread
        }
        if let cached = db.getEmail(id: inReplyTo) {
            return cached
        }
        guard let mailboxId = selectedMailboxId else { return nil }
        return try? await APIClient.shared.getEmail(mailboxId: mailboxId, id: inReplyTo)
    }

    /// Prefer the latest message from someone else; fall back to latest non-draft.
    var actionSourceEmail: Email? {
        let selfAddresses = Set(
            [selectedMailbox?.email, selectedMailbox?.id]
                .compactMap { $0?.lowercased() }
                .filter { !$0.isEmpty }
        )
        if let received = threadEmails.last(where: { !$0.isDraft && !selfAddresses.contains($0.sender.lowercased()) }) {
            return received
        }
        return threadEmails.last(where: { !$0.isDraft }) ?? selectedEmail
    }

    /// Discard a draft in the open thread without closing the conversation.
    func deleteThreadDraft(_ draft: Email) async {
        guard draft.isDraft, let mailboxId = selectedMailboxId else { return }
        do {
            try await APIClient.shared.deleteEmail(mailboxId: mailboxId, id: draft.id)
            db.deleteEmail(id: draft.id)
            threadEmails.removeAll { $0.id == draft.id }
            emails.removeAll { $0.id == draft.id }

            if selectedEmail?.id == draft.id || threadEmails.isEmpty {
                selectedEmail = nil
                threadEmails = []
                await loadEmailsForCurrentTab()
                return
            }

            let stillHasDraft = threadEmails.contains(where: \.isDraft)
            selectedEmail?.hasDraft = stillHasDraft
            if let selectedId = selectedEmail?.id,
               let idx = emails.firstIndex(where: { $0.id == selectedId }) {
                emails[idx].hasDraft = stillHasDraft
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func markThreadHasDraft(
        draftId: String,
        threadId: String?,
        originalEmailId: String?,
        draftSubject: String? = nil,
        draftBody: String? = nil,
        draftRecipient: String? = nil,
        hasDraft: Bool
    ) {
        // 1. Update emails in the current tab list (e.g. Inbox)
        for i in emails.indices {
            let e = emails[i]
            let matchesThread = threadId != nil && !threadId!.isEmpty && (e.threadId == threadId || e.id == threadId)
            let matchesOriginal = originalEmailId != nil && !originalEmailId!.isEmpty && (e.id == originalEmailId || e.threadId == originalEmailId)
            if matchesThread || matchesOriginal {
                let wasDraft = emails[i].hasDraft == true
                if hasDraft && !wasDraft {
                    emails[i].threadCount = (emails[i].threadCount ?? 1) + 1
                } else if !hasDraft && wasDraft {
                    emails[i].threadCount = max(1, (emails[i].threadCount ?? 2) - 1)
                }
                emails[i].hasDraft = hasDraft
            }
        }

        // 2. Update selectedEmail if open
        if let selected = selectedEmail {
            let matchesThread = threadId != nil && !threadId!.isEmpty && (selected.threadId == threadId || selected.id == threadId)
            let matchesOriginal = originalEmailId != nil && !originalEmailId!.isEmpty && (selected.id == originalEmailId || selected.threadId == originalEmailId)
            if matchesThread || matchesOriginal {
                let wasDraft = selectedEmail?.hasDraft == true
                if hasDraft && !wasDraft {
                    selectedEmail?.threadCount = (selectedEmail?.threadCount ?? 1) + 1
                } else if !hasDraft && wasDraft {
                    selectedEmail?.threadCount = max(1, (selectedEmail?.threadCount ?? 2) - 1)
                }
                selectedEmail?.hasDraft = hasDraft
            }
        }

        // 3. Update thread messages if active
        for i in threadEmails.indices {
            let e = threadEmails[i]
            let matchesThread = threadId != nil && !threadId!.isEmpty && (e.threadId == threadId || e.id == threadId)
            let matchesOriginal = originalEmailId != nil && !originalEmailId!.isEmpty && (e.id == originalEmailId || e.threadId == originalEmailId)
            if matchesThread || matchesOriginal {
                let wasDraft = threadEmails[i].hasDraft == true
                if hasDraft && !wasDraft {
                    threadEmails[i].threadCount = (threadEmails[i].threadCount ?? 1) + 1
                } else if !hasDraft && wasDraft {
                    threadEmails[i].threadCount = max(1, (threadEmails[i].threadCount ?? 2) - 1)
                }
                threadEmails[i].hasDraft = hasDraft
            }
        }

        // Keep threadEmails / local cache in sync if viewing this thread
        if hasDraft {
            let removed = threadEmails.filter { email in
                email.isDraft && email.id != draftId && Self.isRelatedDraft(
                    email,
                    threadId: threadId,
                    originalEmailId: originalEmailId
                )
            }
            threadEmails.removeAll { email in removed.contains(where: { $0.id == email.id }) }
            emails.removeAll { email in
                email.isDraft && email.id != draftId && Self.isRelatedDraft(
                    email,
                    threadId: threadId,
                    originalEmailId: originalEmailId
                )
            }
            for stale in removed {
                db.deleteEmail(id: stale.id)
            }
            if let idx = threadEmails.firstIndex(where: { $0.id == draftId }) {
                if let draftSubject { threadEmails[idx].subject = draftSubject }
                if let draftBody { threadEmails[idx].body = draftBody }
                if let draftRecipient { threadEmails[idx].recipient = draftRecipient }
            } else if let threadId, threadEmails.contains(where: { $0.threadId == threadId || $0.id == threadId }) {
                let draftEmail = Email(
                    id: draftId,
                    threadId: threadId,
                    folderId: "draft",
                    subject: draftSubject ?? "",
                    sender: selectedMailbox?.email ?? "",
                    senderName: selectedMailbox?.name,
                    recipient: draftRecipient ?? "",
                    date: ISO8601DateFormatter().string(from: Date()),
                    read: true,
                    starred: false,
                    body: draftBody,
                    inReplyTo: originalEmailId
                )
                threadEmails.append(draftEmail)
            }
            if let mailboxId = selectedMailboxId {
                db.deleteDrafts(
                    mailboxId: mailboxId,
                    threadId: threadId,
                    originalEmailId: originalEmailId,
                    keeping: draftId
                )
                db.upsertEmails(
                    mailboxId: mailboxId,
                    emails: [
                        Email(
                            id: draftId,
                            threadId: threadId,
                            folderId: "draft",
                            subject: draftSubject ?? "",
                            sender: selectedMailbox?.email ?? "",
                            senderName: selectedMailbox?.name,
                            recipient: draftRecipient ?? "",
                            date: ISO8601DateFormatter().string(from: Date()),
                            read: true,
                            starred: false,
                            body: draftBody,
                            inReplyTo: originalEmailId
                        )
                    ],
                    defaultFolder: "draft"
                )
            }
        } else {
            let removed = threadEmails.filter { email in
                email.id == draftId || (email.isDraft && Self.isRelatedDraft(
                    email,
                    threadId: threadId,
                    originalEmailId: originalEmailId
                ))
            }
            threadEmails.removeAll { email in removed.contains(where: { $0.id == email.id }) }
            emails.removeAll { email in
                email.id == draftId || (email.isDraft && Self.isRelatedDraft(
                    email,
                    threadId: threadId,
                    originalEmailId: originalEmailId
                ))
            }
            for stale in removed {
                db.deleteEmail(id: stale.id)
            }
            db.deleteEmail(id: draftId)
            if let mailboxId = selectedMailboxId {
                db.deleteDrafts(
                    mailboxId: mailboxId,
                    threadId: threadId,
                    originalEmailId: originalEmailId,
                    keeping: nil
                )
            }
        }
    }

    private static func isRelatedDraft(
        _ email: Email,
        threadId: String?,
        originalEmailId: String?
    ) -> Bool {
        if let threadId, !threadId.isEmpty, email.threadId == threadId || email.id == threadId {
            return true
        }
        if let originalEmailId, !originalEmailId.isEmpty,
           email.inReplyTo == originalEmailId || email.threadId == originalEmailId {
            return true
        }
        return false
    }


    func showToast(_ message: String, isError: Bool = false, isLoading: Bool = false, isUndo: Bool = false, duration: TimeInterval = 2.5) {
        toastDismissTask?.cancel()
        toast = AppToast(message: message, isError: isError, isLoading: isLoading, isUndo: isUndo)
        if duration > 0 {
            toastDismissTask = Task { @MainActor in
                try? await Task.sleep(for: .seconds(duration))
                guard !Task.isCancelled else { return }
                toast = nil
                toastDismissTask = nil
            }
        }
    }
    
    func hideToast() {
        toastDismissTask?.cancel()
        toast = nil
        toastDismissTask = nil
    }

    func scheduleUndoableAction(
        optimistic: @MainActor () -> Void,
        commit: @escaping @Sendable () async -> Void,
        rollback: @escaping @MainActor () -> Void,
        pendingMessage: String?,
        completedMessage: String
    ) {
        optimistic()
        commitPendingActionImmediately()
        
        let action = UndoableAction(message: completedMessage, execute: commit, rollback: rollback)
        let actionID = action.id
        self.pendingUndoAction = action
        
        pendingUndoTask = Task { @MainActor in
            if let pendingMessage {
                self.showToast(pendingMessage, isLoading: true, duration: 1.0)
                try? await Task.sleep(for: .seconds(1))
            }
            guard !Task.isCancelled, self.pendingUndoAction?.id == actionID else { return }
            
            self.showToast(completedMessage, isUndo: true, duration: 5.0)
            
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, self.pendingUndoAction?.id == actionID else { return }
            
            self.commitPendingActionImmediately()
        }
    }
    
    func commitPendingActionImmediately() {
        pendingUndoTask?.cancel()
        if let action = pendingUndoAction {
            let execute = action.execute
            Task { await execute() }
        }
        pendingUndoAction = nil
    }
    
    func undoPendingAction() {
        pendingUndoTask?.cancel()
        if let action = pendingUndoAction {
            let rollback = action.rollback
            rollback()
        }
        pendingUndoAction = nil
        hideToast()
    }

    func archiveRestoreFolder(for email: Email) -> String {
        if let folderId = email.folderId, !folderId.isEmpty, folderId != "archive" {
            return folderId
        }
        if let folderId = selectedTab.syncFolderId, folderId != "archive" {
            return folderId
        }
        return "inbox"
    }

    func toggleStar(on email: Email? = nil) async {
        guard let mailboxId = selectedMailboxId else { return }
        let target = email ?? selectedEmail ?? threadEmails.last
        guard let target else { return }
        let next = !target.starred

        // 1. Instant local optimistic update (<1ms)
        db.updateEmailFlags(id: target.id, starred: next)
        db.enqueueMutation(mailboxId: mailboxId, emailId: target.id, actionType: "star", payload: ["starred": next])
        outbox.trigger()

        var updated = target
        updated.starred = next
        applyEmailUpdate(updated)
    }

    func toggleRead(on email: Email? = nil) async {
        guard let mailboxId = selectedMailboxId else { return }
        let target = email ?? selectedEmail ?? threadEmails.last
        guard let target else { return }
        let next = !target.read

        // 1. Instant local optimistic update (<1ms)
        db.updateEmailFlags(id: target.id, read: next)
        db.enqueueMutation(mailboxId: mailboxId, emailId: target.id, actionType: "mark_read", payload: ["read": next])
        outbox.trigger()

        var updated = target
        updated.read = next
        applyEmailUpdate(updated)
    }

    func applyEmailUpdate(_ updated: Email) {
        let previous = emails.first(where: { $0.id == updated.id })
        if selectedEmail?.id == updated.id {
            selectedEmail = updated
        }
        if let idx = threadEmails.firstIndex(where: { $0.id == updated.id }) {
            threadEmails[idx] = updated
        }
        if let idx = emails.firstIndex(where: { $0.id == updated.id }) {
            emails[idx].read = updated.read
            emails[idx].starred = updated.starred
            if updated.read {
                emails[idx].threadUnreadCount = 0
            }
        }
        if let previous {
            adjustFolderUnread(for: previous, wasUnread: !previous.read, isUnread: !updated.read)
        }
    }

    func minimizeCompose() {
        composeSession?.minimize()
        if let form = composeSession?.form, !form.isEmpty && form.hasUnsavedChanges {
            Task { @MainActor in
                await form.saveDraft(explicit: false)
            }
        }
    }

    func expandCompose() {
        composeSession?.expand()
    }

    func closeCompose() {
        composeSession?.form.cancelAutoSave()
        composeSession = nil
    }

    func openChatSession(existingId: String? = nil, resumeActive: Bool = true, forceNew: Bool = false) {
        if let existingId, !existingId.isEmpty, existingId != Self.autoConversationId {
            chatSession = .conversation(existingId)
            if isKnownConversation(existingId) {
                activeConversationId = existingId
            }
            return
        }
        if forceNew {
            chatSession = .conversation(ChatSession.newConversationId())
            return
        }
        if resumeActive, let active = validatedActiveConversationId() {
            chatSession = .conversation(active)
            return
        }
        chatSession = .conversation(ChatSession.newConversationId())
    }

    func showChatList() {
        chatSession = .list
    }

    func startNewChat() {
        openChatSession(forceNew: true)
    }

    func dismissChatSession() {
        chatSession = .dismissed
    }

    func notePendingConversation(id: String, title: String, lastMessagePreview: String?) {
        pendingConversationIds.insert(id)
        let now = ISO8601DateFormatter().string(from: Date())
        upsertLocalConversation(
            AgentConversation(
                id: id,
                title: title,
                createdAt: now,
                updatedAt: now,
                lastMessagePreview: lastMessagePreview
            )
        )
    }

    func createConversation(id: String? = nil, title: String? = nil, lastMessagePreview: String? = nil) async -> AgentConversation? {
        guard let mailboxId = selectedMailboxId else { return nil }

        let targetId = id ?? ChatSession.newConversationId()
        guard targetId != Self.autoConversationId else { return nil }
        let finalTitle = (title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ? title! : "New chat"
        let now = ISO8601DateFormatter().string(from: Date())

        let optimistic = AgentConversation(
            id: targetId,
            title: finalTitle,
            createdAt: now,
            updatedAt: now,
            lastMessagePreview: lastMessagePreview
        )
        upsertLocalConversation(optimistic)
        pendingConversationIds.insert(targetId)

        do {
            let created = try await APIClient.shared.createConversation(
                mailboxId: mailboxId,
                id: targetId,
                title: finalTitle,
                lastMessagePreview: lastMessagePreview
            )
            if created.id == targetId {
                upsertLocalConversation(created)
                pendingConversationIds.remove(targetId)
                return created
            }

            // Old workers mint their own id. Messages already live on the client id's
            // EmailAgent, so drop the empty extra row instead of switching to it.
            conversations.removeAll { $0.id == created.id }
            pendingConversationIds.remove(created.id)
            try? await APIClient.shared.deleteConversation(mailboxId: mailboxId, id: created.id)
            return conversations.first(where: { $0.id == targetId }) ?? optimistic
        } catch {
            errorMessage = error.localizedDescription
            return optimistic
        }
    }

    func refreshConversations() async {
        guard let mailboxId = selectedMailboxId else { return }
        do {
            let server = try await APIClient.shared.listConversations(mailboxId: mailboxId)
            let visible = Self.visibleConversations(server)
            let serverIds = Set(visible.map(\.id))
            pendingConversationIds = pendingConversationIds.filter { !serverIds.contains($0) }
            let inFlight = conversations.filter { pendingConversationIds.contains($0.id) && !serverIds.contains($0.id) }
            conversations = visible
            for local in inFlight.reversed() {
                if !conversations.contains(where: { $0.id == local.id }) {
                    conversations.insert(local, at: 0)
                }
            }
            dropStaleActiveConversation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func updateConversation(id: String, title: String? = nil, lastMessagePreview: String? = nil) async -> AgentConversation? {
        guard let mailboxId = selectedMailboxId else { return nil }

        applyLocalConversationUpdate(id: id, title: title, lastMessagePreview: lastMessagePreview)

        do {
            let serverUpdated = try await APIClient.shared.updateConversation(
                mailboxId: mailboxId,
                id: id,
                title: title,
                lastMessagePreview: lastMessagePreview
            )
            upsertLocalConversation(serverUpdated)
            return serverUpdated
        } catch {
            if case APIError.http(404, _) = error {
                let local = conversations.first(where: { $0.id == id })
                return await createConversation(
                    id: id,
                    title: title ?? local?.title,
                    lastMessagePreview: lastMessagePreview ?? local?.lastMessagePreview
                )
            }
            print("[AppModel] Failed to update conversation \(id): \(error)")
            return nil
        }
    }

    func deleteConversation(id: String) async {
        guard let mailboxId = selectedMailboxId else { return }
        conversations.removeAll(where: { $0.id == id })
        pendingConversationIds.remove(id)
        if activeConversationId == id {
            activeConversationId = nil
        }
        if chatSession.conversationId == id {
            chatSession = .list
        }
        do {
            try await APIClient.shared.deleteConversation(mailboxId: mailboxId, id: id)
        } catch {
            errorMessage = error.localizedDescription
            await refreshConversations()
        }
    }

    /// Titles empty chats from the first user message, and deletes empty duplicates
    /// that would otherwise open as a blank "new chat" screen.
    func pruneEmptyConversations(authToken: String?) async {
        guard let mailboxId = selectedMailboxId else { return }
        var preserve = pendingConversationIds
        if let activeConversationId { preserve.insert(activeConversationId) }
        if let openId = chatSession.conversationId { preserve.insert(openId) }

        let visible = conversations.filter { $0.id != Self.autoConversationId }

        for conv in visible.filter({ $0.title == "New chat" }).prefix(8) {
            if preserve.contains(conv.id) { continue }
            guard let msgs = await AgentChatClient.fetchMessages(
                mailboxId: mailboxId,
                conversationId: conv.id,
                authToken: authToken
            ) else { continue }
            if let firstUser = msgs.first(where: { $0.role == "user" && !$0.text.isEmpty }) {
                let derived = ConversationTitleHelper.deriveTitle(from: firstUser.text)
                let lastText = msgs.last?.text ?? firstUser.text
                await updateConversation(id: conv.id, title: derived, lastMessagePreview: String(lastText.prefix(120)))
            } else if msgs.isEmpty {
                await deleteConversation(id: conv.id)
            }
        }

        let grouped = Dictionary(
            grouping: conversations.filter { $0.id != Self.autoConversationId },
            by: { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        )
        for (_, group) in grouped where group.count > 1 {
            for conv in group {
                if preserve.contains(conv.id) { continue }
                guard let msgs = await AgentChatClient.fetchMessages(
                    mailboxId: mailboxId,
                    conversationId: conv.id,
                    authToken: authToken
                ) else { continue }
                if msgs.isEmpty {
                    await deleteConversation(id: conv.id)
                }
            }
        }
    }

    private static let autoConversationId = "auto"

    private static func visibleConversations(_ conversations: [AgentConversation]) -> [AgentConversation] {
        conversations.filter { $0.id != autoConversationId }
    }

    private func isKnownConversation(_ id: String) -> Bool {
        pendingConversationIds.contains(id) || conversations.contains(where: { $0.id == id })
    }

    /// Ask AI should only resume a chat that still exists in this mailbox.
    private func validatedActiveConversationId() -> String? {
        dropStaleActiveConversation()
        return activeConversationId
    }

    private func dropStaleActiveConversation() {
        guard let active = activeConversationId, !isKnownConversation(active) else { return }
        activeConversationId = nil
    }

    private func upsertLocalConversation(_ conversation: AgentConversation) {
        if let idx = conversations.firstIndex(where: { $0.id == conversation.id }) {
            conversations[idx] = conversation
            let updated = conversations.remove(at: idx)
            conversations.insert(updated, at: 0)
        } else {
            conversations.insert(conversation, at: 0)
        }
    }

    private func applyLocalConversationUpdate(id: String, title: String?, lastMessagePreview: String?) {
        guard let idx = conversations.firstIndex(where: { $0.id == id }) else { return }
        if let title, !title.isEmpty {
            conversations[idx].title = title
        }
        if let lastMessagePreview {
            conversations[idx].lastMessagePreview = lastMessagePreview
        }
        conversations[idx].updatedAt = ISO8601DateFormatter().string(from: Date())
        let updated = conversations.remove(at: idx)
        conversations.insert(updated, at: 0)
    }

    func notifyAIToolCompleted() async {
        guard let mailboxId = selectedMailboxId else { return }
        _ = try? await syncService.syncFolder(mailboxId: mailboxId, folderId: "draft")
        if let folderId = selectedTab.syncFolderId {
            _ = try? await syncService.syncFolder(mailboxId: mailboxId, folderId: folderId)
            await loadEmailsForCurrentTab(showLoading: false)
        }
        if selectedTab == .aiInbox {
            await loadInboxDigest(showLoading: false)
        }
    }
}

struct AppToast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    var isError: Bool = false
    var isLoading: Bool = false
    var isUndo: Bool = false
}

enum HomeTab: Hashable {
    case folder(String)
    case chats
    case aiInbox

    static var inbox: HomeTab { .folder("inbox") }

    /// Folder id used for cache/sync when this tab shows mail-backed content.
    var syncFolderId: String? {
        switch self {
        case .folder(let id): return id
        case .aiInbox: return "inbox"
        case .chats: return nil
        }
    }

    var title: String {
        switch self {
        case .folder(let id):
            switch id {
            case "inbox": return "Inbox"
            case "promotions": return "Promotions"
            case "updates": return "Updates"
            case "sent": return "Sent"
            case "draft": return "Drafts"
            case "archive": return "Archive"
            case "spam": return "Spam"
            case "trash": return "Trash"
            default: return id.capitalized
            }
        case .chats:
            return "AI"
        case .aiInbox:
            return "For you"
        }
    }

    var systemImage: String {
        switch self {
        case .folder(let id):
            switch id {
            case "inbox": return "tray"
            case "promotions": return "megaphone"
            case "updates": return "newspaper"
            case "sent": return "paperplane"
            case "draft": return "pencil.and.scribble"
            case "archive": return "archivebox"
            case "spam": return "exclamationmark.triangle"
            case "trash": return "trash"
            default: return "folder"
            }
        case .chats:
            return "bubble.left.and.bubble.right"
        case .aiInbox:
            return "sparkles"
        }
    }
}

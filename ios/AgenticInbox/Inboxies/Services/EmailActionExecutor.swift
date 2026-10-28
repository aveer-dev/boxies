import Foundation

extension AppModel {
    /// Runs a configured swipe quick action on a list row.
    func performSwipeAction(_ action: SwipeQuickAction, on email: Email) async {
        switch action {
        case .delete:
            await deleteEmail(email, fromList: true)
        case .archive:
            await archiveEmail(email, fromList: true)
        case .star:
            await toggleStar(on: email)
        case .toggleRead:
            await toggleRead(on: email)
        case .reply:
            await startCompose(mode: .reply, original: email)
        }
    }

    func deleteEmail(_ email: Email, fromList: Bool = false) async {
        guard let mailboxId = selectedMailboxId else { return }

        scheduleUndoableAction(
            optimistic: {
                self.threadEmails.removeAll { $0.id == email.id }
                self.emails.removeAll { $0.id == email.id }

                if self.threadEmails.isEmpty {
                    self.selectedEmail = nil
                } else if self.selectedEmail?.id == email.id {
                    self.selectedEmail = self.threadEmails.last(where: { !$0.isDraft }) ?? self.threadEmails.last
                }
                if email.isUnread {
                    self.adjustFolderUnread(for: email, wasUnread: true, isUnread: false)
                }
            },
            commit: { @Sendable in
                DatabaseService.shared.deleteEmail(id: email.id)
                DatabaseService.shared.enqueueMutation(mailboxId: mailboxId, emailId: email.id, actionType: "delete", payload: [:])
                OutboxQueueWorker.shared.trigger()
            },
            rollback: { @MainActor in
                Task {
                    await self.loadEmailsForCurrentTab(showLoading: false)
                }
            },
            pendingMessage: "Deleting...",
            completedMessage: "Deleted"
        )
    }

    func archiveEmail(_ email: Email, fromList: Bool = false) async {
        guard let mailboxId = selectedMailboxId else { return }

        scheduleUndoableAction(
            optimistic: {
                self.threadEmails.removeAll { $0.id == email.id }
                self.emails.removeAll { $0.id == email.id }

                if self.threadEmails.isEmpty {
                    self.selectedEmail = nil
                } else if self.selectedEmail?.id == email.id {
                    self.selectedEmail = self.threadEmails.last(where: { !$0.isDraft }) ?? self.threadEmails.last
                }
                if email.isUnread {
                    self.adjustFolderUnread(for: email, wasUnread: true, isUnread: false)
                }
            },
            commit: { @Sendable in
                DatabaseService.shared.moveEmail(id: email.id, toFolderId: "archive")
                DatabaseService.shared.enqueueMutation(mailboxId: mailboxId, emailId: email.id, actionType: "move", payload: ["folderId": "archive"])
                OutboxQueueWorker.shared.trigger()
            },
            rollback: { @MainActor in
                Task {
                    await self.loadEmailsForCurrentTab(showLoading: false)
                }
            },
            pendingMessage: "Archiving...",
            completedMessage: "Archived"
        )
    }

    func moveEmail(
        _ email: Email,
        to folderId: String,
        fromList: Bool = false,
        setSenderPreference: Bool = false,
        unsubscribe: Bool = false
    ) async {
        guard let mailboxId = selectedMailboxId else { return }

        // Into or out of Spam is Not spam / Report spam: toast with Undo (AVE-98).
        if email.folderId != folderId, email.folderId == "spam" || folderId == "spam" {
            _ = await applySpamVerdict(email, to: folderId, fromList: fromList, unsubscribe: unsubscribe)
            return
        }

        // 1. Instant local optimistic move (<1ms)
        DatabaseService.shared.moveEmail(id: email.id, toFolderId: folderId)
        enqueueMove(mailboxId: mailboxId, email: email, folderId: folderId, setSenderPreference: setSenderPreference, unsubscribe: unsubscribe)
        await removeMovedEmailLocally(email, to: folderId)
    }

    private func enqueueMove(
        mailboxId: String,
        email: Email,
        folderId: String,
        setSenderPreference: Bool,
        unsubscribe: Bool,
        refileSender: Bool = true
    ) {
        var payload: [String: Any] = ["folderId": folderId]
        if setSenderPreference {
            payload["setSenderPreference"] = true
        }
        if unsubscribe {
            // The Worker sends the RFC 8058 POST at most once per message,
            // so an outbox retry is safe.
            payload["unsubscribe"] = true
        }
        if !refileSender {
            payload["refileSender"] = false
        }
        DatabaseService.shared.enqueueMutation(
            mailboxId: mailboxId,
            emailId: email.id,
            actionType: "move",
            payload: payload
        )
        OutboxQueueWorker.shared.trigger()
    }

    /// Not spam / Report spam, any path (AVE-95, AVE-98). Moves locally at once,
    /// then calls the Worker directly so the toast can say "· N more moved" and
    /// offer Undo. Offline, it falls back to the outbox (no Undo then).
    /// Returns whether the server took the move now.
    @discardableResult
    func applySpamVerdict(
        _ email: Email,
        to folderId: String,
        fromList: Bool = false,
        unsubscribe: Bool = false,
        refileSender: Bool = true
    ) async -> Bool {
        guard let mailboxId = selectedMailboxId else { return false }
        DatabaseService.shared.moveEmail(id: email.id, toFolderId: folderId)
        await removeMovedEmailLocally(email, to: folderId)
        do {
            let response = try await APIClient.shared.moveEmail(
                mailboxId: mailboxId,
                id: email.id,
                folderId: folderId,
                setSenderPreference: true,
                unsubscribe: unsubscribe,
                refileSender: refileSender
            )
            if (response.rescuedCount ?? 0) > 0 {
                // Other messages from the sender moved server-side.
                await loadEmailsForCurrentTab(showLoading: false)
            }
            if let title = SpamVerdictToast.title(for: response, folderId: folderId, sender: email.sender) {
                if let token = response.undoToken, !token.isEmpty {
                    showSpamVerdictUndoToast(title, mailboxId: mailboxId, undoToken: token)
                } else {
                    showToast(title)
                }
            }
            return true
        } catch {
            enqueueMove(
                mailboxId: mailboxId,
                email: email,
                folderId: folderId,
                setSenderPreference: true,
                unsubscribe: unsubscribe,
                refileSender: refileSender
            )
            if folderId == "spam" {
                showToast("Reported as spam")
            } else if email.folderId == "spam", folderId != "trash" {
                showToast("Moved out of Spam")
            }
            return false
        }
    }

    /// Verdict toast with Undo. The verdict is already on the server, so Undo
    /// calls `sender-rules/undo` instead of cancelling a delayed commit.
    private func showSpamVerdictUndoToast(_ message: String, mailboxId: String, undoToken: String) {
        commitPendingActionImmediately()
        let action = UndoableAction(
            message: message,
            execute: {},
            rollback: { @MainActor in
                Task { @MainActor in
                    do {
                        try await APIClient.shared.undoSenderVerdict(mailboxId: mailboxId, undoToken: undoToken)
                        await self.loadEmailsForCurrentTab(showLoading: false)
                        await self.refreshReplyLaterCount()
                        self.showToast("Undone")
                    } catch {
                        self.showToast("Couldn't undo", isError: true)
                    }
                }
            }
        )
        pendingUndoAction = action
        showToast(message, isUndo: true, duration: 6.0)
        let actionID = action.id
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(6))
            if self.pendingUndoAction?.id == actionID {
                self.pendingUndoAction = nil
            }
        }
    }

    private func removeMovedEmailLocally(_ email: Email, to folderId: String) async {
        threadEmails.removeAll { $0.id == email.id }
        emails.removeAll { $0.id == email.id }

        if threadEmails.isEmpty {
            selectedEmail = nil
        } else if selectedEmail?.id == email.id {
            selectedEmail = threadEmails.last(where: { !$0.isDraft }) ?? threadEmails.last
        }
        if email.isUnread {
            adjustFolderUnread(for: email, wasUnread: true, isUnread: false)
        }
        if folderId == "trash" || folderId == "spam" {
            await refreshReplyLaterCount()
            if selectedTab == .replyLater {
                await loadEmailsForCurrentTab(showLoading: false)
            }
        }
    }

    /// Move to Spam and reject the sender: their future mail is screened out.
    /// With `unsubscribe`, the Worker also sends the RFC 8058 one-click POST;
    /// with `refileSender` (the default), their Inbox / Promotions / Updates
    /// mail moves to Spam too (AVE-98).
    func reportSpam(_ email: Email, fromList: Bool = false, unsubscribe: Bool = false, refileSender: Bool = true) async {
        await applySpamVerdict(email, to: "spam", fromList: fromList, unsubscribe: unsubscribe, refileSender: refileSender)
    }

    /// Move back to Inbox and allow the sender; their other recent Spam is rescued (AVE-98).
    func markNotSpam(_ email: Email, fromList: Bool = false) async {
        await applySpamVerdict(email, to: "inbox", fromList: fromList)
    }

    func deleteCurrentEmail() async {
        guard let email = selectedEmail ?? threadEmails.last else { return }
        await deleteEmail(email)
    }

    func archiveCurrentEmail() async {
        guard let email = selectedEmail ?? threadEmails.last else { return }
        await archiveEmail(email)
    }

    func moveCurrentEmail(to folderId: String) async {
        guard let email = selectedEmail ?? threadEmails.last else { return }
        await moveEmail(email, to: folderId)
    }

    /// Screener-lite: allow sender and file queued mail to a purpose box.
    func approveScreenerSender(
        _ email: Email,
        destinationFolderId: String
    ) async {
        guard let mailboxId = selectedMailboxId else { return }
        let sender = email.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !sender.isEmpty else { return }

        do {
            try await APIClient.shared.approveSender(
                mailboxId: mailboxId,
                sender: sender,
                destinationFolderId: destinationFolderId,
                emailId: email.id,
                displayName: email.senderName
            )
            // Mirror archive: update local SQLite so empty-folder sync cannot revive ghosts.
            let queued = emails.filter {
                $0.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sender
                    && ($0.folderId == "screener" || $0.id == email.id)
            }
            for item in queued {
                DatabaseService.shared.moveEmail(id: item.id, toFolderId: destinationFolderId)
            }
            let queuedIds = Set(queued.map(\.id))
            emails.removeAll { queuedIds.contains($0.id) }
            if let selected = selectedEmail, queuedIds.contains(selected.id)
                || selected.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sender
            {
                selectedEmail = nil
                threadEmails = []
            }
            await loadEmailsForCurrentTab(showLoading: false)
            if let synced = try? await APIClient.shared.listFolders(mailboxId: mailboxId) {
                folders = synced
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Screener-lite: reject sender into screened_out (silent).
    func rejectScreenerSender(_ email: Email) async {
        guard let mailboxId = selectedMailboxId else { return }
        let sender = email.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !sender.isEmpty else { return }

        do {
            try await APIClient.shared.rejectSender(
                mailboxId: mailboxId,
                sender: sender,
                emailId: email.id,
                displayName: email.senderName
            )
            let queued = emails.filter {
                $0.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sender
                    && ($0.folderId == "screener" || $0.id == email.id)
            }
            for item in queued {
                DatabaseService.shared.moveEmail(id: item.id, toFolderId: "screened_out")
            }
            let queuedIds = Set(queued.map(\.id))
            emails.removeAll { queuedIds.contains($0.id) }
            if let selected = selectedEmail, queuedIds.contains(selected.id)
                || selected.sender.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == sender
            {
                selectedEmail = nil
                threadEmails = []
            }
            await loadEmailsForCurrentTab(showLoading: false)
            if let synced = try? await APIClient.shared.listFolders(mailboxId: mailboxId) {
                folders = synced
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteEmails(_ emailIDs: Set<String>) async {
        guard let mailboxId = selectedMailboxId, !emailIDs.isEmpty else { return }
        for id in emailIDs {
            DatabaseService.shared.deleteEmail(id: id)
            DatabaseService.shared.enqueueMutation(mailboxId: mailboxId, emailId: id, actionType: "delete", payload: [:])
            if selectedEmail?.id == id {
                selectedEmail = nil
                threadEmails = []
            }
            emails.removeAll { $0.id == id }
        }
        OutboxQueueWorker.shared.trigger()
    }

    func archiveEmails(_ emailIDs: Set<String>) async {
        guard let mailboxId = selectedMailboxId, !emailIDs.isEmpty else { return }
        for id in emailIDs {
            DatabaseService.shared.moveEmail(id: id, toFolderId: "archive")
            DatabaseService.shared.enqueueMutation(mailboxId: mailboxId, emailId: id, actionType: "move", payload: ["folderId": "archive"])
            if selectedEmail?.id == id {
                selectedEmail = nil
                threadEmails = []
            }
            emails.removeAll { $0.id == id }
        }
        OutboxQueueWorker.shared.trigger()
    }

    func markEmailsRead(_ emailIDs: Set<String>, read: Bool) async {
        guard let mailboxId = selectedMailboxId, !emailIDs.isEmpty else { return }
        for id in emailIDs {
            if let updated = try? await APIClient.shared.updateEmail(mailboxId: mailboxId, id: id, read: read) {
                applyEmailUpdate(updated)
            }
        }
    }

    func starEmails(_ emailIDs: Set<String>, starred: Bool) async {
        guard let mailboxId = selectedMailboxId, !emailIDs.isEmpty else { return }
        for id in emailIDs {
            if let updated = try? await APIClient.shared.updateEmail(mailboxId: mailboxId, id: id, starred: starred) {
                applyEmailUpdate(updated)
            }
        }
    }

    func moveEmails(_ emailIDs: Set<String>, to folderId: String) async {
        guard let mailboxId = selectedMailboxId, !emailIDs.isEmpty else { return }
        for id in emailIDs {
            try? await APIClient.shared.moveEmail(mailboxId: mailboxId, id: id, folderId: folderId)
            if selectedEmail?.id == id {
                selectedEmail = nil
                threadEmails = []
            }
            emails.removeAll { $0.id == id }
        }
    }

    /// Screener on/off for the selected mailbox (AVE-104). Turning it off moves the
    /// server's Screener mail to Inbox; mirror that in the local cache.
    func setScreenerEnabled(_ enabled: Bool) async -> Bool {
        let wasEnabled = isScreenerEnabled
        let ok = await updateMailboxSettings { settings in
            settings.screener = ScreenerSettings(enabled: enabled)
        }
        guard ok, wasEnabled, !enabled, let mailboxId = selectedMailboxId else { return ok }
        for email in DatabaseService.shared.getEmails(mailboxId: mailboxId, folderId: "screener", limit: nil) {
            DatabaseService.shared.moveEmail(id: email.id, toFolderId: "inbox")
        }
        if selectedTab == .folder("screener") {
            selectedTab = .folder("inbox")
        }
        if let synced = try? await APIClient.shared.listFolders(mailboxId: mailboxId) {
            folders = synced
        }
        await loadEmailsForCurrentTab(showLoading: false, resetPaging: true)
        return ok
    }

    func updateMailboxSettings(_ transform: (inout MailboxSettings) -> Void) async -> Bool {
        guard let mailboxId = selectedMailboxId else { return false }
        var settings = selectedMailbox?.settings ?? MailboxSettings()
        transform(&settings)
        do {
            let updated = try await APIClient.shared.updateMailbox(mailboxId: mailboxId, settings: settings)
            if let idx = mailboxes.firstIndex(where: { $0.id == mailboxId }) {
                mailboxes[idx] = updated
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

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
        setSenderPreference: Bool = false
    ) async {
        guard let mailboxId = selectedMailboxId else { return }

        // 1. Instant local optimistic move (<1ms)
        DatabaseService.shared.moveEmail(id: email.id, toFolderId: folderId)
        var payload: [String: Any] = ["folderId": folderId]
        if setSenderPreference {
            payload["setSenderPreference"] = true
        }
        DatabaseService.shared.enqueueMutation(
            mailboxId: mailboxId,
            emailId: email.id,
            actionType: "move",
            payload: payload
        )
        OutboxQueueWorker.shared.trigger()

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

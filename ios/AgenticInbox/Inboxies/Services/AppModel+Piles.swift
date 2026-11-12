import Foundation

/// Piles people make (AVE-194), beside Reply Later and Set Aside: put mail in one, view
/// it (`HomeTab.pile`), and create / rename / delete. Works like Set Aside: the mail stays
/// until you take it out, replying leaves it, and a mail is in one pile at a time (so
/// joining moves it out of Reply Later and drops a reminder). DEBUG previews keep piles in
/// memory. Web: `useReplyLater.setPile`, `PileDialogs.tsx`; Android twin: AppModel's pile
/// section.
extension AppModel {
    func customPile(id: String) -> WorkflowPile? {
        customPiles.first { $0.id == id }
    }

    /// The custom pile the mail is in, if any.
    func customPile(of email: Email) -> WorkflowPile? {
        guard let id = email.pileId, !MailPiles.isBuiltin(id) else { return nil }
        return customPile(id: id)
    }

    /// The custom pile whose view is on screen, if any.
    var openPileId: String? {
        if case .pile(let id) = selectedTab { return id }
        return nil
    }

    /// Opens a pile's view from anywhere (reader chip, Piles sheet); the home shell runs
    /// the push so it animates like Set Aside.
    func openPileView(_ pileId: String) {
        requestedTab = .pile(pileId)
    }

    /// Fresh pile list and counts (Set Aside and custom piles).
    func refreshPiles() async {
        guard let mailboxId = selectedMailboxId, !isDebugPreview else { return }
        guard let response = try? await APIClient.shared.listWorkflowPiles(mailboxId: mailboxId),
              selectedMailboxId == mailboxId else { return }
        customPiles = MailPiles.custom(response.piles)
        if response.pile(WorkflowPileID.setAside) != nil {
            setAsideCount = response.count(of: WorkflowPileID.setAside)
        }
    }

    // MARK: Put mail in a pile

    /// Puts the mail in a pile people made, or with nil takes it out of whatever pile it's
    /// in. Applied at once and queued like Set Aside (the outbox's `pile` mutation).
    func setPile(_ pileId: String?, on email: Email) async {
        guard !isReadOnly, let mailboxId = selectedMailboxId else { return }
        let previous = email.pileId
        guard previous != pileId else { return }
        if pileId == WorkflowPileID.replyLater {
            await toggleReplyLater(on: email)
            return
        }
        if pileId == WorkflowPileID.setAside || (pileId == nil && previous == WorkflowPileID.setAside) {
            await toggleSetAside(on: email)
            return
        }
        if pileId == nil && previous == WorkflowPileID.replyLater {
            await toggleReplyLater(on: email)
            return
        }

        let db = DatabaseService.shared
        if !isDebugPreview {
            db.updateEmailPile(id: email.id, pileId: pileId)
            db.enqueueMutation(
                mailboxId: mailboxId,
                emailId: email.id,
                actionType: "pile",
                payload: ["pile": pileId.map { $0 as Any } ?? NSNull()]
            )
            OutboxQueueWorker.shared.trigger()
        }

        applyEmailUpdate(Self.movingToPile(email, pileId))
        if let selected = selectedEmail, selected.id == email.id {
            selectedEmail = Self.movingToPile(selected, pileId)
        }
        // Optimistic counts, like Set Aside: a refetch would race the outbox.
        if let previous { setPileCount(previous, pileCount(previous) - 1) }
        if let pileId { setPileCount(pileId, pileCount(pileId) + 1) }

        if let pileId {
            showToast(MailPiles.movedToast(customPile(id: pileId).map(MailPiles.displayName) ?? "pile"), icon: "square.stack")
        } else {
            let name = previous.flatMap { customPile(id: $0) }.map(MailPiles.displayName) ?? "pile"
            showToast(MailPiles.removedToast(name))
        }
    }

    /// The mail moved to `pileId` (nil: out of its pile). Joining leaves Reply Later and
    /// drops its reminder, as the Worker does.
    static func movingToPile(_ email: Email, _ pileId: String?) -> Email {
        var updated = email
        updated.pileId = pileId
        updated.pileAt = pileId == nil ? nil : ISO8601DateFormatter().string(from: Date())
        if pileId != WorkflowPileID.replyLater {
            updated.replyLater = false
            updated.replyLaterAt = nil
            updated.replyLaterRemindAt = nil
            updated.replyLaterRemindedAt = nil
        }
        return updated
    }

    // MARK: Create, rename, delete

    /// Makes a pile. Names the Worker would refuse throw `CustomFolders.ValidationError`
    /// with the Worker's sentence, before any request.
    @discardableResult
    func createPile(name raw: String) async throws -> WorkflowPile {
        if let message = MailPiles.validate(raw, existing: customPiles) {
            throw CustomFolders.ValidationError(message: message)
        }
        guard case .ok(let name, _) = MailPiles.normalizeName(raw) else {
            throw CustomFolders.ValidationError(message: MailPiles.nameRequired)
        }
        let created: WorkflowPile
        if isDebugPreview {
            created = WorkflowPile(id: "p_\(UUID().uuidString.prefix(8).lowercased())", count: 0, name: name, builtin: false, clearsOnReply: false)
        } else {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            created = try await APIClient.shared.createPile(mailboxId: mailboxId, name: name)
            guard selectedMailboxId == mailboxId else { return created }
        }
        customPiles = customPiles.filter { $0.id != created.id } + [created]
        return created
    }

    /// Makes `name` and puts `email` in it (the picker's New pile row).
    func createPile(name raw: String, applyingTo email: Email) async throws {
        let created = try await createPile(name: raw)
        await setPile(created.id, on: email)
    }

    func renamePile(_ pile: WorkflowPile, to raw: String) async throws {
        if let message = MailPiles.validate(raw, existing: customPiles, renaming: pile) {
            throw CustomFolders.ValidationError(message: message)
        }
        guard case .ok(let name, _) = MailPiles.normalizeName(raw), name != pile.name else { return }
        if !isDebugPreview {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            _ = try await APIClient.shared.renamePile(mailboxId: mailboxId, pileId: pile.id, name: name)
            guard selectedMailboxId == mailboxId else { return }
        }
        customPiles = customPiles.map { current in
            guard current.id == pile.id else { return current }
            var renamed = current
            renamed.name = name
            return renamed
        }
    }

    /// Deletes a pile: its mail comes out of it and stays where it is. Its open view goes
    /// back to Inbox.
    func deletePile(_ pile: WorkflowPile) async throws {
        if !isDebugPreview {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            try await APIClient.shared.deletePile(mailboxId: mailboxId, pileId: pile.id)
            guard selectedMailboxId == mailboxId else { return }
            DatabaseService.shared.clearPile(mailboxId: mailboxId, pileId: pile.id)
        }
        customPiles.removeAll { $0.id == pile.id }
        for index in emails.indices where emails[index].pileId == pile.id {
            emails[index].pileId = nil
            emails[index].pileAt = nil
        }
        for index in threadEmails.indices where threadEmails[index].pileId == pile.id {
            threadEmails[index].pileId = nil
            threadEmails[index].pileAt = nil
        }
        if selectedEmail?.pileId == pile.id {
            selectedEmail?.pileId = nil
            selectedEmail?.pileAt = nil
        }
        if openPileId == pile.id {
            requestedTab = .inbox
        }
    }
}

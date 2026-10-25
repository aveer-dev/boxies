import CoreGraphics
import Foundation

/// Notes to self on the open conversation (AVE-61). Private to the signed-in user;
/// the Worker scopes every call to them. DEBUG previews keep notes in memory.
extension AppModel {
    func threadNotesStoreKey(mailboxId: String, threadKey: String) -> String {
        "\(mailboxId)|\(threadKey)"
    }

    /// The open conversation's notes, or none while another conversation's are loaded.
    func notes(forThread threadKey: String) -> [ThreadNote] {
        guard let mailboxId = selectedMailboxId,
              threadNotesKey == threadNotesStoreKey(mailboxId: mailboxId, threadKey: threadKey) else {
            return []
        }
        return threadNotes
    }

    func loadThreadNotes(threadKey: String) async {
        guard let mailboxId = selectedMailboxId else { return }
        let key = threadNotesStoreKey(mailboxId: mailboxId, threadKey: threadKey)
        if threadNotesKey != key {
            threadNotes = []
            threadNotesKey = key
        }
        if isDebugPreview {
            threadNotes = PreviewSupport.threadNotes[threadKey] ?? []
            return
        }
        do {
            let notes = try await APIClient.shared.listThreadNotes(mailboxId: mailboxId, threadId: threadKey)
            // Another conversation opened while the request was out: drop the result.
            guard threadNotesKey == key else { return }
            threadNotes = notes
            applyThreadNoteSummary(threadKey: threadKey)
        } catch {
            // Notes are extra context; the conversation still reads fine without them.
        }
    }

    /// Adds a note. A sticky with no `position` opens top-right (cascading), like web.
    @discardableResult
    func createThreadNote(
        threadKey: String,
        body: String,
        noteType: String,
        emailId: String? = nil,
        position: CGPoint? = nil
    ) async -> Bool {
        guard let mailboxId = selectedMailboxId else { return false }
        let key = threadNotesStoreKey(mailboxId: mailboxId, threadKey: threadKey)
        let created: ThreadNote
        if isDebugPreview {
            let now = NoteDates.now()
            created = ThreadNote(
                id: UUID().uuidString,
                threadId: threadKey,
                emailId: emailId,
                noteType: noteType,
                body: body,
                posX: position.map { Double($0.x) },
                posY: position.map { Double($0.y) },
                createdAt: now,
                updatedAt: now
            )
        } else {
            do {
                created = try await APIClient.shared.createThreadNote(
                    mailboxId: mailboxId,
                    threadId: threadKey,
                    body: body,
                    noteType: noteType,
                    emailId: emailId,
                    position: position
                )
            } catch {
                showToast("Couldn’t save the note", isError: true)
                return false
            }
        }
        guard threadNotesKey == key else { return true }
        threadNotes.append(created)
        didChangeThreadNotes(threadKey: threadKey)
        return true
    }

    @discardableResult
    func updateThreadNoteBody(_ note: ThreadNote, body: String) async -> Bool {
        guard let mailboxId = selectedMailboxId else { return false }
        let updated: ThreadNote
        if isDebugPreview {
            var local = note
            local.body = body
            local.updatedAt = NoteDates.now()
            updated = local
        } else {
            do {
                updated = try await APIClient.shared.updateThreadNote(mailboxId: mailboxId, noteId: note.id, body: body)
            } catch {
                showToast("Couldn’t save the note", isError: true)
                return false
            }
        }
        replaceThreadNote(updated)
        didChangeThreadNotes(threadKey: note.threadId)
        return true
    }

    /// Saves where a sticky was dropped. Moves at once; puts it back if the save fails.
    func moveThreadNote(_ note: ThreadNote, to position: CGPoint) async {
        guard let mailboxId = selectedMailboxId else { return }
        var moved = note
        moved.posX = Double(position.x)
        moved.posY = Double(position.y)
        replaceThreadNote(moved)
        guard !isDebugPreview else {
            PreviewSupport.threadNotes[note.threadId] = threadNotes
            return
        }
        do {
            let saved = try await APIClient.shared.updateThreadNote(mailboxId: mailboxId, noteId: note.id, position: position)
            replaceThreadNote(saved)
        } catch {
            replaceThreadNote(note)
            showToast("Couldn’t move the note", isError: true)
        }
    }

    /// Deletes a note at once; restores it if the server refuses.
    func deleteThreadNote(_ note: ThreadNote) async {
        guard let mailboxId = selectedMailboxId,
              let index = threadNotes.firstIndex(where: { $0.id == note.id }) else { return }
        threadNotes.remove(at: index)
        didChangeThreadNotes(threadKey: note.threadId)
        guard !isDebugPreview else { return }
        do {
            try await APIClient.shared.deleteThreadNote(mailboxId: mailboxId, noteId: note.id)
        } catch {
            if !threadNotes.contains(where: { $0.id == note.id }) {
                threadNotes.insert(note, at: min(index, threadNotes.count))
                didChangeThreadNotes(threadKey: note.threadId)
            }
            showToast("Couldn’t delete the note", isError: true)
        }
    }

    private func replaceThreadNote(_ note: ThreadNote) {
        guard let index = threadNotes.firstIndex(where: { $0.id == note.id }) else { return }
        threadNotes[index] = note
    }

    private func didChangeThreadNotes(threadKey: String) {
        if isDebugPreview {
            PreviewSupport.threadNotes[threadKey] = threadNotes
        }
        applyThreadNoteSummary(threadKey: threadKey)
    }

    /// Mirrors the open conversation's notes onto its list row (memory and cache),
    /// so the sticky strip and private-note count update before the next sync.
    private func applyThreadNoteSummary(threadKey: String) {
        guard let mailboxId = selectedMailboxId,
              threadNotesKey == threadNotesStoreKey(mailboxId: mailboxId, threadKey: threadKey) else { return }
        let summary = ThreadNoteSummary(notes: threadNotes)
        for index in emails.indices where emails[index].noteThreadKey == threadKey {
            emails[index].hasStickyNote = summary.hasStickyNote
            emails[index].stickyNoteText = summary.stickyNoteText
            emails[index].inlineNoteCount = summary.inlineNoteCount
        }
        if selectedEmail?.noteThreadKey == threadKey {
            selectedEmail?.hasStickyNote = summary.hasStickyNote
            selectedEmail?.stickyNoteText = summary.stickyNoteText
            selectedEmail?.inlineNoteCount = summary.inlineNoteCount
        }
        if !isDebugPreview {
            DatabaseService.shared.updateThreadNoteSummary(mailboxId: mailboxId, threadKey: threadKey, summary: summary)
        }
    }
}

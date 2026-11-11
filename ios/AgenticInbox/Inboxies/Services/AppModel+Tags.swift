import Foundation

/// Tags (AVE-242): many per email, on top of the one folder it lives in. Tagging works
/// on the whole conversation (`MailTags.threadKey`), like web; replies that arrive later
/// start untagged. A tag is a view (`HomeTab.tag`) of everything carrying it outside
/// Trash, Spam and Drafts. DEBUG previews keep tags in memory. Android twin: AppModel's
/// tag section.
extension AppModel {
    /// The tag whose view is on screen, if any.
    var openTagId: String? {
        if case .tag(let id) = selectedTab { return id }
        return nil
    }

    func tag(id: String) -> MailTag? {
        tags.first { $0.id == id }
    }

    /// Title for a tab, using the tag's live name for tag views.
    func title(for tab: HomeTab) -> String {
        if case .tag(let id) = tab { return tag(id: id)?.name ?? tab.title }
        return tab.title
    }

    /// Tags on the open conversation: every message's plus the list row's (which carries
    /// the conversation's), so cached messages without tags still show them.
    func conversationTags(for email: Email) -> [TagRef] {
        let key = MailTags.threadKey(email)
        return MailTags.union(threadEmails.filter { MailTags.threadKey($0) == key } + [email])
    }

    /// Opens a tag's view from anywhere (reader chip, Tags sheet); the home shell runs
    /// the push so it animates like Reply Later.
    func openTagView(_ tagId: String) {
        requestedTab = .tag(tagId)
    }

    func refreshTags() async {
        guard let mailboxId = selectedMailboxId, !isDebugPreview else { return }
        guard let fresh = try? await APIClient.shared.listTags(mailboxId: mailboxId),
              selectedMailboxId == mailboxId else { return }
        tags = MailTags.sorted(fresh)
    }

    // MARK: Tag an email (its conversation)

    /// Adds (`on`) or removes `tag` on `email`'s whole conversation. Applied at once;
    /// rolled back with a toast when the Worker refuses.
    func setTag(_ tag: TagRef, on: Bool, for email: Email) async {
        guard !isReadOnly, let mailboxId = selectedMailboxId else { return }
        let threadId = MailTags.threadKey(email)
        let inThread: (Email) -> Bool = { MailTags.threadKey($0) == threadId }

        // Snapshot what the change touches, by id, for the rollback.
        let previousRows = Dictionary(emails.filter(inThread).map { ($0.id, $0.tags) }, uniquingKeysWith: { a, _ in a })
        let previousMessages = Dictionary(threadEmails.filter(inThread).map { ($0.id, $0.tags) }, uniquingKeysWith: { a, _ in a })
        let previousSelected = selectedEmail.flatMap { inThread($0) ? $0.tags : nil }
        let removedRows = emails.filter(inThread)

        emails = MailTags.patchThread(emails, threadId: threadId, tag: tag, on: on)
        threadEmails = MailTags.patchThread(threadEmails, threadId: threadId, tag: tag, on: on)
        if let selected = selectedEmail, inThread(selected) {
            selectedEmail?.tags = MailTags.withTag(selected.tags, tag, on: on)
        }
        let leavesView = !on && openTagId == tag.id
        if leavesView {
            emails.removeAll(where: inThread)
            showToast(MailTags.removedToast(tag.name))
        }

        if isDebugPreview {
            adjustPreviewTagCount(tag.id, by: on ? 1 : -1, unread: email.isUnread)
            return
        }

        do {
            let response = try await APIClient.shared.setThreadTag(
                mailboxId: mailboxId, threadId: threadId, tagId: tag.id, on: on
            )
            guard selectedMailboxId == mailboxId else { return }
            // List rows carry the conversation's tags; each message carries its own.
            var cache: [String: [TagRef]] = [:]
            for index in emails.indices where inThread(emails[index]) {
                emails[index].tags = response.tags
                cache[emails[index].id] = response.tags
            }
            for message in threadEmails where response.emailIds.contains(message.id) {
                cache[message.id] = message.tags ?? []
            }
            for id in response.emailIds where cache[id] == nil {
                // Messages not on screen: patch the cached copy.
                if let cached = DatabaseService.shared.getEmail(id: id) {
                    cache[id] = MailTags.withTag(cached.tags, tag, on: on)
                }
            }
            DatabaseService.shared.updateEmailTags(cache)
            await refreshTags()
        } catch {
            guard selectedMailboxId == mailboxId else { return }
            if leavesView, openTagId == tag.id {
                emails = EmailListPaging.appending(removedRows, to: emails)
            }
            for index in emails.indices {
                if let tags = previousRows[emails[index].id] { emails[index].tags = tags }
            }
            for index in threadEmails.indices {
                if let tags = previousMessages[threadEmails[index].id] { threadEmails[index].tags = tags }
            }
            if let selected = selectedEmail, inThread(selected) {
                selectedEmail?.tags = previousSelected
            }
            showToast(Self.message(for: error, fallback: MailTags.updateFailed), isError: true)
        }
    }

    // MARK: Create, rename, delete

    /// Creates a tag. Names the Worker would refuse throw `CustomFolders.ValidationError`
    /// with the Worker's sentence, before any request.
    @discardableResult
    func createTag(name raw: String) async throws -> MailTag {
        if let message = MailTags.validate(raw, existing: tags) {
            throw CustomFolders.ValidationError(message: message)
        }
        guard case .ok(let name, _) = MailTags.normalizeName(raw) else {
            throw CustomFolders.ValidationError(message: MailTags.nameRequired)
        }
        let created: MailTag
        if isDebugPreview {
            created = MailTag(id: "tag_\(UUID().uuidString.prefix(8).lowercased())", name: name)
        } else {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            created = try await APIClient.shared.createTag(mailboxId: mailboxId, name: name)
            guard selectedMailboxId == mailboxId else { return created }
        }
        tags = MailTags.sorted(tags.filter { $0.id != created.id } + [created])
        return created
    }

    /// Creates `name` and puts it on `email`'s conversation (the picker's Create row).
    func createTag(name raw: String, applyingTo email: Email) async throws {
        let created = try await createTag(name: raw)
        await setTag(created.ref, on: true, for: email)
    }

    func renameTag(_ tag: MailTag, to raw: String) async throws {
        if let message = MailTags.validate(raw, existing: tags, renaming: tag) {
            throw CustomFolders.ValidationError(message: message)
        }
        guard case .ok(let name, _) = MailTags.normalizeName(raw), name != tag.name else { return }
        var renamed = tag
        if isDebugPreview {
            renamed = MailTag(id: tag.id, name: name, emailCount: tag.emailCount, unreadCount: tag.unreadCount)
        } else {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            renamed = try await APIClient.shared.renameTag(mailboxId: mailboxId, tagId: tag.id, name: name)
            guard selectedMailboxId == mailboxId else { return }
        }
        tags = MailTags.sorted(tags.map { $0.id == tag.id ? renamed : $0 })
        relabel(tagId: tag.id, name: renamed.name)
    }

    /// Deletes a tag: it comes off every email, the emails stay. Its open view goes back
    /// to Inbox.
    func deleteTag(_ tag: MailTag) async throws {
        if !isDebugPreview {
            guard let mailboxId = selectedMailboxId else {
                throw CustomFolders.ValidationError(message: CustomFolders.noMailbox)
            }
            try await APIClient.shared.deleteTag(mailboxId: mailboxId, tagId: tag.id)
            guard selectedMailboxId == mailboxId else { return }
        }
        tags.removeAll { $0.id == tag.id }
        relabel(tagId: tag.id, name: nil)
        if openTagId == tag.id {
            requestedTab = .inbox
        }
    }

    /// Renames (or with nil drops) a tag on everything on screen and in the cache.
    private func relabel(tagId: String, name: String?) {
        emails = MailTags.replacing(emails, tagId: tagId, with: name)
        threadEmails = MailTags.replacing(threadEmails, tagId: tagId, with: name)
        if let selected = selectedEmail {
            selectedEmail = MailTags.replacing([selected], tagId: tagId, with: name).first
        }
        guard !isDebugPreview else { return }
        var cache: [String: [TagRef]] = [:]
        for email in emails + threadEmails { cache[email.id] = email.tags ?? [] }
        DatabaseService.shared.updateEmailTags(cache)
    }

    private func adjustPreviewTagCount(_ tagId: String, by delta: Int, unread: Bool) {
        guard let index = tags.firstIndex(where: { $0.id == tagId }) else { return }
        tags[index].emailCount = max(0, tags[index].emailCount + delta)
        if unread { tags[index].unreadCount = max(0, tags[index].unreadCount + delta) }
    }

    static func message(for error: Error, fallback: String) -> String {
        let message = error.localizedDescription
        return message.isEmpty ? fallback : message
    }
}

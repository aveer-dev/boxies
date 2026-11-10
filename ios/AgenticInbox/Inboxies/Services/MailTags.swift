import Foundation

/// The short form of a tag carried on email and thread payloads (`TagRef` in
/// `shared/tags.ts`).
struct TagRef: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

/// A tag as `GET /tags` lists it (AVE-240). Counts leave out Trash, Spam and Drafts.
struct MailTag: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    var emailCount: Int
    var unreadCount: Int

    init(id: String, name: String, emailCount: Int = 0, unreadCount: Int = 0) {
        self.id = id
        self.name = name
        self.emailCount = emailCount
        self.unreadCount = unreadCount
    }

    enum CodingKeys: String, CodingKey {
        case id, name, emailCount, unreadCount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        emailCount = (try? c.decodeIfPresent(Int.self, forKey: .emailCount)) ?? 0
        unreadCount = (try? c.decodeIfPresent(Int.self, forKey: .unreadCount)) ?? 0
    }

    var ref: TagRef { TagRef(id: id, name: name) }
}

/// `GET /tags`.
struct TagListResponse: Decodable {
    let tags: [MailTag]
}

/// `PUT` / `DELETE /threads/:threadId/tags/:tagId`.
struct ThreadTagsResponse: Decodable, Equatable {
    let threadId: String
    /// Every tag on any message of the thread, after the change.
    let tags: [TagRef]
    /// Messages whose tags changed.
    let emailIds: [String]
}

/// Tags (AVE-188 / AVE-242): an email keeps its one folder and can carry any number of
/// tags. Pure helpers and copy, mirroring web `app/lib/tags.ts` and the Worker's
/// `normalizeTagName` (`shared/tags.ts`). Android twin: `MailTags.kt`.
enum MailTags {
    /// `TAG_NAME_MAX` in `shared/tags.ts`, in characters (code points).
    static let nameMax = 64

    // MARK: Copy (web + Android)

    static let groupTitle = "Tags"
    static let groupEmpty = "No tags yet. A message can have several."
    static let createLabel = "Create tag"
    static let pickerTitle = "Tags"
    static let pickerPlaceholder = "Find or create a tag"
    static let pickerEmpty = "No tags yet. Type a name to create one."
    static let createTitle = "New tag"
    static let nameField = "Tag name"
    static let renameTitle = "Rename tag"
    static let renameMenu = "Rename tag…"
    static let deleteMenu = "Delete tag"
    static let deleteMessage = "The tag comes off every email. The emails stay where they are."
    static let removeAction = "Remove tag"
    static let addChip = "Add tag"
    static let emptyViewMessage = "Add this tag to an email from its Tags menu."
    static let updateFailed = "Couldn’t update tags"
    static let createFailed = "Couldn’t create tag"
    static let renameFailed = "Couldn’t rename tag"
    static let deleteFailed = "Couldn’t delete tag"
    static let nameRequired = "Tag name is required"
    static let invalidCharacters = "Tag name contains invalid characters"
    static let nameTooLong = "Tag name must be at most \(nameMax) characters"
    /// The Worker's 409 sentence; also caught before the request.
    static let duplicateName = "Tag with this name already exists"

    static func createOption(_ name: String) -> String { "Create “\(name)”" }
    static func deleteTitle(_ name: String) -> String { "Delete “\(name)”?" }
    static func emptyViewTitle(_ name: String) -> String { "Nothing tagged \(name)" }
    static func removedToast(_ name: String) -> String { "Removed \(name)" }

    static func unreadLabel(_ count: Int) -> String {
        count == 0 ? "No unread" : "\(count) unread"
    }

    // MARK: Names

    enum NameResult: Equatable {
        case ok(name: String, key: String)
        case invalid(String)
    }

    /// `normalizeTagName`: NFC, runs of whitespace folded to one space, trimmed; control
    /// characters and bidi overrides refused; at most `nameMax` characters. `key` is the
    /// case-insensitive form that must be unique per mailbox.
    static func normalizeName(_ raw: String) -> NameResult {
        let name = raw.precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return .invalid(nameRequired) }
        let forbidden: Set<UInt32> = [0x200E, 0x200F]
        for scalar in name.unicodeScalars {
            let v = scalar.value
            if scalar.properties.generalCategory == .control
                || forbidden.contains(v)
                || (0x202A...0x202E).contains(v)
                || (0x2066...0x2069).contains(v) {
                return .invalid(invalidCharacters)
            }
        }
        if name.unicodeScalars.count > nameMax { return .invalid(nameTooLong) }
        return .ok(name: name, key: name.lowercased())
    }

    /// Error sentence for a new (or renamed) tag name, or nil when it can go to the Worker.
    static func validate(_ raw: String, existing: [MailTag], renaming: MailTag? = nil) -> String? {
        switch normalizeName(raw) {
        case .invalid(let message):
            return message
        case .ok(_, let key):
            let taken = existing.contains { $0.id != renaming?.id && $0.name.lowercased() == key }
            return taken ? duplicateName : nil
        }
    }

    // MARK: Lists

    /// Name order, as the Worker sorts them (case-insensitive, then id).
    static func precedes(_ a: TagRef, _ b: TagRef) -> Bool {
        let x = a.name.lowercased()
        let y = b.name.lowercased()
        return x != y ? x < y : a.id < b.id
    }

    static func sorted(_ tags: [MailTag]) -> [MailTag] {
        tags.sorted { precedes($0.ref, $1.ref) }
    }

    /// `tags` with `tag` added (`on`) or removed, sorted by name.
    static func withTag(_ tags: [TagRef]?, _ tag: TagRef, on: Bool) -> [TagRef] {
        let rest = (tags ?? []).filter { $0.id != tag.id }
        return (on ? rest + [tag] : rest).sorted(by: precedes)
    }

    /// Every tag on any of `messages`, once each, sorted by name (a thread's tags).
    static func union(_ messages: [Email]) -> [TagRef] {
        var byId: [String: TagRef] = [:]
        for message in messages {
            for tag in message.tags ?? [] { byId[tag.id] = tag }
        }
        return byId.values.sorted(by: precedes)
    }

    /// The conversation key the tag routes use: `thread_id`, or the email's own id.
    static func threadKey(_ email: Email) -> String {
        if let threadId = email.threadId, !threadId.isEmpty { return threadId }
        return email.id
    }

    /// `emails` with `tag` added to or removed from every row of thread `threadId`
    /// (tagging a thread tags all its messages).
    static func patchThread(_ emails: [Email], threadId: String, tag: TagRef, on: Bool) -> [Email] {
        emails.map { email in
            guard threadKey(email) == threadId else { return email }
            var copy = email
            copy.tags = withTag(email.tags, tag, on: on)
            return copy
        }
    }

    /// Renames `tag` wherever `emails` carry it (deleted: `name` nil drops it).
    static func replacing(_ emails: [Email], tagId: String, with name: String?) -> [Email] {
        emails.map { email in
            guard let tags = email.tags, tags.contains(where: { $0.id == tagId }) else { return email }
            var copy = email
            let rest = tags.filter { $0.id != tagId }
            copy.tags = (name.map { rest + [TagRef(id: tagId, name: $0)] } ?? rest).sorted(by: precedes)
            return copy
        }
    }

    /// What the picker lists for what's typed: the tags whose name contains it (all of
    /// them for an empty query), and the name to offer "Create" with, or nil when it's
    /// empty, invalid, or already a tag (names are unique case-insensitively). Web
    /// `tagPickerOptions`.
    static func pickerOptions(_ tags: [MailTag], query: String) -> (matches: [MailTag], create: String?) {
        let needle = query
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        let matches = needle.isEmpty ? tags : tags.filter { $0.name.lowercased().contains(needle) }
        guard case .ok(let name, let key) = normalizeName(query) else { return (matches, nil) }
        let taken = tags.contains { $0.name.lowercased() == key }
        return (matches, taken ? nil : name)
    }
}

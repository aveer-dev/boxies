import Foundation

/// Custom folders (AVE-158). A message lives in one: the folder it's in. Once labelled
/// "tags"; since AVE-241/242 they read as Folders on every client, and Tags are the
/// separate many-per-email layer (`MailTags`).
///
/// Mirrors the Worker's folder routes (`workers/index.ts` POST / PUT / DELETE
/// `/api/v1/mailboxes/:id/folders`) and the web Folders group
/// (`app/components/columns/FoldersColumn.tsx`), so a name the Worker would refuse is
/// caught before the request with the same sentence. Android twin: `CustomFolders.kt`.
enum CustomFolders {
    /// `SYSTEM_FOLDER_IDS` in `shared/folders.ts`. These can't be renamed or deleted.
    static let systemFolderIds: Set<String> = [
        "inbox", "screener", "promotions", "updates", "sent",
        "draft", "archive", "spam", "screened_out", "trash",
    ]

    // MARK: Copy (web + Worker)

    static let pageTitle = "Folders"
    static let introText = "Folders you create. A message lives in one; file mail into it with Move to Folder."
    static let emptyTitle = "No folders yet"
    /// Web: "No folders yet. A message lives in one folder."
    static let emptyMessage = "A message lives in one folder."
    static let namePlaceholder = "e.g. Engineering-PRs"
    static let nameField = "Folder name"
    static let createLabel = "Create folder"
    static let deleteButton = "Delete folder"
    static let createFailed = "Failed to create folder"
    static let renameFailed = "Failed to rename folder"
    static let deleteFailed = "Failed to delete folder"
    static let renameTitle = "Rename folder"
    static let deleteConfirmMessage = "Its mail moves to your Inbox. This can't be undone."
    static let noMailbox = "Select a mailbox first"

    /// Worker error sentences (`workers/index.ts`), shown as-is like web does.
    static let nameRequired = "Folder name is required"
    static let needsAlphanumeric = "Folder name must contain alphanumeric characters"
    static let duplicateName = "Folder with this name already exists"

    static func deleteConfirmTitle(_ folder: Folder) -> String {
        "Delete \(displayName(folder))?"
    }

    static func deletedToast(_ folder: Folder) -> String {
        "Deleted \(displayName(folder)). Its mail is in your Inbox."
    }

    // MARK: Rules

    static func isCustom(_ folder: Folder) -> Bool {
        !systemFolderIds.contains(folder.id)
    }

    /// Custom folders only, by name (web lists them in server order, which is by id).
    static func custom(in folders: [Folder]) -> [Folder] {
        folders
            .filter(isCustom)
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// "Receipts" for a folder named "#Receipts" (web strips one leading "#" and, since
    /// the Folders relabel, draws no "#" of its own).
    static func displayName(_ folder: Folder) -> String {
        bareName(folder.name)
    }

    static func bareName(_ name: String) -> String {
        name.hasPrefix("#") ? String(name.dropFirst()) : name
    }

    /// What we send: trimmed, one leading "#" dropped (web `handleCreateTag`).
    static func normalizedName(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return bareName(trimmed).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// `slugify` in `workers/index.ts`: the id the Worker gives a new folder.
    /// JS `\w` is ASCII-only, so spell the class out (NSRegularExpression's `\w` is Unicode).
    static func slug(_ name: String) -> String {
        var s = name.lowercased()
        s = s.replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        s = s.replacingOccurrences(of: "[^A-Za-z0-9_-]+", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "-{2,}", with: "-", options: .regularExpression)
        s = s.replacingOccurrences(of: "^-+", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "-+$", with: "", options: .regularExpression)
        return s
    }

    /// Error sentence for a new folder name, or nil when the Worker would accept it.
    static func validateCreate(_ raw: String, existing: [Folder]) -> String? {
        let name = normalizedName(raw)
        guard !name.isEmpty else { return nameRequired }
        let id = slug(name)
        guard !id.isEmpty else { return needsAlphanumeric }
        let lowered = name.lowercased()
        if systemFolderIds.contains(id)
            || existing.contains(where: { $0.id.lowercased() == id || $0.name.lowercased() == lowered }) {
            return duplicateName
        }
        return nil
    }

    /// Error sentence for renaming `folder`, or nil. Names may not match another folder's
    /// name or id, case-insensitively (the Durable Object's `updateFolder`).
    static func validateRename(_ raw: String, folder: Folder, existing: [Folder]) -> String? {
        let name = normalizedName(raw)
        guard !name.isEmpty else { return nameRequired }
        let lowered = name.lowercased()
        if systemFolderIds.contains(lowered)
            || existing.contains(where: {
                $0.id != folder.id && ($0.name.lowercased() == lowered || $0.id.lowercased() == lowered)
            }) {
            return duplicateName
        }
        return nil
    }

    /// Thrown before a request when the name fails `validateCreate` / `validateRename`.
    struct ValidationError: LocalizedError, Equatable {
        let message: String
        var errorDescription: String? { message }
    }
}

/// `PUT /folders/:id` answers `{ id, name }` without an unread count.
struct RenamedFolder: Decodable {
    let id: String
    let name: String
}

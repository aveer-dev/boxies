import Foundation

/// Piles people make (AVE-194) beside the built-in Reply Later and Set Aside: names,
/// copy and list helpers. Worker twin: `shared/piles.ts`; Android twin: `MailPiles.kt`.
/// A mail (and its thread) is in one pile at a time; replying clears Reply Later only.
enum MailPiles {
    /// `PILE_NAME_MAX`: longest name, in characters, after trimming.
    static let nameMax = 40
    /// `MAX_CUSTOM_PILES`: piles one mailbox can make (built-ins don't count).
    static let maxCustom = 20

    // MARK: Copy (shared with web and Android)

    static let groupTitle = "Piles"
    static let groupEmpty = "No piles of your own yet. Make one for mail that needs follow-through, like “Waiting on” or “To pay”."
    static let createLabel = "New pile"
    static let createTitle = "New pile"
    static let createMenu = "New pile…"
    static let pickerTitle = "Move to pile"
    static let pickerMenu = "Move to pile…"
    static let nameField = "Pile name"
    static let renameTitle = "Rename pile"
    static let renameMenu = "Rename pile…"
    static let deleteMenu = "Delete pile"
    static let deleteMessage = "Mail in this pile comes out of it and stays where it is. No email is deleted."
    static let emptyViewMessage = "Put mail here from its ⋯ menu. It stays until you take it out."
    static let updateFailed = "Couldn’t update the pile"
    static let createFailed = "Couldn’t make the pile"
    static let renameFailed = "Couldn’t rename the pile"
    static let deleteFailed = "Couldn’t delete the pile"
    static let nameRequired = "Pile name is required"
    static let invalidCharacters = "Pile name contains invalid characters"
    static let nameTooLong = "Pile name must be at most \(nameMax) characters"
    static let duplicateName = "A pile with this name already exists"
    static let tooMany = "A mailbox can have at most \(maxCustom) piles of its own"

    static func deleteTitle(_ name: String) -> String { "Delete “\(name)”?" }
    static func emptyViewTitle(_ name: String) -> String { "Nothing in \(name)" }
    static func movedToast(_ name: String) -> String { "Moved to \(name)" }
    static func removedToast(_ name: String) -> String { "Removed from \(name)" }
    static func removeAction(_ name: String) -> String { "Remove from \(name)" }

    static func subtitle(count: Int) -> String {
        count == 0 ? "Empty" : (count == 1 ? "1 in this pile" : "\(count) in this pile")
    }

    // MARK: Names

    enum NameResult: Equatable {
        case ok(name: String, key: String)
        case invalid(String)
    }

    /// `normalizePileName`: NFC, runs of whitespace folded to one space, trimmed; control
    /// characters and bidi overrides refused; at most `nameMax` characters. `key` is the
    /// case-insensitive form that must be unique per mailbox (built-in names included).
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

    /// Error sentence for a new (or renamed) pile name, or nil when it can go to the Worker.
    /// `existing` are the custom piles; the built-in names are always taken.
    static func validate(_ raw: String, existing: [WorkflowPile], renaming: WorkflowPile? = nil) -> String? {
        switch normalizeName(raw) {
        case .invalid(let message):
            return message
        case .ok(_, let key):
            let builtinNames = ["reply later", "set aside"]
            let taken = builtinNames.contains(key)
                || existing.contains { $0.id != renaming?.id && ($0.name ?? "").lowercased() == key }
            if taken { return duplicateName }
            if renaming == nil, existing.count >= maxCustom { return tooMany }
            return nil
        }
    }

    // MARK: Lists

    static func isBuiltin(_ id: String) -> Bool {
        id == WorkflowPileID.replyLater || id == WorkflowPileID.setAside
    }

    /// The piles people made, in the Worker's order. Older Workers send no `builtin`.
    static func custom(_ piles: [WorkflowPile]) -> [WorkflowPile] {
        piles.filter { pile in
            if let builtin = pile.builtin { return !builtin }
            return !isBuiltin(pile.id)
        }
    }

    static func displayName(_ pile: WorkflowPile) -> String {
        pile.name ?? "Pile"
    }
}

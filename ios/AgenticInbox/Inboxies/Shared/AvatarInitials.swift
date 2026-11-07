import Foundation

/// Initials for avatar discs. Shared with the widget extension (AVE-149).
enum AvatarInitials {
    /// Two letters for a two-character name or first + last; otherwise the first letter.
    static func from(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "A" }

        let source = trimmed.contains("@")
            ? String(trimmed.split(separator: "@").first ?? Substring(trimmed))
            : trimmed
        let parts = source
            .split { $0.isWhitespace || $0 == "." || $0 == "_" }
            .map(String.init)
            .filter { !$0.isEmpty }

        if parts.count >= 2 {
            return String(parts[0].prefix(1) + parts[parts.count - 1].prefix(1)).uppercased()
        }

        let word = parts.first ?? source
        if word.count <= 2 {
            return word.uppercased()
        }
        return String(word.prefix(1)).uppercased()
    }
}

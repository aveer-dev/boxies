import Foundation

/// Text helpers for the watch's message view (AVE-144). Pure, so the iOS test
/// target covers them.
enum WatchMailText {
    /// The plan trims watch bodies to about 2 KB.
    static let bodyLimit = 2_000

    /// Fixed short replies for v1, the same four the notification plan lists.
    static let cannedReplies = ["Thanks!", "Got it, will reply soon", "Can we talk later?", "👍"]

    /// A readable plain-text version of a mail body (HTML or text), trimmed to `limit`
    /// characters. No rich rendering on the watch.
    static func plainText(from body: String?, limit: Int = bodyLimit) -> String {
        guard var text = body, !text.isEmpty else { return "" }
        if looksLikeHTML(text) {
            text = stripHTML(text)
        }
        text = text.replacingOccurrences(of: "\r\n", with: "\n")
        // Collapse runs of spaces and blank lines.
        text = text.replacingOccurrences(of: "[ \t\u{00A0}]+", with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: " *\n *", with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > limit else { return text }
        let cut = text.prefix(limit)
        // End on a word boundary when one is close.
        if let space = cut.lastIndex(where: { $0 == " " || $0 == "\n" }),
           cut.distance(from: space, to: cut.endIndex) < 40 {
            return String(cut[..<space]) + "…"
        }
        return String(cut) + "…"
    }

    static func looksLikeHTML(_ text: String) -> Bool {
        text.range(of: "<[a-zA-Z!/][^>]*>", options: .regularExpression) != nil
    }

    private static func stripHTML(_ html: String) -> String {
        var text = html
        // Drop things that never render as text.
        for tag in ["head", "style", "script", "title"] {
            text = text.replacingOccurrences(
                of: "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)\\s*>",
                with: "",
                options: [.regularExpression, .caseInsensitive]
            )
        }
        text = text.replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: "", options: .regularExpression)
        // Line breaks for block ends.
        text = text.replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(
            of: "</(p|div|tr|li|h[1-6]|blockquote|table)\\s*>",
            with: "\n",
            options: [.regularExpression, .caseInsensitive]
        )
        text = text.replacingOccurrences(of: "<li\\b[^>]*>", with: "• ", options: [.regularExpression, .caseInsensitive])
        text = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        return decodeEntities(text)
    }

    private static let namedEntities: [String: String] = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "#39": "'",
        "nbsp": " ", "ndash": "–", "mdash": "—", "hellip": "…", "rsquo": "’", "lsquo": "‘",
        "rdquo": "”", "ldquo": "“", "copy": "©", "reg": "®", "zwnj": "", "zwj": "",
    ]

    private static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = ""
        result.reserveCapacity(text.count)
        var index = text.startIndex
        while index < text.endIndex {
            let char = text[index]
            guard char == "&", let semi = text[index...].prefix(12).firstIndex(of: ";") else {
                result.append(char)
                index = text.index(after: index)
                continue
            }
            let name = String(text[text.index(after: index)..<semi])
            if let replacement = namedEntities[name.lowercased()] {
                result += replacement
            } else if name.hasPrefix("#x") || name.hasPrefix("#X"),
                      let code = UInt32(name.dropFirst(2), radix: 16), let scalar = Unicode.Scalar(code) {
                result.unicodeScalars.append(scalar)
            } else if name.hasPrefix("#"), let code = UInt32(name.dropFirst()), let scalar = Unicode.Scalar(code) {
                result.unicodeScalars.append(scalar)
            } else {
                result.append(char)
                index = text.index(after: index)
                continue
            }
            index = text.index(after: semi)
        }
        return result
    }

    /// "Ada Lovelace" from the display name, else the address's local part.
    static func senderName(name: String?, address: String) -> String {
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        // "Name <addr>" from older rows.
        if let open = trimmed.firstIndex(of: "<"), open > trimmed.startIndex {
            let display = trimmed[..<open].trimmingCharacters(in: CharacterSet(charactersIn: " \""))
            if !display.isEmpty { return display }
        }
        return trimmed.isEmpty ? "Unknown sender" : trimmed
    }
}

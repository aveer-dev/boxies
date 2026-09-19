import Foundation

/// Parsed Gmail-style search operators — mirrors `app/lib/search-parser.ts`.
struct ParsedSearch: Equatable {
    var query: String = ""
    var from: String?
    var to: String?
    var subject: String?
    var folder: String?
    var isRead: Bool?
    var isStarred: Bool?
    var hasAttachment: Bool?
    var dateStart: String?
    var dateEnd: String?

    /// True when any structured filter is set (free-text may still be empty).
    var hasStructuredFilters: Bool {
        from != nil
            || to != nil
            || subject != nil
            || folder != nil
            || isRead != nil
            || isStarred != nil
            || hasAttachment == true
            || dateStart != nil
            || dateEnd != nil
    }

    /// Query params for `GET …/search`, omitting empty values.
    var apiQueryItems: [String: String] {
        var params: [String: String] = [:]
        if !query.isEmpty { params["query"] = query }
        if let from { params["from"] = from }
        if let to { params["to"] = to }
        if let subject { params["subject"] = subject }
        if let folder { params["folder"] = folder }
        if let dateStart { params["date_start"] = dateStart }
        if let dateEnd { params["date_end"] = dateEnd }
        if let isRead { params["is_read"] = isRead ? "true" : "false" }
        if let isStarred { params["is_starred"] = isStarred ? "true" : "false" }
        if hasAttachment == true { params["has_attachment"] = "true" }
        return params
    }
}

enum SearchQueryParser {
    /// Matches `operator:value` or `operator:"quoted value"` (case-insensitive ops).
    private static let operatorRegex: NSRegularExpression = {
        try! NSRegularExpression(
            pattern: #"\b(from|to|subject|in|is|has|before|after):(?:"([^"]*?)"|(\S+))"#,
            options: [.caseInsensitive]
        )
    }()

    static func parse(_ input: String) -> ParsedSearch {
        var result = ParsedSearch()
        let nsRange = NSRange(input.startIndex..<input.endIndex, in: input)
        let matches = operatorRegex.matches(in: input, options: [], range: nsRange)

        var remaining = input
        var ops: [(op: String, value: String)] = []

        for match in matches {
            guard match.numberOfRanges >= 4,
                  let fullRange = Range(match.range(at: 0), in: input),
                  let opRange = Range(match.range(at: 1), in: input)
            else { continue }

            let value: String
            if match.range(at: 2).location != NSNotFound,
               let quotedRange = Range(match.range(at: 2), in: input) {
                value = String(input[quotedRange])
            } else if match.range(at: 3).location != NSNotFound,
                      let bareRange = Range(match.range(at: 3), in: input) {
                value = String(input[bareRange])
            } else {
                value = ""
            }

            let op = String(input[opRange]).lowercased()
            ops.append((op, value))

            let fullMatch = String(input[fullRange])
            if let found = remaining.range(of: fullMatch) {
                remaining.removeSubrange(found)
            }
        }

        result.query = remaining
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        for (op, value) in ops {
            switch op {
            case "from":
                result.from = value
            case "to":
                result.to = value
            case "subject":
                result.subject = value
            case "in":
                result.folder = value.lowercased()
            case "is":
                switch value.lowercased() {
                case "unread": result.isRead = false
                case "read": result.isRead = true
                case "starred": result.isStarred = true
                case "unstarred": result.isStarred = false
                default: break
                }
            case "has":
                if value.lowercased() == "attachment" {
                    result.hasAttachment = true
                }
            case "before":
                result.dateEnd = normalizeDate(value)
            case "after":
                result.dateStart = normalizeDate(value)
            default:
                break
            }
        }

        return result
    }

    /// Normalize to ISO-8601. Accepts YYYY-MM-DD or ISO date-times.
    private static func normalizeDate(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let out = ISO8601DateFormatter()
        out.formatOptions = [.withInternetDateTime]

        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: trimmed) {
            return out.string(from: d)
        }
        if let d = out.date(from: trimmed) {
            return out.string(from: d)
        }

        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(secondsFromGMT: 0)
        day.dateFormat = "yyyy-MM-dd"
        if let d = day.date(from: trimmed) {
            return out.string(from: d)
        }

        return nil
    }
}

import Foundation

/// AI summaries (AVE-20, native in AVE-218). Wire twin of `shared/ai-summaries.ts`.
///
/// Routes, under `/api/v1/mailboxes/:mailboxId`:
/// - `GET  /threads/:threadId/summary`             cached, or generated on first open
/// - `POST /threads/:threadId/summary/regenerate`  always re-runs the model
/// - `POST /emails/:emailId/summary/generate`      quick summary of one message
///
/// A model run over the mailbox's daily AI quota answers 429 (AVE-215).
struct AISummary: Codable, Equatable {
    var targetType: String
    /// Thread key for "thread", email id for "email".
    var targetId: String
    /// One to three plain-text sentences.
    var summary: String
    /// Action items / deadlines / questions. Often empty.
    var keyPoints: [String]
    var model: String
    var messageCount: Int
    var lastEmailId: String
    var createdAt: String
    var updatedAt: String

    private enum CodingKeys: String, CodingKey {
        case targetType = "target_type"
        case targetId = "target_id"
        case summary
        case keyPoints = "key_points"
        case model
        case messageCount = "message_count"
        case lastEmailId = "last_email_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(
        targetType: String = "thread",
        targetId: String,
        summary: String,
        keyPoints: [String] = [],
        model: String = "",
        messageCount: Int = 1,
        lastEmailId: String = "",
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.targetType = targetType
        self.targetId = targetId
        self.summary = summary
        self.keyPoints = keyPoints
        self.model = model
        self.messageCount = messageCount
        self.lastEmailId = lastEmailId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        targetType = try c.decodeIfPresent(String.self, forKey: .targetType) ?? "thread"
        targetId = try c.decodeIfPresent(String.self, forKey: .targetId) ?? ""
        summary = try c.decode(String.self, forKey: .summary)
        keyPoints = try c.decodeIfPresent([String].self, forKey: .keyPoints) ?? []
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        messageCount = try c.decodeIfPresent(Int.self, forKey: .messageCount) ?? 1
        lastEmailId = try c.decodeIfPresent(String.self, forKey: .lastEmailId) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

/// `AiSummaryResponse`: ready, not eligible (show nothing), or missing (email GET only).
enum AISummaryResponse: Decodable, Equatable {
    /// `cached` is false when the model ran for this request.
    case ready(AISummary, cached: Bool)
    /// folder · screened_out_sender · too_short · single_message. Clients show nothing.
    case notEligible(reason: String)
    case missing

    private enum CodingKeys: String, CodingKey {
        case status, summary, cached, reason
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .status) {
        case "ready":
            self = .ready(
                try c.decode(AISummary.self, forKey: .summary),
                cached: try c.decodeIfPresent(Bool.self, forKey: .cached) ?? true
            )
        case "missing":
            self = .missing
        case "not_eligible":
            self = .notEligible(reason: try c.decodeIfPresent(String.self, forKey: .reason) ?? "")
        default:
            // A status this build doesn't know: show nothing rather than fail.
            self = .notEligible(reason: "unknown")
        }
    }

    var summary: AISummary? {
        if case .ready(let summary, _) = self { return summary }
        return nil
    }
}

/// Which readers ask for a summary. Mirrors web `EmailPanel` `summaryEnabled`:
/// the open mail's folder can be summarized, and the thread's non-draft messages in
/// such folders hold at least `minChars` of text between them. The server re-checks
/// both; this only skips pointless calls.
enum AISummaryEligibility {
    /// `MIN_SUMMARY_CHARS`.
    static let minChars = 500

    /// `SUMMARY_EXCLUDED_FOLDER_IDS`: Screener, Screened out, Spam, Trash, Drafts.
    static let excludedFolderIds: Set<String> = ["screener", "screened_out", "spam", "trash", "draft"]

    /// `isSummaryFolderEligible`.
    static func isFolderEligible(_ folderId: String?) -> Bool {
        guard let folderId, !folderId.isEmpty else { return false }
        return !excludedFolderIds.contains(folderId)
    }

    static func isEnabled(email: Email?, thread: [Email]) -> Bool {
        guard let email, isFolderEligible(email.folderId), !email.isDraft else { return false }
        let messages = (thread.isEmpty ? [email] : thread)
            .filter { !$0.isDraft && isFolderEligible($0.folderId) }
        var chars = 0
        for message in messages {
            chars += plainText(message.body ?? "").count
            if chars >= minChars { return true }
        }
        return false
    }

    /// Web `stripHtml`: drop non-content blocks and tags, decode entities, collapse whitespace.
    static func plainText(_ html: String) -> String {
        guard !html.isEmpty else { return "" }
        var text = html
        for tag in ["head", "style", "script", "title"] {
            text = text.replacingOccurrences(
                of: "<\(tag)\\b[^>]*>[\\s\\S]*?</\(tag)\\s*>",
                with: " ",
                options: [.regularExpression, .caseInsensitive]
            )
        }
        text = text.replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]*>", with: " ", options: .regularExpression)
        for (entity, value) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] {
            text = text.replacingOccurrences(of: entity, with: value)
        }
        text = text.replacingOccurrences(of: "[\u{00AD}\u{034F}\u{200B}\u{200C}\u{FEFF}]", with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// The daily AI limit on summaries (AVE-215): a 429 from a summary route.
enum AISummaryQuota {
    static func isQuotaError(_ error: Error) -> Bool {
        if case APIError.http(429, _) = error { return true }
        return false
    }

    /// The quota resets at the next UTC midnight.
    static func nextReset(after now: Date = .now) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let today = calendar.startOfDay(for: now)
        return calendar.date(byAdding: .day, value: 1, to: today) ?? now.addingTimeInterval(86_400)
    }

    /// "Daily AI limit reached. Resets in 6h." — web `summaryQuotaText`.
    static func text(now: Date = .now) -> String {
        "Daily AI limit reached. \(AIUsageFormat.resetLabel(nextReset(after: now), now: now))."
    }
}

import Foundation

/// Which of an original's files a forward carries (AVE-181). Same rule as web
/// `shared/forward-attachments.ts` and Android `ForwardAttachments`, checked
/// against `shared/forward-attachments.fixtures.json`.
///
/// Inline `cid:` images that are part of the body are not attachments: they are
/// left out of "Include N attachments" and never sent as files.
enum ForwardAttachments {
    /// The original's real attachments, in order.
    static func forwardable(_ attachments: [Attachment]?, body: String?) -> [Attachment] {
        (attachments ?? []).filter { !isInlineBodyPart($0, body: body) }
    }

    /// `Content-Disposition: inline` (the reader hides these too), or an image the body shows via `cid:`.
    static func isInlineBodyPart(_ attachment: Attachment, body: String?) -> Bool {
        if attachment.disposition?.trimmingCharacters(in: .whitespaces).lowercased() == "inline" {
            return true
        }
        guard isImageMime(attachment.mimetype), let cid = attachment.normalizedContentId else { return false }
        return referencesContentId(body ?? "", cid: cid)
    }

    /// A downloaded original file, ready to send like any other attachment.
    static func pending(from attachment: Attachment, data: Data) -> ComposePendingAttachment {
        let type = attachment.mimetype.trimmingCharacters(in: .whitespaces)
        return ComposePendingAttachment(
            filename: attachment.filename.isEmpty ? "attachment" : attachment.filename,
            mimeType: type.isEmpty ? "application/octet-stream" : type,
            size: data.count,
            base64: data.base64EncodedString()
        )
    }

    /// "Include 1 attachment" / "Include 3 attachments".
    static func includeLabel(count: Int) -> String {
        "Include \(count) \(count == 1 ? "attachment" : "attachments")"
    }

    /// `image/png; name=x.png` counts; anything that isn't a plain image type doesn't.
    static func isImageMime(_ mimetype: String) -> Bool {
        let type = mimetype.split(separator: ";").first.map(String.init)?
            .trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return type.range(of: #"^image/[a-z0-9][a-z0-9.+-]*$"#, options: .regularExpression) != nil
    }

    /// `cid:<id>` or `cid:id` as a whole reference: `cid:img1` doesn't match inside `cid:img10`.
    static func referencesContentId(_ body: String, cid: String) -> Bool {
        guard !body.isEmpty, !cid.isEmpty else { return false }
        let id = NSRegularExpression.escapedPattern(for: cid)
        let pattern = #"cid:(?:&lt;|<)?"# + id + #"(?:&gt;|>)?(?=$|["'\s)\],;&<>])"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return false
        }
        return regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)) != nil
    }
}

enum ForwardAttachmentError: LocalizedError, Equatable {
    case download(filename: String)
    case tooLarge

    var errorDescription: String? {
        switch self {
        case .download(let filename): return "Couldn't attach \(filename). Try again, or turn off the attachments."
        case .tooLarge: return OutboundLimits.sizeError
        }
    }
}

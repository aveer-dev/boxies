import CoreGraphics
import Foundation

/// Pure helpers for notes to self (AVE-61), the iOS twin of web `app/lib/thread-notes.ts`:
/// where a sticky note sits, what the list row shows, and the markdown edits the
/// editor's buttons make. No SwiftUI here, so it is unit tested directly.
///
/// A sticky note's `posX` / `posY` are points from the top-left corner of the
/// reader's message area. They're clamped every time the note is laid out, so a
/// note saved on a wider screen still shows inside a narrower one (the saved
/// value is only rewritten when the user drags it).
enum StickyNoteLayout {
    /// Gap kept between a sticky note and the edges of the view.
    static let edge: CGFloat = 12
    /// Each further sticky without a saved spot opens this much lower and to the left.
    static let cascade: CGFloat = 24
    /// Points a finger must travel before a press on the note becomes a drag.
    static let dragThreshold: CGFloat = 3
    /// Seconds of the release velocity a throw carries, so a flick travels a little on.
    static let throwSeconds: CGFloat = 0.08
    /// Farthest a throw carries the note past where it was let go, in points.
    static let maxThrow: CGFloat = 48
    /// Degrees of drag tilt per point/second of horizontal speed.
    static let tiltPerVelocity: Double = 0.006
    /// Most a dragged note leans with its horizontal speed, in degrees either way.
    static let maxTilt: Double = 6
    /// Cap on the settle spring's relative launch speed, so a fast throw that lands
    /// close (say, against an edge) overshoots a little instead of flying past.
    static let maxSettleVelocity: CGFloat = 20
    /// Resting width of a sticky note (narrower views shrink it to fit).
    static let width: CGFloat = 260

    /// The note's width inside a view: `width`, or the view minus both edges when narrower.
    static func noteWidth(in view: CGSize) -> CGFloat {
        max(120, min(width, view.width - edge * 2))
    }

    /// Keeps a note of `note` size fully inside `view`, `edge` points from every side.
    /// A view smaller than the note pins it to the start edge.
    static func clamp(_ position: CGPoint, note: CGSize, view: CGSize, edge: CGFloat = edge) -> CGPoint {
        func axis(_ value: CGFloat, _ noteLength: CGFloat, _ viewLength: CGFloat) -> CGFloat {
            let maxValue = viewLength - noteLength - edge
            if maxValue <= edge { return edge }
            guard value.isFinite else { return edge }
            return min(max(value, edge), maxValue).rounded()
        }
        return CGPoint(
            x: axis(position.x, note.width, view.width),
            y: axis(position.y, note.height, view.height)
        )
    }

    /// Where a sticky note shows: its saved spot, or (never dragged) the top-right
    /// corner, cascading so several new notes don't stack exactly. Always clamped.
    static func position(saved: CGPoint?, index: Int, note: CGSize, view: CGSize) -> CGPoint {
        let offset = CGFloat(max(0, index)) * cascade
        let start = saved ?? CGPoint(x: view.width - note.width - edge - offset, y: edge + offset)
        return clamp(start, note: note, view: view)
    }

    /// True once a finger has moved far enough from where it pressed to count as a drag.
    static func passedDragThreshold(_ translation: CGSize, threshold: CGFloat = dragThreshold) -> Bool {
        hypot(translation.width, translation.height) >= threshold
    }

    /// The lean of a note dragged at `velocityX` points/second: proportional,
    /// clamped to ±`maxTilt`, like paper dragged through air. Positive leans clockwise.
    static func tilt(forVelocityX velocityX: CGFloat) -> Double {
        guard velocityX.isFinite else { return 0 }
        return min(max(Double(velocityX) * tiltPerVelocity, -maxTilt), maxTilt)
    }

    /// Where a released note comes to rest: where it was let go plus the release
    /// `velocity` (points/second) carried for `throwSeconds`, at most `maxThrow`
    /// points along the throw, then clamped inside the view (an out-of-bounds throw
    /// lands on the edge).
    static func throwTarget(release: CGPoint, velocity: CGSize, note: CGSize, view: CGSize) -> CGPoint {
        var dx = velocity.width.isFinite ? velocity.width * throwSeconds : 0
        var dy = velocity.height.isFinite ? velocity.height * throwSeconds : 0
        let distance = hypot(dx, dy)
        if distance > maxThrow {
            dx = dx / distance * maxThrow
            dy = dy / distance * maxThrow
        }
        return clamp(CGPoint(x: release.x + dx, y: release.y + dy), note: note, view: view)
    }

    /// The settle spring's initial velocity, relative to the distance left to travel
    /// (SwiftUI's `interpolatingSpring(initialVelocity:)` unit), so the note leaves the
    /// finger at the speed it was thrown: the release `velocity` (points/second)
    /// projected onto the path from `from` to `to`. Zero when there's no distance
    /// left; capped at ±`maxSettleVelocity`.
    static func settleVelocity(from: CGPoint, to: CGPoint, velocity: CGSize) -> Double {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared >= 0.25, velocity.width.isFinite, velocity.height.isFinite else { return 0 }
        let relative = (velocity.width * dx + velocity.height * dy) / lengthSquared
        return Double(min(max(relative, -maxSettleVelocity), maxSettleVelocity))
    }
}

/// A thread's notes split for the reader: stickies for the overlay, inline notes
/// grouped under the message they annotate (oldest first, as the API returns them).
struct ThreadNoteGroups: Equatable {
    var sticky: [ThreadNote] = []
    var inlineByEmail: [String: [ThreadNote]] = [:]

    init(_ notes: [ThreadNote]) {
        for note in notes {
            if note.isSticky {
                sticky.append(note)
            } else if let emailId = note.emailId {
                inlineByEmail[emailId, default: []].append(note)
            }
        }
    }
}

/// The list row's note fields, recomputed locally after a change so the row
/// updates before the next list sync (mirrors the Worker's `threadNoteSummaries`).
struct ThreadNoteSummary: Equatable {
    var hasStickyNote: Bool
    var stickyNoteText: String?
    var inlineNoteCount: Int

    /// Server cap on `sticky_note_text`, in characters.
    static let snippetMax = 200

    init(hasStickyNote: Bool, stickyNoteText: String?, inlineNoteCount: Int) {
        self.hasStickyNote = hasStickyNote
        self.stickyNoteText = stickyNoteText
        self.inlineNoteCount = inlineNoteCount
    }

    init(notes: [ThreadNote]) {
        let stickies = notes.filter(\.isSticky)
        // Latest sticky by creation (the server orders `created_at DESC, id DESC`).
        let latest = stickies.max { lhs, rhs in
            lhs.createdAt == rhs.createdAt ? lhs.id < rhs.id : lhs.createdAt < rhs.createdAt
        }
        self.init(
            hasStickyNote: !stickies.isEmpty,
            stickyNoteText: latest.map { Self.snippet($0.body) },
            inlineNoteCount: notes.filter { !$0.isSticky }.count
        )
    }

    /// Trimmed body, at most `snippetMax` characters (ellipsis included).
    static func snippet(_ body: String) -> String {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > snippetMax else { return trimmed }
        let cut = String(trimmed.prefix(snippetMax - 1))
        return cut.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) + "…"
    }
}

enum NoteText {
    /// One line of plain text from a note's markdown, for the list row and a folded
    /// sticky: no heading / list / quote markers, emphasis or code ticks; links keep
    /// their label; whitespace collapsed. Same rules as web `notePreviewText`.
    static func preview(_ markdown: String?) -> String {
        guard var text = markdown, !text.isEmpty else { return "" }
        text = replace(text, "```[^\\n]*\\n?", " ")
        text = replace(text, "!\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
        text = replace(text, "\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
        text = replace(
            text,
            "^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+\\[[ xX]\\]\\s+|[-*+]\\s+|\\d+[.)]\\s+)",
            "",
            options: [.anchorsMatchLines]
        )
        text = replace(text, "(\\*\\*|__|~~)(.+?)\\1", "$2")
        text = replace(text, "(^|[^\\w*])[*_](\\S(?:.*?\\S)?)[*_](?=[^\\w*]|$)", "$1$2")
        text = replace(text, "`([^`]*)`", "$1")
        text = replace(text, "\\s+", " ")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Markdown made safe to render: images become their alt text, so a note never
    /// loads a remote image. (Raw HTML is never interpreted: SwiftUI's markdown is
    /// inline-only and shows tags as text.)
    static func renderable(_ markdown: String) -> String {
        replace(markdown, "!\\[([^\\]]*)\\]\\([^)]*\\)", "$1")
    }

    private static func replace(
        _ text: String,
        _ pattern: String,
        _ template: String,
        options: NSRegularExpression.Options = []
    ) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return text }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, range: range, withTemplate: template)
    }
}

// MARK: - Editor formatting

enum NoteFormat: String, CaseIterable, Identifiable {
    case bold, italic, code, link, bullet, checklist

    var id: String { rawValue }

    var label: String {
        switch self {
        case .bold: return "Bold"
        case .italic: return "Italic"
        case .code: return "Code"
        case .link: return "Link"
        case .bullet: return "Bulleted list"
        case .checklist: return "Checklist"
        }
    }

    var systemImage: String {
        switch self {
        case .bold: return "bold"
        case .italic: return "italic"
        case .code: return "chevron.left.forwardslash.chevron.right"
        case .link: return "link"
        case .bullet: return "list.bullet"
        case .checklist: return "checklist"
        }
    }
}

/// Text plus selection (UTF-16 offsets, as `UITextView.selectedRange` uses).
struct NoteTextEdit: Equatable {
    var text: String
    var selection: NSRange
}

extension NoteFormat {
    private var wrapMark: String? {
        switch self {
        case .bold: return "**"
        case .italic: return "_"
        case .code: return "`"
        default: return nil
        }
    }

    private var linePrefix: String? {
        switch self {
        case .bullet: return "- "
        case .checklist: return "- [ ] "
        default: return nil
        }
    }

    /// Applies an editor button to the text and selection (web `applyNoteFormat`):
    /// - bold / italic / code wrap the selection (or unwrap it when already wrapped);
    ///   with nothing selected they insert the markers with the caret between them.
    /// - link turns the selection into `[selection](url)` with `url` selected.
    /// - bullet / checklist prefix every selected line, or remove the prefix when
    ///   every line already has it.
    func apply(to text: String, selection: NSRange) -> NoteTextEdit {
        let ns = text as NSString
        let length = ns.length
        let lower = selection.location == NSNotFound ? length : selection.location
        let start = max(0, min(lower, length))
        let end = min(length, max(start, lower + max(0, selection.length)))
        let selected = ns.substring(with: NSRange(location: start, length: end - start))
        let before = ns.substring(to: start)
        let after = ns.substring(from: end)

        if let mark = wrapMark {
            let markLength = (mark as NSString).length
            if !selected.isEmpty, before.hasSuffix(mark), after.hasPrefix(mark) {
                let trimmedBefore = (before as NSString).substring(to: (before as NSString).length - markLength)
                let trimmedAfter = (after as NSString).substring(from: markLength)
                return NoteTextEdit(
                    text: trimmedBefore + selected + trimmedAfter,
                    selection: NSRange(location: start - markLength, length: end - start)
                )
            }
            return NoteTextEdit(
                text: before + mark + selected + mark + after,
                selection: NSRange(location: start + markLength, length: end - start)
            )
        }

        if self == .link {
            let label = selected.isEmpty ? "link" : selected
            let url = "https://"
            let urlStart = start + (label as NSString).length + 3
            return NoteTextEdit(
                text: before + "[\(label)](\(url))" + after,
                selection: NSRange(location: urlStart, length: (url as NSString).length)
            )
        }

        // Line prefixes: work on the whole lines the selection touches.
        let prefix = linePrefix ?? "- "
        let lineStart: Int = {
            guard start > 0 else { return 0 }
            let found = ns.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: start))
            return found.location == NSNotFound ? 0 : found.location + 1
        }()
        let searchFrom = (end > start && ns.character(at: end - 1) == 0x0A) ? end - 1 : end
        let nextBreak = ns.range(of: "\n", range: NSRange(location: searchFrom, length: length - searchFrom))
        let lineEnd = nextBreak.location == NSNotFound ? length : nextBreak.location
        let lines = ns.substring(with: NSRange(location: lineStart, length: lineEnd - lineStart))
            .components(separatedBy: "\n")
        let allPrefixed = lines.allSatisfy { $0.hasPrefix(prefix) }
        let prefixLength = (prefix as NSString).length
        let nextLines = lines.map { line -> String in
            if allPrefixed { return (line as NSString).substring(from: prefixLength) }
            return line.hasPrefix(prefix) ? line : prefix + line
        }
        let replaced = nextLines.joined(separator: "\n")
        let delta = (replaced as NSString).length - (lineEnd - lineStart)
        let firstDelta = (nextLines[0] as NSString).length - (lines[0] as NSString).length
        let newStart = max(lineStart, start + firstDelta)
        let newEnd = max(lineStart, end + delta)
        return NoteTextEdit(
            text: ns.substring(to: lineStart) + replaced + ns.substring(from: lineEnd),
            selection: NSRange(location: newStart, length: max(0, newEnd - newStart))
        )
    }
}

enum NoteDates {
    /// Short date for a note's footer, matching the list's `formatListDate`:
    /// time today, "Sep 3" this year, "Sep 3, 2025" otherwise.
    static func short(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date = parse(iso) else { return "" }
        let out = DateFormatter()
        out.calendar = calendar
        if calendar.isDate(date, inSameDayAs: now) {
            out.timeStyle = .short
            out.dateStyle = .none
            return out.string(from: date)
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            out.setLocalizedDateFormatFromTemplate("MMMd")
        } else {
            out.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        }
        return out.string(from: date)
    }

    static func parse(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    static func now() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}

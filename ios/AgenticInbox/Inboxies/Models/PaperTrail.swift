import Foundation

/// Updates as a quiet receipts view (AVE-192, HEY's Paper Trail): compact rows
/// (sender, subject, date; no preview line) grouped by month. Mail filed here
/// never sends a push (the Worker skips it), and opening a message marks it
/// read like any other folder. Mirrors `shared/paper-trail.ts` and Android
/// `PaperTrail.kt`.
enum PaperTrail {
    static let folderId = "updates"

    /// Empty Updates; same copy as the web.
    static let emptyDescription = "Receipts, confirmations and notifications, grouped by month. Mail here doesn’t send notifications."

    static func isPaperTrail(folderId: String?) -> Bool {
        folderId == Self.folderId
    }

    struct MonthSection: Identifiable, Equatable {
        /// "month-2026-11"; "month-undated" for mail without a usable date.
        let id: String
        let label: String
        var emails: [Email]
    }

    private static let monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]

    static func parseDate(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    /// "November" in the current year, "November 2025" otherwise, "Earlier" without a date.
    static func label(for date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return "Earlier" }
        let parts = calendar.dateComponents([.year, .month], from: date)
        let month = monthNames[(parts.month ?? 1) - 1]
        let year = parts.year ?? 0
        return year == calendar.component(.year, from: now) ? month : "\(month) \(year)"
    }

    /// Keeps the list's order (date DESC) and starts a section whenever the month changes.
    static func monthSections(
        _ emails: [Email],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [MonthSection] {
        var sections: [MonthSection] = []
        var lastKey: String?
        var seen: [String: Int] = [:]
        for email in emails {
            let date = parseDate(email.date)
            let key: String
            if let date {
                let parts = calendar.dateComponents([.year, .month], from: date)
                key = String(format: "month-%04d-%02d", parts.year ?? 0, parts.month ?? 0)
            } else {
                key = "month-undated"
            }
            if key == lastKey {
                sections[sections.count - 1].emails.append(email)
                continue
            }
            // Ids stay unique for ForEach even if a month comes back out of order.
            let repeats = seen[key, default: 0]
            seen[key] = repeats + 1
            sections.append(MonthSection(
                id: repeats == 0 ? key : "\(key)-\(repeats)",
                label: label(for: date, now: now, calendar: calendar),
                emails: [email]
            ))
            lastKey = key
        }
        return sections
    }
}

import Foundation

/// What the "Today's inbox" widget draws (AVE-138, built in AVE-149). The app writes it
/// to the App Group as JSON whenever the Inbox refreshes (`InboxWidgetStore`), and the
/// `InboxiesWidget` timeline provider reads it back. Keep it small and Codable.
/// Android twin: `InboxWidgetSnapshot` in `ui/widget/InboxWidgetSnapshot.kt`.
struct InboxWidgetSnapshot: Codable, Equatable {
    struct Thread: Codable, Equatable, Identifiable {
        /// Thread id, for the tap-to-open deep link.
        let id: String
        let senderName: String
        let subject: String
        let receivedAt: Date
    }

    let mailboxId: String
    let mailboxAddress: String
    /// Count of New conversations in the Inbox (the same number as the Inbox "New" section).
    let newCount: Int
    let replyLaterCount: Int
    /// Newest New threads, at most `maxThreads` (five). Medium lists three, the small
    /// avatar stack shows three, and the depth card stack flips through all of them.
    let threads: [Thread]
    let updatedAt: Date

    var isInboxZero: Bool { newCount == 0 }

    static let maxThreads = 5
}

extension InboxWidgetSnapshot {
    /// Copy under "Inbox zero". One line per day, picked by day of the year, so the
    /// widget feels alive without being noisy. Same lines and order on Android.
    static let inboxZeroLines = [
        "Nothing new. Enjoy the quiet.",
        "All caught up. Go make something.",
        "Clear skies in your inbox.",
        "That's everything. Nice work.",
    ]

    static func inboxZeroLine(on date: Date, calendar: Calendar = .current) -> String {
        let day = calendar.ordinality(of: .day, in: .year, for: date) ?? 1
        return inboxZeroLines[(day - 1) % inboxZeroLines.count]
    }
}

// MARK: - Sample data (design mocks only; no networking)

extension InboxWidgetSnapshot {
    /// 9:41, so mocks read like Apple marketing shots and stay deterministic.
    static let sampleNow: Date = {
        var parts = DateComponents()
        parts.year = 2026
        parts.month = 10
        parts.day = 28
        parts.hour = 9
        parts.minute = 41
        return Calendar.current.date(from: parts) ?? Date()
    }()

    static let sampleHasMail = InboxWidgetSnapshot(
        mailboxId: "mb-preview",
        mailboxAddress: "you@inboxies.email",
        newCount: 7,
        replyLaterCount: 2,
        threads: [
            Thread(
                id: "t-1",
                senderName: "Maya Chen",
                subject: "Q3 roadmap: final draft for review",
                receivedAt: sampleNow.addingTimeInterval(-4 * 60)
            ),
            Thread(
                id: "t-2",
                senderName: "Jonas Weber",
                subject: "Dinner on Friday?",
                receivedAt: sampleNow.addingTimeInterval(-38 * 60)
            ),
            Thread(
                id: "t-3",
                senderName: "Priya Natarajan",
                subject: "Contract signed, next steps",
                receivedAt: sampleNow.addingTimeInterval(-95 * 60)
            ),
            Thread(
                id: "t-4",
                senderName: "Leo Martins",
                subject: "Photos from the offsite",
                receivedAt: sampleNow.addingTimeInterval(-140 * 60)
            ),
            Thread(
                id: "t-5",
                senderName: "Ada Okafor",
                subject: "Can we move our 1:1 to Thursday?",
                receivedAt: sampleNow.addingTimeInterval(-185 * 60)
            ),
        ],
        updatedAt: sampleNow
    )

    static let sampleInboxZero = InboxWidgetSnapshot(
        mailboxId: "mb-preview",
        mailboxAddress: "you@inboxies.email",
        newCount: 0,
        replyLaterCount: 2,
        threads: [],
        updatedAt: sampleNow
    )
}

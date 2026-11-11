import XCTest
@testable import Inboxies

/// Paper Trail, a quiet receipts folder (AVE-192): which folder it is, month grouping and labels.
/// Mirrors workers/test/paper-trail.test.mjs and Android PaperTrailTest.
final class PaperTrailTests: XCTestCase {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        cal.locale = Locale(identifier: "en_US_POSIX")
        return cal
    }

    private func date(_ y: Int, _ m: Int, _ d: Int) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12))!
    }

    private func email(_ id: String, _ date: String) -> Email {
        Email(id: id, folderId: "paper_trail", subject: id, sender: "s@example.com", recipient: "you@example.com", date: date, read: true, starred: false)
    }

    func testOnlyPaperTrailIsPaperTrail() {
        XCTAssertEqual(PaperTrail.folderId, "paper_trail")
        XCTAssertTrue(PaperTrail.isPaperTrail(folderId: "paper_trail"))
        XCTAssertFalse(PaperTrail.isPaperTrail(folderId: "updates"))
        XCTAssertFalse(PaperTrail.isPaperTrail(folderId: "inbox"))
        XCTAssertFalse(PaperTrail.isPaperTrail(folderId: "promotions"))
        XCTAssertFalse(PaperTrail.isPaperTrail(folderId: nil))
    }

    /// Paper Trail is a system folder and a sender destination, next to Updates
    /// (`shared/folders.ts` SYSTEM_FOLDER_IDS / SCREENER_DESTINATION_IDS).
    func testPaperTrailIsASystemFolderAndDestination() {
        XCTAssertTrue(CustomFolders.systemFolderIds.contains("paper_trail"))
        XCTAssertEqual(HomeTab.folder("paper_trail").title, "Paper Trail")
        XCTAssertEqual(ScreenerDecision.toastTitle(destinationFolderId: "paper_trail"), "Accepted · future mail goes to Paper Trail")
        XCTAssertEqual(ComposeActionItem.paperTrail.folderTab, .folder("paper_trail"))
    }

    func testLabelsDropTheCurrentYear() {
        let now = date(2026, 11, 10)
        XCTAssertEqual(PaperTrail.label(for: date(2026, 11, 3), now: now, calendar: calendar), "November")
        XCTAssertEqual(PaperTrail.label(for: date(2026, 1, 15), now: now, calendar: calendar), "January")
        XCTAssertEqual(PaperTrail.label(for: date(2025, 12, 15), now: now, calendar: calendar), "December 2025")
        XCTAssertEqual(PaperTrail.label(for: nil, now: now, calendar: calendar), "Earlier")
    }

    func testGroupsConsecutiveMailByMonth() {
        let now = date(2026, 11, 10)
        let rows = [
            email("a", "2026-11-09T17:00:00.000Z"),
            email("b", "2026-11-02T17:00:00Z"),
            email("c", "2026-10-30T17:00:00.000Z"),
            email("d", "2025-10-15T17:00:00.000Z"),
            email("e", "2025-10-01T17:00:00.000Z"),
        ]
        let sections = PaperTrail.monthSections(rows, now: now, calendar: calendar)
        XCTAssertEqual(sections.map(\.label), ["November", "October", "October 2025"])
        XCTAssertEqual(sections.map(\.id), ["month-2026-11", "month-2026-10", "month-2025-10"])
        XCTAssertEqual(sections.map { $0.emails.map(\.id) }, [["a", "b"], ["c"], ["d", "e"]])
    }

    func testUndatedMailGoesUnderEarlierAndIdsStayUnique() {
        let now = date(2026, 11, 10)
        let rows = [
            email("a", "2026-11-09T17:00:00.000Z"),
            email("b", "not a date"),
            email("c", "2026-11-01T17:00:00.000Z"),
        ]
        let sections = PaperTrail.monthSections(rows, now: now, calendar: calendar)
        XCTAssertEqual(sections.map(\.label), ["November", "Earlier", "November"])
        XCTAssertEqual(Set(sections.map(\.id)).count, 3)
        XCTAssertTrue(PaperTrail.monthSections([], now: now, calendar: calendar).isEmpty)
    }
}

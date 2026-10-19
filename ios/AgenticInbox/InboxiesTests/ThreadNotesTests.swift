import XCTest
@testable import Inboxies

/// Notes to self (AVE-61): sticky placement, list summary, preview text and the
/// editor's markdown buttons. Mirrors web `app/lib/thread-notes.ts` behaviour.
final class ThreadNotesTests: XCTestCase {
    private let view = CGSize(width: 390, height: 600)
    private let noteSize = CGSize(width: 260, height: 120)

    private func note(
        _ id: String,
        type: String = ThreadNote.stickyType,
        emailId: String? = nil,
        body: String = "Body",
        created: String = "2026-09-01T10:00:00.000Z",
        posX: Double? = nil,
        posY: Double? = nil
    ) -> ThreadNote {
        ThreadNote(
            id: id, threadId: "t1", emailId: emailId, noteType: type, body: body,
            posX: posX, posY: posY, createdAt: created, updatedAt: created
        )
    }

    // MARK: Layout

    func testClampKeepsNoteInsideViewWithEdge() {
        let inside = StickyNoteLayout.clamp(CGPoint(x: 40, y: 50), note: noteSize, view: view)
        XCTAssertEqual(inside, CGPoint(x: 40, y: 50))

        let farRight = StickyNoteLayout.clamp(CGPoint(x: 900, y: 900), note: noteSize, view: view)
        XCTAssertEqual(farRight, CGPoint(x: 390 - 260 - 12, y: 600 - 120 - 12))

        let negative = StickyNoteLayout.clamp(CGPoint(x: -50, y: -10), note: noteSize, view: view)
        XCTAssertEqual(negative, CGPoint(x: 12, y: 12))
    }

    func testClampPinsToStartEdgeWhenViewIsSmallerThanNote() {
        let tiny = CGSize(width: 200, height: 100)
        XCTAssertEqual(StickyNoteLayout.clamp(CGPoint(x: 80, y: 60), note: noteSize, view: tiny), CGPoint(x: 12, y: 12))
    }

    func testClampRoundsAndRejectsNonFinite() {
        let rounded = StickyNoteLayout.clamp(CGPoint(x: 40.4, y: 50.6), note: noteSize, view: view)
        XCTAssertEqual(rounded, CGPoint(x: 40, y: 51))
        let nan = StickyNoteLayout.clamp(CGPoint(x: CGFloat.nan, y: .infinity), note: noteSize, view: view)
        XCTAssertEqual(nan, CGPoint(x: 12, y: 12))
    }

    func testUnsavedStickiesOpenTopRightAndCascade() {
        let first = StickyNoteLayout.position(saved: nil, index: 0, note: noteSize, view: view)
        XCTAssertEqual(first, CGPoint(x: 390 - 260 - 12, y: 12))
        let second = StickyNoteLayout.position(saved: nil, index: 1, note: noteSize, view: view)
        XCTAssertEqual(second, CGPoint(x: first.x - 24, y: first.y + 24))
    }

    func testSavedPositionWinsButIsClampedIntoSmallerView() {
        let saved = CGPoint(x: 700, y: 30)
        let shown = StickyNoteLayout.position(saved: saved, index: 3, note: noteSize, view: view)
        XCTAssertEqual(shown, CGPoint(x: 118, y: 30))
    }

    func testDragThresholdAndMomentumDrop() {
        XCTAssertFalse(StickyNoteLayout.passedDragThreshold(CGSize(width: 1, height: 2)))
        XCTAssertTrue(StickyNoteLayout.passedDragThreshold(CGSize(width: 3, height: 0)))

        let drop = StickyNoteLayout.dropPosition(
            start: CGPoint(x: 100, y: 100),
            translation: CGSize(width: 10, height: 20),
            predicted: CGSize(width: 60, height: 20),
            note: noteSize,
            view: view
        )
        // 100 + 10 + (60 - 10) * 0.2 = 120
        XCTAssertEqual(drop, CGPoint(x: 118, y: 120)) // clamped to the right edge (118)
    }

    func testNoteWidthShrinksOnNarrowViews() {
        XCTAssertEqual(StickyNoteLayout.noteWidth(in: view), 260)
        XCTAssertEqual(StickyNoteLayout.noteWidth(in: CGSize(width: 200, height: 400)), 176)
    }

    // MARK: Grouping + summary

    func testGroupsSplitStickyAndInlineByMessage() {
        let groups = ThreadNoteGroups([
            note("s1"),
            note("i1", type: ThreadNote.inlineType, emailId: "e1"),
            note("i2", type: ThreadNote.inlineType, emailId: "e2"),
            note("i3", type: ThreadNote.inlineType, emailId: "e1"),
            note("orphan", type: ThreadNote.inlineType, emailId: nil),
        ])
        XCTAssertEqual(groups.sticky.map(\.id), ["s1"])
        XCTAssertEqual(groups.inlineByEmail["e1"]?.map(\.id), ["i1", "i3"])
        XCTAssertEqual(groups.inlineByEmail["e2"]?.map(\.id), ["i2"])
    }

    func testSummaryUsesLatestStickyAndCountsInline() {
        let summary = ThreadNoteSummary(notes: [
            note("a", body: "older", created: "2026-09-01T10:00:00.000Z"),
            note("b", body: "  newer  ", created: "2026-09-02T10:00:00.000Z"),
            note("i", type: ThreadNote.inlineType, emailId: "e1"),
        ])
        XCTAssertEqual(summary, ThreadNoteSummary(hasStickyNote: true, stickyNoteText: "newer", inlineNoteCount: 1))
        XCTAssertEqual(
            ThreadNoteSummary(notes: []),
            ThreadNoteSummary(hasStickyNote: false, stickyNoteText: nil, inlineNoteCount: 0)
        )
    }

    func testSnippetCapsAt200Characters() {
        let long = String(repeating: "a", count: 250)
        let snippet = ThreadNoteSummary.snippet(long)
        XCTAssertEqual(snippet.count, 200)
        XCTAssertTrue(snippet.hasSuffix("…"))
    }

    // MARK: Text

    func testPreviewStripsMarkdown() {
        XCTAssertEqual(
            NoteText.preview("# Call **Jordan**\n- [ ] send _deck_\n> see [pricing](https://x.y) `INV-1`"),
            "Call Jordan send deck see pricing INV-1"
        )
        XCTAssertEqual(NoteText.preview(nil), "")
        XCTAssertEqual(NoteText.preview("![logo](https://evil.example/a.png) hi"), "logo hi")
    }

    func testRenderableDropsImages() {
        XCTAssertEqual(NoteText.renderable("a ![pic](https://x/y.png) b"), "a pic b")
        XCTAssertEqual(NoteText.renderable("<img src=x>"), "<img src=x>")
    }

    func testDecodesServerNoteAndListFields() throws {
        let noteJSON = """
        {"id":"n1","threadId":"t1","emailId":null,"noteType":"sticky","body":"Hi","posX":12.5,"posY":40,
         "createdAt":"2026-09-01T10:00:00.000Z","updatedAt":"2026-09-01T10:00:00.000Z"}
        """
        let note = try JSONDecoder().decode(ThreadNote.self, from: Data(noteJSON.utf8))
        XCTAssertTrue(note.isSticky)
        XCTAssertEqual(note.savedPosition, CGPoint(x: 12.5, y: 40))

        let rowJSON = """
        {"id":"e1","has_sticky_note":1,"sticky_note_text":"Call","inline_note_count":2}
        """
        let row = try JSONDecoder().decode(Email.self, from: Data(rowJSON.utf8))
        XCTAssertEqual(row.hasStickyNote, true)
        XCTAssertEqual(row.stickyNoteText, "Call")
        XCTAssertEqual(row.inlineNoteCount, 2)
        XCTAssertEqual(row.noteThreadKey, "e1")
    }

    // MARK: Editor formatting

    private func apply(_ format: NoteFormat, _ text: String, _ location: Int, _ length: Int = 0) -> NoteTextEdit {
        format.apply(to: text, selection: NSRange(location: location, length: length))
    }

    func testWrapAndUnwrap() {
        let wrapped = apply(.bold, "hello world", 6, 5)
        XCTAssertEqual(wrapped, NoteTextEdit(text: "hello **world**", selection: NSRange(location: 8, length: 5)))
        let unwrapped = apply(.bold, wrapped.text, wrapped.selection.location, wrapped.selection.length)
        XCTAssertEqual(unwrapped, NoteTextEdit(text: "hello world", selection: NSRange(location: 6, length: 5)))

        let empty = apply(.italic, "ab", 1)
        XCTAssertEqual(empty, NoteTextEdit(text: "a__b", selection: NSRange(location: 2, length: 0)))
    }

    func testLinkSelectsURL() {
        let edit = apply(.link, "see docs", 4, 4)
        XCTAssertEqual(edit.text, "see [docs](https://)")
        XCTAssertEqual(edit.selection, NSRange(location: 11, length: 8))
        XCTAssertEqual(apply(.link, "", 0).text, "[link](https://)")
    }

    func testLinePrefixesToggleOnEverySelectedLine() {
        let text = "one\ntwo\nthree"
        let bulleted = apply(.bullet, text, 0, 7)
        XCTAssertEqual(bulleted.text, "- one\n- two\nthree")
        let back = apply(.bullet, bulleted.text, 0, 11)
        XCTAssertEqual(back.text, text)

        let check = apply(.checklist, "task", 2)
        XCTAssertEqual(check, NoteTextEdit(text: "- [ ] task", selection: NSRange(location: 8, length: 0)))
    }

    func testFormattingUsesUTF16Offsets() {
        // "👋" is two UTF-16 units: the selection after it starts at 3.
        let edit = apply(.code, "👋 hi", 3, 2)
        XCTAssertEqual(edit.text, "👋 `hi`")
        XCTAssertEqual(edit.selection, NSRange(location: 4, length: 2))
    }
}

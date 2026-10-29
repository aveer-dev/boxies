package co.inboxies.app.services

import co.inboxies.app.models.Email
import co.inboxies.app.models.ThreadNote
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadNotesTest {
    private val view = NoteSize(390f, 700f)
    private val note = NoteSize(260f, 120f)

    private fun threadNote(
        id: String,
        type: String,
        body: String = "Body",
        emailId: String? = null,
        created: String = "2026-09-01T10:00:00.000Z",
    ) = ThreadNote(id = id, threadId = "t", emailId = emailId, noteType = type, body = body, createdAt = created, updatedAt = created)

    @Test
    fun defaultPositionIsTopRightAndCascades() {
        assertEquals(NotePoint(118f, 12f), StickyNoteLayout.position(null, 0, note, view))
        assertEquals(NotePoint(94f, 36f), StickyNoteLayout.position(null, 1, note, view))
    }

    @Test
    fun savedPositionIsClampedInsideTheView() {
        assertEquals(NotePoint(16f, 340f), StickyNoteLayout.position(NotePoint(16f, 340f), 0, note, view))
        assertEquals(NotePoint(118f, 568f), StickyNoteLayout.position(NotePoint(900f, 900f), 0, note, view))
        assertEquals(NotePoint(12f, 12f), StickyNoteLayout.position(NotePoint(-50f, -5f), 0, note, view))
    }

    @Test
    fun viewSmallerThanNotePinsToStartEdge() {
        assertEquals(NotePoint(12f, 12f), StickyNoteLayout.clamp(NotePoint(80f, 80f), note, NoteSize(200f, 100f)))
    }

    @Test
    fun noteWidthShrinksOnNarrowViews() {
        assertEquals(260f, StickyNoteLayout.noteWidth(390f))
        assertEquals(176f, StickyNoteLayout.noteWidth(200f))
        assertEquals(120f, StickyNoteLayout.noteWidth(100f))
    }

    @Test
    fun throwCarriesTheReleaseVelocityAShortWay() {
        val end = StickyNoteLayout.dropPosition(
            start = NotePoint(100f, 100f),
            translation = NotePoint(10f, 20f),
            velocity = NotePoint(400f, 0f),
            note = note,
            view = NoteSize(1000f, 1000f),
        )
        // 400 dp/s × 0.08 s = 32 dp past the release point.
        assertEquals(NotePoint(142f, 120f), end)
    }

    @Test
    fun hardThrowIsCappedAlongItsDirection() {
        val end = StickyNoteLayout.dropPosition(
            start = NotePoint(100f, 100f),
            translation = NotePoint(0f, 0f),
            velocity = NotePoint(6000f, 8000f),
            note = NoteSize(100f, 50f),
            view = NoteSize(1000f, 1000f),
        )
        // Capped at MAX_THROW (48) along the 3:4:5 throw: (28.8, 38.4), rounded by clamp.
        assertEquals(NotePoint(129f, 138f), end)
    }

    @Test
    fun throwPastAnEdgeLandsOnTheEdge() {
        val end = StickyNoteLayout.dropPosition(
            start = NotePoint(20f, 100f),
            translation = NotePoint(0f, 0f),
            velocity = NotePoint(-3000f, 0f),
            note = note,
            view = view,
        )
        assertEquals(NotePoint(StickyNoteLayout.EDGE, 100f), end)
    }

    @Test
    fun noVelocityDropsWhereLetGo() {
        val end = StickyNoteLayout.dropPosition(
            start = NotePoint(100f, 100f),
            translation = NotePoint(5f, -5f),
            velocity = NotePoint(Float.NaN, 0f),
            note = note,
            view = view,
        )
        assertEquals(NotePoint(105f, 95f), end)
    }

    @Test
    fun dragTiltFollowsSpeedAndIsClamped() {
        assertEquals(0f, StickyNoteMotion.tiltFor(0f), 0.0001f)
        assertEquals(3f, StickyNoteMotion.tiltFor(500f), 0.0001f)
        assertEquals(-3f, StickyNoteMotion.tiltFor(-500f), 0.0001f)
        assertEquals(StickyNoteMotion.MAX_TILT, StickyNoteMotion.tiltFor(5000f), 0.0001f)
        assertEquals(-StickyNoteMotion.MAX_TILT, StickyNoteMotion.tiltFor(-5000f), 0.0001f)
        assertEquals(0f, StickyNoteMotion.tiltFor(Float.NaN), 0.0001f)
    }

    @Test
    fun settleSpringIsSlightlyUnderdamped() {
        assertTrue(StickyNoteMotion.SETTLE_DAMPING in 0.6f..0.8f)
    }

    @Test
    fun groupsSplitStickiesAndInlineByMessage() {
        val groups = ThreadNoteGroups.of(
            listOf(
                threadNote("s", ThreadNote.STICKY),
                threadNote("a", ThreadNote.INLINE, emailId = "e1"),
                threadNote("b", ThreadNote.INLINE, emailId = "e1"),
                threadNote("orphan", ThreadNote.INLINE),
            ),
        )
        assertEquals(listOf("s"), groups.sticky.map { it.id })
        assertEquals(listOf("a", "b"), groups.inlineByEmail["e1"]?.map { it.id })
        assertEquals(1, groups.inlineByEmail.size)
    }

    @Test
    fun summaryUsesLatestStickyAndCountsInline() {
        val summary = ThreadNoteSummary.of(
            listOf(
                threadNote("s1", ThreadNote.STICKY, body = "old", created = "2026-09-01T10:00:00.000Z"),
                threadNote("s2", ThreadNote.STICKY, body = "  new  ", created = "2026-09-02T10:00:00.000Z"),
                threadNote("i", ThreadNote.INLINE, emailId = "e"),
            ),
        )
        assertEquals(ThreadNoteSummary(true, "new", 1), summary)
        assertEquals(ThreadNoteSummary(false, null, 0), ThreadNoteSummary.of(emptyList()))
        val long = ThreadNoteSummary.snippet("x".repeat(300))
        assertEquals(200, long.length)
        assertTrue(long.endsWith("…"))
    }

    @Test
    fun previewStripsMarkdown() {
        assertEquals(
            "Call Jordan re: pricing Loop in Sam the sheet code",
            NoteText.preview("# **Call Jordan** re: _pricing_\n\n- [x] Loop in Sam\n[the sheet](https://x.y) `code`"),
        )
        assertEquals("", NoteText.preview(null))
        assertEquals("alt", NoteText.renderable("![alt](https://tracker.example/p.gif)"))
        assertTrue(NoteText.isOpenableLink("https://example.com"))
        assertTrue(NoteText.isOpenableLink("mailto:a@b.c"))
        assertFalse(NoteText.isOpenableLink("javascript:alert(1)"))
    }

    @Test
    fun wrapFormatsWrapAndUnwrap() {
        val bold = NoteFormat.Bold.apply("hello world", 6, 11)
        assertEquals(NoteTextEdit("hello **world**", 8, 13), bold)
        assertEquals(NoteTextEdit("hello world", 6, 11), NoteFormat.Bold.apply(bold.text, 8, 13))
        assertEquals(NoteTextEdit("__", 1, 1), NoteFormat.Italic.apply("", 0, 0))
    }

    @Test
    fun linkSelectsTheUrl() {
        val edit = NoteFormat.Link.apply("see docs", 4, 8)
        assertEquals("see [docs](https://)", edit.text)
        assertEquals("https://", edit.text.substring(edit.selectionStart, edit.selectionEnd))
    }

    @Test
    fun linePrefixesToggleAcrossLines() {
        val bullets = NoteFormat.Bullet.apply("one\ntwo", 0, 7)
        assertEquals("- one\n- two", bullets.text)
        assertEquals("one\ntwo", NoteFormat.Bullet.apply(bullets.text, 0, bullets.text.length).text)
        assertEquals("a\n- [ ] b", NoteFormat.Checklist.apply("a\nb", 2, 2).text)
    }

    @Test
    fun emailDecodesNoteFieldsAndThreadKey() {
        val json = Json { ignoreUnknownKeys = true }
        val row = json.decodeFromString<Email>(
            """{"id":"e1","thread_id":"t1","has_sticky_note":true,"sticky_note_text":"Hi","inline_note_count":2}""",
        )
        assertEquals(true, row.hasStickyNote)
        assertEquals("Hi", row.stickyNoteText)
        assertEquals(2, row.inlineNoteCount)
        assertEquals("t1", row.noteThreadKey)
        val bare = json.decodeFromString<Email>("""{"id":"e2"}""")
        assertNull(bare.hasStickyNote)
        assertEquals("e2", bare.noteThreadKey)

        val note = json.decodeFromString<ThreadNote>(
            """{"id":"n","threadId":"t1","emailId":null,"noteType":"sticky","body":"b","posX":16,"posY":340.5,"createdAt":"c","updatedAt":"u"}""",
        )
        assertTrue(note.isSticky)
        assertEquals(16f to 340.5f, note.savedPosition)
    }
}

package co.inboxies.app.services

import co.inboxies.app.models.ThreadNote
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Pure helpers for notes to self (AVE-62), the Android twin of iOS `ThreadNotes.swift`
 * and web `app/lib/thread-notes.ts`: where a sticky note sits, what the list row
 * shows, and the markdown edits the editor's buttons make. No Compose here, so it
 * is unit tested directly.
 *
 * A sticky note's `posX` / `posY` are dp (iOS points / CSS px) from the top-left
 * corner of the reader's message area. They're clamped every time the note is laid
 * out, so a note saved on a wider screen still shows inside a narrower one (the
 * saved value is only rewritten when the user drags it).
 */
data class NotePoint(val x: Float, val y: Float)

data class NoteSize(val width: Float, val height: Float)

object StickyNoteLayout {
    /** Gap kept between a sticky note and the edges of the view. */
    const val EDGE = 12f
    /** Each further sticky without a saved spot opens this much lower and to the left. */
    const val CASCADE = 24f
    /** How long a throw carries the release velocity, in seconds (same as web `NOTE_THROW_SECONDS`). */
    const val THROW_SECONDS = 0.08f
    /** Farthest a throw carries the note past where it was let go, in dp (same as web `NOTE_MAX_THROW`). */
    const val MAX_THROW = 48f
    /** Resting width of a sticky note (narrower views shrink it to fit). */
    const val WIDTH = 260f

    /** The note's width inside a view: [WIDTH], or the view minus both edges when narrower. */
    fun noteWidth(viewWidth: Float): Float = max(120f, min(WIDTH, viewWidth - EDGE * 2))

    /**
     * Keeps a note of [note] size fully inside [view], [edge] from every side.
     * A view smaller than the note pins it to the start edge.
     */
    fun clamp(position: NotePoint, note: NoteSize, view: NoteSize, edge: Float = EDGE): NotePoint {
        fun axis(value: Float, noteLength: Float, viewLength: Float): Float {
            val maxValue = viewLength - noteLength - edge
            if (maxValue <= edge) return edge
            if (!value.isFinite()) return edge
            return value.coerceIn(edge, maxValue).roundToInt().toFloat()
        }
        return NotePoint(
            x = axis(position.x, note.width, view.width),
            y = axis(position.y, note.height, view.height),
        )
    }

    /**
     * Where a sticky note shows: its saved spot, or (never dragged) the top-right
     * corner, cascading so several new notes don't stack exactly. Always clamped.
     */
    fun position(saved: NotePoint?, index: Int, note: NoteSize, view: NoteSize): NotePoint {
        val offset = max(0, index) * CASCADE
        val start = saved ?: NotePoint(view.width - note.width - EDGE - offset, EDGE + offset)
        return clamp(start, note, view)
    }

    /**
     * Where a released note settles: the drop point plus the release [velocity] (dp/s)
     * carried a short way, at most [MAX_THROW] dp along the throw, then clamped inside
     * the view. A throw past an edge lands on that edge (the spring takes it there).
     */
    fun dropPosition(
        start: NotePoint,
        translation: NotePoint,
        velocity: NotePoint,
        note: NoteSize,
        view: NoteSize,
    ): NotePoint {
        var dx = if (velocity.x.isFinite()) velocity.x * THROW_SECONDS else 0f
        var dy = if (velocity.y.isFinite()) velocity.y * THROW_SECONDS else 0f
        val distance = sqrt(dx * dx + dy * dy)
        if (distance > MAX_THROW) {
            dx = dx / distance * MAX_THROW
            dy = dy / distance * MAX_THROW
        }
        return clamp(
            NotePoint(start.x + translation.x + dx, start.y + translation.y + dy),
            note,
            view,
        )
    }
}

/**
 * The sticky's drag feel (AVE-62 review), same numbers as web `thread-notes.ts` and
 * iOS `AppTheme.Note`: it leans with its horizontal speed like paper pulled through
 * air, and the lean eases back as it slows.
 */
object StickyNoteMotion {
    /** Most a dragged note leans, in degrees either way. */
    const val MAX_TILT = 6f
    /** Degrees of lean per dp/s of horizontal speed (6° at 1000 dp/s). */
    const val TILT_PER_VELOCITY = 0.006f
    /** Scale while a note is held. */
    const val LIFT_SCALE = 1.03f
    /** Spring damping on release: a little under 1, so the settle shows a small overshoot. */
    const val SETTLE_DAMPING = 0.7f

    /** Drag lean for a horizontal speed (dp/s): proportional, clamped to ±[MAX_TILT]. */
    fun tiltFor(velocityX: Float): Float {
        if (!velocityX.isFinite()) return 0f
        return (velocityX * TILT_PER_VELOCITY).coerceIn(-MAX_TILT, MAX_TILT)
    }
}

/**
 * A thread's notes split for the reader: stickies for the overlay, inline notes
 * grouped under the message they annotate (oldest first, as the API returns them).
 */
data class ThreadNoteGroups(
    val sticky: List<ThreadNote>,
    val inlineByEmail: Map<String, List<ThreadNote>>,
) {
    companion object {
        val Empty = ThreadNoteGroups(emptyList(), emptyMap())

        fun of(notes: List<ThreadNote>): ThreadNoteGroups {
            val sticky = mutableListOf<ThreadNote>()
            val inline = linkedMapOf<String, MutableList<ThreadNote>>()
            for (note in notes) {
                if (note.isSticky) {
                    sticky += note
                } else {
                    val emailId = note.emailId ?: continue
                    inline.getOrPut(emailId) { mutableListOf() } += note
                }
            }
            return ThreadNoteGroups(sticky, inline)
        }
    }
}

/**
 * The list row's note fields, recomputed locally after a change so the row
 * updates before the next list sync (mirrors the Worker's `threadNoteSummaries`).
 */
data class ThreadNoteSummary(
    val hasStickyNote: Boolean,
    val stickyNoteText: String?,
    val inlineNoteCount: Int,
) {
    companion object {
        /** Server cap on `sticky_note_text`, in characters. */
        const val SNIPPET_MAX = 200

        fun of(notes: List<ThreadNote>): ThreadNoteSummary {
            val stickies = notes.filter { it.isSticky }
            // Latest sticky by creation (the server orders `created_at DESC, id DESC`).
            val latest = stickies.maxWithOrNull(compareBy<ThreadNote>({ it.createdAt }, { it.id }))
            return ThreadNoteSummary(
                hasStickyNote = stickies.isNotEmpty(),
                stickyNoteText = latest?.let { snippet(it.body) },
                inlineNoteCount = notes.count { !it.isSticky },
            )
        }

        /** Trimmed body, at most [SNIPPET_MAX] characters (ellipsis included). */
        fun snippet(body: String): String {
            val trimmed = body.trim()
            if (trimmed.length <= SNIPPET_MAX) return trimmed
            return trimmed.take(SNIPPET_MAX - 1).trimEnd() + "…"
        }
    }
}

object NoteText {
    /**
     * One line of plain text from a note's markdown, for the list row and a folded
     * sticky: no heading / list / quote markers, emphasis or code ticks; links keep
     * their label; whitespace collapsed. Same rules as web `notePreviewText`.
     */
    fun preview(markdown: String?): String {
        if (markdown.isNullOrEmpty()) return ""
        var text: String = markdown
        text = text.replace(Regex("```[^\\n]*\\n?"), " ")
        text = text.replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        text = text.replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        text = text.replace(
            Regex(
                "^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+\\[[ xX]\\]\\s+|[-*+]\\s+|\\d+[.)]\\s+)",
                RegexOption.MULTILINE,
            ),
            "",
        )
        text = text.replace(Regex("(\\*\\*|__|~~)(.+?)\\1"), "$2")
        text = text.replace(Regex("(^|[^\\w*])[*_](\\S(?:.*?\\S)?)[*_](?=[^\\w*]|$)"), "$1$2")
        text = text.replace(Regex("`([^`]*)`"), "$1")
        text = text.replace(Regex("\\s+"), " ")
        return text.trim()
    }

    /**
     * Markdown made safe to render: images become their alt text, so a note never
     * loads a remote image. (The renderer never interprets raw HTML.)
     */
    fun renderable(markdown: String): String =
        markdown.replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")

    /** Only web and mail links open from a note. */
    fun isOpenableLink(url: String): Boolean {
        val scheme = url.substringBefore(':', "").lowercase()
        return scheme == "http" || scheme == "https" || scheme == "mailto"
    }
}

// Editor formatting

/** Text plus selection (UTF-16 offsets, as Kotlin strings and `TextRange` use). */
data class NoteTextEdit(val text: String, val selectionStart: Int, val selectionEnd: Int)

enum class NoteFormat(val label: String) {
    Bold("Bold"),
    Italic("Italic"),
    Code("Code"),
    Link("Link"),
    Bullet("Bulleted list"),
    Checklist("Checklist"),
    ;

    private val wrapMark: String?
        get() = when (this) {
            Bold -> "**"
            Italic -> "_"
            Code -> "`"
            else -> null
        }

    private val linePrefix: String?
        get() = when (this) {
            Bullet -> "- "
            Checklist -> "- [ ] "
            else -> null
        }

    /**
     * Applies an editor button to the text and selection (web `applyNoteFormat`):
     * - bold / italic / code wrap the selection (or unwrap it when already wrapped);
     *   with nothing selected they insert the markers with the caret between them.
     * - link turns the selection into `[selection](url)` with `url` selected.
     * - bullet / checklist prefix every selected line, or remove the prefix when
     *   every line already has it.
     */
    fun apply(text: String, selectionStart: Int, selectionEnd: Int): NoteTextEdit {
        val length = text.length
        val start = min(selectionStart, selectionEnd).coerceIn(0, length)
        val end = max(selectionStart, selectionEnd).coerceIn(start, length)
        val selected = text.substring(start, end)
        val before = text.substring(0, start)
        val after = text.substring(end)

        wrapMark?.let { mark ->
            if (selected.isNotEmpty() && before.endsWith(mark) && after.startsWith(mark)) {
                return NoteTextEdit(
                    text = before.dropLast(mark.length) + selected + after.drop(mark.length),
                    selectionStart = start - mark.length,
                    selectionEnd = end - mark.length,
                )
            }
            return NoteTextEdit(
                text = before + mark + selected + mark + after,
                selectionStart = start + mark.length,
                selectionEnd = end + mark.length,
            )
        }

        if (this == Link) {
            val label = selected.ifEmpty { "link" }
            val url = "https://"
            val urlStart = start + label.length + 3
            return NoteTextEdit(
                text = "$before[$label]($url)$after",
                selectionStart = urlStart,
                selectionEnd = urlStart + url.length,
            )
        }

        // Line prefixes: work on the whole lines the selection touches.
        val prefix = linePrefix ?: "- "
        val lineStart = if (start > 0) text.lastIndexOf('\n', start - 1) + 1 else 0
        val searchFrom = if (end > start && text[end - 1] == '\n') end - 1 else end
        val nextBreak = text.indexOf('\n', searchFrom)
        val lineEnd = if (nextBreak < 0) length else nextBreak
        val lines = text.substring(lineStart, lineEnd).split("\n")
        val allPrefixed = lines.all { it.startsWith(prefix) }
        val nextLines = lines.map { line ->
            when {
                allPrefixed -> line.removePrefix(prefix)
                line.startsWith(prefix) -> line
                else -> prefix + line
            }
        }
        val replaced = nextLines.joinToString("\n")
        val delta = replaced.length - (lineEnd - lineStart)
        val firstDelta = nextLines[0].length - lines[0].length
        val newStart = max(lineStart, start + firstDelta)
        val newEnd = max(lineStart, end + delta)
        return NoteTextEdit(
            text = text.substring(0, lineStart) + replaced + text.substring(lineEnd),
            selectionStart = newStart,
            selectionEnd = max(newStart, newEnd),
        )
    }
}

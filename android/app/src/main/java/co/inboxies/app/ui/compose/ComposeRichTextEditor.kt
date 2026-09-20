package co.inboxies.app.ui.compose

import android.graphics.Typeface
import android.text.Html
import android.text.Layout
import android.text.Spannable
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.AlignmentSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.TypedValue
import android.view.Gravity
import android.widget.EditText
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.widget.doAfterTextChanged
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.util.ComposeHtml
import kotlin.math.roundToInt

enum class ComposeParagraphStyle { Title, Subtitle, Body, Caption }

data class ComposeFormatState(
    val paragraph: ComposeParagraphStyle = ComposeParagraphStyle.Body,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strikethrough: Boolean = false,
    val color: Int = android.graphics.Color.parseColor("#1F1F24"),
    val fontSizeSp: Int = 13,
    val alignment: Int = Gravity.START,
    val bullet: Boolean = false,
    val numbered: Boolean = false,
    val indentPx: Int = 0,
)

class ComposeRichTextController {
    var editText: EditText? = null
    var onHtmlChange: (String) -> Unit = {}
    var onStateChange: (ComposeFormatState) -> Unit = {}
    var defaultInk: Int = android.graphics.Color.parseColor("#1F1F24")
    var state: ComposeFormatState = ComposeFormatState()
        private set

    fun applyParagraph(style: ComposeParagraphStyle) {
        val size = when (style) {
            ComposeParagraphStyle.Title -> 22
            ComposeParagraphStyle.Subtitle -> 18
            ComposeParagraphStyle.Body -> 13
            ComposeParagraphStyle.Caption -> 12
        }
        val bold = style == ComposeParagraphStyle.Title || style == ComposeParagraphStyle.Subtitle
        applySize(size)
        applyStyle(Typeface.BOLD, enable = bold)
        refresh()
    }

    fun toggleBold() {
        applyStyle(Typeface.BOLD, enable = !state.bold)
        refresh()
    }

    fun toggleItalic() {
        applyStyle(Typeface.ITALIC, enable = !state.italic)
        refresh()
    }

    fun toggleUnderline() = toggleSpan { UnderlineSpan() }
    fun toggleStrike() = toggleSpan { StrikethroughSpan() }

    fun setColor(color: Int) {
        applySpan(ForegroundColorSpan(color))
        refresh()
    }

    fun bumpFontSize(delta: Int) {
        val next = (state.fontSizeSp + delta).coerceIn(10, 36)
        applySize(next)
        refresh()
    }

    fun setAlignment(gravity: Int) {
        val alignment = when (gravity) {
            Gravity.CENTER_HORIZONTAL -> Layout.Alignment.ALIGN_CENTER
            Gravity.END -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_NORMAL
        }
        applySpan(AlignmentSpan.Standard(alignment), paragraph = true)
        refresh()
    }

    fun indent(delta: Int) {
        val next = (state.indentPx + delta).coerceIn(0, 120)
        applySpan(LeadingMarginSpan.Standard(next, next), paragraph = true)
        refresh()
    }

    fun toggleBullet() {
        val edit = editText ?: return
        val text = edit.text
        val start = edit.selectionStart.coerceAtLeast(0)
        val lineStart = paragraphStart(text, start)
        if (text.substring(lineStart).startsWith("• ")) {
            text.delete(lineStart, (lineStart + 2).coerceAtMost(text.length))
        } else {
            if (text.substring(lineStart).startsWith("1. ")) {
                text.delete(lineStart, (lineStart + 3).coerceAtMost(text.length))
            }
            text.insert(lineStart, "• ")
        }
        emit()
        refresh()
    }

    fun toggleNumbered() {
        val edit = editText ?: return
        val text = edit.text
        val start = edit.selectionStart.coerceAtLeast(0)
        val lineStart = paragraphStart(text, start)
        if (text.substring(lineStart).startsWith("1. ")) {
            text.delete(lineStart, (lineStart + 3).coerceAtMost(text.length))
        } else {
            if (text.substring(lineStart).startsWith("• ")) {
                text.delete(lineStart, (lineStart + 2).coerceAtMost(text.length))
            }
            text.insert(lineStart, "1. ")
        }
        emit()
        refresh()
    }

    fun emit() {
        val edit = editText ?: return
        onHtmlChange(ComposeEmailHtml.fromSpanned(edit.text, defaultInk))
    }

    fun refresh() {
        val edit = editText ?: return
        val start = edit.selectionStart.coerceAtLeast(0)
        val text = edit.editableText
        val probeStart = start.coerceAtMost((text.length - 1).coerceAtLeast(0))
        val probeEnd = (probeStart + 1).coerceAtMost(text.length)
        val spans = if (text.isEmpty()) {
            emptyArray()
        } else {
            text.getSpans(probeStart, probeEnd, Any::class.java)
        }
        val styles = spans.filterIsInstance<StyleSpan>()
        val sizeSpan = spans.filterIsInstance<AbsoluteSizeSpan>().lastOrNull()
        val fontSizeSp = when {
            sizeSpan == null -> 13
            sizeSpan.dip -> sizeSpan.size
            else -> (sizeSpan.size / edit.resources.displayMetrics.scaledDensity)
                .roundToInt()
                .coerceIn(10, 36)
        }
        val alignment = when (spans.filterIsInstance<AlignmentSpan>().lastOrNull()?.alignment) {
            Layout.Alignment.ALIGN_CENTER -> Gravity.CENTER_HORIZONTAL
            Layout.Alignment.ALIGN_OPPOSITE -> Gravity.END
            else -> Gravity.START
        }
        val indentPx = spans.filterIsInstance<LeadingMarginSpan.Standard>().lastOrNull()
            ?.getLeadingMargin(true) ?: 0
        val color = spans.filterIsInstance<ForegroundColorSpan>().lastOrNull()?.foregroundColor
            ?: defaultInk
        val line = text.substring(paragraphStart(text, start))
        val paragraph = when {
            fontSizeSp >= 21 -> ComposeParagraphStyle.Title
            fontSizeSp >= 16 -> ComposeParagraphStyle.Subtitle
            fontSizeSp <= 12 -> ComposeParagraphStyle.Caption
            else -> ComposeParagraphStyle.Body
        }
        state = ComposeFormatState(
            paragraph = paragraph,
            bold = styles.any { it.style and Typeface.BOLD != 0 },
            italic = styles.any { it.style and Typeface.ITALIC != 0 },
            underline = spans.any { it is UnderlineSpan },
            strikethrough = spans.any { it is StrikethroughSpan },
            color = color,
            fontSizeSp = fontSizeSp,
            alignment = alignment,
            bullet = line.startsWith("• "),
            numbered = line.startsWith("1. "),
            indentPx = indentPx,
        )
        onStateChange(state)
    }

    private fun applySize(sp: Int) {
        applySpan(AbsoluteSizeSpan(sp, true))
    }

    private fun applyStyle(style: Int, enable: Boolean) {
        val edit = editText ?: return
        val (from, to) = selection()
        edit.editableText.getSpans(from, to.coerceAtLeast(from), StyleSpan::class.java)
            .filter { it.style == style }
            .forEach { edit.editableText.removeSpan(it) }
        if (enable) {
            val flags = if (from == to) Spannable.SPAN_INCLUSIVE_INCLUSIVE else Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
            edit.editableText.setSpan(StyleSpan(style), from, to.coerceAtLeast(from), flags)
        }
        emit()
    }

    private inline fun toggleSpan(create: () -> Any) {
        val edit = editText ?: return
        val (from, to) = selection()
        val sample = create()
        val existing = edit.editableText.getSpans(from, to.coerceAtLeast(from), sample.javaClass)
        if (existing.isNotEmpty()) {
            existing.forEach { edit.editableText.removeSpan(it) }
        } else {
            val flags = if (from == to) Spannable.SPAN_INCLUSIVE_INCLUSIVE else Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
            edit.editableText.setSpan(create(), from, to.coerceAtLeast(from), flags)
        }
        emit()
        refresh()
    }

    private fun applySpan(span: Any, paragraph: Boolean = false) {
        val edit = editText ?: return
        val (from, to) = selection(paragraph)
        val text = edit.editableText
        text.getSpans(from, to.coerceAtLeast(from), span.javaClass).forEach { text.removeSpan(it) }
        val flags = if (from == to) Spannable.SPAN_INCLUSIVE_INCLUSIVE else Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
        text.setSpan(span, from, to.coerceAtLeast(from), flags)
        emit()
    }

    /** Collapsed caret formats the current paragraph, matching iOS. */
    private fun selection(paragraph: Boolean = false): Pair<Int, Int> {
        val edit = editText ?: return 0 to 0
        val start = edit.selectionStart.coerceAtLeast(0)
        val end = edit.selectionEnd.coerceAtLeast(start)
        if (!paragraph && start != end) return start to end
        val text = edit.text
        val lineStart = paragraphStart(text, start)
        val lineEnd = paragraphEnd(text, start)
        return lineStart to lineEnd
    }

    private fun paragraphStart(text: CharSequence, index: Int): Int {
        val at = index.coerceIn(0, text.length)
        val from = text.lastIndexOf('\n', (at - 1).coerceAtLeast(0))
        return if (from < 0) 0 else from + 1
    }

    private fun paragraphEnd(text: CharSequence, index: Int): Int {
        val at = index.coerceIn(0, text.length)
        val nl = text.indexOf('\n', at)
        return if (nl < 0) text.length else nl
    }
}

@Composable
fun ComposeRichTextEditor(
    html: String,
    controller: ComposeRichTextController,
    onHtmlChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = inboxiesColors().ink.toArgb()
    AndroidView(
        // Parent must pass a bounded height (e.g. weight/fillMaxHeight). Nesting this
        // inside verticalScroll with only heightIn(min) collapses sibling form fields.
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            EditText(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                setTextColor(ink)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(32, 24, 32, 24)
                gravity = Gravity.TOP or Gravity.START
                hint = ""
                isVerticalScrollBarEnabled = true
                overScrollMode = android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS
                val spanned = Html.fromHtml(
                    if (html.contains('<')) html else ComposeHtml.textToHtml(html),
                    Html.FROM_HTML_MODE_COMPACT,
                )
                setText(spanned)
                controller.defaultInk = ink
                controller.editText = this
                controller.onHtmlChange = onHtmlChange
                doAfterTextChanged {
                    controller.emit()
                    controller.refresh()
                }
            }
        },
        update = { view ->
            controller.defaultInk = ink
            controller.editText = view
            controller.onHtmlChange = onHtmlChange
            view.setTextColor(ink)
        },
    )
}

/** Email-safe HTML with inline styles. [Html.toHtml] drops indent and can emit
 * dark-mode ink that vanishes on a white Gmail canvas. */
object ComposeEmailHtml {
    private val defaultInkHexes = setOf("#1F1F24", "#FAFAFC")

    fun fromSpanned(text: Spanned, defaultInk: Int): String {
        if (text.isEmpty()) return "<p><br></p>"
        val raw = text.toString()
        val parts = mutableListOf<String>()
        var location = 0
        while (location < raw.length) {
            val newline = raw.indexOf('\n', location)
            val lineEnd = if (newline < 0) raw.length else newline
            val line = raw.substring(location, lineEnd)
            val probeEnd = (location + 1).coerceAtMost(raw.length)
            val blockSpans = if (raw.isEmpty()) {
                emptyArray()
            } else {
                text.getSpans(location, probeEnd.coerceAtLeast(location), Any::class.java)
            }
            val blockCss = mutableListOf<String>()
            when (blockSpans.filterIsInstance<AlignmentSpan>().lastOrNull()?.alignment) {
                Layout.Alignment.ALIGN_CENTER -> blockCss += "text-align:center"
                Layout.Alignment.ALIGN_OPPOSITE -> blockCss += "text-align:right"
                else -> Unit
            }
            val indent = blockSpans.filterIsInstance<LeadingMarginSpan.Standard>().lastOrNull()
                ?.getLeadingMargin(true) ?: 0
            if (indent > 0) blockCss += "margin-left:${indent}px"
            val styleAttr = if (blockCss.isEmpty()) "" else " style=\"${blockCss.joinToString(";")}\""
            val isBullet = line.startsWith("• ")
            val isNumbered = line.startsWith("1. ")
            val contentStart = when {
                isBullet -> (location + 2).coerceAtMost(lineEnd)
                isNumbered -> (location + 3).coerceAtMost(lineEnd)
                else -> location
            }
            val inner = if (lineEnd <= contentStart) {
                "<br>"
            } else {
                inlineRuns(text, contentStart, lineEnd, defaultInk)
            }
            parts += when {
                isBullet -> "<ul><li$styleAttr>$inner</li></ul>"
                isNumbered -> "<ol><li$styleAttr>$inner</li></ol>"
                else -> "<p$styleAttr>$inner</p>"
            }
            location = if (newline < 0) raw.length else newline + 1
        }
        return parts.joinToString("").ifEmpty { "<p><br></p>" }
    }

    private fun inlineRuns(text: Spanned, start: Int, end: Int, defaultInk: Int): String {
        val html = StringBuilder()
        var index = start
        while (index < end) {
            val next = text.nextSpanTransition(index, end, Any::class.java)
            var piece = ComposeHtml.escapeHtml(text.subSequence(index, next).toString())
                .replace("\n", "<br>")
            val spans = text.getSpans(index, next, Any::class.java).filter { span ->
                text.getSpanStart(span) < next && text.getSpanEnd(span) > index
            }
            val css = mutableListOf<String>()
            val styles = spans.filterIsInstance<StyleSpan>()
            if (styles.any { it.style and Typeface.BOLD != 0 }) css += "font-weight:700"
            if (styles.any { it.style and Typeface.ITALIC != 0 }) css += "font-style:italic"
            spans.filterIsInstance<AbsoluteSizeSpan>().lastOrNull()?.let { size ->
                css += "font-size:${size.size}px"
            }
            spans.filterIsInstance<ForegroundColorSpan>().lastOrNull()?.let { colorSpan ->
                val hex = cssHex(colorSpan.foregroundColor)
                if (!isDefaultInk(colorSpan.foregroundColor, defaultInk)) {
                    css += "color:$hex"
                }
            }
            val underline = spans.any { it is UnderlineSpan }
            val strike = spans.any { it is StrikethroughSpan }
            when {
                underline && strike -> css += "text-decoration:underline line-through"
                underline -> css += "text-decoration:underline"
                strike -> css += "text-decoration:line-through"
            }
            if (css.isNotEmpty()) {
                piece = "<span style=\"${css.joinToString(";")}\">$piece</span>"
            }
            html.append(piece)
            index = next
        }
        return html.toString().ifEmpty { "<br>" }
    }

    private fun isDefaultInk(color: Int, defaultInk: Int): Boolean {
        val rgb = color and 0xFFFFFF
        return rgb == (defaultInk and 0xFFFFFF) || cssHex(color) in defaultInkHexes
    }

    private fun cssHex(color: Int): String =
        String.format("#%02X%02X%02X", (color shr 16) and 0xFF, (color shr 8) and 0xFF, color and 0xFF)
}

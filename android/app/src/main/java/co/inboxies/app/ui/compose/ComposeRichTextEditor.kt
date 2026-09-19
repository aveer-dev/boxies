package co.inboxies.app.ui.compose

import android.graphics.Typeface
import android.text.Html
import android.text.Spannable
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.widget.doAfterTextChanged
import co.inboxies.app.util.ComposeHtml

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
        if (bold) applyStyle(Typeface.BOLD, enable = true) else applyStyle(Typeface.BOLD, enable = false)
        refresh()
    }

    fun toggleBold() = toggleSpan { StyleSpan(Typeface.BOLD) }
    fun toggleItalic() = toggleSpan { StyleSpan(Typeface.ITALIC) }
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
            Gravity.CENTER_HORIZONTAL -> android.text.Layout.Alignment.ALIGN_CENTER
            Gravity.END -> android.text.Layout.Alignment.ALIGN_OPPOSITE
            else -> android.text.Layout.Alignment.ALIGN_NORMAL
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
        val lineStart = text.lastIndexOf('\n', (start - 1).coerceAtLeast(0)).let { if (it < 0) 0 else it + 1 }
        if (text.substring(lineStart).startsWith("• ")) {
            text.delete(lineStart, (lineStart + 2).coerceAtMost(text.length))
        } else {
            text.insert(lineStart, "• ")
        }
        emit()
        refresh()
    }

    fun toggleNumbered() {
        val edit = editText ?: return
        val text = edit.text
        val start = edit.selectionStart.coerceAtLeast(0)
        val lineStart = text.lastIndexOf('\n', (start - 1).coerceAtLeast(0)).let { if (it < 0) 0 else it + 1 }
        if (text.substring(lineStart).startsWith("1. ")) {
            text.delete(lineStart, (lineStart + 3).coerceAtMost(text.length))
        } else {
            text.insert(lineStart, "1. ")
        }
        emit()
        refresh()
    }

    fun emit() {
        val edit = editText ?: return
        onHtmlChange(Html.toHtml(edit.text, Html.TO_HTML_PARAGRAPH_LINES_CONSECUTIVE))
    }

    fun refresh() {
        val edit = editText ?: return
        val start = edit.selectionStart.coerceAtLeast(0)
        val spans = edit.editableText.getSpans(start, start.coerceAtLeast(start), Any::class.java)
        val styles = spans.filterIsInstance<StyleSpan>()
        state = ComposeFormatState(
            bold = styles.any { it.style and Typeface.BOLD != 0 },
            italic = styles.any { it.style and Typeface.ITALIC != 0 },
            underline = spans.any { it is UnderlineSpan },
            strikethrough = spans.any { it is StrikethroughSpan },
            fontSizeSp = spans.filterIsInstance<AbsoluteSizeSpan>().lastOrNull()?.size?.takeIf { it > 0 } ?: 13,
        )
        onStateChange(state)
    }

    private fun applySize(sp: Int) {
        val edit = editText ?: return
        val px = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP,
            sp.toFloat(),
            edit.resources.displayMetrics,
        ).toInt()
        applySpan(AbsoluteSizeSpan(px))
    }

    private fun applyStyle(style: Int, enable: Boolean) {
        val edit = editText ?: return
        val (from, to) = selection()
        if (!enable) {
            edit.editableText.getSpans(from, to, StyleSpan::class.java)
                .filter { it.style == style }
                .forEach { edit.editableText.removeSpan(it) }
        } else {
            edit.editableText.setSpan(StyleSpan(style), from, to, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        emit()
    }

    private inline fun toggleSpan(create: () -> Any) {
        val edit = editText ?: return
        val (from, to) = selection()
        val sample = create()
        val existing = edit.editableText.getSpans(from, to, sample.javaClass)
        if (existing.isNotEmpty()) {
            existing.forEach { edit.editableText.removeSpan(it) }
        } else {
            edit.editableText.setSpan(create(), from, to, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        emit()
        refresh()
    }

    private fun applySpan(span: Any, paragraph: Boolean = false) {
        val edit = editText ?: return
        val (from, to) = if (paragraph) 0 to edit.text.length else selection()
        if (from == to && edit.text.isEmpty()) {
            edit.editableText.setSpan(span, 0, 0, Spannable.SPAN_INCLUSIVE_INCLUSIVE)
        } else {
            edit.editableText.setSpan(span, from, to.coerceAtLeast(from + if (from == to) 0 else 0), Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        emit()
    }

    private fun selection(): Pair<Int, Int> {
        val edit = editText ?: return 0 to 0
        val start = edit.selectionStart.coerceAtLeast(0)
        val end = edit.selectionEnd.coerceAtLeast(start)
        return if (start == end) {
            0 to edit.text.length.coerceAtLeast(0)
        } else {
            start to end
        }
    }
}

@Composable
fun ComposeRichTextEditor(
    html: String,
    controller: ComposeRichTextController,
    onHtmlChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val ink = remember { android.graphics.Color.parseColor("#1F1F24") }
    AndroidView(
        modifier = modifier,
        factory = { context ->
            EditText(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                setTextColor(ink)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(32, 24, 32, 24)
                gravity = Gravity.TOP or Gravity.START
                hint = ""
                val spanned = Html.fromHtml(
                    if (html.contains('<')) html else ComposeHtml.textToHtml(html),
                    Html.FROM_HTML_MODE_COMPACT,
                )
                setText(spanned)
                controller.editText = this
                controller.onHtmlChange = onHtmlChange
                doAfterTextChanged {
                    controller.emit()
                    controller.refresh()
                }
            }
        },
        update = { view ->
            controller.editText = view
            controller.onHtmlChange = onHtmlChange
        },
    )
}

package co.inboxies.app.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.MailAddress
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.chat.ContactPillMenu
import co.inboxies.app.ui.chat.ContactPillParser
import co.inboxies.app.ui.chat.InlineFlowItem

/**
 * Markdown renderer for chat bubbles and email plain-text fallback.
 * Supports headings, lists, tasks, tables, code, blockquotes, dividers, and contact pills.
 */
@Composable
fun MarkdownContentView(
    markdown: String,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = AppThemeDims.Chat.body,
    onCompose: ((MailAddress) -> Unit)? = null,
    onSearch: ((String) -> Unit)? = null,
    onAskAI: ((String) -> Unit)? = null,
) {
    val blocks = remember(markdown) { parseMarkdownBlocks(markdown) }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Heading -> {
                    val size = when (block.level) {
                        1 -> fontSize.value + 5
                        2 -> fontSize.value + 3
                        3 -> fontSize.value + 1.5f
                        4 -> fontSize.value + 0.5f
                        5 -> fontSize.value
                        else -> maxOf(fontSize.value - 1, 10f)
                    }.sp
                    val weight = when (block.level) {
                        1, 2 -> FontWeight.Bold
                        3, 4 -> FontWeight.SemiBold
                        else -> FontWeight.Medium
                    }
                    InlineMarkdownText(
                        text = block.text,
                        fontSize = size,
                        fontWeight = weight,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                    )
                }
                is MdBlock.Paragraph -> InlineMarkdownText(
                    text = block.text,
                    fontSize = fontSize,
                    onCompose = onCompose,
                    onSearch = onSearch,
                    onAskAI = onAskAI,
                )
                is MdBlock.Bullet -> Row(modifier = Modifier.padding(start = (block.indent * 12).dp)) {
                    Text(
                        "• ",
                        fontFamily = InterFontFamily,
                        fontSize = fontSize,
                        color = inboxiesColors().ink,
                    )
                    InlineMarkdownText(
                        text = block.text,
                        fontSize = fontSize,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                is MdBlock.Numbered -> Row(modifier = Modifier.padding(start = (block.indent * 12).dp)) {
                    Text(
                        "${block.index} ",
                        fontFamily = InterFontFamily,
                        fontSize = fontSize,
                        color = inboxiesColors().ink,
                    )
                    InlineMarkdownText(
                        text = block.text,
                        fontSize = fontSize,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                is MdBlock.Task -> {
                    val colors = inboxiesColors()
                    Row(
                        modifier = Modifier.padding(start = (block.indent * 12).dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            if (block.isDone) "☑" else "☐",
                            fontSize = fontSize,
                            color = if (block.isDone) colors.muted else colors.ink,
                        )
                        InlineMarkdownText(
                            text = block.text,
                            fontSize = fontSize,
                            onCompose = onCompose,
                            onSearch = onSearch,
                            onAskAI = onAskAI,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                    }
                }
                is MdBlock.Code -> CodeBlockView(language = block.language, code = block.text)
                is MdBlock.Blockquote -> {
                    val colors = inboxiesColors()
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(colors.pillFill.copy(alpha = 0.45f))
                            .border(
                                width = 3.dp,
                                color = colors.line,
                                shape = RoundedCornerShape(topStart = 4.dp, bottomStart = 4.dp),
                            )
                            .padding(start = 12.dp, top = 6.dp, bottom = 6.dp, end = 8.dp),
                    ) {
                        InlineMarkdownText(
                            text = block.text,
                            fontSize = fontSize,
                            onCompose = onCompose,
                            onSearch = onSearch,
                            onAskAI = onAskAI,
                        )
                    }
                }
                is MdBlock.Table -> MarkdownTableView(
                    headers = block.headers,
                    alignments = block.alignments,
                    rows = block.rows,
                    fontSize = AppThemeDims.Chat.tableCell,
                    onCompose = onCompose,
                    onSearch = onSearch,
                    onAskAI = onAskAI,
                )
                is MdBlock.Divider -> {
                    val colors = inboxiesColors()
                    Spacer(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .height(0.5.dp)
                            .background(colors.line),
                    )
                }
            }
        }
    }
}

@Composable
private fun InlineMarkdownText(
    text: String,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
    fontWeight: FontWeight = FontWeight.Normal,
    onCompose: ((MailAddress) -> Unit)? = null,
    onSearch: ((String) -> Unit)? = null,
    onAskAI: ((String) -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val interactive = onCompose != null || onSearch != null || onAskAI != null

    if (interactive && ContactPillParser.containsContactOrEmail(text)) {
        val items = remember(text) { ContactPillParser.parseInlineItems(text) }
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(
            modifier = modifier,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items.forEach { item ->
                when (item) {
                    is InlineFlowItem.Word -> Text(
                        parseInlineMarkdown(item.text),
                        fontFamily = InterFontFamily,
                        fontSize = fontSize,
                        fontWeight = fontWeight,
                        letterSpacing = AppThemeDims.Chat.tracking,
                        color = colors.ink,
                        lineHeight = (fontSize.value * (1f + AppThemeDims.Chat.bodyLineSpacingRatio)).sp,
                    )
                    is InlineFlowItem.Contact -> ContactPillMenu(
                        address = item.address,
                        trailingPunctuation = item.trailingPunctuation,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                    )
                }
            }
        }
    } else {
        Text(
            parseInlineMarkdown(text),
            modifier = modifier,
            fontFamily = InterFontFamily,
            fontSize = fontSize,
            fontWeight = fontWeight,
            letterSpacing = AppThemeDims.Chat.tracking,
            color = colors.ink,
            lineHeight = (fontSize.value * (1f + AppThemeDims.Chat.bodyLineSpacingRatio)).sp,
        )
    }
}

@Composable
private fun CodeBlockView(language: String?, code: String) {
    val colors = inboxiesColors()
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(colors.pillFill.copy(alpha = 0.45f))
            .border(1.dp, colors.line, RoundedCornerShape(10.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.line.copy(alpha = 0.45f))
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                (language?.takeIf { it.isNotEmpty() } ?: "code").uppercase(),
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = AppThemeDims.Chat.codeMeta,
                letterSpacing = 0.5.sp,
                color = colors.muted,
                modifier = Modifier.weight(1f),
            )
            TextButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("code", code))
                    copied = true
                },
            ) {
                Icon(
                    if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                    contentDescription = null,
                    tint = if (copied) Color(0xFF2E7D32) else colors.muted,
                    modifier = Modifier.padding(end = 4.dp),
                )
                Text(
                    if (copied) "Copied" else "Copy",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.Chat.codeMeta,
                    color = if (copied) Color(0xFF2E7D32) else colors.muted,
                )
            }
        }
        SelectionContainer {
            Text(
                code,
                fontFamily = FontFamily.Monospace,
                fontSize = AppThemeDims.Chat.code,
                color = colors.ink,
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(12.dp),
            )
        }
    }
}

@Composable
private fun MarkdownTableView(
    headers: List<String>,
    alignments: List<TextAlign>,
    rows: List<List<String>>,
    fontSize: TextUnit,
    onCompose: ((MailAddress) -> Unit)?,
    onSearch: ((String) -> Unit)?,
    onAskAI: ((String) -> Unit)?,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, colors.line, RoundedCornerShape(8.dp)),
    ) {
        Row(modifier = Modifier.background(colors.pillFill.copy(alpha = 0.65f))) {
            headers.forEachIndexed { colIdx, header ->
                Box(
                    modifier = Modifier
                        .padding(horizontal = 10.dp, vertical = 7.dp)
                        .width(120.dp),
                    contentAlignment = when (alignments.getOrNull(colIdx) ?: TextAlign.Start) {
                        TextAlign.Center -> Alignment.Center
                        TextAlign.End -> Alignment.CenterEnd
                        else -> Alignment.CenterStart
                    },
                ) {
                    InlineMarkdownText(
                        text = header,
                        fontSize = (fontSize.value - 0.5f).sp,
                        fontWeight = FontWeight.SemiBold,
                        onCompose = onCompose,
                        onSearch = onSearch,
                        onAskAI = onAskAI,
                    )
                }
            }
        }
        rows.forEachIndexed { rowIdx, row ->
            Row(
                modifier = Modifier.background(
                    if (rowIdx % 2 == 1) colors.pillFill.copy(alpha = 0.25f) else Color.Transparent,
                ),
            ) {
                headers.indices.forEach { colIdx ->
                    val cell = row.getOrNull(colIdx).orEmpty()
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                            .width(120.dp),
                        contentAlignment = when (alignments.getOrNull(colIdx) ?: TextAlign.Start) {
                            TextAlign.Center -> Alignment.Center
                            TextAlign.End -> Alignment.CenterEnd
                            else -> Alignment.CenterStart
                        },
                    ) {
                        InlineMarkdownText(
                            text = cell,
                            fontSize = (fontSize.value - 0.5f).sp,
                            onCompose = onCompose,
                            onSearch = onSearch,
                            onAskAI = onAskAI,
                        )
                    }
                }
            }
        }
    }
}

private sealed class MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock()
    data class Paragraph(val text: String) : MdBlock()
    data class Bullet(val indent: Int, val text: String) : MdBlock()
    data class Numbered(val indent: Int, val index: String, val text: String) : MdBlock()
    data class Task(val indent: Int, val isDone: Boolean, val text: String) : MdBlock()
    data class Code(val language: String?, val text: String) : MdBlock()
    data class Blockquote(val text: String) : MdBlock()
    data class Table(
        val headers: List<String>,
        val alignments: List<TextAlign>,
        val rows: List<List<String>>,
    ) : MdBlock()
    data object Divider : MdBlock()
}

private fun parseMarkdownBlocks(markdown: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val lines = markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    var i = 0

    while (i < lines.size) {
        val rawLine = lines[i]
        val leadingSpaces = rawLine.takeWhile { it == ' ' || it == '\t' }.length
        val indent = maxOf(0, leadingSpaces / 2)
        val trimmed = rawLine.trim()

        if (trimmed.isEmpty()) {
            i++
            continue
        }

        if (trimmed.startsWith("```")) {
            val lang = trimmed.drop(3).trim().ifEmpty { null }
            val code = StringBuilder()
            i++
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                if (code.isNotEmpty()) code.append('\n')
                code.append(lines[i])
                i++
            }
            if (i < lines.size) i++
            blocks.add(MdBlock.Code(lang, code.toString()))
            continue
        }

        if (trimmed == "---" || trimmed == "***" || trimmed == "___") {
            blocks.add(MdBlock.Divider)
            i++
            continue
        }

        if (trimmed.startsWith("#")) {
            val hashCount = trimmed.takeWhile { it == '#' }.length
            if (hashCount in 1..6 && trimmed.drop(hashCount).startsWith(" ")) {
                blocks.add(MdBlock.Heading(hashCount, trimmed.drop(hashCount).trim()))
                i++
                continue
            }
        }

        if (trimmed.startsWith(">")) {
            val quoteLines = mutableListOf<String>()
            while (i < lines.size) {
                val q = lines[i].trim()
                when {
                    q.startsWith("> ") -> {
                        quoteLines.add(q.drop(2))
                        i++
                    }
                    q == ">" -> {
                        quoteLines.add("")
                        i++
                    }
                    q.isNotEmpty() &&
                        !q.startsWith("#") &&
                        !q.startsWith("- ") &&
                        !q.startsWith("* ") &&
                        !q.startsWith("```") &&
                        !q.contains("|") -> {
                        quoteLines.add(q)
                        i++
                    }
                    else -> break
                }
            }
            blocks.add(MdBlock.Blockquote(quoteLines.joinToString("\n")))
            continue
        }

        if (trimmed.contains("|") && i + 1 < lines.size && isTableSeparatorRow(lines[i + 1])) {
            val headers = parseTableRowCells(trimmed)
            val alignments = parseTableAlignments(lines[i + 1], headers.size)
            i += 2
            val rows = mutableListOf<List<String>>()
            while (i < lines.size) {
                val rowTrimmed = lines[i].trim()
                if (rowTrimmed.isEmpty() || !rowTrimmed.contains("|")) break
                var cells = parseTableRowCells(rowTrimmed)
                if (cells.size < headers.size) {
                    cells = cells + List(headers.size - cells.size) { "" }
                } else if (cells.size > headers.size) {
                    cells = cells.take(headers.size)
                }
                rows.add(cells)
                i++
            }
            blocks.add(MdBlock.Table(headers, alignments, rows))
            continue
        }

        when {
            trimmed.startsWith("- [ ] ") || trimmed.startsWith("* [ ] ") -> {
                blocks.add(MdBlock.Task(indent, false, trimmed.drop(6)))
                i++
            }
            trimmed.startsWith("- [x] ") || trimmed.startsWith("- [X] ") ||
                trimmed.startsWith("* [x] ") || trimmed.startsWith("* [X] ") -> {
                blocks.add(MdBlock.Task(indent, true, trimmed.drop(6)))
                i++
            }
            trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ") -> {
                blocks.add(MdBlock.Bullet(indent, trimmed.drop(2)))
                i++
            }
            Regex("^\\d+[.)]\\s+").containsMatchIn(trimmed) -> {
                val match = Regex("^(\\d+[.)])\\s+(.*)").find(trimmed)!!
                blocks.add(MdBlock.Numbered(indent, match.groupValues[1], match.groupValues[2]))
                i++
            }
            else -> {
                val paraLines = mutableListOf(trimmed)
                i++
                while (i < lines.size) {
                    val next = lines[i].trim()
                    if (next.isEmpty() ||
                        next.startsWith("```") ||
                        next.startsWith("#") ||
                        next.startsWith("- ") ||
                        next.startsWith("* ") ||
                        next.startsWith("• ") ||
                        next.startsWith(">") ||
                        next == "---" || next == "***" || next == "___" ||
                        (next.contains("|") && i + 1 < lines.size && isTableSeparatorRow(lines[i + 1])) ||
                        Regex("^\\d+[.)]\\s+").containsMatchIn(next)
                    ) break
                    paraLines.add(next)
                    i++
                }
                blocks.add(MdBlock.Paragraph(paraLines.joinToString(" ")))
            }
        }
    }

    if (blocks.isEmpty() && markdown.isNotBlank()) {
        blocks.add(MdBlock.Paragraph(markdown))
    }
    return blocks
}

private fun isTableSeparatorRow(line: String): Boolean {
    val trimmed = line.trim()
    if (!trimmed.contains('-')) return false
    val cells = parseTableRowCells(trimmed)
    if (cells.isEmpty()) return false
    return cells.all { cell ->
        val cleaned = cell.trim(' ', ':', '-', '|')
        cleaned.isEmpty() && cell.contains('-')
    }
}

private fun parseTableRowCells(line: String): List<String> {
    var trimmed = line.trim()
    if (trimmed.startsWith("|")) trimmed = trimmed.drop(1)
    if (trimmed.endsWith("|")) trimmed = trimmed.dropLast(1)
    return trimmed.split("|").map { it.trim() }
}

private fun parseTableAlignments(line: String, columnCount: Int): List<TextAlign> {
    val cells = parseTableRowCells(line)
    val alignments = cells.map { cell ->
        val hasLeading = cell.startsWith(":")
        val hasTrailing = cell.endsWith(":")
        when {
            hasLeading && hasTrailing -> TextAlign.Center
            hasTrailing -> TextAlign.End
            else -> TextAlign.Start
        }
    }.toMutableList()
    while (alignments.size < columnCount) alignments.add(TextAlign.Start)
    return alignments.take(columnCount)
}

/** Lightweight inline markdown: **bold**, *italic*, `code`. */
private fun parseInlineMarkdown(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("**", i) -> {
                val end = text.indexOf("**", i + 2)
                if (end > i) {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(text.substring(i + 2, end))
                    }
                    i = end + 2
                } else {
                    append(text[i])
                    i++
                }
            }
            text.startsWith("`", i) -> {
                val end = text.indexOf('`', i + 1)
                if (end > i) {
                    withStyle(
                        SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            background = Color(0x22000000),
                        ),
                    ) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(text[i])
                    i++
                }
            }
            text.startsWith("*", i) && (i + 1 >= text.length || text[i + 1] != '*') -> {
                val end = text.indexOf('*', i + 1)
                if (end > i) {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(text.substring(i + 1, end))
                    }
                    i = end + 1
                } else {
                    append(text[i])
                    i++
                }
            }
            else -> {
                append(text[i])
                i++
            }
        }
    }
}

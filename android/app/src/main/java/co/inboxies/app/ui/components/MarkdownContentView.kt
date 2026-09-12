package co.inboxies.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/**
 * Lightweight markdown renderer for chat bubbles (headings, lists, code fences, paragraphs).
 */
@Composable
fun MarkdownContentView(markdown: String, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    val blocks = rememberMarkdownBlocks(markdown)
    Column(modifier = Modifier.fillMaxWidth()) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Heading -> Text(
                    block.text,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = (16 - block.level).coerceAtLeast(12).sp,
                    color = colors.ink,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
                is MdBlock.Bullet -> Text(
                    "• ${block.text}",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(vertical = 2.dp),
                )
                is MdBlock.Code -> SelectionContainer {
                    Text(
                        block.text,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.5.sp,
                        color = colors.ink,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                    )
                }
                is MdBlock.Paragraph -> Text(
                    block.text,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(vertical = 2.dp),
                    lineHeight = 18.sp,
                )
            }
        }
    }
}

private sealed class MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock()
    data class Bullet(val text: String) : MdBlock()
    data class Code(val text: String) : MdBlock()
    data class Paragraph(val text: String) : MdBlock()
}

@Composable
private fun rememberMarkdownBlocks(markdown: String): List<MdBlock> {
    return androidx.compose.runtime.remember(markdown) { parseMarkdown(markdown) }
}

private fun parseMarkdown(input: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val lines = input.replace("\r\n", "\n").split("\n")
    var i = 0
    val paragraph = StringBuilder()
    fun flushParagraph() {
        val text = paragraph.toString().trim()
        if (text.isNotEmpty()) blocks.add(MdBlock.Paragraph(text))
        paragraph.clear()
    }
    while (i < lines.size) {
        val line = lines[i]
        when {
            line.startsWith("```") -> {
                flushParagraph()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].startsWith("```")) {
                    if (code.isNotEmpty()) code.append('\n')
                    code.append(lines[i])
                    i++
                }
                blocks.add(MdBlock.Code(code.toString()))
            }
            line.matches(Regex("^#{1,6}\\s+.+")) -> {
                flushParagraph()
                val level = line.takeWhile { it == '#' }.length
                blocks.add(MdBlock.Heading(level, line.drop(level).trim()))
            }
            line.matches(Regex("^[-*]\\s+.+")) -> {
                flushParagraph()
                blocks.add(MdBlock.Bullet(line.drop(2).trim()))
            }
            line.isBlank() -> flushParagraph()
            else -> {
                if (paragraph.isNotEmpty()) paragraph.append(' ')
                paragraph.append(line.trim())
            }
        }
        i++
    }
    flushParagraph()
    if (blocks.isEmpty() && input.isNotBlank()) {
        blocks.add(MdBlock.Paragraph(input))
    }
    return blocks
}

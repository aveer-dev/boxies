package co.inboxies.app.util

/**
 * HTML → plain text for the quoted original in replies and forwards (AVE-133).
 * Mirrors `shared/quoted-text.ts` (web + Worker) and iOS `QuotedText`; all three
 * are checked against `shared/quoted-text.fixtures.json`.
 */
object QuotedText {
    private val namedEntities: Map<String, String> = mapOf(
        "nbsp" to " ", "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'",
        "shy" to "", "zwnj" to "", "zwj" to "‍", "lrm" to "", "rlm" to "",
        "ensp" to " ", "emsp" to " ", "thinsp" to " ",
        "ndash" to "–", "mdash" to "—", "lsquo" to "‘", "rsquo" to "’", "sbquo" to "‚",
        "ldquo" to "“", "rdquo" to "”", "bdquo" to "„", "laquo" to "«", "raquo" to "»",
        "hellip" to "…", "bull" to "•", "middot" to "·", "copy" to "©", "reg" to "®", "trade" to "™",
        "euro" to "€", "pound" to "£", "yen" to "¥", "cent" to "¢", "deg" to "°", "times" to "×",
        "divide" to "÷", "plusmn" to "±", "sect" to "§", "para" to "¶", "iexcl" to "¡", "iquest" to "¿",
        "rarr" to "→", "larr" to "←", "uarr" to "↑", "darr" to "↓", "hearts" to "♥", "star" to "☆", "check" to "✓",
        "aacute" to "á", "eacute" to "é", "iacute" to "í", "oacute" to "ó", "uacute" to "ú",
        "agrave" to "à", "egrave" to "è", "ugrave" to "ù", "acirc" to "â", "ecirc" to "ê", "ocirc" to "ô",
        "auml" to "ä", "euml" to "ë", "iuml" to "ï", "ouml" to "ö", "uuml" to "ü",
        "ntilde" to "ñ", "ccedil" to "ç", "szlig" to "ß",
        "Aacute" to "Á", "Eacute" to "É", "Oacute" to "Ó", "Auml" to "Ä", "Ouml" to "Ö", "Uuml" to "Ü",
        "Ntilde" to "Ñ", "Ccedil" to "Ç",
    )

    private val voidTags = setOf(
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
    )

    private val ci = setOf(RegexOption.IGNORE_CASE)
    private val htmlTag = Regex("""<\/?[a-z][^>]*>|<!--""", RegexOption.IGNORE_CASE)
    private val entity = Regex("""&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);""", RegexOption.IGNORE_CASE)
    private val opener = Regex("""<([a-z][a-z0-9]*)\b[^>]*\bstyle\s*=\s*("[^"]*"|'[^']*')[^>]*>""", RegexOption.IGNORE_CASE)
    private val displayNone = Regex("""display\s*:\s*none""")

    /** Invisible/format characters used as preheader padding. ZWJ is kept (emoji). */
    private val invisibleChars = Regex("[­͏؜᠎​‌‎‏⁠-⁤﻿]")

    fun fromHtml(html: String?): String {
        if (html.isNullOrEmpty()) return ""
        val input = html.replace(Regex("\r\n?"), "\n")
        if (!htmlTag.containsMatchIn(input)) return tidyLines(decodeEntities(input))
        val text = dropHiddenElements(dropNonContent(input))
            .replace(Regex("[ \t\n\u000C]+"), " ")
            .replace(Regex("""<br\b[^>]*>""", ci), "\n")
            .replace(Regex("""<li\b[^>]*>""", ci), "\n• ")
            .replace(Regex("""</?(p|h[1-6]|blockquote|pre|ul|ol)\b[^>]*>""", ci), "\n\n")
            .replace(
                Regex("""</?(div|tr|table|tbody|thead|tfoot|section|article|header|footer|dl|dt|dd|center|address)\b[^>]*>""", ci),
                "\n",
            )
            .replace(Regex("""<hr\b[^>]*>""", ci), "\n")
            .replace(Regex("""</(td|th)\s*>""", ci), " ")
            .replace(Regex("<[^>]*>"), "")
            .replace(Regex("<[^>]*$"), "")
        return tidyLines(decodeEntities(text))
    }

    fun decodeEntities(text: String): String {
        if (!text.contains('&')) return text
        return entity.replace(text) { match ->
            val body = match.groupValues[1]
            if (body.startsWith("#")) {
                val code = if (body.length > 1 && (body[1] == 'x' || body[1] == 'X')) {
                    body.substring(2).toIntOrNull(16)
                } else {
                    body.substring(1).toIntOrNull()
                }
                if (code == null || code <= 0 || code > 0x10FFFF || code in 0xD800..0xDFFF) {
                    ""
                } else {
                    String(Character.toChars(code))
                }
            } else {
                namedEntities[body] ?: namedEntities[body.lowercase()] ?: match.value
            }
        }
    }

    private fun dropNonContent(html: String): String =
        html
            .replace(Regex("<!--[\\s\\S]*?-->"), "")
            .replace(Regex("""<(head|style|script|title)\b[^>]*>[\s\S]*?</\1\s*>""", ci), "")
            .replace(Regex("""<(style|script)\b[^>]*>[\s\S]*$""", ci), "")

    /** Remove elements styled `display:none` (and everything inside them). */
    private fun dropHiddenElements(html: String): String {
        var out = html
        var searchFrom = 0
        while (searchFrom <= out.length) {
            val match = opener.find(out, searchFrom) ?: break
            val afterOpen = match.range.last + 1
            if (!displayNone.containsMatchIn(match.groupValues[2].lowercase())) {
                searchFrom = afterOpen
                continue
            }
            val tag = match.groupValues[1].lowercase()
            val start = match.range.first
            var end = afterOpen
            if (tag !in voidTags && !match.value.endsWith("/>")) {
                var depth = 1
                for (t in Regex("""<(/?)$tag\b[^>]*>""", ci).findAll(out, afterOpen)) {
                    depth += if (t.groupValues[1].isNotEmpty()) -1 else 1
                    if (depth == 0) {
                        end = t.range.last + 1
                        break
                    }
                }
                // Unbalanced markup: drop just the opening tag rather than the rest of the mail.
            }
            out = out.removeRange(start, end)
            searchFrom = start
        }
        return out
    }

    private fun tidyLines(text: String): String =
        text
            .replace(invisibleChars, "")
            .split("\n")
            .joinToString("\n") { line ->
                line.replace(Regex("[ \t  -   　]+"), " ").trim(' ')
            }
            .replace(Regex("\n{3,}"), "\n\n")
            .trim(' ', '\n')
}

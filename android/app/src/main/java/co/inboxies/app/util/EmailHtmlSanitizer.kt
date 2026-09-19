package co.inboxies.app.util

import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import org.jsoup.safety.Cleaner
import org.jsoup.safety.Safelist

/**
 * Native analogue of web `EmailIframe` DOMPurify options:
 * HTML profile, forbid `<style>` tags, keep `target` on links.
 */
object EmailHtmlSanitizer {
    const val CONTENT_SECURITY_POLICY =
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'unsafe-inline'"

    const val OPAQUE_ORIGIN = "https://inboxies.invalid/"

    data class SplitBody(val main: String, val quote: String?)

    fun prepare(html: String): SplitBody = splitQuotedReplies(sanitize(html))

    fun sanitize(html: String): String =
        runCatching {
            val dirty = Jsoup.parseBodyFragment(html)
            val clean = Cleaner(mailSafelist()).clean(dirty)
            stripDangerousCss(clean)
            clean.outputSettings().prettyPrint(false)
            clean.body()?.html().orEmpty()
        }.getOrElse { "" }

    fun splitQuotedReplies(html: String): SplitBody {
        if (html.isBlank()) return SplitBody(main = html, quote = null)
        return runCatching {
            val doc = Jsoup.parseBodyFragment(html)
            doc.outputSettings().prettyPrint(false)
            val body = doc.body() ?: return SplitBody(main = html, quote = null)
            val start = findQuoteStart(body) ?: return SplitBody(main = html, quote = null)
            val quoteParts = ArrayList<String>()
            val toRemove = ArrayList<Node>()
            var curr: Node? = start
            while (curr != null) {
                val next = curr.nextSibling()
                when (curr) {
                    is Element -> {
                        if (!curr.tagName().equals("script", ignoreCase = true)) {
                            quoteParts.add(curr.outerHtml())
                            toRemove.add(curr)
                        }
                    }
                    is TextNode -> {
                        quoteParts.add(curr.wholeText)
                        toRemove.add(curr)
                    }
                }
                curr = next
            }
            toRemove.forEach { it.remove() }
            val quote = quoteParts.joinToString("").trim()
            val main = body.html().trim()
            if (quote.isEmpty() || main.isEmpty()) SplitBody(main = html, quote = null)
            else SplitBody(main = main, quote = quote)
        }.getOrElse { SplitBody(main = html, quote = null) }
    }

    private fun mailSafelist(): Safelist =
        Safelist.relaxed()
            .addTags("font", "center", "hr", "s", "u", "thead", "tbody", "tfoot", "col", "colgroup", "caption")
            .addAttributes(":all", "class", "id", "style", "align", "dir", "lang", "title")
            .addAttributes("a", "href", "target", "rel", "name")
            .addAttributes("img", "src", "alt", "width", "height", "border", "hspace", "vspace")
            .addAttributes("table", "border", "cellpadding", "cellspacing", "width", "height", "bgcolor", "background")
            .addAttributes("td", "colspan", "rowspan", "width", "height", "bgcolor", "valign", "background")
            .addAttributes("th", "colspan", "rowspan", "width", "height", "bgcolor", "valign")
            .addAttributes("tr", "bgcolor", "valign")
            .addAttributes("font", "color", "face", "size")
            .addProtocols("a", "href", "http", "https", "mailto")
            .addProtocols("img", "src", "http", "https", "cid", "data")
            .preserveRelativeLinks(true)

    private val dangerousCss = Regex(
        """javascript:|vbscript:|expression\s*\(|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*javascript""",
        RegexOption.IGNORE_CASE,
    )

    private fun stripDangerousCss(doc: Document) {
        doc.select("[style]").forEach { el ->
            val style = el.attr("style")
            if (style.isBlank()) return@forEach
            if (dangerousCss.containsMatchIn(style)) {
                el.removeAttr("style")
            }
        }
        doc.select("[href], [src]").forEach { el ->
            listOf("href", "src").forEach { attr ->
                if (!el.hasAttr(attr)) return@forEach
                val value = el.attr(attr).trim()
                val scheme = value.substringBefore(":", missingDelimiterValue = "").lowercase()
                if (scheme in DANGEROUS_SCHEMES) el.removeAttr(attr)
            }
        }
    }

    private val DANGEROUS_SCHEMES = setOf("javascript", "vbscript", "file", "blob", "about")

    private val quoteSelectors = listOf(
        ".gmail_quote",
        ".yahoo_quoted",
        ".protonmail_quote",
        "#divRplyFwdMsg",
        "blockquote[type=cite]",
    )

    private fun findQuoteStart(body: Element): Node? {
        var target: Element? = null
        for (selector in quoteSelectors) {
            val found = body.selectFirst(selector) ?: continue
            target = found
            var parent = found.parent()
            while (parent != null && parent !== body) {
                if (parent.`is`(quoteSelectors.joinToString(","))) {
                    target = parent
                    parent = parent.parent()
                } else {
                    break
                }
            }
            break
        }
        if (target == null) {
            val append = body.getElementById("appendonsend")
            if (append != null && append.nextElementSibling() != null) {
                target = append
            }
        }
        if (target == null) {
            for (bq in body.select("blockquote")) {
                if (bq.parent()?.closest("blockquote") != null) continue
                val text = bq.text().trim()
                val style = bq.attr("style").lowercase()
                val hasReplyPattern =
                    Regex("""on\s.+wrote:\s*""", RegexOption.IGNORE_CASE).containsMatchIn(text) ||
                        Regex("""wrote:\s*$""", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)).containsMatchIn(text) ||
                        text.contains("original message", ignoreCase = true) ||
                        Regex("""from:\s.+\n?(sent|date):""", RegexOption.IGNORE_CASE).containsMatchIn(text) ||
                        style.contains("border-left")
                var hasSubstantialAfter = false
                var sibling = bq.nextElementSibling()
                while (sibling != null) {
                    val sibText = sibling.text().trim()
                    val className = sibling.className()
                    val isSig = className.contains("signature") || className.contains("gmail_signature")
                    if (sibText.length > 40 && !isSig) {
                        hasSubstantialAfter = true
                        break
                    }
                    sibling = sibling.nextElementSibling()
                }
                if (hasReplyPattern || !hasSubstantialAfter) {
                    target = bq
                    break
                }
            }
        }
        val root = target ?: return null
        var prev = root.previousElementSibling()
        while (prev != null && (prev.tagName().equals("br", true) || prev.text().trim().isEmpty())) {
            prev = prev.previousElementSibling()
        }
        if (prev != null) {
            val pText = prev.text().trim()
            val isAttr = prev.hasClass("gmail_attr") || prev.hasClass("moz-cite-prefix")
            val header = Regex(
                """^(on\s.+wrote:|from:\s.+|---\s*original message|-----original message)""",
                RegexOption.IGNORE_CASE,
            ).containsMatchIn(pText)
            if (header || isAttr) return prev
        }
        return root
    }
}

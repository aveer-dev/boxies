import Foundation
import SwiftSoup

/// Native analogue of web `EmailIframe` DOMPurify options:
/// HTML profile, forbid `<style>` tags, keep `target` on links.
enum EmailHTMLSanitizer {
    static let contentSecurityPolicy =
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'unsafe-inline'"

    static let opaqueOrigin = URL(string: "https://inboxies.invalid/")!

    struct SplitBody {
        let main: String
        let quote: String?
    }

    static func prepare(_ html: String) -> SplitBody {
        splitQuotedReplies(sanitize(html))
    }

    static func sanitize(_ html: String) -> String {
        do {
            guard let cleaned = try SwiftSoup.clean(html, "", mailWhitelist()) else { return "" }
            let doc = try SwiftSoup.parseBodyFragment(cleaned, "")
            try stripDangerousCss(doc)
            doc.outputSettings().prettyPrint(pretty: false)
            return try doc.body()?.html() ?? ""
        } catch {
            return ""
        }
    }

    static func splitQuotedReplies(_ html: String) -> SplitBody {
        if html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return SplitBody(main: html, quote: nil)
        }
        do {
            let doc = try SwiftSoup.parseBodyFragment(html, "")
            doc.outputSettings().prettyPrint(pretty: false)
            guard let body = doc.body() else { return SplitBody(main: html, quote: nil) }
            guard let start = try findQuoteStart(in: body) else {
                return SplitBody(main: html, quote: nil)
            }
            var quoteParts: [String] = []
            var toRemove: [Node] = []
            var curr: Node? = start
            while let node = curr {
                let next = node.nextSibling()
                if let el = node as? Element {
                    if el.tagName().lowercased() != "script" {
                        quoteParts.append(try el.outerHtml())
                        toRemove.append(el)
                    }
                } else if let text = node as? TextNode {
                    quoteParts.append(text.getWholeText())
                    toRemove.append(text)
                }
                curr = next
            }
            for node in toRemove {
                try node.remove()
            }
            let quote = quoteParts.joined().trimmingCharacters(in: .whitespacesAndNewlines)
            let main = try body.html().trimmingCharacters(in: .whitespacesAndNewlines)
            if quote.isEmpty || main.isEmpty {
                return SplitBody(main: html, quote: nil)
            }
            return SplitBody(main: main, quote: quote)
        } catch {
            return SplitBody(main: html, quote: nil)
        }
    }

    private static func mailWhitelist() throws -> Whitelist {
        try Whitelist.relaxed()
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
    }

    private static let dangerousCss = try? NSRegularExpression(
        pattern: #"javascript:|vbscript:|expression\s*\(|-moz-binding|behavior\s*:|url\s*\(\s*['"]?\s*javascript"#,
        options: [.caseInsensitive]
    )

    private static func stripDangerousCss(_ doc: Document) throws {
        let styled = try doc.select("[style]")
        for el in styled {
            let style = try el.attr("style")
            guard !style.isEmpty else { continue }
            let range = NSRange(style.startIndex..<style.endIndex, in: style)
            if dangerousCss?.firstMatch(in: style, range: range) != nil {
                try el.removeAttr("style")
            }
        }
        for el in try doc.select("[href], [src]") {
            for attr in ["href", "src"] {
                guard el.hasAttr(attr) else { continue }
                let value = try el.attr(attr).trimmingCharacters(in: .whitespacesAndNewlines)
                let scheme = value.split(separator: ":", maxSplits: 1).first.map(String.init)?.lowercased() ?? ""
                if ["javascript", "vbscript", "file", "blob", "about"].contains(scheme) {
                    try el.removeAttr(attr)
                }
            }
        }
    }

    private static let quoteSelectors = [
        ".gmail_quote",
        ".yahoo_quoted",
        ".protonmail_quote",
        "#divRplyFwdMsg",
        "blockquote[type=cite]",
    ]

    private static func matchesQuoteSelector(_ el: Element) -> Bool {
        quoteSelectors.contains { selector in
            el.cssSelectorMatches(selector)
        }
    }

    private static func findQuoteStart(in body: Element) throws -> Node? {
        var target: Element?
        for selector in quoteSelectors {
            guard let found = try body.select(selector).first() else { continue }
            target = found
            var parent = found.parent()
            while let currentParent = parent, currentParent !== body {
                if matchesQuoteSelector(currentParent) {
                    target = currentParent
                    parent = currentParent.parent()
                } else {
                    break
                }
            }
            break
        }
        if target == nil, let append = try body.getElementById("appendonsend"), try append.nextElementSibling() != nil {
            target = append
        }
        if target == nil {
            for bq in try body.select("blockquote") {
                if bq.ancestor(named: "blockquote") != nil { continue }
                let text = try bq.text().trimmingCharacters(in: .whitespacesAndNewlines)
                let style = (try bq.attr("style")).lowercased()
                let hasReplyPattern =
                    text.range(of: #"on\s.+wrote:\s*"#, options: [.regularExpression, .caseInsensitive]) != nil
                    || text.range(of: #"wrote:\s*$"#, options: [.regularExpression, .caseInsensitive]) != nil
                    || text.range(of: "original message", options: .caseInsensitive) != nil
                    || text.range(of: #"from:\s.+\n?(sent|date):"#, options: [.regularExpression, .caseInsensitive]) != nil
                    || style.contains("border-left")
                var hasSubstantialAfter = false
                var sibling = try bq.nextElementSibling()
                while let next = sibling {
                    let sibText = try next.text().trimmingCharacters(in: .whitespacesAndNewlines)
                    let className = (try? next.className()) ?? ""
                    let isSig = className.contains("signature") || className.contains("gmail_signature")
                    if sibText.count > 40 && !isSig {
                        hasSubstantialAfter = true
                        break
                    }
                    sibling = try next.nextElementSibling()
                }
                if hasReplyPattern || !hasSubstantialAfter {
                    target = bq
                    break
                }
            }
        }
        guard let root = target else { return nil }
        var prev = try root.previousElementSibling()
        while let current = prev {
            let tag = current.tagName().lowercased()
            let text = (try? current.text().trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
            if tag == "br" || text.isEmpty {
                prev = try current.previousElementSibling()
                continue
            }
            break
        }
        if let headerEl = prev {
            let pText = (try? headerEl.text().trimmingCharacters(in: .whitespacesAndNewlines)) ?? ""
            let isAttr = headerEl.hasClass("gmail_attr") || headerEl.hasClass("moz-cite-prefix")
            let header = pText.range(
                of: #"^(on\s.+wrote:|from:\s.+|---\s*original message|-----original message)"#,
                options: [.regularExpression, .caseInsensitive]
            ) != nil
            if header || isAttr { return headerEl }
        }
        return root
    }
}

private extension Element {
    func cssSelectorMatches(_ selector: String) -> Bool {
        if selector.hasPrefix(".") {
            return hasClass(String(selector.dropFirst()))
        }
        if selector.hasPrefix("#") {
            return id() == String(selector.dropFirst())
        }
        if selector == "blockquote[type=cite]" {
            return tagName().lowercased() == "blockquote"
                && ((try? attr("type")) ?? "").lowercased() == "cite"
        }
        return false
    }

    func ancestor(named tag: String) -> Element? {
        var current: Element? = parent()
        while let el = current {
            if el.tagName().lowercased() == tag { return el }
            current = el.parent()
        }
        return nil
    }
}

import Foundation
import SwiftSoup

/// Native analogue of web `EmailIframe` DOMPurify options:
/// HTML profile, forbid `<style>` tags, keep `target` on links.
enum EmailHTMLSanitizer {
    /// Policy once the reader taps "Load images" (same as web's opted-in policy).
    /// No page script ever runs: height measuring is an app-world `WKUserScript`,
    /// which CSP and `allowsContentJavaScript = false` do not block.
    static let contentSecurityPolicy =
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'none'"

    /// Default policy: remote images stay blocked (tracking pixels, read receipts)
    /// until the reader opts in; inline `data:` / `cid:` images still render.
    static let remoteImagesBlockedPolicy =
        "default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:; script-src 'none'"

    static let opaqueOrigin = URL(string: "https://inboxies.invalid/")!

    private static let remoteImageReference = try? NSRegularExpression(
        pattern: #"(?:\bsrc|\bbackground)\s*=\s*["']?\s*(?:https:)?//|url\(\s*["']?\s*(?:https:)?//"#,
        options: [.caseInsensitive]
    )

    /// True when sanitized HTML references images the default policy would block
    /// (`https:` or protocol-relative, which resolves to https on the opaque origin).
    static func containsRemoteImages(_ html: String) -> Bool {
        guard let remoteImageReference, !html.isEmpty else { return false }
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        return remoteImageReference.firstMatch(in: html, range: range) != nil
    }

    // MARK: - Own colours (dark mode)

    private static let tagPattern = try? NSRegularExpression(
        pattern: #"<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>"#
    )
    private static let attributePattern = try? NSRegularExpression(
        pattern: #"([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?"#
    )
    private static let colorProperties: Set<String> = ["color", "background", "background-color", "background-image"]
    private static let neutralColorValues: Set<String> = [
        "", "transparent", "inherit", "initial", "unset", "revert", "currentcolor", "none",
    ]

    /// True when sanitized HTML sets its own background or text colours: a non-empty
    /// `bgcolor` / `background` attribute, `<font color>`, or an inline `color` /
    /// `background*` declaration with a real value. Such mail renders on a light paper
    /// card in dark mode; everything else takes the app theme. Same rules as web
    /// `shared/email-colors.ts` and Android `EmailHtmlSanitizer.hasOwnColors`, checked
    /// against `shared/email-colors.fixtures.json`.
    static func hasOwnColors(_ html: String) -> Bool {
        guard !html.isEmpty, let tagPattern, let attributePattern else { return false }
        let source = html as NSString
        for tag in tagPattern.matches(in: html, range: NSRange(location: 0, length: source.length)) {
            let tagName = source.substring(with: tag.range(at: 1)).lowercased()
            let attributes = source.substring(with: tag.range(at: 2))
            let attrSource = attributes as NSString
            let attrRange = NSRange(location: 0, length: attrSource.length)
            for attr in attributePattern.matches(in: attributes, range: attrRange) {
                let name = attrSource.substring(with: attr.range(at: 1)).lowercased()
                let value = (2...4)
                    .map { attr.range(at: $0) }
                    .first { $0.location != NSNotFound }
                    .map { attrSource.substring(with: $0) } ?? ""
                if (name == "bgcolor" || name == "background") && !isNeutralColor(value) { return true }
                if name == "color" && tagName == "font" && !isNeutralColor(value) { return true }
                if name == "style" && styleSetsColors(value) { return true }
            }
        }
        return false
    }

    private static func styleSetsColors(_ style: String) -> Bool {
        for declaration in style.split(separator: ";", omittingEmptySubsequences: true) {
            guard let colon = declaration.firstIndex(of: ":") else { continue }
            let property = declaration[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = String(declaration[declaration.index(after: colon)...])
            if colorProperties.contains(property) && !isNeutralColor(value) { return true }
        }
        return false
    }

    private static func isNeutralColor(_ value: String) -> Bool {
        let trimmed = value
            .replacingOccurrences(of: #"!\s*important\s*$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return neutralColorValues.contains(trimmed)
    }

    struct SplitBody: Sendable, Equatable {
        let main: String
        let quote: String?
    }

    /// Everything the body view needs from one sanitize pass. Plain strings only,
    /// so it can cross from the background task to the main actor.
    struct PreparedBody: Sendable, Equatable {
        let main: String
        let quote: String?
        let hasRemoteImages: Bool
        /// The main part sets its own colours (paper card in dark mode).
        let mainHasOwnColors: Bool
        let quoteHasOwnColors: Bool
    }

    static func prepare(_ html: String) -> SplitBody {
        splitQuotedReplies(sanitize(html))
    }

    /// One SwiftSoup pass per body, off the main actor. Results are cached by `key`
    /// (email id + source fingerprint) so reopening a message or remounting the view is free.
    /// Remote-image consent only swaps the CSP, so it is not part of the key.
    static func prepareOffMain(_ html: String, key: String) async -> PreparedBody {
        if let cached = PreparedBodyCache.shared.value(for: key) { return cached }
        let prepared = await Task.detached(priority: .userInitiated) {
            let split = prepare(html)
            return PreparedBody(
                main: split.main,
                quote: split.quote,
                hasRemoteImages: containsRemoteImages(split.main) || containsRemoteImages(split.quote ?? ""),
                mainHasOwnColors: hasOwnColors(split.main),
                quoteHasOwnColors: hasOwnColors(split.quote ?? "")
            )
        }.value
        PreparedBodyCache.shared.store(prepared, for: key)
        return prepared
    }

    /// `sanitize` off the main actor (quoted-replies sheet).
    static func sanitizeOffMain(_ html: String) async -> String {
        await Task.detached(priority: .userInitiated) { sanitize(html) }.value
    }

    /// Stable cache key for a body: email id plus a cheap fingerprint of the source HTML.
    static func cacheKey(emailId: String?, html: String) -> String {
        "\(emailId ?? "-")|\(html.utf8.count)|\(html.hashValue)"
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

/// Small in-memory cache of prepared bodies. NSCache is thread-safe and drops
/// entries under memory pressure.
private final class PreparedBodyCache: @unchecked Sendable {
    static let shared = PreparedBodyCache()

    private final class Box {
        let value: EmailHTMLSanitizer.PreparedBody
        init(_ value: EmailHTMLSanitizer.PreparedBody) { self.value = value }
    }

    private let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 64
        return cache
    }()

    func value(for key: String) -> EmailHTMLSanitizer.PreparedBody? {
        cache.object(forKey: key as NSString)?.value
    }

    func store(_ value: EmailHTMLSanitizer.PreparedBody, for key: String) {
        cache.setObject(Box(value), forKey: key as NSString)
    }
}

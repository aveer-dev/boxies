import SwiftUI
import UIKit

enum ComposeParagraphStyle: String, CaseIterable {
    case title
    case subtitle
    case body
    case caption

    var label: String {
        switch self {
        case .title: return "Title"
        case .subtitle: return "Subtitle"
        case .body: return "Body"
        case .caption: return "Caption"
        }
    }

    var fontSize: CGFloat {
        switch self {
        case .title: return 22
        case .subtitle: return 18
        case .body: return AppTheme.FontSize.body
        case .caption: return 12
        }
    }

    var weight: UIFont.Weight {
        switch self {
        case .title: return .bold
        case .subtitle: return .semibold
        case .body, .caption: return .regular
        }
    }
}

struct ComposeFormatState: Equatable {
    var paragraph: ComposeParagraphStyle = .body
    var bold = false
    var italic = false
    var underline = false
    var strikethrough = false
    var color: UIColor = AppTheme.uiInk
    var fontSize: CGFloat = AppTheme.FontSize.body
    var alignment: NSTextAlignment = .left
    var isBulletList = false
    var isOrderedList = false
    var indent: CGFloat = 0
}

@Observable
@MainActor
final class ComposeRichTextSession {
    var state = ComposeFormatState()
    @ObservationIgnored weak var textView: UITextView?
    @ObservationIgnored var onHTMLChange: ((String) -> Void)?

    func applyParagraph(_ style: ComposeParagraphStyle) {
        guard let textView else { return }
        let font = UIFont.inter(size: style.fontSize, weight: style.weight)
        mutate(textView) { attrs in
            attrs[.font] = font
        }
        state.paragraph = style
        state.fontSize = style.fontSize
    }

    func toggleBold() { toggleTrait(.traitBold) { state.bold.toggle() } }
    func toggleItalic() { toggleTrait(.traitItalic) { state.italic.toggle() } }

    func toggleUnderline() {
        guard let textView else { return }
        mutate(textView) { attrs in
            let current = (attrs[.underlineStyle] as? Int) ?? 0
            attrs[.underlineStyle] = current == 0 ? NSUnderlineStyle.single.rawValue : 0
        }
        state.underline.toggle()
    }

    func toggleStrikethrough() {
        guard let textView else { return }
        mutate(textView) { attrs in
            let current = (attrs[.strikethroughStyle] as? Int) ?? 0
            attrs[.strikethroughStyle] = current == 0 ? NSUnderlineStyle.single.rawValue : 0
        }
        state.strikethrough.toggle()
    }

    func setColor(_ color: UIColor) {
        guard let textView else { return }
        mutate(textView) { attrs in
            attrs[.foregroundColor] = color
        }
        state.color = color
    }

    func bumpFontSize(_ delta: CGFloat) {
        guard let textView else { return }
        let next = min(36, max(10, state.fontSize + delta))
        mutate(textView) { attrs in
            let current = (attrs[.font] as? UIFont) ?? UIFont.inter(size: AppTheme.FontSize.body)
            attrs[.font] = current.withSize(next)
        }
        state.fontSize = next
    }

    func setAlignment(_ alignment: NSTextAlignment) {
        guard let textView else { return }
        mutateParagraph(textView) { style in
            style.alignment = alignment
        }
        state.alignment = alignment
    }

    func toggleBulletList() {
        guard let textView else { return }
        mutateParagraph(textView) { style in
            if state.isBulletList {
                style.textLists = []
            } else {
                style.textLists = [NSTextList(markerFormat: .disc, options: 0)]
            }
        }
        state.isBulletList.toggle()
        if state.isBulletList { state.isOrderedList = false }
    }

    func toggleOrderedList() {
        guard let textView else { return }
        mutateParagraph(textView) { style in
            if state.isOrderedList {
                style.textLists = []
            } else {
                style.textLists = [NSTextList(markerFormat: .decimal, options: 0)]
            }
        }
        state.isOrderedList.toggle()
        if state.isOrderedList { state.isBulletList = false }
    }

    func indent(_ delta: CGFloat) {
        guard let textView else { return }
        let next = min(120, max(0, state.indent + delta))
        mutateParagraph(textView) { style in
            style.headIndent = next
            style.firstLineHeadIndent = next
        }
        state.indent = next
    }

    func refreshState() {
        guard let textView else { return }
        let attrs = textView.typingAttributes
        let font = attrs[.font] as? UIFont
        let traits = font?.fontDescriptor.symbolicTraits ?? []
        let paragraph = attrs[.paragraphStyle] as? NSParagraphStyle
        let size = font?.pointSize ?? AppTheme.FontSize.body
        state.bold = traits.contains(.traitBold)
        state.italic = traits.contains(.traitItalic)
        state.underline = ((attrs[.underlineStyle] as? Int) ?? 0) != 0
        state.strikethrough = ((attrs[.strikethroughStyle] as? Int) ?? 0) != 0
        state.color = (attrs[.foregroundColor] as? UIColor) ?? AppTheme.uiInk
        state.fontSize = size
        state.alignment = paragraph?.alignment ?? .left
        state.indent = paragraph?.headIndent ?? 0
        let lists = paragraph?.textLists ?? []
        state.isBulletList = lists.contains { $0.markerFormat == .disc }
        state.isOrderedList = lists.contains { $0.markerFormat == .decimal }
        if abs(size - ComposeParagraphStyle.title.fontSize) < 0.5 {
            state.paragraph = .title
        } else if abs(size - ComposeParagraphStyle.subtitle.fontSize) < 0.5 {
            state.paragraph = .subtitle
        } else if abs(size - ComposeParagraphStyle.caption.fontSize) < 0.5 {
            state.paragraph = .caption
        } else {
            state.paragraph = .body
        }
    }

    func emitHTML() {
        guard let textView, let attributed = textView.attributedText else { return }
        onHTMLChange?(ComposeHTML.fromAttributed(attributed))
    }

    private func toggleTrait(_ trait: UIFontDescriptor.SymbolicTraits, update: () -> Void) {
        guard let textView else { return }
        mutate(textView) { attrs in
            let current = (attrs[.font] as? UIFont) ?? UIFont.inter(size: AppTheme.FontSize.body)
            var traits = current.fontDescriptor.symbolicTraits
            if traits.contains(trait) {
                traits.remove(trait)
            } else {
                traits.insert(trait)
            }
            if let descriptor = current.fontDescriptor.withSymbolicTraits(traits) {
                attrs[.font] = UIFont(descriptor: descriptor, size: current.pointSize)
            }
        }
        update()
    }

    private func mutate(_ textView: UITextView, _ body: (inout [NSAttributedString.Key: Any]) -> Void) {
        var attrs = textView.typingAttributes
        body(&attrs)
        textView.typingAttributes = attrs
        let selected = textView.selectedRange
        let nsText = (textView.text ?? "") as NSString
        let target = selected.length > 0 ? selected : nsText.paragraphRange(for: selected)
        if target.length > 0, let mutable = textView.attributedText?.mutableCopy() as? NSMutableAttributedString {
            mutable.addAttributes(attrs, range: target)
            textView.attributedText = mutable
            textView.selectedRange = selected
        }
        emitHTML()
        refreshState()
    }

    private func mutateParagraph(_ textView: UITextView, _ body: (NSMutableParagraphStyle) -> Void) {
        mutate(textView) { attrs in
            let style = ((attrs[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
            body(style)
            attrs[.paragraphStyle] = style
        }
    }
}

struct ComposeRichTextEditor: UIViewRepresentable {
    @Binding var html: String
    var session: ComposeRichTextSession
    var minHeight: CGFloat

    func makeCoordinator() -> Coordinator {
        Coordinator(html: $html, session: session)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textColor = AppTheme.uiInk
        view.font = UIFont.inter(size: AppTheme.FontSize.body)
        view.typingAttributes = [
            .font: UIFont.inter(size: AppTheme.FontSize.body),
            .foregroundColor: AppTheme.uiInk,
        ]
        view.textContainerInset = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
        view.adjustsFontForContentSizeCategory = false
        // Grow with content so the parent ScrollView is the only scroller.
        // A nested scrolling UITextView collapses the compose form to title-only.
        view.isScrollEnabled = false
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .vertical)
        session.textView = view
        session.onHTMLChange = { html = $0 }
        view.attributedText = ComposeHTML.attributed(from: html)
        context.coordinator.lastHTML = html
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        session.textView = uiView
        session.onHTMLChange = { next in
            context.coordinator.lastHTML = next
            html = next
        }
        if !context.coordinator.isEditing, context.coordinator.lastHTML != html {
            uiView.attributedText = ComposeHTML.attributed(from: html)
            context.coordinator.lastHTML = html
        }
        context.coordinator.html = $html
        context.coordinator.minHeight = minHeight
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let fallbackWidth = uiView.bounds.width > 0 ? uiView.bounds.width : UIScreen.main.bounds.width
        let width = proposal.width ?? fallbackWidth
        guard width.isFinite, width > 0 else {
            return CGSize(width: fallbackWidth, height: minHeight)
        }
        let fitting = uiView.sizeThatFits(
            CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        )
        return CGSize(width: width, height: max(minHeight, ceil(fitting.height)))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var html: Binding<String>
        let session: ComposeRichTextSession
        var isEditing = false
        var lastHTML = ""
        var minHeight: CGFloat = 160

        init(html: Binding<String>, session: ComposeRichTextSession) {
            self.html = html
            self.session = session
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            isEditing = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            isEditing = false
        }

        func textViewDidChange(_ textView: UITextView) {
            session.emitHTML()
            session.refreshState()
            // Relayout so the page ScrollView grows with typed content.
            textView.invalidateIntrinsicContentSize()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            session.refreshState()
        }
    }
}

extension ComposeHTML {
    private struct FormatSpan {
        var isBold: Bool = false
        var isItalic: Bool = false
        var isUnderline: Bool = false
        var isStrikethrough: Bool = false
        var fontSize: CGFloat = AppTheme.FontSize.body
        var color: UIColor = AppTheme.uiInk
    }

    static func attributed(from html: String) -> NSAttributedString {
        guard html.contains("<") else {
            return NSAttributedString(
                string: html,
                attributes: [
                    .font: UIFont.inter(size: AppTheme.FontSize.body),
                    .foregroundColor: AppTheme.uiInk,
                ]
            )
        }

        let result = NSMutableAttributedString()
        var stack: [FormatSpan] = [FormatSpan()]

        let pattern = "<(/?[a-zA-Z0-9]+)([^>]*)>|([^<]+)"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return NSAttributedString(string: stripHTML(html), attributes: [
                .font: UIFont.inter(size: AppTheme.FontSize.body),
                .foregroundColor: AppTheme.uiInk,
            ])
        }

        let nsHtml = html as NSString
        let matches = regex.matches(in: html, range: NSRange(location: 0, length: nsHtml.length))

        for match in matches {
            let tagRange = match.range(at: 1)
            let attrsRange = match.range(at: 2)
            let textRange = match.range(at: 3)

            if tagRange.location != NSNotFound {
                let tag = nsHtml.substring(with: tagRange).lowercased()
                let rawAttrs = attrsRange.location != NSNotFound ? nsHtml.substring(with: attrsRange) : ""

                if tag == "p" || tag == "div" {
                    if result.length > 0 && !result.string.hasSuffix("\n") {
                        result.append(NSAttributedString(string: "\n"))
                    }
                } else if tag == "br" || tag == "br/" {
                    result.append(NSAttributedString(string: "\n"))
                } else if tag == "li" {
                    if result.length > 0 && !result.string.hasSuffix("\n") {
                        result.append(NSAttributedString(string: "\n"))
                    }
                    result.append(NSAttributedString(string: "• ", attributes: [
                        .font: UIFont.inter(size: stack.last?.fontSize ?? AppTheme.FontSize.body),
                        .foregroundColor: stack.last?.color ?? AppTheme.uiInk,
                    ]))
                } else if tag == "b" || tag == "strong" {
                    var current = stack.last ?? FormatSpan()
                    current.isBold = true
                    stack.append(current)
                } else if tag == "/b" || tag == "/strong" {
                    if stack.count > 1 { stack.removeLast() }
                } else if tag == "i" || tag == "em" {
                    var current = stack.last ?? FormatSpan()
                    current.isItalic = true
                    stack.append(current)
                } else if tag == "/i" || tag == "/em" {
                    if stack.count > 1 { stack.removeLast() }
                } else if tag == "u" {
                    var current = stack.last ?? FormatSpan()
                    current.isUnderline = true
                    stack.append(current)
                } else if tag == "/u" {
                    if stack.count > 1 { stack.removeLast() }
                } else if tag == "s" || tag == "strike" || tag == "del" {
                    var current = stack.last ?? FormatSpan()
                    current.isStrikethrough = true
                    stack.append(current)
                } else if tag == "/s" || tag == "/strike" || tag == "/del" {
                    if stack.count > 1 { stack.removeLast() }
                } else if tag == "span" {
                    var current = stack.last ?? FormatSpan()
                    parseCSS(rawAttrs, into: &current)
                    stack.append(current)
                } else if tag == "/span" {
                    if stack.count > 1 { stack.removeLast() }
                }
            } else if textRange.location != NSNotFound {
                let rawText = nsHtml.substring(with: textRange)
                let decoded = decodeHTMLEntities(rawText)
                if !decoded.isEmpty {
                    let current = stack.last ?? FormatSpan()
                    var attrs: [NSAttributedString.Key: Any] = [
                        .font: UIFont.inter(
                            size: current.fontSize,
                            weight: current.isBold ? .bold : .regular,
                            italic: current.isItalic
                        ),
                        .foregroundColor: current.color,
                    ]
                    if current.isUnderline {
                        attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
                    }
                    if current.isStrikethrough {
                        attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
                    }
                    result.append(NSAttributedString(string: decoded, attributes: attrs))
                }
            }
        }

        return result
    }

    private static func parseCSS(_ rawAttrs: String, into current: inout FormatSpan) {
        guard let styleStart = rawAttrs.range(of: "style=\"", options: .caseInsensitive)?.upperBound,
              let styleEnd = rawAttrs[styleStart...].range(of: "\"")?.lowerBound else {
            return
        }
        let styleContent = String(rawAttrs[styleStart..<styleEnd])
        let rules = styleContent.split(separator: ";")
        for rule in rules {
            let parts = rule.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2 else { continue }
            let key = parts[0].lowercased()
            let val = parts[1].lowercased()
            if key == "font-weight" {
                current.isBold = val == "bold" || val == "700" || val == "800" || val == "900"
            } else if key == "font-style" {
                current.isItalic = val == "italic" || val == "oblique"
            } else if key == "text-decoration" {
                if val.contains("underline") { current.isUnderline = true }
                if val.contains("line-through") { current.isStrikethrough = true }
            } else if key == "font-size" {
                if let num = Double(val.replacingOccurrences(of: "px", with: "").trimmingCharacters(in: .whitespaces)) {
                    current.fontSize = CGFloat(num)
                }
            } else if key == "color" {
                if let uiColor = parseHexColor(val) {
                    current.color = uiColor
                }
            }
        }
    }

    private static func parseHexColor(_ hex: String) -> UIColor? {
        var clean = hex.trimmingCharacters(in: .whitespaces)
        if clean.hasPrefix("#") { clean.removeFirst() }
        guard clean.count == 6, let num = UInt64(clean, radix: 16) else { return nil }
        let r = CGFloat((num >> 16) & 0xFF) / 255.0
        let g = CGFloat((num >> 8) & 0xFF) / 255.0
        let b = CGFloat(num & 0xFF) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: 1.0)
    }

    private static func decodeHTMLEntities(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
    }

    /// Email-safe HTML with inline styles. Apple's HTML exporter uses <style>
    /// classes that Gmail strips, so format would vanish on send.
    static func fromAttributed(_ attributed: NSAttributedString) -> String {
        guard attributed.length > 0 else { return "<p><br></p>" }
        let ns = attributed.string as NSString
        var parts: [String] = []
        var location = 0
        while location < ns.length {
            let paraRange = ns.paragraphRange(for: NSRange(location: location, length: 0))
            var contentRange = paraRange
            if ns.substring(with: paraRange).hasSuffix("\n"), contentRange.length > 0 {
                contentRange.length -= 1
            }
            let paraStyle = attributed.attribute(
                .paragraphStyle,
                at: paraRange.location,
                effectiveRange: nil
            ) as? NSParagraphStyle
            var blockCSS: [String] = []
            switch paraStyle?.alignment {
            case .center: blockCSS.append("text-align:center")
            case .right: blockCSS.append("text-align:right")
            default: break
            }
            let indent = paraStyle?.headIndent ?? 0
            if indent > 0 {
                blockCSS.append("margin-left:\(Int(indent))px")
            }
            let inner: String
            if contentRange.length > 0 {
                inner = inlineRuns(attributed, range: contentRange, ns: ns)
            } else {
                inner = "<br>"
            }
            let styleAttr = blockCSS.isEmpty ? "" : " style=\"\(blockCSS.joined(separator: ";"))\""
            let lists = paraStyle?.textLists ?? []
            if lists.contains(where: { $0.markerFormat == .disc }) {
                parts.append("<ul><li\(styleAttr)>\(inner)</li></ul>")
            } else if lists.contains(where: { $0.markerFormat == .decimal }) {
                parts.append("<ol><li\(styleAttr)>\(inner)</li></ol>")
            } else {
                parts.append("<p\(styleAttr)>\(inner)</p>")
            }
            location = paraRange.location + paraRange.length
        }
        return parts.joined()
    }

    private static func inlineRuns(
        _ attributed: NSAttributedString,
        range: NSRange,
        ns: NSString
    ) -> String {
        var html = ""
        attributed.enumerateAttributes(in: range, options: []) { attrs, runRange, _ in
            var piece = escapeHTML(ns.substring(with: runRange)).replacingOccurrences(of: "\n", with: "<br>")
            var css: [String] = []
            if let font = attrs[.font] as? UIFont {
                css.append("font-size:\(Int(font.pointSize.rounded()))px")
                css.append("font-family:sans-serif")
                let traits = font.fontDescriptor.symbolicTraits
                if traits.contains(.traitBold) { css.append("font-weight:700") }
                if traits.contains(.traitItalic) { css.append("font-style:italic") }
            }
            if let color = attrs[.foregroundColor] as? UIColor {
                let hex = cssColor(color)
                // Skip theme ink (light or dark) so Gmail recipients don't get
                // washed-out dark-mode text on a white canvas.
                if hex != "#1F1F24" && hex != "#FAFAFC" {
                    css.append("color:\(hex)")
                }
            }
            let underline = (attrs[.underlineStyle] as? Int) ?? 0
            let strike = (attrs[.strikethroughStyle] as? Int) ?? 0
            if underline != 0 && strike != 0 {
                css.append("text-decoration:underline line-through")
            } else if underline != 0 {
                css.append("text-decoration:underline")
            } else if strike != 0 {
                css.append("text-decoration:line-through")
            }
            if !css.isEmpty {
                piece = "<span style=\"\(css.joined(separator: ";"))\">\(piece)</span>"
            }
            html += piece
        }
        return html
    }

    private static func cssColor(_ color: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        if color.getRed(&r, green: &g, blue: &b, alpha: &a) {
            return String(
                format: "#%02X%02X%02X",
                Int((r * 255).rounded()),
                Int((g * 255).rounded()),
                Int((b * 255).rounded())
            )
        }
        var white: CGFloat = 0
        if color.getWhite(&white, alpha: &a) {
            let value = Int((white * 255).rounded())
            return String(format: "#%02X%02X%02X", value, value, value)
        }
        return "#1F1F24"
    }
}

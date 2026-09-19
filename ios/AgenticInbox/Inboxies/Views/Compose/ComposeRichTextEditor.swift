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
    weak var textView: UITextView?
    var onHTMLChange: ((String) -> Void)?

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
        let range = textView.selectedRange
        if range.length > 0, let mutable = textView.attributedText?.mutableCopy() as? NSMutableAttributedString {
            mutable.addAttributes(attrs, range: range)
            textView.attributedText = mutable
            textView.selectedRange = range
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
        view.isScrollEnabled = true
        session.textView = view
        session.onHTMLChange = { html = $0 }
        view.attributedText = ComposeHTML.attributed(from: html)
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        session.textView = uiView
        if !context.coordinator.isEditing, ComposeHTML.fromAttributed(uiView.attributedText) != html {
            uiView.attributedText = ComposeHTML.attributed(from: html)
        }
        context.coordinator.html = $html
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var html: Binding<String>
        let session: ComposeRichTextSession
        var isEditing = false

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
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            session.refreshState()
        }
    }
}

extension ComposeHTML {
    static func attributed(from html: String) -> NSAttributedString {
        let wrapped: String
        if html.contains("<") {
            wrapped = html
        } else {
            wrapped = textToHTML(html)
        }
        guard let data = wrapped.data(using: .utf8),
              let parsed = try? NSAttributedString(
                data: data,
                options: [
                    .documentType: NSAttributedString.DocumentType.html,
                    .characterEncoding: String.Encoding.utf8.rawValue,
                ],
                documentAttributes: nil
              ) else {
            return NSAttributedString(
                string: stripHTML(html),
                attributes: [
                    .font: UIFont.inter(size: AppTheme.FontSize.body),
                    .foregroundColor: AppTheme.uiInk,
                ]
            )
        }
        let mutable = NSMutableAttributedString(attributedString: parsed)
        let full = NSRange(location: 0, length: mutable.length)
        mutable.enumerateAttribute(.font, in: full) { value, range, _ in
            guard let font = value as? UIFont else { return }
            let traits = font.fontDescriptor.symbolicTraits
            let weight: UIFont.Weight = traits.contains(.traitBold) ? .bold : .regular
            mutable.addAttribute(
                .font,
                value: UIFont.inter(size: font.pointSize, weight: weight, italic: traits.contains(.traitItalic)),
                range: range
            )
        }
        return mutable
    }

    static func fromAttributed(_ attributed: NSAttributedString) -> String {
        guard attributed.length > 0,
              let data = try? attributed.data(
                from: NSRange(location: 0, length: attributed.length),
                documentAttributes: [.documentType: NSAttributedString.DocumentType.html]
              ),
              let raw = String(data: data, encoding: .utf8) else {
            return textToHTML(attributed.string)
        }
        if let body = raw.slice(between: "<body>", and: "</body>") {
            return body.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return raw
    }
}

private extension String {
    func slice(between start: String, and end: String) -> String? {
        guard let startRange = range(of: start, options: .caseInsensitive),
              let endRange = range(of: end, options: [.caseInsensitive, .backwards]),
              startRange.upperBound < endRange.lowerBound else { return nil }
        return String(self[startRange.upperBound..<endRange.lowerBound])
    }
}

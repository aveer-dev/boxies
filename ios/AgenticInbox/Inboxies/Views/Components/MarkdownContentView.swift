import Foundation
import SwiftUI

// MARK: - Markdown Block Data Model

enum MarkdownBlock: Equatable {
    case header(level: Int, text: String)
    case paragraph(text: String)
    case bulletItem(indent: Int, text: String)
    case numberedItem(indent: Int, index: String, text: String)
    case taskItem(indent: Int, isDone: Bool, text: String)
    case table(headers: [String], alignments: [TextAlignment], rows: [[String]])
    case codeBlock(language: String?, code: String)
    case blockquote(text: String)
    case divider
}

// MARK: - Markdown Block Parser

func parseMarkdownBlocks(_ markdown: String) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    let normalized = markdown
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
    let lines = normalized.components(separatedBy: "\n")
    var i = 0

    while i < lines.count {
        let rawLine = lines[i]
        let leadingSpaces = rawLine.prefix(while: { $0 == " " || $0 == "\t" }).count
        let indent = max(0, leadingSpaces / 2)
        let trimmed = rawLine.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            i += 1
            continue
        }

        // 1. Code block (closed or open/streaming)
        if trimmed.hasPrefix("```") {
            let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
            var codeLines: [String] = []
            i += 1
            while i < lines.count {
                let codeLine = lines[i]
                if codeLine.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    i += 1
                    break
                }
                codeLines.append(codeLine)
                i += 1
            }
            blocks.append(.codeBlock(language: lang.isEmpty ? nil : lang, code: codeLines.joined(separator: "\n")))
            continue
        }

        // 2. Horizontal rule / divider
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            blocks.append(.divider)
            i += 1
            continue
        }

        // 3. Headings (levels 1-6)
        if trimmed.hasPrefix("#") {
            let hashCount = trimmed.prefix(while: { $0 == "#" }).count
            if hashCount >= 1 && hashCount <= 6 {
                let remainder = trimmed.dropFirst(hashCount)
                if remainder.hasPrefix(" ") {
                    let title = remainder.trimmingCharacters(in: .whitespaces)
                    blocks.append(.header(level: hashCount, text: title))
                    i += 1
                    continue
                }
            }
        }

        // 4. Blockquote
        if trimmed.hasPrefix(">") {
            var quoteLines: [String] = []
            while i < lines.count {
                let qTrimmed = lines[i].trimmingCharacters(in: .whitespaces)
                if qTrimmed.hasPrefix("> ") {
                    quoteLines.append(String(qTrimmed.dropFirst(2)))
                    i += 1
                } else if qTrimmed == ">" {
                    quoteLines.append("")
                    i += 1
                } else if !qTrimmed.isEmpty &&
                            !qTrimmed.hasPrefix("#") &&
                            !qTrimmed.hasPrefix("- ") &&
                            !qTrimmed.hasPrefix("* ") &&
                            !qTrimmed.hasPrefix("```") &&
                            !qTrimmed.hasPrefix("|") {
                    quoteLines.append(qTrimmed)
                    i += 1
                } else {
                    break
                }
            }
            blocks.append(.blockquote(text: quoteLines.joined(separator: "\n")))
            continue
        }

        // 5. GFM Table
        if trimmed.contains("|") && i + 1 < lines.count && isTableSeparatorRow(lines[i + 1]) {
            let headers = parseTableRowCells(trimmed)
            let separatorLine = lines[i + 1]
            let alignments = parseTableAlignments(separatorLine, columnCount: headers.count)
            i += 2 // skip header and separator

            var rows: [[String]] = []
            while i < lines.count {
                let rowTrimmed = lines[i].trimmingCharacters(in: .whitespaces)
                guard !rowTrimmed.isEmpty, rowTrimmed.contains("|") else { break }
                let cells = parseTableRowCells(rowTrimmed)
                // Normalize row length to match headers
                var padded = cells
                if padded.count < headers.count {
                    padded.append(contentsOf: Array(repeating: "", count: headers.count - padded.count))
                } else if padded.count > headers.count {
                    padded = Array(padded.prefix(headers.count))
                }
                rows.append(padded)
                i += 1
            }

            blocks.append(.table(headers: headers, alignments: alignments, rows: rows))
            continue
        }

        // 6. Task lists (- [ ] / - [x])
        if trimmed.hasPrefix("- [ ] ") || trimmed.hasPrefix("* [ ] ") {
            blocks.append(.taskItem(indent: indent, isDone: false, text: String(trimmed.dropFirst(6))))
            i += 1
            continue
        } else if trimmed.hasPrefix("- [x] ") || trimmed.hasPrefix("- [X] ") ||
                    trimmed.hasPrefix("* [x] ") || trimmed.hasPrefix("* [X] ") {
            blocks.append(.taskItem(indent: indent, isDone: true, text: String(trimmed.dropFirst(6))))
            i += 1
            continue
        }

        // 7. Bullet list items
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("• ") {
            blocks.append(.bulletItem(indent: indent, text: String(trimmed.dropFirst(2))))
            i += 1
            continue
        }

        // 8. Numbered list items
        if let match = trimmed.range(of: #"^\d+[\.\)]\s+"#, options: .regularExpression) {
            let numStr = String(trimmed[match]).trimmingCharacters(in: .whitespaces)
            let itemText = String(trimmed[match.upperBound...])
            blocks.append(.numberedItem(indent: indent, index: numStr, text: itemText))
            i += 1
            continue
        }

        // 9. Paragraph: collect consecutive non-special lines
        var paraLines: [String] = [trimmed]
        i += 1
        while i < lines.count {
            let next = lines[i]
            let nextTrimmed = next.trimmingCharacters(in: .whitespaces)
            if nextTrimmed.isEmpty ||
                nextTrimmed.hasPrefix("```") ||
                nextTrimmed.hasPrefix("#") ||
                nextTrimmed.hasPrefix("- ") ||
                nextTrimmed.hasPrefix("* ") ||
                nextTrimmed.hasPrefix("• ") ||
                nextTrimmed.hasPrefix(">") ||
                nextTrimmed == "---" ||
                nextTrimmed == "***" ||
                nextTrimmed == "___" ||
                (nextTrimmed.contains("|") && i + 1 < lines.count && isTableSeparatorRow(lines[i + 1])) ||
                nextTrimmed.range(of: #"^\d+[\.\)]\s+"#, options: .regularExpression) != nil {
                break
            }
            paraLines.append(nextTrimmed)
            i += 1
        }
        blocks.append(.paragraph(text: paraLines.joined(separator: " ")))
    }

    return blocks
}

// MARK: - Table Parsing Helpers

private func isTableSeparatorRow(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.contains("-") else { return false }
    let cells = parseTableRowCells(trimmed)
    guard !cells.isEmpty else { return false }
    return cells.allSatisfy { cell in
        let cleaned = cell.trimmingCharacters(in: CharacterSet(charactersIn: " :-|"))
        return cleaned.isEmpty && cell.contains("-")
    }
}

private func parseTableRowCells(_ line: String) -> [String] {
    var trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("|") { trimmed.removeFirst() }
    if trimmed.hasSuffix("|") { trimmed.removeLast() }
    return trimmed.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
}

private func parseTableAlignments(_ line: String, columnCount: Int) -> [TextAlignment] {
    let cells = parseTableRowCells(line)
    var alignments: [TextAlignment] = []
    for cell in cells {
        let hasLeading = cell.hasPrefix(":")
        let hasTrailing = cell.hasSuffix(":")
        if hasLeading && hasTrailing {
            alignments.append(.center)
        } else if hasTrailing {
            alignments.append(.trailing)
        } else {
            alignments.append(.leading)
        }
    }
    while alignments.count < columnCount {
        alignments.append(.leading)
    }
    return Array(alignments.prefix(columnCount))
}

private extension TextAlignment {
    var frameAlignment: Alignment {
        switch self {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }
}

// MARK: - Table View

struct MarkdownTableView: View {
    let headers: [String]
    let alignments: [TextAlignment]
    let rows: [[String]]
    var fontSize: CGFloat = AppTheme.Chat.tableCell
    var onCompose: ((MailAddress) -> Void)? = nil
    var onSearch: ((String) -> Void)? = nil
    var onAskAI: ((String) -> Void)? = nil

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                // Header row
                GridRow {
                    ForEach(Array(headers.enumerated()), id: \.offset) { colIdx, header in
                        let alignment = colIdx < alignments.count ? alignments[colIdx] : .leading
                        InlineMarkdownText(
                            text: header,
                            fontSize: fontSize - 0.5,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .fontWeight(.semibold)
                        .foregroundStyle(AppTheme.ink)
                        .multilineTextAlignment(alignment)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .frame(maxWidth: .infinity, alignment: alignment.frameAlignment)
                        .background(AppTheme.pillFill.opacity(0.65))
                    }
                }

                // Data rows
                ForEach(Array(rows.enumerated()), id: \.offset) { rowIdx, row in
                    GridRow {
                        ForEach(Array(headers.enumerated()), id: \.offset) { colIdx, _ in
                            let cellText = colIdx < row.count ? row[colIdx] : ""
                            let alignment = colIdx < alignments.count ? alignments[colIdx] : .leading
                            InlineMarkdownText(
                                text: cellText,
                                fontSize: fontSize - 0.5,
                                onCompose: onCompose,
                                onSearch: onSearch,
                                onAskAI: onAskAI
                            )
                            .foregroundStyle(AppTheme.ink)
                            .multilineTextAlignment(alignment)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: alignment.frameAlignment)
                            .background(rowIdx % 2 == 1 ? AppTheme.pillFill.opacity(0.25) : Color.clear)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AppTheme.line, lineWidth: 1)
            )
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Inline Markdown Text

struct InlineMarkdownText: View {
    let text: String
    var fontSize: CGFloat = AppTheme.Chat.body
    var onCompose: ((MailAddress) -> Void)? = nil
    var onSearch: ((String) -> Void)? = nil
    var onAskAI: ((String) -> Void)? = nil

    var body: some View {
        if ContactPillParser.containsContactOrEmail(text) {
            let items = ContactPillParser.parseInlineItems(text)
            TextFlowLayout(horizontalSpacing: 4, verticalSpacing: 4) {
                ForEach(items) { item in
                    switch item {
                    case .word(_, let attributedWord):
                        Text(attributedWord)
                            .font(.inter(size: fontSize))
                            .tracking(AppTheme.Chat.tracking)
                            .foregroundStyle(AppTheme.ink)
                    case .contact(_, let address, let trailingPunct):
                        ContactPillMenu(
                            address: address,
                            trailingPunctuation: trailingPunct,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                    }
                }
            }
        } else if let attributed = try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            Text(attributed)
                .font(.inter(size: fontSize))
                .tracking(AppTheme.Chat.tracking)
                .foregroundStyle(AppTheme.ink)
                .tint(AppTheme.accent)
        } else {
            Text(text)
                .font(.inter(size: fontSize))
                .tracking(AppTheme.Chat.tracking)
                .foregroundStyle(AppTheme.ink)
        }
    }
}

// MARK: - Code Block View

struct CodeBlockView: View {
    let language: String?
    let code: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text((language?.isEmpty == false ? language! : "code").uppercased())
                    .font(.system(size: AppTheme.Chat.codeMeta, weight: .bold, design: .monospaced))
                    .tracking(0.5)
                    .foregroundStyle(AppTheme.muted)

                Spacer()

                Button {
                    UIPasteboard.general.string = code
                    withAnimation(.easeInOut(duration: 0.2)) { copied = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        withAnimation(.easeInOut(duration: 0.2)) { copied = false }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.inter(size: 10, weight: .medium))
                        Text(copied ? "Copied" : "Copy")
                            .font(.inter(size: AppTheme.Chat.codeMeta, weight: .medium))
                            .tracking(AppTheme.Chat.tracking)
                    }
                    .foregroundStyle(copied ? Color.green : AppTheme.muted)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(AppTheme.line.opacity(0.45))

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(size: AppTheme.Chat.code, design: .monospaced))
                    .foregroundStyle(AppTheme.ink)
                    .padding(12)
                    .textSelection(.enabled)
            }
        }
        .background(AppTheme.pillFill.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 1)
        )
    }
}

// MARK: - Master Markdown Content View

struct MarkdownContentView: View {
    let text: String
    var fontSize: CGFloat = AppTheme.Chat.body
    var onCompose: ((MailAddress) -> Void)? = nil
    var onSearch: ((String) -> Void)? = nil
    var onAskAI: ((String) -> Void)? = nil

    private var blocks: [MarkdownBlock] {
        parseMarkdownBlocks(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .header(let level, let headingText):
                    let size: CGFloat = {
                        switch level {
                        case 1: return fontSize + 5
                        case 2: return fontSize + 3
                        case 3: return fontSize + 1.5
                        case 4: return fontSize + 0.5
                        case 5: return fontSize
                        default: return max(fontSize - 1, 10)
                        }
                    }()
                    let weight: Font.Weight = {
                        switch level {
                        case 1, 2: return .bold
                        case 3, 4: return .semibold
                        default: return .medium
                        }
                    }()
                    let tracking: CGFloat = {
                        switch level {
                        case 1, 2: return 0.2
                        default: return AppTheme.Chat.tracking
                        }
                    }()

                    InlineMarkdownText(
                        text: headingText,
                        fontSize: size,
                        onCompose: onCompose,
                        onSearch: onSearch,
                        onAskAI: onAskAI
                    )
                    .fontWeight(weight)
                    .tracking(tracking)
                    .foregroundStyle(level == 6 ? AppTheme.muted : AppTheme.ink)
                    .padding(.top, level <= 2 ? 4 : 2)

                case .paragraph(let paraText):
                    InlineMarkdownText(
                        text: paraText,
                        fontSize: fontSize,
                        onCompose: onCompose,
                        onSearch: onSearch,
                        onAskAI: onAskAI
                    )
                    .foregroundStyle(AppTheme.ink)
                    .lineSpacing(fontSize * AppTheme.Chat.bodyLineSpacingRatio)

                case .bulletItem(let indent, let itemText):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle()
                            .fill(AppTheme.accent)
                            .frame(width: 4.5, height: 4.5)
                            .padding(.top, fontSize * 0.45)
                        InlineMarkdownText(
                            text: itemText,
                            fontSize: fontSize,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .foregroundStyle(AppTheme.ink)
                        .lineSpacing(fontSize * 0.2)
                    }
                    .padding(.leading, CGFloat(indent * 14))

                case .numberedItem(let indent, let index, let itemText):
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(index)
                            .font(.system(size: fontSize, weight: .semibold, design: .monospaced))
                            .foregroundStyle(AppTheme.accent)
                        InlineMarkdownText(
                            text: itemText,
                            fontSize: fontSize,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .foregroundStyle(AppTheme.ink)
                        .lineSpacing(fontSize * 0.2)
                    }
                    .padding(.leading, CGFloat(indent * 14))

                case .taskItem(let indent, let isDone, let itemText):
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: fontSize + 1, weight: .medium))
                            .foregroundStyle(isDone ? AppTheme.accent : AppTheme.muted)
                        InlineMarkdownText(
                            text: itemText,
                            fontSize: fontSize,
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .foregroundStyle(isDone ? AppTheme.muted : AppTheme.ink)
                        .lineSpacing(fontSize * 0.2)
                    }
                    .padding(.leading, CGFloat(indent * 14))

                case .table(let headers, let alignments, let rows):
                    MarkdownTableView(
                        headers: headers,
                        alignments: alignments,
                        rows: rows,
                        fontSize: fontSize,
                        onCompose: onCompose,
                        onSearch: onSearch,
                        onAskAI: onAskAI
                    )

                case .codeBlock(let language, let code):
                    CodeBlockView(language: language, code: code)

                case .blockquote(let quoteText):
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(AppTheme.accent.opacity(0.7))
                            .frame(width: 3)
                        InlineMarkdownText(
                            text: quoteText,
                            fontSize: max(fontSize - 1, 11),
                            onCompose: onCompose,
                            onSearch: onSearch,
                            onAskAI: onAskAI
                        )
                        .foregroundStyle(AppTheme.muted)
                        .lineSpacing(fontSize * 0.22)
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 8)
                    .background(AppTheme.pillFill.opacity(0.35))
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                case .divider:
                    Divider().padding(.vertical, 4)
                }
            }
        }
    }
}

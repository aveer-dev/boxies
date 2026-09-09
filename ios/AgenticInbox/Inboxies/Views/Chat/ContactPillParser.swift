import Foundation
import SwiftUI

/// An inline item within a rich text flow: either a formatted word or an interactive contact pill.
enum InlineFlowItem: Identifiable {
    case word(id: Int, text: AttributedString)
    case contact(id: Int, address: MailAddress, trailingPunctuation: String?)

    var id: Int {
        switch self {
        case .word(let id, _): return id
        case .contact(let id, _, _): return id
        }
    }
}

enum ContactPillParser {
    static let emailPattern = #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#
    
    // Capitalized name: 1 to 4 words starting with uppercase / title-case letter
    static let capitalizedNamePattern = #"(?:[A-Z\p{Lu}][\p{L}0-9'.-]*(?:\s+[A-Z\p{Lu}][\p{L}0-9'.-]*){0,3})"#
    
    static let combinedRegex: NSRegularExpression = {
        let ep = emailPattern
        let capName = capitalizedNamePattern
        let pattern = "(?:" +
            #"(?:\[(?<mdName>[^\]]+)\]\((?:mailto:)?(?<mdEmail>"# + ep + #")\))"# +
            "|" +
            #"(?:[\"'](?<qName>[^\"']+)[\"']\s*[<(\[](?:mailto:)?(?<qEmail>"# + ep + #")[>)\]])"# +
            "|" +
            #"(?:(?<uName>"# + capName + #")\s*[<(\[](?:mailto:)?(?<uEmail>"# + ep + #")[>)\]])"# +
            "|" +
            #"(?:[<(\[](?:mailto:)?(?<bEmail>"# + ep + #")[>)\]])"# +
            "|" +
            #"(?:\b(?<rawEmail>"# + ep + #")\b)"# +
            ")"
        return try! NSRegularExpression(pattern: pattern)
    }()
    
    private static let stopWords: Set<String> = [
        "to", "from", "by", "with", "for", "at", "about", "via",
        "contact", "email", "reach", "message", "the", "a", "an",
        "is", "was", "sent", "and", "or", "in", "on", "dear", "hi", "hello"
    ]
    
    static func sanitizeName(_ raw: String) -> String? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("• ") {
            trimmed = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
        }
        
        let words = trimmed.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
        var startIndex = 0
        while startIndex < words.count {
            let lower = words[startIndex].lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ":,-*•"))
            if stopWords.contains(lower) {
                startIndex += 1
            } else {
                break
            }
        }
        
        if startIndex >= words.count {
            return nil
        }
        
        let cleaned = words[startIndex...].joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: " \t\n\r:,-*•\"'"))
        
        if cleaned.isEmpty || cleaned.contains("@") {
            return nil
        }
        return cleaned
    }
    
    static func containsContactOrEmail(_ text: String) -> Bool {
        let nsText = text as NSString
        return combinedRegex.firstMatch(in: text, options: [], range: NSRange(location: 0, length: nsText.length)) != nil
    }
    
    /// Parses a string into words and contact pills for inline rendering.
    static func parseInlineItems(_ text: String) -> [InlineFlowItem] {
        let nsText = text as NSString
        let matches = combinedRegex.matches(in: text, options: [], range: NSRange(location: 0, length: nsText.length))
        
        var nextId = 0
        var items: [InlineFlowItem] = []
        var lastIndex = 0
        
        for match in matches {
            let matchRange = match.range
            
            var parsedName: String? = nil
            var parsedEmail: String? = nil
            var actualStart = matchRange.location
            let actualEnd = matchRange.location + matchRange.length
            
            if let mdEmailRange = Range(match.range(withName: "mdEmail"), in: text), !mdEmailRange.isEmpty {
                parsedEmail = String(text[mdEmailRange])
                if let mdNameRange = Range(match.range(withName: "mdName"), in: text) {
                    parsedName = sanitizeName(String(text[mdNameRange]))
                }
            } else if let qEmailRange = Range(match.range(withName: "qEmail"), in: text), !qEmailRange.isEmpty {
                parsedEmail = String(text[qEmailRange])
                if let qNameRange = Range(match.range(withName: "qName"), in: text) {
                    parsedName = sanitizeName(String(text[qNameRange]))
                }
            } else if let uEmailRange = Range(match.range(withName: "uEmail"), in: text), !uEmailRange.isEmpty {
                parsedEmail = String(text[uEmailRange])
                if let uNameRange = Range(match.range(withName: "uName"), in: text) {
                    let rawName = String(text[uNameRange])
                    let sanitized = sanitizeName(rawName)
                    if let sanitized {
                        parsedName = sanitized
                        if let subRange = rawName.range(of: sanitized) {
                            let skippedLength = rawName.distance(from: rawName.startIndex, to: subRange.lowerBound)
                            actualStart += skippedLength
                        }
                    } else {
                        let uNameNSRange = match.range(withName: "uName")
                        actualStart = uNameNSRange.location + uNameNSRange.length
                        while actualStart < actualEnd && (nsText.character(at: actualStart) == 32 || nsText.character(at: actualStart) == 9) {
                            actualStart += 1
                        }
                    }
                }
            } else if let bEmailRange = Range(match.range(withName: "bEmail"), in: text), !bEmailRange.isEmpty {
                parsedEmail = String(text[bEmailRange])
            } else if let rawEmailRange = Range(match.range(withName: "rawEmail"), in: text), !rawEmailRange.isEmpty {
                parsedEmail = String(text[rawEmailRange])
            }
            
            guard let email = parsedEmail else { continue }
            
            var trailingPunct: String? = nil
            var afterEnd = actualEnd
            if afterEnd < nsText.length {
                let char = nsText.character(at: afterEnd)
                // Period, comma, colon, semicolon, exclamation, question mark
                if char == 46 || char == 44 || char == 58 || char == 59 || char == 33 || char == 63 {
                    trailingPunct = nsText.substring(with: NSRange(location: afterEnd, length: 1))
                    afterEnd += 1
                }
            }
            
            // Append preceding text as formatted words
            if actualStart > lastIndex {
                let prevText = nsText.substring(with: NSRange(location: lastIndex, length: actualStart - lastIndex))
                appendWords(from: prevText, to: &items, nextId: &nextId)
            }
            
            let address = MailAddress(name: parsedName, email: email)
            items.append(.contact(id: nextId, address: address, trailingPunctuation: trailingPunct))
            nextId += 1
            
            lastIndex = afterEnd
        }
        
        if lastIndex < nsText.length {
            let rem = nsText.substring(with: NSRange(location: lastIndex, length: nsText.length - lastIndex))
            appendWords(from: rem, to: &items, nextId: &nextId)
        }
        
        return items
    }
    
    private static func appendWords(from rawMarkdown: String, to items: inout [InlineFlowItem], nextId: inout Int) {
        guard !rawMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        
        let attributed = (try? AttributedString(
            markdown: rawMarkdown,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(rawMarkdown)
        
        var currentIndex = attributed.startIndex
        while currentIndex < attributed.endIndex {
            // Skip whitespaces
            while currentIndex < attributed.endIndex && attributed.characters[currentIndex].isWhitespace {
                currentIndex = attributed.index(afterCharacter: currentIndex)
            }
            if currentIndex == attributed.endIndex { break }
            
            // Find word boundary
            var wordEnd = currentIndex
            while wordEnd < attributed.endIndex && !attributed.characters[wordEnd].isWhitespace {
                wordEnd = attributed.index(afterCharacter: wordEnd)
            }
            
            let wordAttr = AttributedString(attributed[currentIndex..<wordEnd])
            items.append(.word(id: nextId, text: wordAttr))
            nextId += 1
            
            currentIndex = wordEnd
        }
    }
}

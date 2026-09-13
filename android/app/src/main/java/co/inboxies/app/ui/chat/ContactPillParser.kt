package co.inboxies.app.ui.chat

import co.inboxies.app.models.MailAddress

/** An inline item within a rich text flow: either a word or an interactive contact pill. */
sealed class InlineFlowItem {
    abstract val id: Int

    data class Word(override val id: Int, val text: String) : InlineFlowItem()
    data class Contact(
        override val id: Int,
        val address: MailAddress,
        val trailingPunctuation: String? = null,
    ) : InlineFlowItem()
}

/**
 * Parses emails / named contacts out of markdown or free text for inline contact pills.
 * Mirrors iOS `ContactPillParser`.
 */
object ContactPillParser {
    private val emailPattern = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
    private val capitalizedNamePattern =
        "(?:[A-Z\\p{Lu}][\\p{L}0-9'.-]*(?:\\s+[A-Z\\p{Lu}][\\p{L}0-9'.-]*){0,3})"

    private val combinedRegex: Regex by lazy {
        val ep = emailPattern
        val capName = capitalizedNamePattern
        val pattern = "(?:" +
            "(?:\\[(?<mdName>[^\\]]+)\\]\\((?:mailto:)?(?<mdEmail>$ep)\\))" +
            "|" +
            "(?:[\"'](?<qName>[^\"']+)[\"']\\s*[<(\\[](?:mailto:)?(?<qEmail>$ep)[>)\\]])" +
            "|" +
            "(?:(?<uName>$capName)\\s*[<(\\[](?:mailto:)?(?<uEmail>$ep)[>)\\]])" +
            "|" +
            "(?:[<(\\[](?:mailto:)?(?<bEmail>$ep)[>)\\]])" +
            "|" +
            "(?:\\b(?<rawEmail>$ep)\\b)" +
            ")"
        Regex(pattern)
    }

    private val stopWords = setOf(
        "to", "from", "by", "with", "for", "at", "about", "via",
        "contact", "email", "reach", "message", "the", "a", "an",
        "is", "was", "sent", "and", "or", "in", "on", "dear", "hi", "hello",
    )

    fun sanitizeName(raw: String): String? {
        var trimmed = raw.trim()
        if (trimmed.isEmpty()) return null

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ")) {
            trimmed = trimmed.drop(2).trim()
        }

        val words = trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() }
        var startIndex = 0
        while (startIndex < words.size) {
            val lower = words[startIndex].lowercase().trim(':', ',', '-', '*', '•')
            if (lower in stopWords) startIndex++ else break
        }
        if (startIndex >= words.size) return null

        val cleaned = words.subList(startIndex, words.size).joinToString(" ")
            .trim(' ', '\t', '\n', '\r', ':', ',', '-', '*', '•', '"', '\'')
        if (cleaned.isEmpty() || cleaned.contains('@')) return null
        return cleaned
    }

    fun containsContactOrEmail(text: String): Boolean =
        combinedRegex.containsMatchIn(text)

    fun parseInlineItems(text: String): List<InlineFlowItem> {
        val matches = combinedRegex.findAll(text).toList()
        if (matches.isEmpty()) {
            return if (text.isBlank()) emptyList() else listOf(InlineFlowItem.Word(0, text))
        }

        var nextId = 0
        val items = mutableListOf<InlineFlowItem>()
        var lastIndex = 0

        for (match in matches) {
            var parsedName: String? = null
            var parsedEmail: String? = null
            var actualStart = match.range.first
            var actualEnd = match.range.last + 1

            val groups = match.groups
            when {
                groups["mdEmail"] != null -> {
                    parsedEmail = groups["mdEmail"]!!.value
                    groups["mdName"]?.value?.let { parsedName = sanitizeName(it) }
                }
                groups["qEmail"] != null -> {
                    parsedEmail = groups["qEmail"]!!.value
                    groups["qName"]?.value?.let { parsedName = sanitizeName(it) }
                }
                groups["uEmail"] != null -> {
                    parsedEmail = groups["uEmail"]!!.value
                    val rawName = groups["uName"]?.value
                    if (rawName != null) {
                        val sanitized = sanitizeName(rawName)
                        if (sanitized != null) {
                            parsedName = sanitized
                            val skipped = rawName.indexOf(sanitized)
                            if (skipped > 0) actualStart += skipped
                        } else {
                            val uNameGroup = groups["uName"]!!
                            actualStart = uNameGroup.range.last + 1
                            while (actualStart < actualEnd && text[actualStart].isWhitespace()) {
                                actualStart++
                            }
                        }
                    }
                }
                groups["bEmail"] != null -> parsedEmail = groups["bEmail"]!!.value
                groups["rawEmail"] != null -> parsedEmail = groups["rawEmail"]!!.value
            }

            val email = parsedEmail ?: continue

            var trailingPunct: String? = null
            if (actualEnd < text.length) {
                val ch = text[actualEnd]
                if (ch in ".,:;!?") {
                    trailingPunct = ch.toString()
                    actualEnd++
                }
            }

            if (actualStart > lastIndex) {
                appendWords(text.substring(lastIndex, actualStart), items, nextId)
                nextId = items.size
            }

            items.add(
                InlineFlowItem.Contact(
                    id = nextId++,
                    address = MailAddress(name = parsedName, email = email),
                    trailingPunctuation = trailingPunct,
                ),
            )
            lastIndex = actualEnd
        }

        if (lastIndex < text.length) {
            appendWords(text.substring(lastIndex), items, nextId)
        }

        return items
    }

    private fun appendWords(
        raw: String,
        items: MutableList<InlineFlowItem>,
        startId: Int,
    ) {
        if (raw.isBlank()) return
        // Keep whitespace-separated tokens so FlowRow can wrap naturally.
        val tokens = Regex("\\S+|\\s+").findAll(raw).map { it.value }.toList()
        var id = startId
        for (token in tokens) {
            if (token.isBlank()) continue
            items.add(InlineFlowItem.Word(id++, token))
        }
    }
}

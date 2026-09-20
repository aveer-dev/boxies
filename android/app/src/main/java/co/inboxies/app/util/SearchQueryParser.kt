package co.inboxies.app.util

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/**
 * Parsed Gmail-style search operators — mirrors `app/lib/search-parser.ts`.
 */
data class ParsedSearch(
    val query: String = "",
    val from: String? = null,
    val to: String? = null,
    val subject: String? = null,
    val folder: String? = null,
    val isRead: Boolean? = null,
    val isStarred: Boolean? = null,
    val isReplyLater: Boolean? = null,
    val hasAttachment: Boolean? = null,
    val dateStart: String? = null,
    val dateEnd: String? = null,
) {
    val hasStructuredFilters: Boolean
        get() = from != null ||
            to != null ||
            subject != null ||
            folder != null ||
            isRead != null ||
            isStarred != null ||
            isReplyLater != null ||
            hasAttachment == true ||
            dateStart != null ||
            dateEnd != null

    /** Query params for `GET …/search`, omitting empty values. */
    fun toApiQuery(): Map<String, String> = buildMap {
        if (query.isNotEmpty()) put("query", query)
        from?.let { put("from", it) }
        to?.let { put("to", it) }
        subject?.let { put("subject", it) }
        folder?.let { put("folder", it) }
        dateStart?.let { put("date_start", it) }
        dateEnd?.let { put("date_end", it) }
        isRead?.let { put("is_read", if (it) "true" else "false") }
        isStarred?.let { put("is_starred", if (it) "true" else "false") }
        isReplyLater?.let { put("is_reply_later", if (it) "true" else "false") }
        if (hasAttachment == true) put("has_attachment", "true")
    }
}

object SearchQueryParser {
    private val operatorRegex =
        Regex("""\b(from|to|subject|in|is|has|before|after):(?:"([^"]*?)"|(\S+))""", RegexOption.IGNORE_CASE)

    fun parse(input: String): ParsedSearch {
        val matches = operatorRegex.findAll(input).toList()
        var remaining = input
        for (match in matches) {
            remaining = remaining.replaceFirst(match.value, "")
        }
        val freeText = remaining.replace(Regex("""\s+"""), " ").trim()

        var from: String? = null
        var to: String? = null
        var subject: String? = null
        var folder: String? = null
        var isRead: Boolean? = null
        var isStarred: Boolean? = null
        var isReplyLater: Boolean? = null
        var hasAttachment: Boolean? = null
        var dateStart: String? = null
        var dateEnd: String? = null

        for (match in matches) {
            val op = match.groupValues[1].lowercase()
            val value = match.groupValues[2].ifEmpty { match.groupValues[3] }
            when (op) {
                "from" -> from = value
                "to" -> to = value
                "subject" -> subject = value
                "in" -> folder = value.lowercase()
                "is" -> when (value.lowercase()) {
                    "unread" -> isRead = false
                    "read" -> isRead = true
                    "starred" -> isStarred = true
                    "unstarred" -> isStarred = false
                    "reply-later", "reply_later" -> isReplyLater = true
                }
                "has" -> if (value.lowercase() == "attachment") hasAttachment = true
                "before" -> dateEnd = normalizeDate(value)
                "after" -> dateStart = normalizeDate(value)
            }
        }

        return ParsedSearch(
            query = freeText,
            from = from,
            to = to,
            subject = subject,
            folder = folder,
            isRead = isRead,
            isStarred = isStarred,
            isReplyLater = isReplyLater,
            hasAttachment = hasAttachment,
            dateStart = dateStart,
            dateEnd = dateEnd,
        )
    }

    /**
     * Normalize to ISO-8601. Mirrors web `new Date(value).toISOString()` for
     * single-token values: ISO instants, `YYYY-MM-DD`, and `M/D/YYYY`.
     */
    private fun normalizeDate(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        return try {
            Instant.parse(trimmed).toString()
        } catch (_: DateTimeParseException) {
            try {
                LocalDate.parse(trimmed).atStartOfDay(ZoneOffset.UTC).toInstant().toString()
            } catch (_: DateTimeParseException) {
                parseSlashDate(trimmed)
            }
        }
    }

    private fun parseSlashDate(value: String): String? {
        val parts = value.split('/')
        if (parts.size != 3) return null
        val month = parts[0].toIntOrNull() ?: return null
        val day = parts[1].toIntOrNull() ?: return null
        val year = parts[2].toIntOrNull() ?: return null
        return try {
            LocalDate.of(year, month, day).atStartOfDay(ZoneOffset.UTC).toInstant().toString()
        } catch (_: Exception) {
            null
        }
    }
}

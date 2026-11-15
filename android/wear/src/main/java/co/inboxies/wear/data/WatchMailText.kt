package co.inboxies.wear.data

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale

/**
 * Text helpers for the watch's message view (AVE-145). Pure, so unit tests cover
 * them. Twin of the iOS `WatchMailText` (AVE-144).
 */
object WatchMailText {
    /** The plan trims watch bodies to about 2 KB. */
    const val BODY_LIMIT = 2_000

    /**
     * Fixed short replies for v1, the same four as the phone's notification Reply
     * (`MailNotificationActions.CANNED_REPLIES`).
     */
    val cannedReplies: List<String> = listOf("Thanks!", "Got it, will reply soon", "Can we talk later?", "👍")

    /**
     * A readable plain-text version of a mail body (HTML or text), trimmed to [limit]
     * characters. No rich rendering on the watch.
     */
    fun plainText(body: String?, limit: Int = BODY_LIMIT): String {
        if (body.isNullOrEmpty()) return ""
        var text = body
        if (looksLikeHtml(text)) text = stripHtml(text)
        text = text.replace("\r\n", "\n")
            // Collapse runs of spaces and blank lines.
            .replace(Regex("[ \\t\\u00A0]+"), " ")
            .replace(Regex(" *\\n *"), "\n")
            .replace(Regex("\\n{3,}"), "\n\n")
            .trim()
        if (text.length <= limit) return text
        val cut = text.substring(0, limit)
        // End on a word boundary when one is close.
        val space = cut.indexOfLast { it == ' ' || it == '\n' }
        if (space >= 0 && cut.length - space < 40) return cut.substring(0, space) + "…"
        return "$cut…"
    }

    fun looksLikeHtml(text: String): Boolean = HTML_TAG.containsMatchIn(text)

    private val HTML_TAG = Regex("<[a-zA-Z!/][^>]*>")

    private fun stripHtml(html: String): String {
        var text = html
        // Drop things that never render as text.
        for (tag in listOf("head", "style", "script", "title")) {
            text = text.replace(Regex("<$tag\\b[^>]*>[\\s\\S]*?</$tag\\s*>", RegexOption.IGNORE_CASE), "")
        }
        text = text.replace(Regex("<!--[\\s\\S]*?-->"), "")
        // Line breaks for block ends.
        text = text.replace(Regex("<br\\s*/?>", RegexOption.IGNORE_CASE), "\n")
        text = text.replace(Regex("</(p|div|tr|li|h[1-6]|blockquote|table)\\s*>", RegexOption.IGNORE_CASE), "\n")
        text = text.replace(Regex("<li\\b[^>]*>", RegexOption.IGNORE_CASE), "• ")
        text = text.replace(Regex("<[^>]+>"), "")
        return decodeEntities(text)
    }

    private val NAMED_ENTITIES = mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "#39" to "'",
        "nbsp" to " ", "ndash" to "–", "mdash" to "—", "hellip" to "…", "rsquo" to "’", "lsquo" to "‘",
        "rdquo" to "”", "ldquo" to "“", "copy" to "©", "reg" to "®", "zwnj" to "", "zwj" to "",
    )

    private fun decodeEntities(text: String): String {
        if (!text.contains('&')) return text
        val out = StringBuilder(text.length)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c != '&') {
                out.append(c)
                i++
                continue
            }
            val semi = text.indexOf(';', i).takeIf { it in (i + 1)..(i + 11) }
            if (semi == null) {
                out.append(c)
                i++
                continue
            }
            val name = text.substring(i + 1, semi)
            val replacement = NAMED_ENTITIES[name.lowercase()] ?: numericEntity(name)
            if (replacement == null) {
                out.append(c)
                i++
                continue
            }
            out.append(replacement)
            i = semi + 1
        }
        return out.toString()
    }

    private fun numericEntity(name: String): String? {
        val code = when {
            name.startsWith("#x", ignoreCase = true) -> name.substring(2).toIntOrNull(16)
            name.startsWith("#") -> name.substring(1).toIntOrNull()
            else -> null
        } ?: return null
        if (code < 0 || code > Character.MAX_CODE_POINT) return null
        return String(Character.toChars(code))
    }

    /** "Ada Lovelace" from the display name, else the address. */
    fun senderName(name: String?, address: String): String {
        name?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        val trimmed = address.trim()
        // "Name <addr>" from older rows.
        val open = trimmed.indexOf('<')
        if (open > 0) {
            val display = trimmed.substring(0, open).trim(' ', '"')
            if (display.isNotEmpty()) return display
        }
        return trimmed.ifEmpty { "Unknown sender" }
    }
}

object WatchDates {
    /** "14:05" today, "Tue" this week, "12 Oct" before. */
    fun short(
        raw: String?,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val instant = parse(raw) ?: return ""
        val date = instant.atZone(zone)
        val today = now.atZone(zone).toLocalDate()
        val day = date.toLocalDate()
        return when {
            day == today -> DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(date)
            day.isAfter(today.minusDays(7)) && !day.isAfter(today) ->
                day.dayOfWeek.getDisplayName(TextStyle.SHORT, locale)
            else -> DateTimeFormatter.ofPattern("d MMM", locale).format(day)
        }
    }

    fun parse(raw: String?): Instant? {
        if (raw.isNullOrBlank()) return null
        return runCatching { Instant.parse(raw) }.getOrNull()
            ?: runCatching { java.time.OffsetDateTime.parse(raw).toInstant() }.getOrNull()
            ?: runCatching { LocalDate.parse(raw).atStartOfDay(ZoneId.of("UTC")).toInstant() }.getOrNull()
            ?: runCatching {
                java.time.LocalDateTime.parse(raw.replace(' ', 'T')).atZone(ZoneId.of("UTC")).toInstant()
            }.getOrNull()
    }
}

package co.inboxies.app.models

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

/** One daily counter, e.g. agent chats (AVE-45). Mirrors web `shared/ai-quota.ts`. */
@Serializable
data class AiUsageCounter(
    val used: Int = 0,
    val limit: Int = 0,
) {
    val level: AiUsageLevel
        get() = when {
            limit <= 0 || used >= limit -> AiUsageLevel.Exhausted
            used.toDouble() / limit >= 0.8 -> AiUsageLevel.Warning
            else -> AiUsageLevel.Normal
        }

    /** Filled share of the bar, 0…1. */
    val fraction: Float
        get() = if (limit <= 0) 1f else (used.toFloat() / limit).coerceIn(0f, 1f)
}

enum class AiUsageLevel { Normal, Warning, Exhausted }

/** `GET /api/v1/mailboxes/{id}/ai-usage`. */
@Serializable
data class AiUsageSnapshot(
    val tier: String = "free",
    val day: String = "",
    val resetsAt: String = "",
    val chat: AiUsageCounter = AiUsageCounter(),
    val inbound: AiUsageCounter = AiUsageCounter(),
) {
    val planLabel: String
        get() = if (tier.equals("free", ignoreCase = true)) "Free plan" else "Paid plan"

    val resetsAtInstant: Instant?
        get() = runCatching { Instant.parse(resetsAt) }.getOrNull()
}

object AiUsageFormat {
    /** "Resets in 6h" / "Resets in 1h 40m" / "Resets in 42m" — same rules as web. */
    fun resetText(resetsAt: Instant?, now: Instant = Instant.now()): String {
        if (resetsAt == null) return "Resets at midnight UTC"
        val ms = resetsAt.toEpochMilli() - now.toEpochMilli()
        if (ms <= 60_000) return "Resets in under a minute"
        return "Resets in ${durationText(ms)}"
    }

    /** "5h", "1h 40m", "42m" (minutes rounded up). */
    fun durationText(ms: Long): String {
        val minutes = ceil(ms / 60_000.0).toLong()
        if (minutes < 60) return "${minutes}m"
        val h = minutes / 60
        val rest = minutes % 60
        return if (rest == 0L || h >= 3) "${h}h" else "${h}h ${rest}m"
    }

    /** "You can chat again at 12:00 AM (in 5h)." in the device's time zone. */
    fun chatAgainText(resetsAt: Instant?, now: Instant = Instant.now()): String {
        if (resetsAt == null) return " You can chat again after midnight UTC."
        val time = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
            .withZone(ZoneId.systemDefault())
            .format(resetsAt)
        val ms = resetsAt.toEpochMilli() - now.toEpochMilli()
        val inText = if (ms <= 60_000) "in under a minute" else "in ${durationText(ms)}"
        return " You can chat again at $time ($inText)."
    }

    /** True for the agent's typed quota error JSON (`type: "ai_quota_exceeded"`). */
    fun isQuotaError(raw: String): Boolean =
        raw.trimStart().startsWith("{") && raw.contains("\"ai_quota_exceeded\"")
}

package co.inboxies.app.models

import co.inboxies.app.services.ApiException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * AI summaries (AVE-20, native in AVE-218). Wire twin of `shared/ai-summaries.ts`.
 *
 * Routes, under `/api/v1/mailboxes/{mailboxId}`:
 * - `GET  /threads/{threadId}/summary`             cached, or generated on first open
 * - `POST /threads/{threadId}/summary/regenerate`  always re-runs the model
 * - `POST /emails/{emailId}/summary/generate`      quick summary of one message
 *
 * A model run over the mailbox's daily AI quota answers 429 (AVE-215).
 */
@Serializable
data class AiSummary(
    @SerialName("target_type") val targetType: String = "thread",
    /** Thread key for "thread", email id for "email". */
    @SerialName("target_id") val targetId: String = "",
    /** One to three plain-text sentences. */
    val summary: String,
    /** Action items / deadlines / questions. Often empty. */
    @SerialName("key_points") val keyPoints: List<String> = emptyList(),
    val model: String = "",
    @SerialName("message_count") val messageCount: Int = 1,
    @SerialName("last_email_id") val lastEmailId: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/**
 * `AiSummaryResponse`, flattened: `status` is `ready` (with [summary]), `not_eligible`
 * (with [reason]; clients show nothing) or `missing` (email GET only).
 */
@Serializable
data class AiSummaryResponse(
    val status: String = "",
    val summary: AiSummary? = null,
    /** False when the model ran for this request. */
    val cached: Boolean = true,
    /** folder · screened_out_sender · too_short · single_message. */
    val reason: String? = null,
) {
    /** The summary to show, or null for anything else (including unknown statuses). */
    val readySummary: AiSummary?
        get() = summary.takeIf { status == "ready" }
}

/**
 * Which readers ask for a summary. Mirrors web `EmailPanel` `summaryEnabled`: the open
 * mail's folder can be summarized, and the thread's non-draft messages in such folders
 * hold at least [MIN_CHARS] of text between them. The server re-checks both; this only
 * skips pointless calls.
 */
object AiSummaryEligibility {
    /** `MIN_SUMMARY_CHARS`. */
    const val MIN_CHARS = 500

    /** `SUMMARY_EXCLUDED_FOLDER_IDS`: Screener, Screened out, Spam, Trash, Drafts. */
    val excludedFolderIds = setOf("screener", "screened_out", "spam", "trash", "draft")

    /** `isSummaryFolderEligible`. */
    fun isFolderEligible(folderId: String?): Boolean =
        !folderId.isNullOrEmpty() && folderId !in excludedFolderIds

    fun isEnabled(email: Email?, thread: List<Email>): Boolean {
        if (email == null || !isFolderEligible(email.folderId) || email.isDraft) return false
        var chars = 0
        for (message in thread.ifEmpty { listOf(email) }) {
            if (message.isDraft || !isFolderEligible(message.folderId)) continue
            chars += plainText(message.body.orEmpty()).length
            if (chars >= MIN_CHARS) return true
        }
        return false
    }

    private val nonContent = listOf("head", "style", "script", "title").map { tag ->
        Regex("<$tag\\b[^>]*>[\\s\\S]*?</$tag\\s*>", RegexOption.IGNORE_CASE)
    }
    private val entities = listOf(
        "&nbsp;" to " ", "&lt;" to "<", "&gt;" to ">", "&quot;" to "\"", "&#39;" to "'", "&amp;" to "&",
    )

    /** Web `stripHtml`: drop non-content blocks and tags, decode entities, collapse whitespace. */
    fun plainText(html: String): String {
        if (html.isEmpty()) return ""
        var text = html
        nonContent.forEach { text = it.replace(text, " ") }
        text = text.replace(Regex("<!--[\\s\\S]*?-->"), " ")
        text = text.replace(Regex("<[^>]*>"), " ")
        entities.forEach { (entity, value) -> text = text.replace(entity, value) }
        text = text.replace(Regex("[­͏​‌﻿]"), "")
        return text.replace(Regex("\\s+"), " ").trim()
    }
}

/** The daily AI limit on summaries (AVE-215): a 429 from a summary route. */
object AiSummaryQuota {
    fun isQuotaError(error: Throwable): Boolean = (error as? ApiException.Http)?.code == 429

    /** The quota resets at the next UTC midnight. */
    fun nextReset(now: Instant = Instant.now()): Instant =
        LocalDate.ofInstant(now, ZoneOffset.UTC).plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant()

    /** "Daily AI limit reached. Resets in 6h." — web `summaryQuotaText`. */
    fun text(now: Instant = Instant.now()): String =
        "Daily AI limit reached. ${AiUsageFormat.resetText(nextReset(now), now)}."
}

package co.inboxies.app.services

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** One recipient a send was refused for: the server's `SuppressionView` (AVE-37). */
data class SuppressedRecipient(
    val address: String,
    val domain: String,
    val reason: Reason,
    val source: String,
    val detail: String?,
    /** ISO 8601. */
    val suppressedAt: String,
    /** False when another mailbox's send caused it and the caller isn't a domain admin. */
    val canUnsuppress: Boolean,
) {
    enum class Reason { HardBounce, Complaint }
}

/**
 * The suppression list a mailbox can see (AVE-157): its own sends' suppressions, or every
 * mailbox's on the domain for a domain admin ([Scope.Domain]).
 */
data class SuppressionList(
    val domain: String,
    val scope: Scope,
    val suppressions: List<SuppressedRecipient>,
) {
    enum class Scope { Domain, Mailbox }
}

/**
 * Bounce / complaint suppressions on Android (AVE-84). Mirrors `app/lib/suppression.ts`
 * and iOS `BounceSuppression`.
 *
 * A send, reply or forward to a suppressed recipient comes back as
 * `409 { error, code: "recipient_suppressed", suppressed: [SuppressionView] }`.
 * Compose shows each address with its reason and offers Un-suppress
 * (`DELETE /api/v1/mailboxes/:id/suppressions/:address`) followed by a retry
 * with the same `Idempotency-Key`.
 */
object BounceSuppression {
    /** Same value as the server's `RECIPIENT_SUPPRESSED_CODE`. */
    const val RECIPIENT_SUPPRESSED_CODE = "recipient_suppressed"

    const val ASK_ADMIN_TEXT =
        "Another mailbox on this domain suppressed it. Ask a domain admin to un-suppress it."

    /** The suppressed recipients a failed send reports, or null for any other response. */
    fun suppressedRecipients(code: Int, body: String): List<SuppressedRecipient>? {
        if (code != 409) return null
        val obj = runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return null
        if ((obj["code"] as? JsonPrimitive)?.contentOrNull != RECIPIENT_SUPPRESSED_CODE) return null
        val rows = obj["suppressed"] as? JsonArray ?: return null
        val list = rows.mapNotNull { (it as? JsonObject)?.let(::recipient) }
        return list.ifEmpty { null }
    }

    /** One `SuppressionView` row; null without an address. */
    fun recipient(row: JsonObject): SuppressedRecipient? {
        fun str(key: String): String? = (row[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val address = str("address")?.takeIf { it.isNotEmpty() } ?: return null
        return SuppressedRecipient(
            address = address.lowercase(),
            domain = str("domain").orEmpty(),
            reason = if (str("reason") == "complaint") {
                SuppressedRecipient.Reason.Complaint
            } else {
                SuppressedRecipient.Reason.HardBounce
            },
            source = str("source").orEmpty(),
            detail = str("detail")?.takeIf { it.isNotEmpty() },
            suppressedAt = str("suppressedAt").orEmpty(),
            canUnsuppress = (row["canUnsuppress"] as? JsonPrimitive)?.booleanOrNull == true,
        )
    }

    /** `GET /api/v1/mailboxes/:id/suppressions` (AVE-157); null when the body isn't that shape. */
    fun list(obj: JsonObject): SuppressionList? {
        val rows = obj["suppressions"] as? JsonArray ?: return null
        fun str(key: String): String? = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return SuppressionList(
            domain = str("domain").orEmpty(),
            scope = if (str("scope") == "domain") SuppressionList.Scope.Domain else SuppressionList.Scope.Mailbox,
            suppressions = rows.mapNotNull { (it as? JsonObject)?.let(::recipient) },
        )
    }

    fun list(body: String): SuppressionList? =
        runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull()?.let(::list)

    // Settings → Bounced addresses (web `SuppressionsSettings.tsx`, iOS `SuppressionsSettingsView`).

    const val PAGE_TITLE = "Bounced addresses"
    const val EMPTY_TITLE = "No bounced addresses"
    const val EMPTY_MESSAGE = "Addresses that hard-bounce or report your mail as spam show up here."
    const val LOAD_FAILED_TITLE = "Couldn’t load bounced addresses"
    const val ADMIN_ONLY_TEXT = "Domain admin only"
    const val CONFIRM_TITLE = "Un-suppress this address?"

    /** Short label for a reason, for lists: "Bounced" / "Marked as spam". */
    fun reasonLabel(reason: SuppressedRecipient.Reason): String =
        if (reason == SuppressedRecipient.Reason.Complaint) "Marked as spam" else "Bounced"

    /** "Bounced · Oct 1, 2026". */
    fun metaLine(
        recipient: SuppressedRecipient,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val whenText = formatDate(recipient.suppressedAt, locale, zone)
        val label = reasonLabel(recipient.reason)
        return if (whenText.isEmpty()) label else "$label · $whenText"
    }

    /** The page's intro. Before the list loads (`list == null`) it reads like a member's. */
    fun introText(list: SuppressionList?): String {
        val domain = list?.domain?.takeIf { it.isNotEmpty() } ?: "this domain"
        val scope = if (list?.scope == SuppressionList.Scope.Domain) {
            "As a domain admin you see every mailbox's."
        } else {
            "You see the ones this mailbox's sends caused."
        }
        return "After a hard bounce or a spam report, mail from $domain stops going to that address, " +
            "which protects your sending reputation. $scope"
    }

    fun confirmMessage(recipient: SuppressedRecipient): String {
        val again = if (recipient.reason == SuppressedRecipient.Reason.Complaint) "reports spam" else "bounces"
        return "Mail will go to ${recipient.address} again. If it $again again, it's suppressed again."
    }

    fun unsuppressedToast(address: String): String = "$address un-suppressed"

    /** A 404 on un-suppress: the suppression is already gone, so the row just goes away. */
    fun isAlreadyLifted(error: Throwable): Boolean = error is ApiException.Http && error.code == 404

    /** The 409 as an [ApiException.RecipientSuppressed], or null. */
    fun failure(code: Int, body: String, message: String): ApiException.RecipientSuppressed? {
        val list = suppressedRecipients(code, body) ?: return null
        return ApiException.RecipientSuppressed(list, message)
    }

    /** "Oct 1, 2026"; the raw value when it isn't an ISO date. */
    fun formatDate(
        iso: String,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        if (iso.isEmpty()) return ""
        val instant = runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: return iso
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .format(instant.atZone(zone))
    }

    /** "This address bounced on Oct 1, 2026" / "This address marked earlier mail as spam on …". */
    fun reasonText(
        recipient: SuppressedRecipient,
        locale: Locale = Locale.getDefault(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): String {
        val whenText = formatDate(recipient.suppressedAt, locale, zone)
        val on = if (whenText.isEmpty()) "" else " on $whenText"
        return when (recipient.reason) {
            SuppressedRecipient.Reason.Complaint -> "This address marked earlier mail as spam$on"
            SuppressedRecipient.Reason.HardBounce -> "This address bounced$on"
        }
    }

    /**
     * The suppressions still among the compose's recipients: removing an address from
     * To / Cc / Bcc clears its notice without another send attempt.
     */
    fun stillAddressed(
        suppressed: List<SuppressedRecipient>,
        recipients: List<String>,
    ): List<SuppressedRecipient> {
        if (suppressed.isEmpty()) return emptyList()
        val current = recipients.map { it.trim().lowercase() }.toSet()
        return suppressed.filter { it.address.lowercase() in current }
    }

    fun buttonTitle(count: Int): String =
        if (count > 1) "Un-suppress all and send" else "Un-suppress and send"

    fun footerText(canLiftAll: Boolean): String =
        if (canLiftAll) {
            "Or remove the address to send to everyone else."
        } else {
            "Remove the address to send to everyone else."
        }
}

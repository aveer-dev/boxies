package co.inboxies.app.services

import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.DomainAliasItem
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Domain aliases (AVE-219): `sales@domain` delivers into one of the domain's mailboxes.
 * Admin-only, managed from Domain Admin → Aliases. Worker routes:
 * `GET|POST /api/v1/admin/domains/:domain/aliases`, `DELETE …/aliases/:aliasLocal`
 * (`workers/routes/domain-dns.ts`). Same rules and copy as iOS `DomainAliases`.
 */
object DomainAliases {
    const val SECTION_TITLE = "Aliases"
    const val ADD_TITLE = "Add alias"
    const val EMPTY_MESSAGE = "No aliases yet. An alias like sales@ delivers into one of this domain's mailboxes."
    const val INVALID_LOCAL = "Use only letters, numbers, dots, dashes and underscores."
    const val FORBIDDEN_TARGET = "Aliases can only deliver to mailboxes on this domain or ones you can access."
    const val ADD_FAILED = "Couldn't add the alias. Try again."
    const val DELETE_FAILED = "Couldn't delete the alias. Try again."
    const val LOAD_FAILED = "Couldn't load aliases."
    const val NO_TARGETS = "Create a mailbox on this domain first."

    private val localPattern = Regex("^[a-z0-9._-]+$")

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    fun path(domain: String): String = "/api/v1/admin/domains/${encode(domain)}/aliases"

    fun deletePath(domain: String, aliasLocal: String): String = "${path(domain)}/${encode(aliasLocal)}"

    /** Camel-case keys, the shape the Worker reads. */
    fun createBody(aliasLocal: String, targetMailboxId: String): JsonObject = buildJsonObject {
        put("aliasLocal", aliasLocal)
        put("targetMailboxId", targetMailboxId)
    }

    /** What the Worker stores: trimmed, lowercased, no leading `@`, nothing after an `@`. */
    fun normalizedLocal(input: String): String =
        input.trim().lowercase().trimStart('@').substringBefore('@')

    /** The Worker's `^[a-zA-Z0-9._-]+$` check. */
    fun isValidLocal(local: String): Boolean = localPattern.matches(local)

    /** Mailboxes an alias may deliver to: the domain's own, else every listed one. */
    fun targets(rows: List<AdminMailboxRow>, domain: String): List<AdminMailboxRow> {
        val suffix = "@${domain.lowercase()}"
        val onDomain = rows.filter { it.email.lowercase().endsWith(suffix) }
        return onDomain.ifEmpty { rows }
    }

    fun sorted(aliases: List<DomainAliasItem>): List<DomainAliasItem> = aliases.sortedBy { it.aliasLocal }

    /**
     * Checked before the request: the Worker would 409 on a mailbox and silently re-point an
     * existing alias, so both are caught here.
     */
    fun conflict(
        local: String,
        domain: String,
        aliases: List<DomainAliasItem>,
        mailboxes: List<AdminMailboxRow>,
    ): String? {
        val email = "$local@${domain.lowercase()}"
        if (aliases.any { it.aliasLocal.lowercase() == local }) return "$email is already an alias"
        if (mailboxes.any { it.email.lowercase() == email }) return "$email is already a mailbox"
        return null
    }

    /** Toast copy for a failed add: the Worker's sentence when it sent one. */
    fun addErrorMessage(status: Int?, serverMessage: String?): String {
        val server = serverMessage?.trim().orEmpty()
        return when (status) {
            // "Invalid alias local part" reads better as the rule it broke.
            400 -> if (server.isEmpty() || server == "Invalid alias local part") INVALID_LOCAL else server
            403 -> server.ifEmpty { FORBIDDEN_TARGET }
            // 409 carries "x@domain is already a mailbox" / "in use by a private email".
            else -> server.ifEmpty { ADD_FAILED }
        }
    }

    fun addErrorMessage(error: Throwable): String = when (error) {
        is ApiException.Http -> addErrorMessage(error.code, error.serverMessage)
        is ApiException.ServiceEnded -> addErrorMessage(403, error.serverMessage)
        else -> ADD_FAILED
    }

    fun deleteErrorMessage(error: Throwable): String =
        (error as? ApiException)?.serverMessage ?: DELETE_FAILED

    fun deleteConfirmTitle(alias: DomainAliasItem): String = "Delete ${alias.aliasEmail}?"

    fun deleteConfirmMessage(alias: DomainAliasItem): String =
        "Mail sent to ${alias.aliasEmail} will stop reaching ${alias.targetMailboxId}."
}

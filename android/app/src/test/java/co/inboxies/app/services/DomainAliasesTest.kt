package co.inboxies.app.services

import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.DomainAliasCreateResponse
import co.inboxies.app.models.DomainAliasItem
import co.inboxies.app.models.DomainAliasesResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Domain Admin → Aliases (AVE-219). iOS twin: `DomainAliasesTests.swift`. */
class DomainAliasesTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun row(email: String) = AdminMailboxRow(id = email, email = email, name = email)

    @Test
    fun pathsMatchWorkerRoutes() {
        assertEquals("/api/v1/admin/domains/acme.com/aliases", DomainAliases.path("acme.com"))
        assertEquals("/api/v1/admin/domains/acme.com/aliases/sales", DomainAliases.deletePath("acme.com", "sales"))
    }

    @Test
    fun createBodyUsesWorkerKeys() {
        val body = DomainAliases.createBody("sales", "you@acme.com")
        assertEquals(setOf("aliasLocal", "targetMailboxId"), body.keys)
        assertEquals(JsonPrimitive("sales"), body["aliasLocal"])
        assertEquals(JsonPrimitive("you@acme.com"), body["targetMailboxId"])
    }

    @Test
    fun listAndCreateResponsesDecodeWorkerShape() {
        val alias = """{"aliasLocal":"sales","aliasEmail":"sales@acme.com","targetMailboxId":"you@acme.com","createdAt":"2026-11-09T10:00:00.000Z"}"""
        val list = json.decodeFromString<DomainAliasesResponse>("""{"domain":"acme.com","aliases":[$alias]}""")
        assertEquals("sales@acme.com", list.aliases.single().aliasEmail)
        assertEquals("you@acme.com", list.aliases.single().targetMailboxId)
        val created = json.decodeFromString<DomainAliasCreateResponse>("""{"success":true,"alias":$alias}""")
        assertEquals("sales", created.alias?.aliasLocal)
    }

    @Test
    fun normalizedLocalMatchesWorker() {
        assertEquals("sales", DomainAliases.normalizedLocal("  @@Sales "))
        assertEquals("sales", DomainAliases.normalizedLocal("sales@acme.com"))
        assertTrue(DomainAliases.isValidLocal("first.last_2-x"))
        assertFalse(DomainAliases.isValidLocal(""))
        assertFalse(DomainAliases.isValidLocal("sales team"))
        assertFalse(DomainAliases.isValidLocal("sales+1"))
    }

    @Test
    fun targetsPreferTheDomainsMailboxes() {
        val rows = listOf(row("you@acme.com"), row("ops@other.com"))
        assertEquals(listOf("you@acme.com"), DomainAliases.targets(rows, "ACME.com").map { it.email })
        assertEquals(2, DomainAliases.targets(rows, "nope.com").size)
    }

    @Test
    fun conflictCatchesAliasesAndMailboxes() {
        val aliases = listOf(DomainAliasItem("sales", "sales@acme.com", "you@acme.com"))
        val rows = listOf(row("you@acme.com"))
        assertEquals("sales@acme.com is already an alias", DomainAliases.conflict("sales", "acme.com", aliases, rows))
        assertEquals("you@acme.com is already a mailbox", DomainAliases.conflict("you", "acme.com", aliases, rows))
        assertNull(DomainAliases.conflict("hello", "acme.com", aliases, rows))
    }

    @Test
    fun addErrorCopyForWorkerStatuses() {
        assertEquals(DomainAliases.INVALID_LOCAL, DomainAliases.addErrorMessage(400, "Invalid alias local part"))
        assertEquals("Target mailbox is required", DomainAliases.addErrorMessage(400, "Target mailbox is required"))
        assertEquals(DomainAliases.FORBIDDEN_TARGET, DomainAliases.addErrorMessage(403, ""))
        assertEquals(
            "sales@acme.com is already a mailbox",
            DomainAliases.addErrorMessage(409, "sales@acme.com is already a mailbox"),
        )
        assertEquals(DomainAliases.ADD_FAILED, DomainAliases.addErrorMessage(500, null))
        assertEquals(
            "sales@acme.com is in use by a private email",
            DomainAliases.addErrorMessage(ApiException.Http(409, "sales@acme.com is in use by a private email")),
        )
    }
}

package co.inboxies.app.services

import co.inboxies.app.models.DomainService
import co.inboxies.app.models.Email
import co.inboxies.app.models.Mailbox
import co.inboxies.app.ui.components.domainServiceCopy
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Read-only mailboxes once a domain's subscription ends (`service_ended`). */
class ServiceEndedTest {
    // Mirrors ApiClient.json.
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
        encodeDefaults = false
    }

    @Test
    fun serviceEnded403IsDistinctFromLostAccess() {
        val body = """{"error":"The subscription for acme.com has ended.","code":"service_ended","domain":"acme.com"}"""
        val ended = ApiClient.serviceEndedFailure(403, body, "The subscription for acme.com has ended.")
        assertNotNull(ended)
        assertEquals("acme.com", ended!!.domain)
        // Not an Http 403, so the "drop the mailbox" paths never see it.
        assertFalse((ended as ApiException) is ApiException.Http)
        assertEquals("The subscription for acme.com has ended.", ended.serverMessage)

        assertNull(ApiClient.serviceEndedFailure(403, """{"error":"Forbidden"}""", "Forbidden"))
        assertNull(ApiClient.serviceEndedFailure(409, body, "x"))
        assertNull(ApiClient.serviceEndedFailure(403, "<html>", "x"))
    }

    @Test
    fun mailboxDecodesReadOnlyAndServiceSummary() {
        val list = json.decodeFromString<Mailbox>(
            """{"id":"me@acme.com","email":"me@acme.com","name":"me@acme.com","role":"owner","readOnly":true}""",
        )
        assertTrue(list.isReadOnly)
        assertEquals("acme.com", list.domain)

        val detail = json.decodeFromString<Mailbox>(
            """{"id":"me@acme.com","email":"me@acme.com","name":"Me","readOnly":false,
               "service":{"domain":"acme.com","status":"ending","endsAt":"2026-11-01T00:00:00.000Z",
               "registrarManaged":true,"canRenew":true}}""",
        )
        assertFalse(detail.isReadOnly)
        assertTrue(detail.service!!.isEnding)

        val older = json.decodeFromString<Mailbox>("""{"id":"a@b.c","email":"a@b.c","name":"a"}""")
        assertFalse(older.isReadOnly)
        assertNull(older.service)

        // The flag wins over a stale summary after a renewal.
        assertFalse(detail.copy(readOnly = false, service = detail.service.copy(status = "ended")).isReadOnly)
    }

    @Test
    fun serviceEndpointDecodes() {
        val service = json.decodeFromString<DomainService>(
            """{"domain":"acme.com","status":"ended","endedAt":"2026-10-01T00:00:00.000Z","registrarManaged":true,
               "registrationExpiresAt":"2026-09-20T00:00:00.000Z","renewBy":"2026-10-30T00:00:00.000Z",
               "daysLeftToRenew":16,"canRenew":true,"canManage":false,"billed":true}""",
        )
        assertTrue(service.isEnded)
        assertEquals(16, service.daysLeftToRenew)
        assertEquals(false, service.canManage)

        val unbilled = json.decodeFromString<DomainService>(
            """{"domain":"inboxies.email","status":"active","registrarManaged":false,"canRenew":false,"canManage":false,"billed":false}""",
        )
        assertEquals(false, unbilled.billed)
    }

    @Test
    fun bannerCopyFollowsRoleAndDeadline() {
        val ended = DomainService(
            domain = "acme.com",
            status = DomainService.STATUS_ENDED,
            registrarManaged = true,
            renewBy = "2026-10-30T00:00:00Z",
            daysLeftToRenew = 21,
            canRenew = true,
        )
        val admin = domainServiceCopy("acme.com", ended, readOnly = true, isAdmin = true)!!
        assertEquals("Your subscription for acme.com ended. Mail is read-only.", admin.title)
        assertEquals("Renew", admin.actionLabel)
        assertTrue(admin.detail!!.startsWith("Renew by "))
        assertTrue(admin.detail!!.contains("(21 days left)"))

        val member = domainServiceCopy("acme.com", ended, readOnly = true, isAdmin = false)!!
        assertNull(member.actionLabel)
        assertTrue(member.detail!!.endsWith("Ask an admin of acme.com to renew."))

        val closed = domainServiceCopy("acme.com", ended.copy(canRenew = false), readOnly = true, isAdmin = true)!!
        assertNull(closed.actionLabel)
        assertEquals(
            "This domain can no longer be renewed. You can still read and export your mail.",
            closed.detail,
        )

        // Flag known before the service: still a read-only notice, no action yet.
        assertNull(domainServiceCopy("acme.com", null, readOnly = true, isAdmin = true)!!.actionLabel)

        val ending = ended.copy(status = DomainService.STATUS_ENDING, endsAt = "2026-11-01T00:00:00Z")
        assertEquals("Keep subscription", domainServiceCopy("acme.com", ending, readOnly = false, isAdmin = true)!!.actionLabel)
        assertNull(domainServiceCopy("acme.com", ending, readOnly = false, isAdmin = false))
        assertNull(domainServiceCopy("acme.com", ended.copy(status = "active"), readOnly = false, isAdmin = true))
    }

    @Test
    fun readOnlyHidesWritesButKeepsFlags() {
        val email = Email(id = "e1", folderId = "inbox", subject = "s", sender = "a@b.c", recipient = "me@acme.com", date = "2026-10-01T00:00:00Z")
        val writable = EmailActionAvailability(email)
        assertTrue(writable.showsReplyActions && writable.showsDelete && writable.showsArchive && writable.showsMove)
        val frozen = EmailActionAvailability(email, readOnly = true)
        assertFalse(frozen.showsReplyActions || frozen.showsDelete || frozen.showsArchive || frozen.showsMove)

        val layout = EmailSwipeLayout(
            trailingActions = listOf(SwipeQuickAction.DELETE, SwipeQuickAction.STAR),
            trailingAllowsFullSwipe = true,
            leadingActions = listOf(SwipeQuickAction.ARCHIVE),
            leadingAllowsFullSwipe = true,
            showsMore = true,
        ).readOnly()
        assertEquals(listOf(SwipeQuickAction.STAR), layout.trailingActions)
        assertTrue(layout.leadingActions.isEmpty())
        assertFalse(layout.leadingAllowsFullSwipe)
    }
}

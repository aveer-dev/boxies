package co.inboxies.app.services

import co.inboxies.app.util.DeliveryStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/** 409 `recipient_suppressed` parsing and the composer's reason copy (AVE-84). */
class BounceSuppressionTest {
    private val body = """
        {"error":"Not sent: bob@example.com bounced on 2026-10-01 (and 1 more suppressed address). Remove the address or un-suppress it to send again.",
         "code":"recipient_suppressed",
         "suppressed":[
           {"address":"Bob@Example.com","domain":"acme.com","reason":"hard_bounce","source":"dsn","detail":"550 5.1.1 user unknown","suppressedAt":"2026-10-01T12:00:00.000Z","canUnsuppress":true},
           {"address":"carol@example.com","domain":"acme.com","reason":"complaint","source":"event","detail":null,"suppressedAt":"2026-10-02T09:30:00Z","canUnsuppress":false},
           {"domain":"acme.com"}
         ]}
    """.trimIndent()

    private val utc = ZoneId.of("UTC")

    @Test
    fun parsesSuppressedRecipientsFrom409() {
        val list = BounceSuppression.suppressedRecipients(409, body)
        assertNotNull(list)
        assertEquals("rows without an address are dropped", 2, list!!.size)
        assertEquals("bob@example.com", list[0].address)
        assertEquals(SuppressedRecipient.Reason.HardBounce, list[0].reason)
        assertEquals("550 5.1.1 user unknown", list[0].detail)
        assertTrue(list[0].canUnsuppress)
        assertEquals(SuppressedRecipient.Reason.Complaint, list[1].reason)
        assertNull(list[1].detail)
        assertFalse(list[1].canUnsuppress)
    }

    @Test
    fun ignoresOtherResponses() {
        assertNull(BounceSuppression.suppressedRecipients(400, body))
        assertNull(BounceSuppression.suppressedRecipients(409, """{"error":"Private email is paused","code":"alias_inactive"}"""))
        assertNull(BounceSuppression.suppressedRecipients(409, """{"code":"recipient_suppressed","suppressed":[]}"""))
        assertNull(BounceSuppression.suppressedRecipients(409, "<html>"))
    }

    @Test
    fun failureIsATypedExceptionCarryingTheServerSentence() {
        val message = "Not sent: bob@example.com bounced on 2026-10-01."
        val failure = BounceSuppression.failure(409, body, message)
        assertNotNull(failure)
        assertEquals(message, failure!!.message)
        assertEquals(message, failure.serverMessage)
        assertEquals(2, failure.suppressed.size)
        assertFalse((failure as ApiException) is ApiException.Http)
        assertNull(BounceSuppression.failure(409, """{"error":"Conflict"}""", "Conflict"))
    }

    @Test
    fun reasonText() {
        val list = BounceSuppression.suppressedRecipients(409, body)!!
        assertEquals(
            "This address bounced on Oct 1, 2026",
            BounceSuppression.reasonText(list[0], Locale.US, utc),
        )
        assertEquals(
            "This address marked earlier mail as spam on Oct 2, 2026",
            BounceSuppression.reasonText(list[1], Locale.US, utc),
        )
        val undated = list[0].copy(suppressedAt = "")
        assertEquals("This address bounced", BounceSuppression.reasonText(undated))
        assertEquals("yesterday", BounceSuppression.formatDate("yesterday"))
    }

    @Test
    fun removingARecipientClearsItsNotice() {
        val list = BounceSuppression.suppressedRecipients(409, body)!!
        assertEquals(
            listOf("bob@example.com", "carol@example.com"),
            BounceSuppression.stillAddressed(list, listOf("BOB@example.com", "carol@example.com")).map { it.address },
        )
        assertEquals(
            listOf("carol@example.com"),
            BounceSuppression.stillAddressed(list, listOf("carol@example.com", "dave@example.com")).map { it.address },
        )
        assertTrue(BounceSuppression.stillAddressed(list, emptyList()).isEmpty())
    }

    @Test
    fun buttonAndFooterCopy() {
        assertEquals("Un-suppress and send", BounceSuppression.buttonTitle(1))
        assertEquals("Un-suppress all and send", BounceSuppression.buttonTitle(2))
        assertEquals("Remove the address to send to everyone else.", BounceSuppression.footerText(false))
    }

    @Test
    fun deliveryStatusLabelsForSentRows() {
        assertEquals("Bounced", DeliveryStatus.label("bounced"))
        assertEquals("Marked as spam", DeliveryStatus.label("complained"))
        assertTrue(DeliveryStatus.isFailure("complained"))
        assertFalse(DeliveryStatus.isFailure("accepted"))
    }

    // Settings → Bounced addresses (AVE-157)

    private val listBody = """
        {"domain":"acme.com","scope":"domain","suppressions":[
           {"address":"Bob@Example.com","domain":"acme.com","reason":"hard_bounce","source":"dsn","detail":"550 5.1.1 user unknown","suppressedAt":"2026-10-01T12:00:00.000Z","canUnsuppress":true},
           {"address":"carol@example.com","domain":"acme.com","reason":"complaint","source":"event","detail":"","suppressedAt":"2026-10-02T09:30:00Z","canUnsuppress":false},
           {"domain":"acme.com"},
           "junk"
        ]}
    """.trimIndent()

    @Test
    fun parsesSuppressionList() {
        val list = BounceSuppression.list(listBody)
        assertNotNull(list)
        assertEquals("acme.com", list!!.domain)
        assertEquals(SuppressionList.Scope.Domain, list.scope)
        assertEquals(listOf("bob@example.com", "carol@example.com"), list.suppressions.map { it.address })
        assertEquals(SuppressedRecipient.Reason.HardBounce, list.suppressions[0].reason)
        assertTrue(list.suppressions[0].canUnsuppress)
        assertEquals(SuppressedRecipient.Reason.Complaint, list.suppressions[1].reason)
        assertNull("an empty detail is dropped", list.suppressions[1].detail)
        assertFalse(list.suppressions[1].canUnsuppress)
    }

    @Test
    fun suppressionListDefaultsAndRejects() {
        val empty = BounceSuppression.list("""{"domain":"acme.com","scope":"mailbox","suppressions":[]}""")
        assertEquals(SuppressionList.Scope.Mailbox, empty!!.scope)
        assertTrue(empty.suppressions.isEmpty())
        val unknownScope = BounceSuppression.list("""{"suppressions":[]}""")
        assertEquals(SuppressionList.Scope.Mailbox, unknownScope!!.scope)
        assertEquals("", unknownScope.domain)
        assertNull(BounceSuppression.list("""{"error":"Invalid mailbox email address"}"""))
        assertNull(BounceSuppression.list("<html>"))
    }

    @Test
    fun listRowCopy() {
        val rows = BounceSuppression.list(listBody)!!.suppressions
        assertEquals("Bounced · Oct 1, 2026", BounceSuppression.metaLine(rows[0], Locale.US, utc))
        assertEquals("Marked as spam · Oct 2, 2026", BounceSuppression.metaLine(rows[1], Locale.US, utc))
        assertEquals(
            "Mail will go to bob@example.com again. If it bounces again, it's suppressed again.",
            BounceSuppression.confirmMessage(rows[0]),
        )
        assertEquals(
            "Mail will go to carol@example.com again. If it reports spam again, it's suppressed again.",
            BounceSuppression.confirmMessage(rows[1]),
        )
        assertEquals("bob@example.com un-suppressed", BounceSuppression.unsuppressedToast("bob@example.com"))
    }

    @Test
    fun introTextFollowsScope() {
        val admin = BounceSuppression.list(listBody)
        assertEquals(
            "After a hard bounce or a spam report, mail from acme.com stops going to that address, " +
                "which protects your sending reputation. As a domain admin you see every mailbox's.",
            BounceSuppression.introText(admin),
        )
        val member = SuppressionList("acme.com", SuppressionList.Scope.Mailbox, emptyList())
        assertTrue(BounceSuppression.introText(member).endsWith("You see the ones this mailbox's sends caused."))
        assertTrue(BounceSuppression.introText(null).contains("mail from this domain stops"))
    }

    @Test
    fun alreadyLiftedIsA404() {
        assertTrue(BounceSuppression.isAlreadyLifted(ApiException.Http(404, "Not suppressed")))
        assertFalse(BounceSuppression.isAlreadyLifted(ApiException.Http(403, "Ask a domain admin")))
        assertFalse(BounceSuppression.isAlreadyLifted(IllegalStateException("boom")))
    }
}

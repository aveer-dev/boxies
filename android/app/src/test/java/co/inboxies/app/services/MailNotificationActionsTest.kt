package co.inboxies.app.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** AVE-142: notification action mapping and FCM payload parsing (twin of iOS AVE-141). */
class MailNotificationActionsTest {
    private val now = ZonedDateTime.of(2026, 10, 29, 22, 30, 0, 0, ZoneId.of("America/New_York"))

    @Test
    fun actionsMapToWorkerRequests() {
        assertEquals(
            MailNotificationRequest.Move("archive", setSenderPreference = false),
            MailNotificationActions.request(MailNotificationAction.ARCHIVE, null, now),
        )
        assertEquals(
            MailNotificationRequest.Move("spam", setSenderPreference = true),
            MailNotificationActions.request(MailNotificationAction.SPAM, null, now),
        )
        assertEquals(MailNotificationRequest.MarkRead, MailNotificationActions.request(MailNotificationAction.MARK_READ, null, now))
    }

    @Test
    fun replyLaterRemindsTomorrowAtNineLocal() {
        // 2026-10-30 09:00 EDT = 13:00Z.
        assertEquals(
            MailNotificationRequest.ReplyLater("2026-10-30T13:00:00.000Z"),
            MailNotificationActions.request(MailNotificationAction.REPLY_LATER, null, now),
        )
    }

    @Test
    fun replyTrimsTextAndBlankSendsNothing() {
        assertEquals(
            MailNotificationRequest.QuickReply("Thanks!"),
            MailNotificationActions.request(MailNotificationAction.REPLY, "  Thanks!\n", now),
        )
        assertNull(MailNotificationActions.request(MailNotificationAction.REPLY, "   ", now))
        assertNull(MailNotificationActions.request(MailNotificationAction.REPLY, null, now))
    }

    @Test
    fun cannedRepliesMatchThePlan() {
        assertEquals(
            listOf("Thanks!", "Got it, will reply soon", "Can we talk later?", "👍"),
            MailNotificationActions.CANNED_REPLIES,
        )
    }

    @Test
    fun actionIdsRoundTrip() {
        MailNotificationAction.entries.forEach { assertEquals(it, MailNotificationAction.from(it.id)) }
        assertNull(MailNotificationAction.from("TRASH"))
        assertNull(MailNotificationAction.from(null))
    }

    @Test
    fun onlyActionablePushesWithIdsGetATarget() {
        val data = mapOf(
            "mailboxId" to "ada@inboxies.email",
            "emailId" to "e1",
            "threadId" to "thread-1@example.com",
            "category" to "INBOXIES_MAIL",
        )
        assertEquals(
            MailNotificationTarget("ada@inboxies.email", "e1", "thread-1@example.com"),
            MailNotificationActions.target(data),
        )
        // Legacy / test pushes have no category.
        assertNull(MailNotificationActions.target(data - "category"))
        assertNull(MailNotificationActions.target(data + ("emailId" to "")))
        assertNull(MailNotificationActions.target(data - "mailboxId"))
        assertEquals(
            MailNotificationTarget("ada@inboxies.email", "e1", null),
            MailNotificationActions.target(data + ("threadId" to "")),
        )
    }
}

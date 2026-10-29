package co.inboxies.app.util

import co.inboxies.app.models.Email
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * AVE-133: the reply shows the original's HTML as-is and the Worker appends it on
 * send (`quote_original`); nothing is flattened to text on the device.
 * iOS twin: `HardeningTests.testQuotedOriginalKeepsTheOriginalHTML`.
 */
class QuotedOriginalTest {
    private val original = Email(
        id = "o1",
        folderId = "spam",
        subject = "Deals",
        sender = "news@example.com",
        senderName = "News",
        recipient = "me@example.com",
        date = "2026-10-27T16:46:00.000Z",
        read = true,
        starred = false,
        body = "<table><tr><td><b>Big</b> <a href=\"https://example.com\">sale</a></td></tr></table>",
        snippet = "Big sale",
    )

    @Test
    fun quotedOriginalKeepsTheOriginalHtml() {
        val reply = ComposeHtml.quotedOriginal(original)!!
        assertEquals(original, reply.email)
        assertFalse(reply.isForward)
        assertTrue(reply.header, reply.header.endsWith("News <news@example.com> wrote:"))

        val forward = ComposeHtml.quotedOriginal(original, isForward = true)!!
        assertEquals("---------- Forwarded message ---------", forward.detailLines.first())
        assertEquals("To: me@example.com", forward.detailLines.last())

        assertNull(ComposeHtml.quotedOriginal(original.copy(body = "  ", snippet = null)))
    }

    @Test
    fun legacyDraftQuoteIsStrippedFromTheEditor() {
        assertEquals(
            "Thanks!",
            ComposeHtml.editableReply(
                "<p>Thanks!</p><br>On Tue, Oct 27, 2026, News wrote:<br><br>old",
                null,
            ),
        )
        assertEquals(
            "FYI",
            ComposeHtml.editableReply(
                "FYI\n\n---------- Forwarded message ----------\nFrom: News\n\nold",
                "Forwarded message from News",
            ),
        )
    }
}

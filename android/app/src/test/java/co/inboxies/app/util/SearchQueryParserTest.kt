package co.inboxies.app.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchQueryParserTest {
    @Test
    fun parsesMixedFreeTextAndOperators() {
        val parsed = SearchQueryParser.parse("hello from:alice@x.com is:unread")
        assertEquals("hello", parsed.query)
        assertEquals("alice@x.com", parsed.from)
        assertEquals(false, parsed.isRead)
        assertTrue(parsed.hasStructuredFilters)
        assertEquals(
            mapOf(
                "query" to "hello",
                "from" to "alice@x.com",
                "is_read" to "false",
            ),
            parsed.toApiQuery(),
        )
    }

    @Test
    fun parsesQuotedValuesAndDates() {
        val parsed = SearchQueryParser.parse("""from:"John Doe" has:attachment before:2025-01-01""")
        assertEquals("", parsed.query)
        assertEquals("John Doe", parsed.from)
        assertEquals(true, parsed.hasAttachment)
        assertEquals("2025-01-01T00:00:00Z", parsed.dateEnd)
        assertEquals("true", parsed.toApiQuery()["has_attachment"])
        assertEquals("2025-01-01T00:00:00Z", parsed.toApiQuery()["date_end"])
    }

    @Test
    fun parsesSlashDatesLikeWeb() {
        val parsed = SearchQueryParser.parse("before:01/01/2025 after:12/31/2024")
        assertEquals("2025-01-01T00:00:00Z", parsed.dateEnd)
        assertEquals("2024-12-31T00:00:00Z", parsed.dateStart)
    }

    @Test
    fun lastDuplicateOperatorWins() {
        val parsed = SearchQueryParser.parse("from:a from:b is:starred in:sent")
        assertEquals("b", parsed.from)
        assertEquals(true, parsed.isStarred)
        assertEquals("sent", parsed.folder)
    }

    @Test
    fun stripsInvalidHasButKeepsFreeText() {
        val parsed = SearchQueryParser.parse("has:foo leftover")
        assertEquals("leftover", parsed.query)
        assertNull(parsed.hasAttachment)
        assertFalse(parsed.hasStructuredFilters)
    }
}

class DeliveryStatusTest {
    @Test
    fun failureOnly() {
        assertTrue(DeliveryStatus.isFailure("failed"))
        assertTrue(DeliveryStatus.isFailure("bounced"))
        assertTrue(DeliveryStatus.isFailure("complained"))
        assertFalse(DeliveryStatus.isFailure("queued"))
        assertFalse(DeliveryStatus.isFailure("accepted"))
        assertFalse(DeliveryStatus.isFailure(null))
    }

    @Test
    fun labelsMatchWeb() {
        assertEquals("Send failed", DeliveryStatus.label("failed"))
        assertEquals("Bounced", DeliveryStatus.label("bounced"))
        assertEquals("Marked as spam", DeliveryStatus.label("complained"))
        assertEquals("Sending", DeliveryStatus.label("queued"))
        assertEquals("Sent", DeliveryStatus.label("accepted"))
    }
}

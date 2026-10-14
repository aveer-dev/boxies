package co.inboxies.app.services

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SseEventParserTest {
    private fun parse(vararg lines: String): List<SseEvent> {
        val parser = SseEventParser()
        return lines.mapNotNull { parser.feed(it) }
    }

    @Test
    fun dispatchesOnBlankLine() {
        assertEquals(
            listOf(SseEvent("new_email", "{\"id\":\"1\"}")),
            parse("event: new_email", "data: {\"id\":\"1\"}", ""),
        )
    }

    @Test
    fun joinsMultipleDataLinesWithNewline() {
        assertEquals(
            listOf(SseEvent("message", "{\"a\":1,\n\"b\":2}")),
            parse("data: {\"a\":1,", "data: \"b\":2}", ""),
        )
    }

    @Test
    fun keepsWhitespaceBeyondTheFirstSpace() {
        assertEquals(listOf(SseEvent("message", "  indented")), parse("data:   indented", ""))
        assertEquals(listOf(SseEvent("message", "tight")), parse("data:tight", ""))
    }

    @Test
    fun ignoresCommentsAndDataLessEvents() {
        assertEquals(emptyList<SseEvent>(), parse(": keep-alive", "", "event: ping", ""))
        // The event name of a data-less block doesn't leak into the next event.
        assertEquals(listOf(SseEvent("message", "x")), parse("event: ping", "", "data: x", ""))
    }

    @Test
    fun resetDropsAHalfReceivedEvent() {
        val parser = SseEventParser()
        assertNull(parser.feed("event: new_email"))
        assertNull(parser.feed("data: partial"))
        parser.reset()
        assertNull(parser.feed(""))
        assertEquals(SseEvent("connected", "{}"), parser.run { feed("event: connected"); feed("data: {}"); feed("") })
    }

    @Test
    fun sequentialEvents() {
        assertEquals(
            listOf(SseEvent("connected", "{}"), SseEvent("email_updated", "{\"id\":\"2\"}")),
            parse("event: connected", "data: {}", "", "event: email_updated", "data: {\"id\":\"2\"}", ""),
        )
    }
}

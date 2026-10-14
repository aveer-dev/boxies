package co.inboxies.app.services

/** One dispatched server-sent event. */
data class SseEvent(val event: String, val data: String)

/**
 * Line-oriented `text/event-stream` parser (WHATWG SSE "interpret the stream").
 * Feed it one line at a time (without the terminator); a blank line dispatches the
 * buffered event. Multiple `data:` lines are joined with `\n`, a single space after
 * the colon is dropped, `:` lines are comments, and an event with no data is ignored.
 */
class SseEventParser {
    private var eventName: String? = null
    private val data = StringBuilder()
    private var hasData = false

    fun feed(line: String): SseEvent? {
        if (line.isEmpty()) return dispatch()
        if (line.startsWith(":")) return null
        val colon = line.indexOf(':')
        val field = if (colon == -1) line else line.substring(0, colon)
        var value = if (colon == -1) "" else line.substring(colon + 1)
        if (value.startsWith(" ")) value = value.substring(1)
        when (field) {
            "event" -> eventName = value
            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }
            // `id` / `retry` are not used by the Worker stream.
        }
        return null
    }

    /** Drop any half-received event (e.g. on reconnect). */
    fun reset() {
        eventName = null
        data.setLength(0)
        hasData = false
    }

    private fun dispatch(): SseEvent? {
        if (!hasData) {
            eventName = null
            return null
        }
        val event = SseEvent(eventName?.takeIf { it.isNotEmpty() } ?: "message", data.toString())
        reset()
        return event
    }
}

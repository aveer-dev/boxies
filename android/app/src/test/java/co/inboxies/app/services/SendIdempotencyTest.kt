package co.inboxies.app.services

import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Mailbox
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** AVE-64: one `Idempotency-Key` per compose, sent on send / reply / forward. */
class SendIdempotencyTest {
    private val mailbox = Mailbox(id = "mb-1", email = "me@x.com", name = "Me")

    @Test
    fun headerOnlyWhenThereIsAKey() {
        assertEquals(mapOf("Idempotency-Key" to "abc"), ApiClient.idempotencyHeaders("abc"))
        assertEquals(emptyMap<String, String>(), ApiClient.idempotencyHeaders(null))
        assertEquals(emptyMap<String, String>(), ApiClient.idempotencyHeaders(""))
    }

    @Test
    fun eachComposeHasItsOwnStableKey() {
        val first = ComposeFormModel(mode = ComposeMode.New, mailbox = mailbox)
        val second = ComposeFormModel(mode = ComposeMode.New, mailbox = mailbox)
        assertNotEquals(first.sendIdempotencyKey, second.sendIdempotencyKey)
        assertEquals("Stable for the compose's life", first.sendIdempotencyKey, first.sendIdempotencyKey)
        // The server takes 1-200 printable ASCII characters.
        for (key in listOf(first.sendIdempotencyKey, second.sendIdempotencyKey)) {
            assertEquals(36, key.length)
            assertTrue(key.all { it.code in 0x20..0x7E })
        }
    }
}

package co.inboxies.app.services

import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** AVE-235: DEBUG previews never reach the network. */
class PreviewNetworkGuardTest {
    @After
    fun tearDown() = PreviewNetworkGuard.setBlocking(false)

    @Test
    fun blockingFailsTheCallBeforeItLeavesTheApp() {
        PreviewNetworkGuard.setBlocking(true)
        assertTrue(PreviewNetworkGuard.isBlocking)
        val client = OkHttpClient.Builder().addInterceptor(PreviewNetworkGuard.interceptor).build()
        // Unroutable on purpose: only the guard can answer this quickly with its own message.
        val request = Request.Builder().url("https://api.preview.invalid/api/v1/mailboxes").build()
        try {
            client.newCall(request).execute().close()
            fail("expected the preview guard to refuse the call")
        } catch (e: IOException) {
            assertTrue(e.message.orEmpty().startsWith(PreviewNetworkGuard.BLOCKED_MESSAGE))
            assertTrue(e.message.orEmpty().contains("api.preview.invalid"))
        }
    }

    @Test
    fun aNormalLaunchTurnsItOff() {
        PreviewNetworkGuard.setBlocking(true)
        PreviewNetworkGuard.setBlocking(false)
        assertFalse(PreviewNetworkGuard.isBlocking)
    }
}

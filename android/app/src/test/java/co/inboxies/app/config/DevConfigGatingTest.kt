package co.inboxies.app.config

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The launcher activity is exported: the API base editor must stay DEBUG-only (AVE-119). */
class DevConfigGatingTest {
    @Test
    fun releaseIgnoresShowApiBaseExtra() {
        assertFalse(AppConfig.shouldShowDevConfig(isDebug = false, showApiBaseExtra = true))
        assertFalse(AppConfig.shouldShowDevConfig(isDebug = false, showApiBaseExtra = false))
    }

    @Test
    fun debugHonorsShowApiBaseExtra() {
        assertTrue(AppConfig.shouldShowDevConfig(isDebug = true, showApiBaseExtra = true))
        assertFalse(AppConfig.shouldShowDevConfig(isDebug = true, showApiBaseExtra = false))
    }
}

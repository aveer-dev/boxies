package co.inboxies.app.config

import co.inboxies.app.BuildConfig
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** The launcher activity is exported: the API base editor must stay DEBUG-only (AVE-119). */
class DevConfigGatingTest {
    @After
    fun resetApiBase() {
        AppConfig.apiBaseURL = BuildConfig.DEFAULT_API_BASE
    }

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

    @Test
    fun recognizesLocalWorkerBases() {
        assertTrue(AppConfig.isLocalWorkerBase("http://10.0.2.2:5173"))
        assertTrue(AppConfig.isLocalWorkerBase("http://localhost:5173"))
        assertTrue(AppConfig.isLocalWorkerBase("http://127.0.0.1:5173"))
        assertFalse(AppConfig.isLocalWorkerBase("https://inboxies.email"))
    }

    /** `adb shell am start … --es apiBase http://10.0.2.2:5173` reaches `pnpm dev` and shows Dev Login. */
    @Test
    fun debugKeepsLocalWorkerBaseForThisProcess() {
        assumeTrue(BuildConfig.DEBUG)
        AppConfig.apiBaseURL = "http://10.0.2.2:5173"
        assertEquals("http://10.0.2.2:5173", AppConfig.apiBaseURL)
        assertTrue(AppConfig.isLocalDevelopmentAPI)
    }

    @Test
    fun remoteBaseReplacesLocalWorkerBase() {
        assumeTrue(BuildConfig.DEBUG)
        AppConfig.apiBaseURL = "http://10.0.2.2:5173"
        AppConfig.apiBaseURL = BuildConfig.DEFAULT_API_BASE
        assertEquals(BuildConfig.DEFAULT_API_BASE, AppConfig.apiBaseURL)
        assertFalse(AppConfig.isLocalDevelopmentAPI)
    }
}

package co.inboxies.app.services

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** "Confirm it's you" for `reauth_required` (AVE-171): the 403 body, the retry-once rule, the shared prompt. */
class ReauthTest {
    private val gateBody = """
        {"error":"For your security, confirm it's you first. Sign out and sign back in, then try again within 5 minutes.",
         "message":"For your security, confirm it's you first. Sign out and sign back in, then try again within 5 minutes.",
         "code":"reauth_required","maxAgeSeconds":300,
         "methods":["password","passkey","sign_in"],"twoFactor":true,"emailCodeTo":null}
    """.trimIndent()

    // Decoding the 403

    @Test
    fun parsesReauthRequiredBody() {
        val challenge = ReauthChallenge.parse(403, gateBody)
        assertNotNull(challenge)
        challenge!!
        assertEquals(listOf(ReauthMethod.Password, ReauthMethod.Passkey, ReauthMethod.SignIn), challenge.methods)
        assertEquals(listOf(ReauthMethod.Password, ReauthMethod.Passkey), challenge.usableMethods)
        assertTrue(challenge.twoFactor)
        assertNull(challenge.emailCodeTo)
        assertEquals(300, challenge.maxAgeSeconds)
        assertTrue(challenge.message.startsWith("For your security"))
    }

    @Test
    fun parsesEmailCodeAccount() {
        val body = """{"code":"reauth_required","methods":["email_code","sign_in"],"twoFactor":false,"emailCodeTo":"a•••p@gmail.com","maxAgeSeconds":300}"""
        val challenge = ReauthChallenge.parse(403, body)!!
        assertEquals(listOf(ReauthMethod.EmailCode, ReauthMethod.SignIn), challenge.methods)
        assertEquals("a•••p@gmail.com", challenge.emailCodeTo)
        assertFalse(challenge.twoFactor)
    }

    @Test
    fun unknownOrMissingMethodsFallBackToSignIn() {
        val challenge = ReauthChallenge.parse(403, """{"code":"reauth_required","methods":["carrier_pigeon"]}""")!!
        assertEquals(listOf(ReauthMethod.SignIn), challenge.methods)
        assertTrue(challenge.usableMethods.isEmpty())
        assertEquals(300, challenge.maxAgeSeconds)
        assertEquals("", challenge.message)

        // email_code with nowhere to send it isn't offered.
        val noTarget = """{"code":"reauth_required","methods":["email_code","sign_in"],"emailCodeTo":null}"""
        assertEquals(listOf(ReauthMethod.SignIn), ReauthChallenge.parse(403, noTarget)?.methods)
    }

    @Test
    fun otherErrorsAreNotChallenges() {
        assertNull("only a 403 is the gate", ReauthChallenge.parse(401, gateBody))
        assertNull(ReauthChallenge.parse(403, """{"error":"Forbidden"}"""))
        assertNull(ReauthChallenge.parse(403, """{"code":"service_ended","domain":"x.com"}"""))
        assertNull(ReauthChallenge.parse(403, "not json"))
    }

    @Test
    fun httpFailureMapsGateToReauthRequired() {
        val error = ApiClient.shared.httpFailure(403, gateBody, sentToken = "tok")
        assertTrue(error is ApiException.ReauthRequired)
        val challenge = (error as ApiException.ReauthRequired).challenge
        assertEquals(challenge.message, error.message)
        assertEquals(challenge.message, error.serverMessage)
        // Other 403s keep their old shapes.
        assertTrue(ApiClient.shared.httpFailure(403, """{"error":"Forbidden"}""", "tok") is ApiException.Http)
    }

    @Test
    fun errorMessageFallsBackWhenServerSentNone() {
        val bare = ApiException.ReauthRequired(ReauthChallenge(listOf(ReauthMethod.SignIn)))
        assertFalse(bare.message.isNullOrBlank())
    }

    @Test
    fun passkeyFriendlyKeepsTheGate() {
        val gate = ApiException.ReauthRequired(ReauthChallenge.parse(403, gateBody)!!)
        assertSame(gate, Passkeys.friendly(gate, "fallback"))
    }

    @Test
    fun reauthBodiesMatchTheWorker() {
        val password = ReauthBodies.password("hunter2", " 123 456 ", useBackupCode = false)
        assertEquals(JsonPrimitive("password"), password["method"])
        assertEquals(JsonPrimitive("hunter2"), password["password"])
        assertEquals(JsonPrimitive("123456"), password["code"])
        assertEquals(JsonPrimitive("totp"), password["codeType"])

        val backup = ReauthBodies.password("hunter2", "abcd-efgh", useBackupCode = true)
        assertEquals(JsonPrimitive("backup_code"), backup["codeType"])

        val noTwoFactor = ReauthBodies.password("hunter2", null, useBackupCode = false)
        assertNull(noTwoFactor["code"])
        assertNull(noTwoFactor["codeType"])

        val email = ReauthBodies.emailCode(" 123456 ")
        assertEquals(JsonPrimitive("email_code"), email["method"])
        assertEquals(JsonPrimitive("123456"), email["code"])
    }

    // Retry once

    private fun challenge() = ReauthChallenge(listOf(ReauthMethod.Password, ReauthMethod.SignIn), message = "m")

    @Test
    fun confirmedPromptRetriesOnce() = runBlocking {
        var calls = 0
        var prompts = 0
        val gate = challenge()
        val value = ReauthRetry.run(confirm = { prompts++; true }) {
            calls++
            if (calls == 1) throw ApiException.ReauthRequired(gate)
            "ok"
        }
        assertEquals("ok", value)
        assertEquals(2, calls)
        assertEquals(1, prompts)
    }

    @Test
    fun declinedPromptDoesNotRetry() = runBlocking {
        var calls = 0
        val gate = challenge()
        try {
            ReauthRetry.run<String>(confirm = { false }) {
                calls++
                throw ApiException.ReauthRequired(gate)
            }
            fail("expected ReauthRequired")
        } catch (e: ApiException.ReauthRequired) {
            assertEquals(gate, e.challenge)
        }
        assertEquals(1, calls)
    }

    @Test
    fun secondGateIsThrownWithoutAnotherPrompt() = runBlocking {
        var calls = 0
        var prompts = 0
        try {
            ReauthRetry.run<String>(confirm = { prompts++; true }) {
                calls++
                throw ApiException.ReauthRequired(challenge())
            }
            fail("expected ReauthRequired")
        } catch (_: ApiException.ReauthRequired) {
            // expected
        }
        assertEquals("retried exactly once", 2, calls)
        assertEquals("never loops back to the prompt", 1, prompts)
    }

    @Test
    fun otherErrorsSkipThePrompt() = runBlocking {
        var prompts = 0
        try {
            ReauthRetry.run<String>(confirm = { prompts++; true }) {
                throw ApiException.Http(400, "Bad request")
            }
            fail("expected Http")
        } catch (e: ApiException.Http) {
            assertEquals(400, e.code)
        }
        assertEquals(0, prompts)
    }

    // Shared prompt

    @Test
    fun promptWithoutHostDeclinesImmediately() = runBlocking {
        val coordinator = ReauthCoordinator()
        assertFalse(coordinator.confirm(challenge()))
        assertNull(coordinator.prompt.value)
    }

    @Test
    fun onePromptAnswersEveryWaitingRequest() = runBlocking {
        val coordinator = ReauthCoordinator()
        val host = coordinator.newHostId()
        coordinator.register(host)
        assertEquals(host, coordinator.activeHost)

        val first = async { coordinator.confirm(challenge()) }
        val second = async { coordinator.confirm(challenge().copy(message = "other")) }
        repeat(100) { if (coordinator.waitingCount < 2) yield() }
        assertEquals(2, coordinator.waitingCount)
        val prompt = coordinator.prompt.value
        assertNotNull(prompt)
        assertEquals("the first challenge is the one shown", "m", prompt!!.challenge.message)
        coordinator.finish(true)
        assertEquals(listOf(true, true), awaitAll(first, second))
        assertNull(coordinator.prompt.value)
    }

    @Test
    fun removingTheLastHostCancelsThePrompt() = runBlocking {
        val coordinator = ReauthCoordinator()
        val host = coordinator.newHostId()
        coordinator.register(host)
        val answer = async { coordinator.confirm(challenge()) }
        repeat(100) { if (coordinator.waitingCount < 1) yield() }
        coordinator.unregister(host)
        assertFalse(answer.await())
        assertNull(coordinator.activeHost)
        assertNull(coordinator.prompt.value)
    }

    @Test
    fun innermostHostPresents() {
        val coordinator = ReauthCoordinator()
        val outer = coordinator.newHostId()
        val inner = coordinator.newHostId()
        coordinator.register(outer)
        coordinator.register(inner)
        assertEquals(inner, coordinator.activeHost)
        coordinator.unregister(inner)
        assertEquals(outer, coordinator.activeHost)
    }

    @Test
    fun cancelledWaiterClosesAnOrphanedPrompt() = runBlocking {
        val coordinator = ReauthCoordinator()
        coordinator.register(coordinator.newHostId())
        val waiting = async { coordinator.confirm(challenge()) }
        repeat(100) { if (coordinator.waitingCount < 1) yield() }
        assertNotNull(coordinator.prompt.value)
        waiting.cancel()
        waiting.join()
        assertEquals(0, coordinator.waitingCount)
        assertNull(coordinator.prompt.value)
    }
}

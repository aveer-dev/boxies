package co.inboxies.app.services

import androidx.credentials.exceptions.domerrors.InvalidStateError
import androidx.credentials.exceptions.domerrors.NotAllowedError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import co.inboxies.app.models.MeResponse
import co.inboxies.app.models.PasskeyRow
import co.inboxies.app.models.ResetPasswordResponse
import co.inboxies.app.models.TwoFactorChallenge
import co.inboxies.app.ui.settings.passkeyDetail
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import kotlin.coroutines.cancellation.CancellationException

/** Wire handling for passkey sign-in and the two-factor challenge (AVE-77, twin of iOS AVE-76). */
class PasskeysTwoFactorTest {
    private val json = ApiClient.shared.json

    // Two-factor challenge

    private val challengeBody = """
        {"error":"Enter the code from your authenticator app.","code":"TWO_FACTOR_REQUIRED",
         "twoFactorRequired":true,"twoFactorMethods":["totp","backup_code"],"twoFactorToken":"abc.def%2B"}
    """.trimIndent()

    @Test
    fun parsesTwoFactorChallengeFromPasswordSignIn() {
        val challenge = TwoFactorChallenge.parse(challengeBody)
        assertNotNull(challenge)
        assertEquals("abc.def%2B", challenge!!.token)
        assertEquals(listOf("totp", "backup_code"), challenge.methods)
    }

    @Test
    fun passwordSignIn401BecomesTwoFactorRequired() {
        val failure = ApiClient.shared.httpFailure(401, challengeBody, sentToken = null)
        assertTrue(failure is ApiException.TwoFactorRequired)
        assertEquals("abc.def%2B", (failure as ApiException.TwoFactorRequired).challenge.token)

        val wrongPassword = ApiClient.shared.httpFailure(401, """{"error":"Invalid email or password"}""", sentToken = null)
        assertTrue(wrongPassword is ApiException.Http)
        assertEquals("Invalid email or password", wrongPassword.message)
    }

    @Test
    fun ordinaryFailedSignInIsNotAChallenge() {
        assertNull(TwoFactorChallenge.parse("""{"error":"Invalid email or password"}"""))
        assertNull(TwoFactorChallenge.parse("""{"twoFactorRequired":true}"""))
        assertNull(TwoFactorChallenge.parse("""{"twoFactorRequired":false,"twoFactorToken":"t"}"""))
        assertNull(TwoFactorChallenge.parse("not json"))
    }

    @Test
    fun resetPasswordReplyCarriesChallengeOrSession() {
        val challengeReply = json.decodeFromString<ResetPasswordResponse>(
            """{"ok":true,"twoFactorRequired":true,"twoFactorToken":"t1","twoFactorMethods":["totp","backup_code"]}""",
        )
        assertEquals("t1", challengeReply.twoFactorChallenge?.token)
        assertEquals(listOf("totp", "backup_code"), challengeReply.twoFactorChallenge?.methods)
        assertNull(challengeReply.token)

        val sessionReply = json.decodeFromString<ResetPasswordResponse>(
            """{"ok":true,"token":"s1","expiresAt":"2026-11-01T00:00:00.000Z","email":"ada@inboxies.email","sub":"u","keys":[]}""",
        )
        assertNull(sessionReply.twoFactorChallenge)
        assertEquals("s1", sessionReply.token)
        assertEquals("ada@inboxies.email", sessionReply.email)

        val bare = json.decodeFromString<ResetPasswordResponse>("""{"ok":true}""")
        assertNull(bare.token)
        assertNull(bare.twoFactorChallenge)
    }

    @Test
    fun twoFactorVerifyErrors() {
        assertTrue(AuthStore.isExpiredTwoFactor(401, "This sign-in has expired. Sign in again."))
        assertFalse(AuthStore.isExpiredTwoFactor(401, "Invalid code"))
        assertEquals(
            "That code didn't work. Check your authenticator app and try again.",
            AuthStore.twoFactorErrorMessage(401, "Invalid code", useBackupCode = false),
        )
        assertEquals("That backup code didn't work.", AuthStore.twoFactorErrorMessage(401, "Invalid code", useBackupCode = true))
        assertEquals(
            "Too many wrong codes. Try again in 15 minutes.",
            AuthStore.twoFactorErrorMessage(429, "Too many wrong codes. Try again in 15 minutes.", useBackupCode = false),
        )
    }

    @Test
    fun meDecodesTwoFactorFlag() {
        assertEquals(true, json.decodeFromString<MeResponse>("""{"userId":"u","twoFactorEnabled":true}""").twoFactorEnabled)
        assertNull(json.decodeFromString<MeResponse>("""{"userId":"u"}""").twoFactorEnabled)
    }

    // Passkeys

    @Test
    fun readsPasskeyChallengeCookie() {
        val cookie = Passkeys.challengeCookie(
            listOf(
                "other=1; Path=/",
                "__Secure-better-auth.better-auth-passkey=tok123.sig%2Fx; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax",
            ),
        )
        assertEquals("__Secure-better-auth.better-auth-passkey=tok123.sig%2Fx", cookie)
        assertEquals(
            mapOf("Cookie" to "c=v", "Origin" to "https://inboxies.app"),
            Passkeys.ceremonyHeaders("c=v", "inboxies.app"),
        )
    }

    @Test
    fun noChallengeCookieMeansNoCeremony() {
        assertNull(Passkeys.challengeCookie(listOf("other=1; Path=/")))
        assertNull(Passkeys.challengeCookie(listOf("better-auth.better-auth-passkey=; Max-Age=0")))
        assertNull(Passkeys.challengeCookie(emptyList()))
    }

    @Test
    fun sessionTokenFromBodyElseSetAuthToken() {
        val reply = Json.parseToJsonElement("""{"session":{"token":"bodyToken"},"user":{"email":"a@b.c"}}""") as JsonObject
        assertEquals("bodyToken", Passkeys.sessionToken(reply))
        val noSession = Json.parseToJsonElement("""{"user":{"email":"a@b.c"}}""") as JsonObject
        assertNull(Passkeys.sessionToken(noSession))
        assertEquals("rawSessionToken", Passkeys.bearerToken("rawSessionToken.c2lnbmF0dXJl"))
        assertEquals("bare", Passkeys.bearerToken("bare"))
        assertNull(Passkeys.bearerToken(""))
        assertNull(Passkeys.bearerToken(null))
    }

    @Test
    fun friendlyPasskeyErrors() {
        val notFound = Passkeys.friendly(
            ApiClient.shared.httpFailure(401, """{"code":"PASSKEY_NOT_FOUND","message":"Passkey not found"}""", null),
            "x",
        )
        assertEquals("That passkey isn't registered with Inboxies. Sign in another way.", notFound.message)
        val stale = Passkeys.friendly(
            ApiClient.shared.httpFailure(403, """{"code":"SESSION_NOT_FRESH","message":"Session is not fresh"}""", null),
            "x",
        )
        assertTrue(stale.message!!.contains("sign out and sign in again"))
        assertTrue(Passkeys.friendly(ApiException.Http(429, "{}"), "x").message!!.contains("Too many"))
        assertEquals("fallback", Passkeys.friendly(ApiException.Http(500, "boom"), "fallback").message)
        val transport = ApiException.Transport(RuntimeException("offline"))
        assertTrue(Passkeys.friendly(transport, "x") === transport)
        val own = Passkeys.Failure("mine")
        assertTrue(Passkeys.friendly(own, "x") === own)
        val cancelled = CancellationException("scope left")
        assertTrue(Passkeys.friendly(cancelled, "x") === cancelled)
    }

    @Test
    fun excludedCredentialMeansAlreadyRegistered() {
        val existing = Passkeys.credentialFailure(CreatePublicKeyCredentialDomException(InvalidStateError(), "excluded"))
        assertEquals("This device already has a passkey for your account.", existing.message)
        val other = Passkeys.credentialFailure(CreatePublicKeyCredentialDomException(NotAllowedError(), "nope"))
        assertEquals("nope", other.message)
    }

    @Test
    fun passkeyRowDetail() {
        val synced = PasskeyRow("1", "Inboxies on Android", "2026-10-01T09:00:00.000Z", "multiDevice", true)
        val detail = passkeyDetail(synced, ZoneOffset.UTC)
        assertTrue(detail.startsWith("Added "))
        assertTrue(detail.endsWith(" · Synced"))
        assertEquals("This device only", passkeyDetail(PasskeyRow("2", deviceType = "singleDevice", backedUp = false)))
        assertEquals("Passkey", passkeyDetail(PasskeyRow("3")))
    }
}

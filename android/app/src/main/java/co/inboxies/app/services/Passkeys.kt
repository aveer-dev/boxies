package co.inboxies.app.services

import android.app.Activity
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.exceptions.domerrors.InvalidStateError
import androidx.credentials.exceptions.publickeycredential.CreatePublicKeyCredentialDomException
import androidx.credentials.exceptions.publickeycredential.GetPublicKeyCredentialDomException
import co.inboxies.app.models.PasskeyRow
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * Passkeys (WebAuthn) through Credential Manager against Better Auth's passkey plugin at
 * `/api/auth/passkey/` (Android twin of iOS `Passkeys.swift`).
 *
 * - The relying party is the web app's host (`rpId` / `rp.id` in the server's options,
 *   `inboxies.app` in production). That host must serve `/.well-known/assetlinks.json`
 *   naming this package + signing cert (`delegate_permission/common.get_login_creds`), and
 *   the Worker must accept the app's `android:apk-key-hash:` origin (`PASSKEY_EXTRA_ORIGINS`).
 * - The WebAuthn challenge rides in a short-lived signed cookie between the options call and
 *   the verify call. [ApiClient] keeps no cookies, so it's read from the first reply and sent
 *   back by hand with an `Origin` of `https://<rpID>` (Better Auth checks the origin of any
 *   POST that carries a cookie).
 * - Signing in with a passkey skips the two-factor step: the authenticator is the second factor.
 */
object Passkeys {
    data class SignIn(val token: String, val email: String?)

    /** The user dismissed the system sheet. Not an error to show. */
    class Cancelled : Exception("Cancelled.")

    class Failure(message: String) : Exception(message)

    const val SIGN_IN_FAILED = "Passkey sign-in failed. Try again or sign in another way."
    const val BAD_OPTIONS = "Passkeys aren't available right now. Sign in another way."
    const val ADD_FAILED = "Couldn't add the passkey."

    /** Default name for a passkey made here. */
    const val DEVICE_NAME = "Inboxies on Android"

    private val json = Json { ignoreUnknownKeys = true }

    // Sign in

    /** Shows the system passkey sheet and signs in with the passkey picked. */
    suspend fun signIn(activity: Activity): SignIn {
        val api = ApiClient.shared
        val (options, headers) = try {
            api.requestWithHeaders<JsonObject>("/api/auth/passkey/generate-authenticate-options", authed = false)
        } catch (e: Exception) {
            throw friendly(e, SIGN_IN_FAILED)
        }
        val rpId = options.string("rpId")
        val cookie = challengeCookie(headers.values("Set-Cookie"))
        if (rpId.isNullOrEmpty() || options.string("challenge").isNullOrEmpty() || cookie == null) {
            throw Failure(BAD_OPTIONS)
        }

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetPublicKeyCredentialOption(requestJson = options.toString()))
            .build()
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (e: GetCredentialException) {
            throw credentialFailure(e)
        }
        val assertion = (credential as? PublicKeyCredential)?.authenticationResponseJson
            ?: throw Failure(SIGN_IN_FAILED)
        val body = buildJsonObject { put("response", json.parseToJsonElement(assertion)) }

        try {
            val (session, verifyHeaders) = api.requestWithHeaders<JsonObject>(
                "/api/auth/passkey/verify-authentication",
                method = "POST",
                body = body,
                authed = false,
                headers = ceremonyHeaders(cookie, rpId),
            )
            val token = sessionToken(session) ?: bearerToken(verifyHeaders["set-auth-token"])
            if (token.isNullOrEmpty()) throw Failure(SIGN_IN_FAILED)
            return SignIn(token, (session["user"] as? JsonObject)?.string("email"))
        } catch (e: Exception) {
            throw friendly(e, SIGN_IN_FAILED)
        }
    }

    // Confirm it's you (signed in)

    const val REAUTH_FAILED = "That passkey couldn't confirm it's you. Try again or use another way."

    /**
     * Step-up re-auth with a passkey (`POST /api/v1/me/reauth`, AVE-113): the same ceremony
     * as sign-in, but the assertion goes to `/me/reauth` with the challenge cookie echoed
     * back, and no new session comes out of it.
     */
    suspend fun reauthenticate(activity: Activity) {
        val api = ApiClient.shared
        val (options, headers) = try {
            // Signed in, so the options list only this account's passkeys.
            api.requestWithHeaders<JsonObject>("/api/auth/passkey/generate-authenticate-options")
        } catch (e: Exception) {
            throw friendly(e, REAUTH_FAILED)
        }
        val rpId = options.string("rpId")
        val cookie = challengeCookie(headers.values("Set-Cookie"))
        if (rpId.isNullOrEmpty() || options.string("challenge").isNullOrEmpty() || cookie == null) {
            throw Failure(BAD_OPTIONS)
        }

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetPublicKeyCredentialOption(requestJson = options.toString()))
            .build()
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (e: GetCredentialException) {
            throw credentialFailure(e)
        }
        val assertion = (credential as? PublicKeyCredential)?.authenticationResponseJson
            ?: throw Failure(REAUTH_FAILED)
        try {
            api.request<ReauthResponse>(
                "/api/v1/me/reauth",
                method = "POST",
                body = ReauthBodies.passkey(json.parseToJsonElement(assertion)),
                headers = ceremonyHeaders(cookie, rpId),
            )
        } catch (e: ApiException.Http) {
            // The Worker's own sentence ("That passkey couldn't confirm it's you…", too many tries).
            val text = e.message.orEmpty()
            if (e.code != 429 && text.isNotBlank() && !text.startsWith("{")) throw Failure(text)
            throw friendly(e, REAUTH_FAILED)
        } catch (e: Exception) {
            throw friendly(e, REAUTH_FAILED)
        }
    }

    // Manage (signed in)

    /** Creates a passkey for the signed-in account (saved to the user's password manager). */
    suspend fun register(activity: Activity, name: String = DEVICE_NAME) {
        val api = ApiClient.shared
        val (options, headers) = try {
            api.requestWithHeaders<JsonObject>("/api/auth/passkey/generate-register-options")
        } catch (e: Exception) {
            throw friendly(e, ADD_FAILED)
        }
        val rpId = (options["rp"] as? JsonObject)?.string("id")
        val cookie = challengeCookie(headers.values("Set-Cookie"))
        if (rpId.isNullOrEmpty() || options.string("challenge").isNullOrEmpty() || cookie == null) {
            throw Failure(BAD_OPTIONS)
        }

        val response = try {
            CredentialManager.create(activity)
                .createCredential(activity, CreatePublicKeyCredentialRequest(requestJson = options.toString()))
        } catch (e: CreateCredentialException) {
            throw credentialFailure(e)
        }
        val registration = (response as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
            ?: throw Failure(ADD_FAILED)
        val body = buildJsonObject {
            put("name", name)
            put("response", json.parseToJsonElement(registration))
        }
        try {
            api.request<JsonObject>(
                "/api/auth/passkey/verify-registration",
                method = "POST",
                body = body,
                headers = ceremonyHeaders(cookie, rpId),
            )
        } catch (e: Exception) {
            throw friendly(e, ADD_FAILED)
        }
    }

    suspend fun list(): List<PasskeyRow> = try {
        ApiClient.shared.request("/api/auth/passkey/list-user-passkeys")
    } catch (e: Exception) {
        throw friendly(e, "Couldn't load passkeys.")
    }

    suspend fun delete(id: String) {
        try {
            ApiClient.shared.request<JsonObject>(
                "/api/auth/passkey/delete-passkey",
                method = "POST",
                body = buildJsonObject { put("id", id) },
            )
        } catch (e: Exception) {
            throw friendly(e, "Couldn't remove the passkey.")
        }
    }

    // Wire helpers

    /** The signed WebAuthn challenge cookie (`…better-auth-passkey`) as a `Cookie` pair. */
    fun challengeCookie(setCookieHeaders: List<String>): String? {
        for (header in setCookieHeaders) {
            val pair = header.substringBefore(';').trim()
            val name = pair.substringBefore('=', "").trim()
            val value = pair.substringAfter('=', "").trim()
            if (name.endsWith("passkey") && value.isNotEmpty()) return "$name=$value"
        }
        return null
    }

    fun ceremonyHeaders(cookie: String, rpId: String): Map<String, String> =
        mapOf("Cookie" to cookie, "Origin" to "https://$rpId")

    /** `session.token` from a Better Auth sign-in reply. */
    fun sessionToken(reply: JsonObject): String? =
        (reply["session"] as? JsonObject)?.string("token")?.takeIf { it.isNotEmpty() }

    /**
     * Better Auth's bearer plugin echoes the new session as `set-auth-token`
     * (`token.signature`); the API takes the bare token.
     */
    fun bearerToken(setAuthToken: String?): String? =
        setAuthToken?.takeIf { it.isNotEmpty() }?.substringBefore('.')?.takeIf { it.isNotEmpty() }

    /** Better Auth errors are `{ code, message }`; ours are `{ error }`. */
    fun friendly(error: Throwable, fallback: String): Exception {
        if (error is Failure) return error
        if (error is Cancelled) return error
        // The caller's scope went away mid-request: keep cancelling, don't report a failure.
        if (error is CancellationException) return error
        return when (error) {
            is ApiException.Http -> {
                if (error.code == 429) return Failure("Too many attempts. Wait a minute and try again.")
                val code = runCatching {
                    (Json.parseToJsonElement(error.message.orEmpty()) as? JsonObject)?.string("code")
                }.getOrNull()
                when (code) {
                    "PASSKEY_NOT_FOUND" -> Failure("That passkey isn't registered with Inboxies. Sign in another way.")
                    "SESSION_NOT_FRESH" -> Failure("For your security, sign out and sign in again, then add the passkey.")
                    "CHALLENGE_NOT_FOUND" -> Failure("That took too long. Try again.")
                    "PREVIOUSLY_REGISTERED" -> Failure("This device already has a passkey for your account.")
                    else -> Failure(fallback)
                }
            }
            is ApiException.Transport,
            is ApiException.SessionExpired,
            is ApiException.CloudflareAccess,
            // "Confirm it's you" was closed: the server's sentence says why nothing changed.
            is ApiException.ReauthRequired,
            -> error as Exception
            else -> Failure(fallback)
        }
    }

    /** Credential Manager failures before the server sees anything. */
    fun credentialFailure(e: Exception): Exception = when (e) {
        is GetCredentialCancellationException, is CreateCredentialCancellationException -> Cancelled()
        is NoCredentialException ->
            Failure("No passkey for Inboxies on this device. Sign in another way, then add one in Settings.")
        is CreatePublicKeyCredentialDomException ->
            // `excludeCredentials` matched a passkey the password manager already holds.
            if (e.domError is InvalidStateError) {
                Failure("This device already has a passkey for your account.")
            } else {
                domFailure(e.message)
            }
        is GetPublicKeyCredentialDomException -> domFailure(e.message)
        else -> Failure(e.message?.takeIf { it.isNotBlank() } ?: "Passkeys aren't available right now.")
    }

    /** An app the domain's assetlinks.json doesn't name fails RP validation. */
    private fun domFailure(message: String?): Failure {
        val text = message.orEmpty()
        return if (text.contains("cannot be validated", ignoreCase = true) ||
            text.contains("asset", ignoreCase = true) ||
            text.contains("relying party", ignoreCase = true)
        ) {
            Failure("Passkeys aren't set up for this app yet. Sign in another way.")
        } else {
            Failure(text.ifBlank { "Passkeys aren't available right now." })
        }
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}

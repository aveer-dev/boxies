package co.inboxies.app.services

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlin.coroutines.cancellation.CancellationException

/*
 * Step-up re-authentication (AVE-113 on the Worker, AVE-171 here; twin of iOS `Reauth.swift`).
 *
 * Sensitive account changes (recovery email, sign-in methods, passkeys, the password with
 * 2FA on, deleting the account) answer 403
 * `{ code: "reauth_required", methods, twoFactor, emailCodeTo, maxAgeSeconds }` unless this
 * session signed in or re-authenticated in the last 5 minutes.
 *
 * [ApiClient] turns that 403 into [ApiException.ReauthRequired], asks [ReauthCoordinator] to
 * show the "Confirm it's you" sheet, and retries the original request once when the user
 * confirmed ([ReauthRetry]). Same flow as the web `ReauthDialog` / `requestReauth`.
 */

enum class ReauthMethod(val wire: String) {
    /** The account password, plus an authenticator or backup code when `twoFactor`. */
    Password("password"),

    /** An assertion from one of the user's passkeys. */
    Passkey("passkey"),

    /** A 6-digit code mailed to `emailCodeTo` (accounts without a password). */
    EmailCode("email_code"),

    /** Sign out and sign in again; a new session is fresh for 5 minutes. */
    SignIn("sign_in"),
    ;

    companion object {
        fun fromWire(raw: String): ReauthMethod? = entries.firstOrNull { it.wire == raw }
    }
}

/** The `reauth_required` 403 body. */
data class ReauthChallenge(
    /** What the account can confirm with, in server order. [ReauthMethod.SignIn] is always offered. */
    val methods: List<ReauthMethod>,
    /** A password re-auth also needs a TOTP or backup code. */
    val twoFactor: Boolean = false,
    /** Masked address an emailed code goes to (`a•••p@gmail.com`). */
    val emailCodeTo: String? = null,
    /** How long the confirmation lasts. */
    val maxAgeSeconds: Int = 300,
    /** The server's sentence, written for builds without this sheet ("sign out and back in"). */
    val message: String = "",
) {
    /** Methods with an inline form, i.e. everything but [ReauthMethod.SignIn]. */
    val usableMethods: List<ReauthMethod>
        get() = methods.filter { it != ReauthMethod.SignIn }

    companion object {
        const val CODE = "reauth_required"

        /** The challenge in an error reply, or null for any other error. */
        fun parse(statusCode: Int, body: String): ReauthChallenge? {
            if (statusCode != 403) return null
            val obj = runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return null
            if ((obj["code"] as? JsonPrimitive)?.contentOrNull != CODE) return null
            val methods = mutableListOf<ReauthMethod>()
            (obj["methods"] as? JsonArray)?.forEach { raw ->
                val method = (raw as? JsonPrimitive)?.takeIf { it.isString }?.content?.let(ReauthMethod::fromWire)
                if (method != null && method !in methods) methods += method
            }
            if (ReauthMethod.SignIn !in methods) methods += ReauthMethod.SignIn
            val emailCodeTo = (obj["emailCodeTo"] as? JsonPrimitive)
                ?.takeIf { it.isString }
                ?.content
                ?.takeIf { it.isNotEmpty() }
            // An emailed code needs somewhere to go.
            if (emailCodeTo == null) methods -= ReauthMethod.EmailCode
            fun string(key: String) = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
            return ReauthChallenge(
                methods = methods,
                twoFactor = (obj["twoFactor"] as? JsonPrimitive)?.booleanOrNull == true,
                emailCodeTo = emailCodeTo,
                maxAgeSeconds = (obj["maxAgeSeconds"] as? JsonPrimitive)?.intOrNull ?: 300,
                message = string("error") ?: string("message") ?: "",
            )
        }
    }
}

/** `POST /api/v1/me/reauth` → `{ ok, freshUntil }`. */
@Serializable
data class ReauthResponse(val ok: Boolean? = null, val freshUntil: String? = null)

/** `POST /api/v1/me/reauth/email-code` → `{ ok, sentTo, devCode? }`. */
@Serializable
data class ReauthEmailCodeResponse(
    val ok: Boolean? = null,
    val sentTo: String? = null,
    /** Local dev Worker only. */
    val devCode: String? = null,
)

/** `POST /api/v1/me/reauth` bodies (`workers/routes/reauth.ts`). */
internal object ReauthBodies {
    fun password(password: String, code: String?, useBackupCode: Boolean): JsonObject = buildJsonObject {
        put("method", ReauthMethod.Password.wire)
        put("password", password)
        if (code != null) {
            put("code", code.filterNot { it.isWhitespace() })
            put("codeType", if (useBackupCode) "backup_code" else "totp")
        }
    }

    fun emailCode(code: String): JsonObject = buildJsonObject {
        put("method", ReauthMethod.EmailCode.wire)
        put("code", code.trim())
    }

    fun passkey(assertion: JsonElement): JsonObject = buildJsonObject {
        put("method", ReauthMethod.Passkey.wire)
        put("response", assertion)
    }
}

object ReauthRetry {
    /**
     * Runs [operation]; on [ApiException.ReauthRequired], asks [confirm] and, when the user
     * confirmed, runs it exactly once more. A second `ReauthRequired` (or a declined prompt)
     * is thrown as is, so it never loops.
     */
    suspend fun <T> run(
        confirm: suspend (ReauthChallenge) -> Boolean,
        operation: suspend () -> T,
    ): T = try {
        operation()
    } catch (gate: ApiException.ReauthRequired) {
        if (!confirm(gate.challenge)) throw gate
        operation()
    }
}

/**
 * Owns the one "Confirm it's you" prompt. `ReauthPromptHost` (on the settings sheet)
 * presents it; requests that hit the gate wait here.
 */
class ReauthCoordinator {
    /** The prompt on screen. [id] changes per prompt so the sheet starts clean each time. */
    data class Prompt(val challenge: ReauthChallenge, val id: Long)

    private val lock = Any()
    private val _prompt = MutableStateFlow<Prompt?>(null)
    private val _hosts = MutableStateFlow<List<Long>>(emptyList())
    private val waiters = mutableListOf<CompletableDeferred<Boolean>>()
    private var nextId = 1L

    /** The prompt on screen, if any. */
    val prompt: StateFlow<Prompt?> = _prompt.asStateFlow()

    /** Mounted hosts, innermost last. Only the last one presents. */
    val hosts: StateFlow<List<Long>> = _hosts.asStateFlow()

    val activeHost: Long? get() = _hosts.value.lastOrNull()

    /** Requests waiting on the prompt. */
    val waitingCount: Int get() = synchronized(lock) { waiters.size }

    /** A fresh id for a host composable. */
    fun newHostId(): Long = synchronized(lock) { nextId++ }

    /**
     * Shows the prompt and returns true once the session is fresh again, false when the
     * user closed it (or nothing on screen can show it).
     */
    suspend fun confirm(challenge: ReauthChallenge): Boolean {
        val waiter = CompletableDeferred<Boolean>()
        synchronized(lock) {
            if (_hosts.value.isEmpty()) return false
            // Several requests may hit the gate at once: one prompt answers them all.
            if (_prompt.value == null) _prompt.value = Prompt(challenge, nextId++)
            waiters += waiter
        }
        return try {
            waiter.await()
        } catch (e: CancellationException) {
            synchronized(lock) {
                waiters -= waiter
                // Nobody is waiting on the answer any more: don't leave the sheet up.
                if (waiters.isEmpty()) _prompt.value = null
            }
            throw e
        }
    }

    /** Closes the prompt; [ok] says whether the session is fresh now. */
    fun finish(ok: Boolean) {
        val pending = synchronized(lock) {
            val list = waiters.toList()
            waiters.clear()
            _prompt.value = null
            list
        }
        pending.forEach { it.complete(ok) }
    }

    fun register(host: Long) = synchronized(lock) {
        _hosts.value = _hosts.value.filter { it != host } + host
    }

    fun unregister(host: Long) {
        val orphaned = synchronized(lock) {
            _hosts.value = _hosts.value.filter { it != host }
            _hosts.value.isEmpty() && _prompt.value != null
        }
        // Its sheet went away with it: nobody can answer the prompt now.
        if (orphaned) finish(false)
    }

    /** DEBUG previews: open the prompt without a request behind it. */
    fun presentForPreview(challenge: ReauthChallenge) = synchronized(lock) {
        _prompt.value = Prompt(challenge, nextId++)
    }

    companion object {
        val shared = ReauthCoordinator()
    }
}

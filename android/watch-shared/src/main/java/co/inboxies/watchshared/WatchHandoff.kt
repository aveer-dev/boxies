package co.inboxies.watchshared

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URI

/**
 * The Wearable Data Layer contract between the phone app (`:app`) and the Wear OS
 * app (`:wear`) (AVE-145, docs/watch-companion-plan.md phase 2). Twin of the
 * iOS `WatchHandoff` (AVE-144), which does the same over WatchConnectivity.
 *
 * - The watch asks with [REQUEST_SESSION_PATH] (`MessageClient.sendRequest`, a
 *   request with a reply). The phone mints a `watch`-scoped session
 *   (`POST /api/v1/me/extension-session { client: "wearos" }`) and replies with a
 *   [WatchSessionReply]. The watch asks on its own whenever it has no session
 *   (first launch, a 401), with retries; `manual` marks a Connect tap, which is
 *   the only request that lifts a revoke made on the phone.
 * - The phone may also send one [SESSION_PATH] grant after sign-in, and a
 *   [CLEAR_PATH] message to wipe the watch (sign-out, or the watch was signed out
 *   from Devices & sessions).
 * - The [CONTEXT_PATH] DataItem carries only non-secret state: signed in or not,
 *   the active mailbox and the API origin. Tokens never go in a DataItem, because
 *   DataItems persist and sync. Messages aren't queued while the watch is out of
 *   range, so "signed out" in the context is also the wipe a far-away watch gets
 *   when it reconnects ([WatchPhoneContext.wipes]).
 *
 * The Data Layer only connects apps with the same package name and signing key,
 * so `:wear` uses the phone's applicationId (`co.inboxies.app`). The phone's own
 * full session is never part of any payload.
 */
object WatchHandoff {
    /** Declared by the phone app (`res/values/wear.xml`); the watch finds the phone by it. */
    const val PHONE_CAPABILITY = "inboxies_phone"

    /** Declared by the Wear OS app; the phone finds watches that have it installed. */
    const val WEAR_CAPABILITY = "inboxies_wear"

    const val PATH_PREFIX = "/inboxies"

    /** Watch → phone request: "mint me a watch session". Reply: [WatchSessionReply]. */
    const val REQUEST_SESSION_PATH = "$PATH_PREFIX/request-session"

    /** Phone → watch message: a [WatchSessionGrant] (the handoff after sign-in). */
    const val SESSION_PATH = "$PATH_PREFIX/session"

    /** Phone → watch message: wipe the token. No payload. */
    const val CLEAR_PATH = "$PATH_PREFIX/clear"

    /** DataItem path for [WatchPhoneContext]. */
    const val CONTEXT_PATH = "$PATH_PREFIX/context"

    internal object Kind {
        const val REQUEST = "requestSession"
        const val SESSION = "session"
        const val SIGNED_OUT = "signedOut"
        const val UNAVAILABLE = "unavailable"
        const val REVOKED = "revoked"
        const val CONTEXT = "context"
    }

    internal val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }

    /** One wire shape for every payload; `kind` says which fields apply. */
    @Serializable
    internal data class Wire(
        val kind: String,
        val manual: Boolean? = null,
        val token: String? = null,
        val apiBaseURL: String? = null,
        val mailboxId: String? = null,
        val issuedAt: Long? = null,
        val signedIn: Boolean? = null,
        val updatedAt: Long? = null,
    )

    internal fun encode(wire: Wire): ByteArray = json.encodeToString(Wire.serializer(), wire).toByteArray(Charsets.UTF_8)

    internal fun decode(bytes: ByteArray?): Wire? {
        if (bytes == null || bytes.isEmpty()) return null
        return runCatching { json.decodeFromString(Wire.serializer(), bytes.toString(Charsets.UTF_8)) }.getOrNull()
    }

    /** The [REQUEST_SESSION_PATH] payload. `manual`: the person tapped Connect. */
    fun encodeRequest(manual: Boolean): ByteArray = encode(Wire(kind = Kind.REQUEST, manual = manual))

    /** True only for a well-formed request that says it's a Connect tap. */
    fun isManualRequest(bytes: ByteArray?): Boolean {
        val wire = decode(bytes) ?: return false
        return wire.kind == Kind.REQUEST && wire.manual == true
    }

    /**
     * Only https origins, plus plain http to a local dev server when [allowLocalHttp]
     * (DEBUG builds; `10.0.2.2` is the emulator's host). Returns the origin without a
     * trailing slash, or null.
     */
    fun acceptedOrigin(raw: String?, allowLocalHttp: Boolean): String? {
        val trimmed = raw?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: return null
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        if (uri.userInfo != null) return null
        if (scheme == "https") return trimmed
        if (allowLocalHttp && scheme == "http" && host in LOCAL_HOSTS) return trimmed
        return null
    }

    private val LOCAL_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")
}

/** A `watch`-scoped session for the watch, plus where to use it. */
data class WatchSessionGrant(
    val token: String,
    val apiBaseUrl: String,
    val mailboxId: String?,
    /** Phone clock, epoch ms: lets a later "signed out" context wipe it, but not an older one. */
    val issuedAt: Long,
) {
    fun encode(): ByteArray = WatchHandoff.encode(wire())

    internal fun wire() = WatchHandoff.Wire(
        kind = WatchHandoff.Kind.SESSION,
        token = token,
        apiBaseURL = apiBaseUrl,
        mailboxId = mailboxId?.takeIf { it.isNotEmpty() },
        issuedAt = issuedAt,
    )

    /** Never print the token. */
    override fun toString(): String = "WatchSessionGrant(apiBaseUrl=$apiBaseUrl, mailboxId=$mailboxId, issuedAt=$issuedAt)"

    companion object {
        fun decode(bytes: ByteArray?, allowLocalHttp: Boolean): WatchSessionGrant? =
            WatchHandoff.decode(bytes)?.let { from(it, allowLocalHttp) }

        internal fun from(wire: WatchHandoff.Wire, allowLocalHttp: Boolean): WatchSessionGrant? {
            if (wire.kind != WatchHandoff.Kind.SESSION) return null
            val token = wire.token?.takeIf { it.isNotBlank() } ?: return null
            val origin = WatchHandoff.acceptedOrigin(wire.apiBaseURL, allowLocalHttp) ?: return null
            return WatchSessionGrant(
                token = token,
                apiBaseUrl = origin,
                mailboxId = wire.mailboxId?.takeIf { it.isNotBlank() },
                issuedAt = wire.issuedAt ?: 0L,
            )
        }
    }
}

/** The phone's answer to [WatchHandoff.REQUEST_SESSION_PATH]. */
sealed interface WatchSessionReply {
    data class Granted(val grant: WatchSessionGrant) : WatchSessionReply

    /** No signed-in session on the phone. Retrying won't help. */
    data object SignedOut : WatchSessionReply

    /**
     * The watch was signed out from this phone (Devices & sessions) and the request
     * wasn't a Connect tap. Retrying won't help.
     */
    data object Revoked : WatchSessionReply

    /** The phone couldn't mint one right now (offline, server error). */
    data object Unavailable : WatchSessionReply

    fun encode(): ByteArray = when (this) {
        is Granted -> grant.encode()
        SignedOut -> WatchHandoff.encode(WatchHandoff.Wire(kind = WatchHandoff.Kind.SIGNED_OUT))
        Revoked -> WatchHandoff.encode(WatchHandoff.Wire(kind = WatchHandoff.Kind.REVOKED))
        Unavailable -> WatchHandoff.encode(WatchHandoff.Wire(kind = WatchHandoff.Kind.UNAVAILABLE))
    }

    companion object {
        /** Anything unreadable (or a grant with a bad origin) is [Unavailable]. */
        fun decode(bytes: ByteArray?, allowLocalHttp: Boolean): WatchSessionReply {
            val wire = WatchHandoff.decode(bytes) ?: return Unavailable
            return when (wire.kind) {
                WatchHandoff.Kind.SESSION ->
                    WatchSessionGrant.from(wire, allowLocalHttp)?.let { Granted(it) } ?: Unavailable
                WatchHandoff.Kind.SIGNED_OUT -> SignedOut
                WatchHandoff.Kind.REVOKED -> Revoked
                else -> Unavailable
            }
        }
    }
}

/** Non-secret phone state, kept in the [WatchHandoff.CONTEXT_PATH] DataItem. */
data class WatchPhoneContext(
    val signedIn: Boolean,
    val mailboxId: String?,
    val apiBaseUrl: String?,
    /** Phone clock, epoch ms. */
    val updatedAt: Long,
) {
    fun encode(): ByteArray = WatchHandoff.encode(
        WatchHandoff.Wire(
            kind = WatchHandoff.Kind.CONTEXT,
            signedIn = signedIn,
            mailboxId = mailboxId?.takeIf { it.isNotEmpty() },
            apiBaseURL = apiBaseUrl,
            updatedAt = updatedAt,
        ),
    )

    /**
     * True when this context should wipe a watch holding a grant issued at
     * [grantIssuedAt]: the phone signed out after (or without) that grant. A stale
     * "signed out" synced late never wipes a newer token.
     */
    fun wipes(grantIssuedAt: Long?): Boolean =
        !signedIn && (grantIssuedAt == null || updatedAt >= grantIssuedAt)

    companion object {
        fun decode(bytes: ByteArray?, allowLocalHttp: Boolean): WatchPhoneContext? {
            val wire = WatchHandoff.decode(bytes) ?: return null
            if (wire.kind != WatchHandoff.Kind.CONTEXT) return null
            val signedIn = wire.signedIn ?: return null
            return WatchPhoneContext(
                signedIn = signedIn,
                mailboxId = wire.mailboxId?.takeIf { it.isNotBlank() },
                apiBaseUrl = WatchHandoff.acceptedOrigin(wire.apiBaseURL, allowLocalHttp),
                updatedAt = wire.updatedAt ?: 0L,
            )
        }
    }
}

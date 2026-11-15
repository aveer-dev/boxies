package co.inboxies.wear.session

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** What the watch keeps between launches. Only [token] is a secret. */
interface WatchSessionStorage {
    /** The `watch`-scoped session token, or null. */
    val token: String?

    /** When the phone issued [token] (phone clock), for [co.inboxies.watchshared.WatchPhoneContext.wipes]. */
    val grantIssuedAt: Long?

    val apiBaseUrl: String?
    val mailboxId: String?

    fun saveGrant(token: String, issuedAt: Long, apiBaseUrl: String)

    fun saveApiBaseUrl(url: String)

    fun saveMailboxId(id: String?)

    /** Drops the token (and its issue time). The origin and mailbox hint stay. */
    fun clearToken()
}

/**
 * [WatchSessionStorage] on the watch: the token in EncryptedSharedPreferences
 * (Keystore-backed, like the phone's `AuthStore`), the rest in plain prefs. If
 * encrypted storage can't be opened even after a reset, the token lives in memory
 * only and the watch asks the phone again on the next launch.
 */
class WatchSessionPrefs(context: Context) : WatchSessionStorage {
    private val app = context.applicationContext
    private val secure: SharedPreferences? = openSecure(app)
    private val plain: SharedPreferences = app.getSharedPreferences(PLAIN_PREFS, Context.MODE_PRIVATE)

    @Volatile
    private var memoryToken: String? = null

    override val token: String?
        get() = secure?.getString(TOKEN_KEY, null)?.takeIf { it.isNotEmpty() } ?: memoryToken

    override val grantIssuedAt: Long?
        get() = plain.getLong(ISSUED_AT_KEY, -1L).takeIf { it >= 0 }

    override val apiBaseUrl: String? get() = plain.getString(API_BASE_KEY, null)

    override val mailboxId: String? get() = plain.getString(MAILBOX_KEY, null)

    override fun saveGrant(token: String, issuedAt: Long, apiBaseUrl: String) {
        val prefs = secure
        if (prefs == null) {
            memoryToken = token
        } else {
            prefs.edit(commit = true) { putString(TOKEN_KEY, token) }
        }
        plain.edit(commit = true) {
            putLong(ISSUED_AT_KEY, issuedAt)
            putString(API_BASE_KEY, apiBaseUrl)
        }
    }

    override fun saveApiBaseUrl(url: String) {
        plain.edit { putString(API_BASE_KEY, url) }
    }

    override fun saveMailboxId(id: String?) {
        plain.edit { if (id == null) remove(MAILBOX_KEY) else putString(MAILBOX_KEY, id) }
    }

    override fun clearToken() {
        memoryToken = null
        // commit: a wipe must be on disk before the process can be killed.
        secure?.edit(commit = true) { remove(TOKEN_KEY) }
        plain.edit(commit = true) { remove(ISSUED_AT_KEY) }
    }

    private companion object {
        const val TAG = "WatchSessionPrefs"
        const val SECURE_PREFS = "inboxies_watch_session"
        const val PLAIN_PREFS = "inboxies_watch"
        const val TOKEN_KEY = "watchSessionToken"
        const val ISSUED_AT_KEY = "watchSessionIssuedAt"
        const val API_BASE_KEY = "watchApiBaseURL"
        const val MAILBOX_KEY = "watchActiveMailboxId"

        fun openSecure(context: Context): SharedPreferences? {
            runCatching { return create(context) }.onFailure { Log.w(TAG, "Encrypted prefs unavailable; resetting", it) }
            // The token is only a cache of what the phone can hand over again: start over.
            runCatching { context.deleteSharedPreferences(SECURE_PREFS) }
            return runCatching { create(context) }
                .onFailure { Log.e(TAG, "Encrypted prefs unavailable; token is memory-only", it) }
                .getOrNull()
        }

        fun create(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            return EncryptedSharedPreferences.create(
                context,
                SECURE_PREFS,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}

/** In-memory storage: DEBUG previews and unit tests. */
class MemoryWatchSessionStorage(
    override var token: String? = null,
    override var grantIssuedAt: Long? = null,
    override var apiBaseUrl: String? = null,
    override var mailboxId: String? = null,
) : WatchSessionStorage {
    override fun saveGrant(token: String, issuedAt: Long, apiBaseUrl: String) {
        this.token = token
        this.grantIssuedAt = issuedAt
        this.apiBaseUrl = apiBaseUrl
    }

    override fun saveApiBaseUrl(url: String) {
        apiBaseUrl = url
    }

    override fun saveMailboxId(id: String?) {
        mailboxId = id
    }

    override fun clearToken() {
        token = null
        grantIssuedAt = null
    }
}

package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.ForgotPasswordResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * Session store — EncryptedSharedPreferences for the auth token. The token is never
 * written in plaintext: if encrypted storage can't be opened even after a reset, the
 * session lives in memory only and the user signs in again on the next launch.
 */
class AuthStore(context: Context) {
    /** Null when encrypted storage is unavailable (memory-only session). */
    private val prefs: SharedPreferences? = SecureSessionStorage.open(context.applicationContext)

    /** Memory-only session, used when [prefs] is null. */
    private var memoryToken: String? = null
    private var memoryEmail: String? = null

    init {
        migrateLegacyPlaintextSession(context.applicationContext)
    }

    private val _token = MutableStateFlow(storedToken())
    val token: StateFlow<String?> = _token.asStateFlow()

    private val _userEmail = MutableStateFlow(storedEmail())
    val userEmail: StateFlow<String?> = _userEmail.asStateFlow()

    private val _isBusy = MutableStateFlow(false)
    val isBusy: StateFlow<Boolean> = _isBusy.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    val isAuthenticated: Boolean
        get() = !_token.value.isNullOrEmpty()

    fun currentToken(): String? = _token.value

    suspend fun signInWithGoogle(idToken: String, email: String? = null) {
        _isBusy.value = true
        _errorMessage.value = null
        try {
            val response = withContext(Dispatchers.IO) {
                ApiClient.shared.authGoogle(idToken)
            }
            persist(response.token, response.user.email ?: email)
        } catch (e: Exception) {
            _errorMessage.value = e.message
        } finally {
            _isBusy.value = false
        }
    }

    /** Local-dev shortcut when Google Sign-In isn't configured against a local Worker. */
    suspend fun signInDev(email: String = "dev@example.com") {
        if (!AppConfig.isLocalDevelopmentAPI) {
            _errorMessage.value =
                "Dev login only works against a local Worker (http://10.0.2.2:5173). Use Google Sign-In for production."
            return
        }
        _isBusy.value = true
        _errorMessage.value = null
        try {
            val response = withContext(Dispatchers.IO) {
                ApiClient.shared.authDev(email)
            }
            persist(response.token, response.user.email ?: email)
        } catch (e: Exception) {
            _errorMessage.value = e.message
        } finally {
            _isBusy.value = false
        }
    }

    suspend fun signInWithPassword(email: String, password: String) {
        _isBusy.value = true
        _errorMessage.value = null
        try {
            val response = withContext(Dispatchers.IO) {
                ApiClient.shared.passwordLogin(email, password)
            }
            persist(response.token, response.email ?: email)
        } catch (e: Exception) {
            _errorMessage.value = e.message
        } finally {
            _isBusy.value = false
        }
    }

    suspend fun forgotPassword(email: String): ForgotPasswordResponse {
        _isBusy.value = true
        _errorMessage.value = null
        return try {
            withContext(Dispatchers.IO) {
                ApiClient.shared.forgotPassword(email)
            }
        } catch (e: Exception) {
            _errorMessage.value = e.message
            throw e
        } finally {
            _isBusy.value = false
        }
    }

    suspend fun resetPassword(token: String? = null, email: String? = null, code: String? = null, newPassword: String) {
        _isBusy.value = true
        _errorMessage.value = null
        try {
            val response = withContext(Dispatchers.IO) {
                ApiClient.shared.resetPassword(token, email, code, newPassword)
            }
            persist(response.token, response.email)
        } catch (e: Exception) {
            _errorMessage.value = e.message
            throw e
        } finally {
            _isBusy.value = false
        }
    }

    fun applySession(token: String, email: String?) {
        persist(token, email)
    }

    /**
     * In-memory session for DEBUG emulator previews. Does not write EncryptedSharedPreferences,
     * so a preview launch cannot clobber a real signed-in session on disk.
     */
    fun applyEphemeralSession(token: String, email: String?) {
        _token.value = token
        _userEmail.value = email
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    /** Re-read session from disk — undoes a DEBUG [applyEphemeralSession] after a preview launch. */
    fun resyncFromStorage() {
        _token.value = storedToken()
        _userEmail.value = storedEmail()
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    fun signOut() {
        _token.value = null
        _userEmail.value = null
        clearStoredSession()
    }

    fun clearError() {
        _errorMessage.value = null
    }

    fun setError(message: String?) {
        _errorMessage.value = message
    }

    private fun persist(token: String, email: String?) {
        _token.value = token
        _userEmail.value = email
        writeStoredSession(token, email)
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    private fun storedToken(): String? = prefs?.getString(TOKEN_KEY, null) ?: memoryToken

    private fun storedEmail(): String? = prefs?.getString(EMAIL_KEY, null) ?: memoryEmail

    private fun writeStoredSession(token: String, email: String?) {
        val secure = prefs
        if (secure == null) {
            memoryToken = token
            if (email != null) memoryEmail = email
            return
        }
        secure.edit {
            putString(TOKEN_KEY, token)
            if (email != null) putString(EMAIL_KEY, email)
        }
    }

    private fun clearStoredSession() {
        memoryToken = null
        memoryEmail = null
        prefs?.edit {
            remove(TOKEN_KEY)
            remove(EMAIL_KEY)
        }
    }

    /**
     * Older builds fell back to a plaintext prefs file when encryption failed. Move any
     * session found there into encrypted storage (or memory, if that's still unavailable)
     * and delete the file either way.
     */
    private fun migrateLegacyPlaintextSession(context: Context) {
        runCatching {
            val legacy = context.getSharedPreferences(LEGACY_PLAINTEXT_PREFS, Context.MODE_PRIVATE)
            val legacyToken = legacy.getString(TOKEN_KEY, null)
            if (!legacyToken.isNullOrEmpty() && storedToken().isNullOrEmpty()) {
                writeStoredSession(legacyToken, legacy.getString(EMAIL_KEY, null))
            }
            legacy.edit(commit = true) { clear() }
            context.deleteSharedPreferences(LEGACY_PLAINTEXT_PREFS)
        }.onFailure { Log.w(TAG, "Couldn't clear legacy session prefs", it) }
    }

    init {
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    companion object {
        private const val TAG = "AuthStore"
        private const val TOKEN_KEY = "mobileSessionToken"
        private const val EMAIL_KEY = "mobileUserEmail"
        private const val LEGACY_PLAINTEXT_PREFS = "inboxies_session_fallback"
    }
}

/** Opens the encrypted session prefs, recovering once from a corrupted keyset / master key. */
internal object SecureSessionStorage {
    private const val TAG = "SecureSessionStorage"
    const val PREFS_NAME = "inboxies_secure_session"

    fun open(context: Context): SharedPreferences? {
        return try {
            create(context)
        } catch (first: Exception) {
            // Typically a keyset the Keystore can no longer decrypt (restore to a new
            // device, Keystore reset). The session is unrecoverable anyway: start over.
            Log.w(TAG, "Encrypted session prefs unreadable; resetting", first)
            runCatching { context.deleteSharedPreferences(PREFS_NAME) }
            runCatching {
                java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                    .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            }
            try {
                create(context)
            } catch (second: Exception) {
                Log.e(TAG, "Encrypted session prefs unavailable; session is memory-only", second)
                null
            }
        }
    }

    private fun create(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }
}

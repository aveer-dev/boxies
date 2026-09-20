package co.inboxies.app.services

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import co.inboxies.app.config.AppConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/** Session store — EncryptedSharedPreferences for the auth token. */
class AuthStore(context: Context) {
    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            "inboxies_secure_session",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (_: Exception) {
        context.applicationContext.getSharedPreferences("inboxies_session_fallback", Context.MODE_PRIVATE)
    }

    private val _token = MutableStateFlow(prefs.getString(TOKEN_KEY, null))
    val token: StateFlow<String?> = _token.asStateFlow()

    private val _userEmail = MutableStateFlow(prefs.getString(EMAIL_KEY, null))
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
        _token.value = prefs.getString(TOKEN_KEY, null)
        _userEmail.value = prefs.getString(EMAIL_KEY, null)
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    fun signOut() {
        _token.value = null
        _userEmail.value = null
        prefs.edit {
            remove(TOKEN_KEY)
            remove(EMAIL_KEY)
        }
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
        prefs.edit {
            putString(TOKEN_KEY, token)
            if (email != null) putString(EMAIL_KEY, email)
        }
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    init {
        ApiClient.shared.authTokenProvider = { _token.value }
    }

    companion object {
        private const val TOKEN_KEY = "mobileSessionToken"
        private const val EMAIL_KEY = "mobileUserEmail"
    }
}

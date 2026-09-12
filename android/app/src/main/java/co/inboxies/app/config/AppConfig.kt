package co.inboxies.app.config

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import co.inboxies.app.BuildConfig
import java.net.URI

/**
 * Runtime configuration. Mirrors iOS `AppConfig`.
 * Debug default: emulator loopback to host Vite (`10.0.2.2:5173`).
 * Release default: https://inboxies.email. Editable on the sign-in screen.
 */
object AppConfig {
    const val PREFS_NAME = "inboxies_config"
    private const val KEY_API_BASE = "apiBaseURL"
    const val AGENT_PATH_PREFIX = "/agents/email-agent"
    val agentPathPrefix: String get() = AGENT_PATH_PREFIX
    const val PACKAGE_ID = "co.inboxies.app"

    fun wsBaseURL(context: Context? = null): String {
        if (context != null) init(context)
        val http = apiBaseURL
        return when {
            http.startsWith("https://") -> "wss://" + http.removePrefix("https://")
            http.startsWith("http://") -> "ws://" + http.removePrefix("http://")
            else -> http
        }
    }

    @Volatile
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        if (prefs == null) {
            prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
    }

    var apiBaseURL: String
        get() {
            val override = prefs?.getString(KEY_API_BASE, null)
            val parsed = override?.let { parseAPIBaseURL(it) }
            return parsed ?: BuildConfig.DEFAULT_API_BASE
        }
        set(value) {
            prefs?.edit { putString(KEY_API_BASE, value) }
        }

    val isLocalDevelopmentAPI: Boolean
        get() {
            val host = runCatching { URI(apiBaseURL).host?.lowercase() }.getOrNull() ?: return false
            return host == "localhost" ||
                host == "127.0.0.1" ||
                host == "::1" ||
                host == "10.0.2.2"
        }

    /** Accepts a full origin or bare domain; host-only strings get https:// (or http:// for local). */
    fun parseAPIBaseURL(raw: String): String? {
        var trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null

        if (!hasHttpScheme(trimmed)) {
            val hostPart = trimmed.split('/', limit = 2).first()
            val isLocal =
                hostPart.startsWith("localhost") ||
                    hostPart.startsWith("127.0.0.1") ||
                    hostPart.startsWith("[::1]") ||
                    hostPart.startsWith("0.0.0.0") ||
                    hostPart.startsWith("10.0.2.2")
            trimmed = (if (isLocal) "http://" else "https://") + trimmed
        }

        return try {
            val uri = URI(trimmed)
            val scheme = uri.scheme?.lowercase()
            if (scheme != "http" && scheme != "https") return null
            val host = uri.host ?: return null
            if (host.isEmpty()) return null
            val port = if (uri.port != -1) ":${uri.port}" else ""
            val path = uri.path?.takeIf { it.isNotEmpty() && it != "/" } ?: ""
            "$scheme://$host$port$path"
        } catch (_: Exception) {
            null
        }
    }

    private fun hasHttpScheme(value: String): Boolean {
        val lower = value.lowercase()
        return lower.startsWith("https://") || lower.startsWith("http://")
    }
}

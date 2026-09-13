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
            return isLocalHost(host)
        }

    /** Accepts a full origin or bare domain; host-only strings get https:// (or http:// for local). */
    fun parseAPIBaseURL(raw: String): String? {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null

        val scheme = when {
            trimmed.startsWith("https://", ignoreCase = true) -> "https://"
            trimmed.startsWith("http://", ignoreCase = true) -> "http://"
            else -> null
        }

        val rest = if (scheme != null) trimmed.substring(scheme.length) else trimmed
        val hostPart = rest.split('/', limit = 2).first()
        val hostOnly = hostPart.split(':', limit = 2).first()
        val isLocal = isLocalHost(hostOnly)

        // If no scheme provided, default based on host.
        // If https was mistakenly added to a local host (e.g. during typing), downgrade it.
        var finalUrl = when {
            scheme == null -> (if (isLocal) "http://" else "https://") + rest
            isLocal && scheme == "https://" -> "http://" + rest
            else -> trimmed
        }

        return try {
            val uri = URI(finalUrl)
            val s = uri.scheme?.lowercase()
            if (s != "http" && s != "https") return null
            val host = uri.host ?: return null
            if (host.isEmpty()) return null
            val port = if (uri.port != -1) ":${uri.port}" else ""
            val path = uri.path?.takeIf { it.isNotEmpty() && it != "/" } ?: ""
            "$s://$host$port$path"
        } catch (_: Exception) {
            null
        }
    }

    private fun isLocalHost(host: String): Boolean {
        val h = host.lowercase().removePrefix("[").removeSuffix("]")
        if (h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "10.0.2.2" || h == "0.0.0.0") return true

        // Private IPv4 ranges
        if (h.startsWith("192.168.")) return true
        if (h.startsWith("10.")) return true
        if (h.startsWith("172.")) {
            val second = h.split('.').getOrNull(1)?.toIntOrNull()
            if (second != null && second in 16..31) return true
        }

        // Common local development host suffixes
        if (h.endsWith(".local") || h.endsWith(".lan")) return true

        return false
    }
}

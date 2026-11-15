package co.inboxies.app.services

import co.inboxies.app.BuildConfig
import java.io.IOException
import okhttp3.Interceptor

/**
 * DEBUG previews are fixtures: they must never reach the API (AVE-235). While a
 * preview runs, every OkHttp client the app owns (REST, SSE, agent chat) fails
 * fast instead of sending a request, so a missed per-view guard shows an
 * "offline" error rather than an authenticated production call with the
 * fixture token, or a 401 that signs the real account out.
 *
 * [MainActivity][co.inboxies.app.MainActivity] turns it on for a preview launch
 * and off for a normal one. Release builds can never turn it on.
 */
object PreviewNetworkGuard {
    @Volatile
    var isBlocking: Boolean = false
        private set

    fun setBlocking(blocking: Boolean) {
        isBlocking = BuildConfig.DEBUG && blocking
    }

    val interceptor: Interceptor = Interceptor { chain ->
        if (isBlocking) {
            throw IOException("$BLOCKED_MESSAGE (${chain.request().url.host})")
        }
        chain.proceed(chain.request())
    }

    const val BLOCKED_MESSAGE = "Network is off in DEBUG previews"
}

package co.inboxies.wear.data

import co.inboxies.wear.BuildConfig
import java.io.IOException
import okhttp3.Interceptor

/**
 * DEBUG previews are fixtures and must never reach the API (the phone app's
 * `PreviewNetworkGuard`, AVE-235). While a wear preview runs, every call fails
 * fast. Release builds can never turn it on.
 */
object PreviewNetworkGuard {
    @Volatile
    var isBlocking: Boolean = false
        private set

    fun setBlocking(blocking: Boolean) {
        isBlocking = BuildConfig.DEBUG && blocking
    }

    val interceptor: Interceptor = Interceptor { chain ->
        if (isBlocking) throw IOException("Network is off in DEBUG previews (${chain.request().url.host})")
        chain.proceed(chain.request())
    }
}

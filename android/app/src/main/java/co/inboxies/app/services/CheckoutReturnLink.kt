package co.inboxies.app.services

import java.net.URI
import java.net.URLDecoder

/**
 * The Stripe checkout return deep link (AVE-118):
 * `inboxies://onboarding/domain-ready?domain=…[&code=…]`, or the same path on
 * `https://inboxies.email/onboarding/…`.
 *
 * `code` is a one-time, 60-second exchange code, never a session token. The app trades
 * it, with the checkout session id it started (kept in [co.inboxies.app.config.AppConfig],
 * never in the link), at `POST /api/v1/auth/exchange`. Any app can claim the `inboxies`
 * scheme, so an intercepted link alone can't sign anyone in. A `token=` from an older
 * Worker is ignored.
 */
data class CheckoutReturnLink(val domain: String?, val code: String?) {
    companion object {
        /** The link's domain and code, or null when [raw] isn't an onboarding return. */
        fun parse(raw: String): CheckoutReturnLink? {
            val uri = runCatching { URI(raw) }.getOrNull() ?: return null
            val scheme = uri.scheme?.lowercase()
            val host = uri.host?.lowercase()
            val isOnboarding = (scheme == "inboxies" && (host == "onboarding" || host == "domain-ready")) ||
                (host == "inboxies.email" && uri.rawPath?.startsWith("/onboarding") == true)
            if (!isOnboarding) return null
            val params = queryParams(uri.rawQuery)
            return CheckoutReturnLink(domain = params["domain"], code = params["code"])
        }

        private fun queryParams(rawQuery: String?): Map<String, String> {
            if (rawQuery.isNullOrEmpty()) return emptyMap()
            val out = mutableMapOf<String, String>()
            for (pair in rawQuery.split('&')) {
                val idx = pair.indexOf('=')
                if (idx <= 0) continue
                val name = decode(pair.substring(0, idx))
                val value = decode(pair.substring(idx + 1)).trim()
                if (value.isNotEmpty() && name !in out) out[name] = value
            }
            return out
        }

        private fun decode(s: String): String = runCatching { URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)
    }
}

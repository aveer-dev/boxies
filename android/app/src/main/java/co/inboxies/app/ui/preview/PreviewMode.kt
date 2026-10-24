package co.inboxies.app.ui.preview

import android.content.Intent
import co.inboxies.app.BuildConfig

/**
 * DEBUG-only emulator / adb preview surfaces.
 *
 * Mirrors iOS Simulator launch args (`-previewDomainAdmin`, `-previewMailbox`, …).
 * Pass as a boolean intent extra with the same name (no leading dash), or as
 * `-e preview <name>` where name is one of the [cliName] values.
 *
 * Example:
 * ```
 * adb shell am start -n co.inboxies.app/.MainActivity --ez previewDomainAdmin true
 * adb shell am start -n co.inboxies.app/.MainActivity -e preview mailbox
 * ```
 */
enum class PreviewMode(val cliName: String, val intentExtra: String) {
    DomainAdmin("domainAdmin", "previewDomainAdmin"),
    DomainDns("domainDns", "previewDomainDns"),
    DomainOnboarding("domainOnboarding", "previewDomainOnboarding"),
    PasswordSignIn("passwordSignIn", "previewPasswordSignIn"),
    ForgotPassword("forgotPassword", "previewForgotPassword"),
    /** Email sign-in at the 2FA code step (iOS `-previewTwoFactorChallenge`). */
    TwoFactorChallenge("twoFactorChallenge", "previewTwoFactorChallenge"),
    InviteAccept("inviteAccept", "previewInviteAccept"),
    InviteAcceptSignedIn("inviteAcceptSignedIn", "previewInviteAcceptSignedIn"),
    SignInMethods("signInMethods", "previewSignInMethods"),
    Members("members", "previewMembers"),
    Sessions("sessions", "previewSessions"),
    Mailbox("mailbox", "previewMailbox"),
    /** Inbox with more pages to load: the bottom skeleton row (iOS `-previewLoadMore`). */
    LoadMore("loadMore", "previewLoadMore"),
    /** Inbox with a dozen New: capped New + "Show N more new" above Seen (iOS `-previewManyNew`). */
    ManyNew("manyNew", "previewManyNew"),
    /** Signed in, first mailbox load failed, nothing cached (iOS `-previewLoadFailed`). */
    LoadFailed("loadFailed", "previewLoadFailed"),
    /** Inbox fetch failed with an empty cache: error + Retry (iOS `-previewListError`). */
    ListError("listError", "previewListError"),
    Screener("screener", "previewScreener"),
    ScreenerList("screenerList", "previewScreenerList"),
    ReplyLater("replyLater", "previewReplyLater"),
    Spam("spam", "previewSpam"),
    Splash("splash", "previewSplash"),
    Welcome("welcome", "previewWelcome"),
    AuthOptions("authOptions", "previewAuthOptions"),
    /** Read-only inbox, domain admin: "Renew" banner with a registrar renew-by deadline. */
    ServiceEnded("serviceEnded", "previewServiceEnded"),
    /** Read-only inbox, regular member: "Ask an admin of … to renew." */
    ServiceEndedMember("serviceEndedMember", "previewServiceEndedMember"),
    /** Still active, set to end: admin-only "Keep subscription" notice. */
    ServiceEnding("serviceEnding", "previewServiceEnding"),
    /** DNS console for an ended domain: Subscription card, DNS edits frozen. */
    DomainDnsEnded("domainDnsEnded", "previewDomainDnsEnded"),
    ;

    companion object {
        /** Returns a preview mode only in DEBUG builds. */
        fun fromIntent(intent: Intent?): PreviewMode? {
            if (!BuildConfig.DEBUG || intent == null) return null

            for (mode in entries) {
                if (intent.getBooleanExtra(mode.intentExtra, false)) return mode
            }

            val raw = intent.getStringExtra(EXTRA_PREVIEW)?.trim()?.lowercase().orEmpty()
            if (raw.isEmpty()) return null
            return entries.firstOrNull {
                it.cliName.equals(raw, ignoreCase = true) ||
                    it.intentExtra.equals(raw, ignoreCase = true) ||
                    it.intentExtra.removePrefix("preview").equals(raw, ignoreCase = true)
            }
        }

        const val EXTRA_PREVIEW = "preview"
    }
}

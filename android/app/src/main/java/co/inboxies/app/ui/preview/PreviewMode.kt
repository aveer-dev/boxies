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
    /** Settings → Senders, Allowed tab with fixture rules (iOS `-previewSenders`). */
    Senders("senders", "previewSenders"),
    /** Settings → Senders, Blocked tab (iOS `-previewSenders -previewSendersBlocked`). */
    SendersBlocked("sendersBlocked", "previewSendersBlocked"),
    /** Settings sheet on the fixture mailbox (iOS `-previewSettings`). */
    Settings("settings", "previewSettings"),
    /** Settings sheet with Screener off (iOS `-previewSettings -previewScreenerOff`). */
    SettingsScreenerOff("settingsScreenerOff", "previewSettingsScreenerOff"),
    Mailbox("mailbox", "previewMailbox"),
    /** Inbox with more pages to load: the bottom skeleton row (iOS `-previewLoadMore`). */
    LoadMore("loadMore", "previewLoadMore"),
    /** Inbox with a dozen New: capped New + "Show N more new" above Seen (iOS `-previewManyNew`). */
    ManyNew("manyNew", "previewManyNew"),
    /** Inbox with a pinned "Archived · Undo" toast above the bottom bar (iOS `-previewToast`, AVE-134). */
    Toast("toast", "previewToast"),
    /** Signed in, first mailbox load failed, nothing cached (iOS `-previewLoadFailed`). */
    LoadFailed("loadFailed", "previewLoadFailed"),
    /** Inbox fetch failed with an empty cache: error + Retry (iOS `-previewListError`). */
    ListError("listError", "previewListError"),
    Screener("screener", "previewScreener"),
    ScreenerList("screenerList", "previewScreenerList"),
    ReplyLater("replyLater", "previewReplyLater"),
    Spam("spam", "previewSpam"),
    /** Long, wide newsletter open in the reader: fit-to-width + sideways scroll (iOS `-previewDetail -previewNewsletter`). */
    Newsletter("newsletter", "previewNewsletter"),
    /** Reply composer to a promo mail (tables, CSS, hidden preheader); tap the quote dock to see it rendered (iOS `-previewMailbox -previewReplyQuote`, AVE-133). */
    ReplyQuote("replyQuote", "previewReplyQuote"),
    /** Inbox rows with notes to self: sticky strip + private note chip (iOS `-previewMailbox -previewNotes`). */
    Notes("notes", "previewNotes"),
    /** Q3 thread open with a sticky note and inline notes (iOS `-previewDetail -previewNotes`). */
    NotesDetail("notesDetail", "previewNotesDetail"),
    /** Agent chat open with the usage meter at the warning level, 42 / 50 (iOS `-previewAiUsage`). */
    AiUsage("aiUsage", "previewAiUsage"),
    /** Agent chat at the daily limit, 50 / 50: notice + disabled composer (iOS `-previewAiUsageLimit`). */
    AiUsageLimit("aiUsageLimit", "previewAiUsageLimit"),
    /** Settings sheet with the AI usage section filled (42 / 50 chats, 37 / 200 checks). */
    AiUsageSettings("aiUsageSettings", "previewAiUsageSettings"),
    /** "Today's inbox" widget design mocks at real size, light/dark toggle (iOS `-previewWidgets`, AVE-138). */
    Widgets("widgets", "previewWidgets"),
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

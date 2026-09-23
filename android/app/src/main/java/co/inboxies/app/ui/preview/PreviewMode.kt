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
    PasswordSignIn("passwordSignIn", "previewPasswordSignIn"),
    InviteAccept("inviteAccept", "previewInviteAccept"),
    SignInMethods("signInMethods", "previewSignInMethods"),
    Mailbox("mailbox", "previewMailbox"),
    Screener("screener", "previewScreener"),
    ReplyLater("replyLater", "previewReplyLater"),
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

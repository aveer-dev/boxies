package co.inboxies.app.ui.preview

import org.junit.Assert.assertEquals
import org.junit.Test

/** Keeps DEBUG preview intent / CLI names aligned with iOS launch args. */
class PreviewModeNamesTest {
    @Test
    fun intentExtraNamesMatchIosLaunchArgs() {
        assertEquals("previewDomainAdmin", PreviewMode.DomainAdmin.intentExtra)
        assertEquals("previewDomainOnboarding", PreviewMode.DomainOnboarding.intentExtra)
        assertEquals("previewPasswordSignIn", PreviewMode.PasswordSignIn.intentExtra)
        assertEquals("previewInviteAccept", PreviewMode.InviteAccept.intentExtra)
        assertEquals("previewMailbox", PreviewMode.Mailbox.intentExtra)
        assertEquals("previewScreener", PreviewMode.Screener.intentExtra)
        assertEquals("previewReplyLater", PreviewMode.ReplyLater.intentExtra)
        assertEquals("previewSplash", PreviewMode.Splash.intentExtra)
        assertEquals("previewWelcome", PreviewMode.Welcome.intentExtra)
        assertEquals("previewAuthOptions", PreviewMode.AuthOptions.intentExtra)
    }

    @Test
    fun cliNamesAreStable() {
        assertEquals("domainAdmin", PreviewMode.DomainAdmin.cliName)
        assertEquals("domainOnboarding", PreviewMode.DomainOnboarding.cliName)
        assertEquals("mailbox", PreviewMode.Mailbox.cliName)
        assertEquals("splash", PreviewMode.Splash.cliName)
        assertEquals("welcome", PreviewMode.Welcome.cliName)
        assertEquals("authOptions", PreviewMode.AuthOptions.cliName)
    }
}

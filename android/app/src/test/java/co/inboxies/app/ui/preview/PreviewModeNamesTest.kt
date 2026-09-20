package co.inboxies.app.ui.preview

import org.junit.Assert.assertEquals
import org.junit.Test

/** Keeps DEBUG preview intent / CLI names aligned with iOS launch args. */
class PreviewModeNamesTest {
    @Test
    fun intentExtraNamesMatchIosLaunchArgs() {
        assertEquals("previewDomainAdmin", PreviewMode.DomainAdmin.intentExtra)
        assertEquals("previewPasswordSignIn", PreviewMode.PasswordSignIn.intentExtra)
        assertEquals("previewInviteAccept", PreviewMode.InviteAccept.intentExtra)
        assertEquals("previewMailbox", PreviewMode.Mailbox.intentExtra)
        assertEquals("previewScreener", PreviewMode.Screener.intentExtra)
        assertEquals("previewReplyLater", PreviewMode.ReplyLater.intentExtra)
    }

    @Test
    fun cliNamesAreStable() {
        assertEquals("domainAdmin", PreviewMode.DomainAdmin.cliName)
        assertEquals("mailbox", PreviewMode.Mailbox.cliName)
    }
}

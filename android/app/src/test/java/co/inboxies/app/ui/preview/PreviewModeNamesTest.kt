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
        assertEquals("previewInviteAcceptSignedIn", PreviewMode.InviteAcceptSignedIn.intentExtra)
        assertEquals("previewSignInMethods", PreviewMode.SignInMethods.intentExtra)
        assertEquals("previewMembers", PreviewMode.Members.intentExtra)
        assertEquals("previewSessions", PreviewMode.Sessions.intentExtra)
        assertEquals("previewMailbox", PreviewMode.Mailbox.intentExtra)
        assertEquals("previewLoadMore", PreviewMode.LoadMore.intentExtra)
        assertEquals("previewLoadFailed", PreviewMode.LoadFailed.intentExtra)
        assertEquals("previewListError", PreviewMode.ListError.intentExtra)
        assertEquals("previewScreener", PreviewMode.Screener.intentExtra)
        assertEquals("previewReplyLater", PreviewMode.ReplyLater.intentExtra)
        assertEquals("previewNewsletter", PreviewMode.Newsletter.intentExtra)
        assertEquals("previewReminderPicker", PreviewMode.ReminderPicker.intentExtra)
        assertEquals("previewReminderToast", PreviewMode.ReminderToast.intentExtra)
        assertEquals("previewReminderDue", PreviewMode.ReminderDue.intentExtra)
        assertEquals("previewSplash", PreviewMode.Splash.intentExtra)
        assertEquals("previewWelcome", PreviewMode.Welcome.intentExtra)
        assertEquals("previewAuthOptions", PreviewMode.AuthOptions.intentExtra)
        assertEquals("previewTags", PreviewMode.Tags.intentExtra)
        assertEquals("previewTagsRename", PreviewMode.TagsRename.intentExtra)
        assertEquals("previewTagsDelete", PreviewMode.TagsDelete.intentExtra)
    }

    @Test
    fun cliNamesAreStable() {
        assertEquals("domainAdmin", PreviewMode.DomainAdmin.cliName)
        assertEquals("domainOnboarding", PreviewMode.DomainOnboarding.cliName)
        assertEquals("mailbox", PreviewMode.Mailbox.cliName)
        assertEquals("loadMore", PreviewMode.LoadMore.cliName)
        assertEquals("loadFailed", PreviewMode.LoadFailed.cliName)
        assertEquals("listError", PreviewMode.ListError.cliName)
        assertEquals("newsletter", PreviewMode.Newsletter.cliName)
        assertEquals("reminderPicker", PreviewMode.ReminderPicker.cliName)
        assertEquals("reminderToast", PreviewMode.ReminderToast.cliName)
        assertEquals("reminderDue", PreviewMode.ReminderDue.cliName)
        assertEquals("splash", PreviewMode.Splash.cliName)
        assertEquals("welcome", PreviewMode.Welcome.cliName)
        assertEquals("authOptions", PreviewMode.AuthOptions.cliName)
        assertEquals("tags", PreviewMode.Tags.cliName)
    }
}

package co.inboxies.app.ui.preview

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Keeps DEBUG preview intent / CLI names aligned with iOS launch args. */
class PreviewModeNamesTest {
    @Test
    fun intentExtraNamesMatchIosLaunchArgs() {
        assertEquals("previewDomainAdmin", PreviewMode.DomainAdmin.intentExtra)
        assertEquals("previewDomainAliasAdd", PreviewMode.DomainAliasAdd.intentExtra)
        assertEquals("previewDomainAliasConflict", PreviewMode.DomainAliasConflict.intentExtra)
        assertEquals("previewDomainAliasDelete", PreviewMode.DomainAliasDelete.intentExtra)
        assertEquals("previewDomainOnboarding", PreviewMode.DomainOnboarding.intentExtra)
        assertEquals("previewPasswordSignIn", PreviewMode.PasswordSignIn.intentExtra)
        assertEquals("previewInviteAccept", PreviewMode.InviteAccept.intentExtra)
        assertEquals("previewInviteAcceptSignedIn", PreviewMode.InviteAcceptSignedIn.intentExtra)
        assertEquals("previewSignInMethods", PreviewMode.SignInMethods.intentExtra)
        assertEquals("previewMembers", PreviewMode.Members.intentExtra)
        assertEquals("previewSessions", PreviewMode.Sessions.intentExtra)
        assertEquals("previewSecurityActivity", PreviewMode.SecurityActivity.intentExtra)
        assertEquals("previewSecurityActivityEmpty", PreviewMode.SecurityActivityEmpty.intentExtra)
        assertEquals("previewSecurityActivityError", PreviewMode.SecurityActivityError.intentExtra)
        assertEquals("previewMailbox", PreviewMode.Mailbox.intentExtra)
        assertEquals("previewLoadMore", PreviewMode.LoadMore.intentExtra)
        assertEquals("previewLoadFailed", PreviewMode.LoadFailed.intentExtra)
        assertEquals("previewListError", PreviewMode.ListError.intentExtra)
        assertEquals("previewScreener", PreviewMode.Screener.intentExtra)
        assertEquals("previewScreenerReaderAccept", PreviewMode.ScreenerReaderAccept.intentExtra)
        assertEquals("previewReplyLater", PreviewMode.ReplyLater.intentExtra)
        assertEquals("previewSetAside", PreviewMode.SetAside.intentExtra)
        assertEquals("previewNewsletter", PreviewMode.Newsletter.intentExtra)
        assertEquals("previewCode", PreviewMode.Code.intentExtra)
        assertEquals("previewInvite", PreviewMode.InviteCard.intentExtra)
        assertEquals("previewInviteExpanded", PreviewMode.InviteCardExpanded.intentExtra)
        assertEquals("previewInviteAddress", PreviewMode.InviteCardAddress.intentExtra)
        assertEquals("previewInviteCancelled", PreviewMode.InviteCardCancelled.intentExtra)
        assertEquals("previewInviteFree", PreviewMode.InviteCardFree.intentExtra)
        assertEquals("previewInviteConflict", PreviewMode.InviteCardConflict.intentExtra)
        assertEquals("previewInviteAdded", PreviewMode.InviteCardAdded.intentExtra)
        assertEquals("previewInviteAsk", PreviewMode.InviteCardAsk.intentExtra)
        assertEquals("previewReminderPicker", PreviewMode.ReminderPicker.intentExtra)
        assertEquals("previewReminderToast", PreviewMode.ReminderToast.intentExtra)
        assertEquals("previewReminderDue", PreviewMode.ReminderDue.intentExtra)
        assertEquals("previewSplash", PreviewMode.Splash.intentExtra)
        assertEquals("previewWelcome", PreviewMode.Welcome.intentExtra)
        assertEquals("previewAuthOptions", PreviewMode.AuthOptions.intentExtra)
        assertEquals("previewTags", PreviewMode.Tags.intentExtra)
        assertEquals("previewTagsRename", PreviewMode.TagsRename.intentExtra)
        assertEquals("previewTagsDelete", PreviewMode.TagsDelete.intentExtra)
        assertEquals("previewTagView", PreviewMode.TagView.intentExtra)
        assertEquals("previewTagPicker", PreviewMode.TagPicker.intentExtra)
        assertEquals("previewTagList", PreviewMode.TagList.intentExtra)
        assertEquals("previewPile", PreviewMode.Pile.intentExtra)
        assertEquals("previewPileList", PreviewMode.PileList.intentExtra)
        assertEquals("previewPilePicker", PreviewMode.PilePicker.intentExtra)
        assertEquals("previewWidgetData", PreviewMode.WidgetData.intentExtra)
        assertEquals("previewWidgetZero", PreviewMode.WidgetZero.intentExtra)
        assertEquals("previewDomainDns", PreviewMode.DomainDns.intentExtra)
        assertEquals("previewDomainDnsEnded", PreviewMode.DomainDnsEnded.intentExtra)
        assertEquals("previewAiUsageSettings", PreviewMode.AiUsageSettings.intentExtra)
    }

    @Test
    fun cliNamesAreStable() {
        assertEquals("domainAdmin", PreviewMode.DomainAdmin.cliName)
        assertEquals("domainAliasAdd", PreviewMode.DomainAliasAdd.cliName)
        assertEquals("domainAliasConflict", PreviewMode.DomainAliasConflict.cliName)
        assertEquals("domainAliasDelete", PreviewMode.DomainAliasDelete.cliName)
        assertEquals("domainOnboarding", PreviewMode.DomainOnboarding.cliName)
        assertEquals("mailbox", PreviewMode.Mailbox.cliName)
        assertEquals("setAside", PreviewMode.SetAside.cliName)
        assertEquals("paperTrail", PreviewMode.PaperTrail.cliName)
        assertEquals("previewPaperTrail", PreviewMode.PaperTrail.intentExtra)
        assertEquals("tagView", PreviewMode.TagView.cliName)
        assertEquals("pile", PreviewMode.Pile.cliName)
        assertEquals("pileList", PreviewMode.PileList.cliName)
        assertEquals("pilePicker", PreviewMode.PilePicker.cliName)
        assertEquals("tagPicker", PreviewMode.TagPicker.cliName)
        assertEquals("tagList", PreviewMode.TagList.cliName)
        assertEquals("loadMore", PreviewMode.LoadMore.cliName)
        assertEquals("loadFailed", PreviewMode.LoadFailed.cliName)
        assertEquals("listError", PreviewMode.ListError.cliName)
        assertEquals("newsletter", PreviewMode.Newsletter.cliName)
        assertEquals("screenerReaderAccept", PreviewMode.ScreenerReaderAccept.cliName)
        assertEquals("code", PreviewMode.Code.cliName)
        assertEquals("inviteCard", PreviewMode.InviteCard.cliName)
        assertEquals("inviteCardAddressExpanded", PreviewMode.InviteCardAddressExpanded.cliName)
        assertEquals("inviteCardCancelled", PreviewMode.InviteCardCancelled.cliName)
        assertEquals("inviteCardFree", PreviewMode.InviteCardFree.cliName)
        assertEquals("inviteCardConflict", PreviewMode.InviteCardConflict.cliName)
        assertEquals("inviteCardAdded", PreviewMode.InviteCardAdded.cliName)
        assertEquals("reminderPicker", PreviewMode.ReminderPicker.cliName)
        assertEquals("reminderToast", PreviewMode.ReminderToast.cliName)
        assertEquals("reminderDue", PreviewMode.ReminderDue.cliName)
        assertEquals("splash", PreviewMode.Splash.cliName)
        assertEquals("welcome", PreviewMode.Welcome.cliName)
        assertEquals("authOptions", PreviewMode.AuthOptions.cliName)
        assertEquals("tags", PreviewMode.Tags.cliName)
        assertEquals("securityActivity", PreviewMode.SecurityActivity.cliName)
        assertEquals("securityActivityEmpty", PreviewMode.SecurityActivityEmpty.cliName)
        assertEquals("securityActivityError", PreviewMode.SecurityActivityError.cliName)
    }

    @Test
    fun widgetDataAndZeroArePreviewModes() {
        assertEquals("widgetData", PreviewMode.WidgetData.cliName)
        assertEquals("widgetZero", PreviewMode.WidgetZero.cliName)
        assertEquals(PreviewMode.WidgetData, PreviewMode.fromName("widgetData"))
        assertEquals(PreviewMode.WidgetZero, PreviewMode.fromName("WidgetZero"))
        // The older `--es previewWidgetData mail|zero` launch still lands on a preview mode.
        assertEquals(PreviewMode.WidgetData, PreviewMode.fromWidgetDataValue("mail"))
        assertEquals(PreviewMode.WidgetZero, PreviewMode.fromWidgetDataValue("zero"))
        assertEquals(PreviewMode.WidgetZero, PreviewMode.fromWidgetDataValue(" Zero "))
    }

    @Test
    fun fromNameAcceptsCliNameExtraAndBareExtra() {
        assertEquals(PreviewMode.DomainDns, PreviewMode.fromName("domainDns"))
        assertEquals(PreviewMode.DomainDns, PreviewMode.fromName("previewDomainDns"))
        assertEquals(PreviewMode.InviteCard, PreviewMode.fromName("Invite"))
        assertEquals(PreviewMode.AiUsageSettings, PreviewMode.fromName(" aiusagesettings "))
        assertNull(PreviewMode.fromName(""))
        assertNull(PreviewMode.fromName(null))
        assertNull(PreviewMode.fromName("notAMode"))
    }

    @Test
    fun cliNamesAndExtrasAreUnique() {
        val names = PreviewMode.entries.map { it.cliName.lowercase() }
        assertEquals(names.size, names.toSet().size)
        val extras = PreviewMode.entries.map { it.intentExtra.lowercase() }
        assertEquals(extras.size, extras.toSet().size)
    }

    /** `run-debug-preview.sh` launches every mode, with the extra the app reads. */
    @Test
    fun runDebugPreviewScriptCoversEveryMode() {
        val script = listOf(File("../scripts/run-debug-preview.sh"), File("scripts/run-debug-preview.sh"))
            .first { it.exists() }
            .readText()
        val missing = PreviewMode.entries.filterNot { mode ->
            val name = Regex.escape(mode.cliName)
            val extra = Regex.escape(mode.intentExtra)
            Regex("^\\s*$name[|)][^\\n]*extra=$extra;", RegexOption.MULTILINE).containsMatchIn(script)
        }
        assertTrue("run-debug-preview.sh is missing: ${missing.map { it.cliName }}", missing.isEmpty())
    }
}

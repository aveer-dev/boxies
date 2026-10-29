package co.inboxies.app.ui.preview

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.AdminDomainInfo
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.auth.InviteAcceptView
import co.inboxies.app.ui.auth.MailboxOnboardingView
import co.inboxies.app.ui.components.MailboxLoadFailedView
import co.inboxies.app.ui.auth.OnboardingTrack
import co.inboxies.app.ui.auth.SignInView
import co.inboxies.app.ui.home.HomeShellView
import co.inboxies.app.ui.settings.DomainAdminDNSView
import co.inboxies.app.ui.settings.DomainAdminSettingsView
import co.inboxies.app.ui.settings.SendersSettingsView
import co.inboxies.app.ui.settings.SendersTab
import co.inboxies.app.ui.settings.SessionsSettingsView
import co.inboxies.app.ui.settings.SettingsSheetView
import co.inboxies.app.ui.settings.SharingSettingsView
import co.inboxies.app.ui.settings.SignInMethodsSettingsView
import co.inboxies.app.models.TwoFactorChallenge
import co.inboxies.app.ui.splash.SplashScreenView
import co.inboxies.app.models.ComposeMode
import kotlinx.coroutines.delay

/**
 * DEBUG emulator roots — mirror iOS `PreviewMailboxRoot` / `PreviewAdminAuthRoot`.
 * Call [seed] once before first composition (e.g. from [co.inboxies.app.MainActivity]).
 */
object PreviewHarness {
    fun seed(mode: PreviewMode, auth: AuthStore, appModel: AppModel) {
        when (mode) {
            PreviewMode.TwoFactorChallenge -> {
                appModel.reset()
                auth.applyPreviewTwoFactorChallenge(
                    TwoFactorChallenge(
                        token = "preview",
                        methods = listOf("totp", "backup_code"),
                        email = "you@inboxies.email",
                    ),
                )
            }
            PreviewMode.PasswordSignIn,
            PreviewMode.ForgotPassword,
            PreviewMode.Welcome,
            PreviewMode.AuthOptions,
            -> {
                // Show SignInView only — do not clear a real on-disk session.
                appModel.reset()
            }
            PreviewMode.DomainOnboarding -> {
                PreviewSupport.applyAuth(auth)
            }
            PreviewMode.InviteAccept -> {
                // Signed out: the real invite screen on a fixture invite.
                appModel.reset()
            }
            PreviewMode.InviteAcceptSignedIn,
            PreviewMode.DomainAdmin,
            PreviewMode.DomainDns,
            PreviewMode.Sessions,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyAdminPreview(appModel)
            }
            PreviewMode.SignInMethods -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyAdminPreview(appModel)
                appModel.setIdentities(PreviewSupport.identities())
            }
            PreviewMode.AiUsage,
            PreviewMode.AiUsageLimit,
            PreviewMode.AiUsageSettings,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyMailboxPreview(appModel, mode)
                appModel.applyPreviewAiUsage(PreviewSupport.aiUsage(atLimit = mode == PreviewMode.AiUsageLimit))
                if (mode != PreviewMode.AiUsageSettings) appModel.startNewChat()
            }
            PreviewMode.Members,
            PreviewMode.Senders,
            PreviewMode.SendersBlocked,
            PreviewMode.Settings,
            PreviewMode.SettingsScreenerOff,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyMailboxPreview(appModel, mode)
            }
            PreviewMode.DomainDnsEnded -> {
                PreviewSupport.applyAuth(auth)
                val service = PreviewSupport.domainServiceFixture(mode, PREVIEW_DNS_DOMAIN)!!
                PreviewSupport.applyAdminPreview(appModel, mapOf(PREVIEW_DNS_DOMAIN to service))
            }
            PreviewMode.Splash -> {
                // Splash preview needs no extra session seeding.
            }
            PreviewMode.Mailbox,
            PreviewMode.LoadMore,
            PreviewMode.ManyNew,
            PreviewMode.Toast,
            PreviewMode.ReminderPicker,
            PreviewMode.ReminderToast,
            PreviewMode.ReminderDue,
            PreviewMode.LoadFailed,
            PreviewMode.ListError,
            PreviewMode.Screener,
            PreviewMode.ScreenerList,
            PreviewMode.ReplyLater,
            PreviewMode.Spam,
            PreviewMode.Newsletter,
            PreviewMode.ReplyQuote,
            PreviewMode.Notes,
            PreviewMode.NotesDetail,
            PreviewMode.ServiceEnded,
            PreviewMode.ServiceEndedMember,
            PreviewMode.ServiceEnding,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyMailboxPreview(appModel, mode)
            }
        }
    }
}

private const val PREVIEW_DNS_DOMAIN = "example.com"

@Composable
fun PreviewRoot(
    mode: PreviewMode,
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    when (mode) {
        PreviewMode.Splash -> SplashScreenView()
        PreviewMode.Welcome -> SignInView(isShowingSplash = false, expandPasswordForm = false)
        PreviewMode.AuthOptions -> SignInView(isShowingSplash = false, expandPasswordForm = false, showAuthOptionsInitial = true)
        PreviewMode.PasswordSignIn -> SignInView(expandPasswordForm = true)
        PreviewMode.ForgotPassword -> SignInView(expandForgotPassword = true)
        PreviewMode.TwoFactorChallenge -> SignInView(expandPasswordForm = true)
        PreviewMode.DomainOnboarding -> {
            Surface(modifier = Modifier.fillMaxSize(), color = inboxiesColors().background) {
                MailboxOnboardingView(initialTrack = OnboardingTrack.Domain(1))
            }
        }
        PreviewMode.InviteAccept,
        PreviewMode.InviteAcceptSignedIn,
        -> Surface(modifier = Modifier.fillMaxSize(), color = inboxiesColors().background) {
            InviteAcceptView(
                token = "preview",
                previewInvite = PreviewSupport.invite(),
                onSignIn = {},
                onDone = {},
            )
        }
        PreviewMode.SignInMethods -> SettingsPreviewSurface { SignInMethodsSettingsView(onBack = {}) }
        PreviewMode.Members -> SettingsPreviewSurface { SharingSettingsView(onBack = {}) }
        PreviewMode.Sessions -> SettingsPreviewSurface { SessionsSettingsView(onBack = {}) }
        PreviewMode.Senders -> SettingsPreviewSurface { SendersSettingsView(onBack = {}) }
        PreviewMode.Settings, PreviewMode.SettingsScreenerOff, PreviewMode.AiUsageSettings -> SettingsPreviewSurface {
            SettingsSheetView(onClose = {}, onThemeModeChange = onThemeModeChange, themeMode = themeMode)
        }
        PreviewMode.SendersBlocked -> SettingsPreviewSurface {
            SendersSettingsView(onBack = {}, initialTab = SendersTab.Blocked)
        }
        PreviewMode.DomainAdmin -> {
            Surface(modifier = Modifier.fillMaxSize(), color = inboxiesColors().background) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding(),
                ) {
                    DomainAdminSettingsView(
                        previewRows = PreviewSupport.adminRows(),
                    )
                }
            }
        }
        PreviewMode.DomainDns, PreviewMode.DomainDnsEnded -> {
            Surface(modifier = Modifier.fillMaxSize(), color = inboxiesColors().background) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding(),
                ) {
                    DomainAdminDNSView(
                        previewDomains = listOf(
                            AdminDomainInfo(
                                domain = PREVIEW_DNS_DOMAIN,
                                zoneId = "preview-zone-123",
                                status = "active",
                                nameservers = listOf("ns1.cloudflare.com", "ns2.cloudflare.com"),
                            ),
                        ),
                    )
                }
            }
        }
        PreviewMode.LoadFailed -> MailboxLoadFailedView(appModel = appModel, auth = auth)
        PreviewMode.Mailbox,
        PreviewMode.AiUsage,
        PreviewMode.AiUsageLimit,
        PreviewMode.LoadMore,
        PreviewMode.ManyNew,
        PreviewMode.Toast,
        PreviewMode.ReminderPicker,
        PreviewMode.ReminderToast,
        PreviewMode.ReminderDue,
        PreviewMode.ListError,
        PreviewMode.Screener,
        PreviewMode.ScreenerList,
        PreviewMode.ReplyLater,
        PreviewMode.Spam,
        PreviewMode.Newsletter,
        PreviewMode.ReplyQuote,
        PreviewMode.Notes,
        PreviewMode.NotesDetail,
        PreviewMode.ServiceEnded,
        PreviewMode.ServiceEndedMember,
        PreviewMode.ServiceEnding,
        -> {
            if (mode == PreviewMode.ReplyQuote) {
                LaunchedEffect(Unit) {
                    delay(400)
                    appModel.startCompose(ComposeMode.Reply, original = PreviewSupport.promoEmail())
                }
            }
            HomeShellView(
                auth = auth,
                appModel = appModel,
                themeMode = themeMode,
                onThemeModeChange = onThemeModeChange,
            )
        }
    }
}

/** A settings page on the sheet background, below the status bar. */
@Composable
private fun SettingsPreviewSurface(content: @Composable () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = inboxiesColors().background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
        ) {
            content()
        }
    }
}

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.auth.SignInView
import co.inboxies.app.ui.home.HomeShellView
import co.inboxies.app.ui.settings.DomainAdminSettingsView

/**
 * DEBUG emulator roots — mirror iOS `PreviewMailboxRoot` / `PreviewAdminAuthRoot`.
 * Call [seed] once before first composition (e.g. from [co.inboxies.app.MainActivity]).
 */
object PreviewHarness {
    fun seed(mode: PreviewMode, auth: AuthStore, appModel: AppModel) {
        when (mode) {
            PreviewMode.PasswordSignIn -> {
                // Show SignInView only — do not clear a real on-disk session.
                appModel.reset()
            }
            PreviewMode.InviteAccept,
            PreviewMode.DomainAdmin,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyAdminPreview(appModel)
            }
            PreviewMode.Mailbox,
            PreviewMode.Screener,
            PreviewMode.ReplyLater,
            -> {
                PreviewSupport.applyAuth(auth)
                PreviewSupport.applyMailboxPreview(appModel, mode)
            }
        }
    }
}

@Composable
fun PreviewRoot(
    mode: PreviewMode,
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    when (mode) {
        PreviewMode.PasswordSignIn -> SignInView(expandPasswordForm = true)
        PreviewMode.InviteAccept -> InviteAcceptPreview()
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
        PreviewMode.Mailbox,
        PreviewMode.Screener,
        PreviewMode.ReplyLater,
        -> HomeShellView(
            auth = auth,
            appModel = appModel,
            themeMode = themeMode,
            onThemeModeChange = onThemeModeChange,
        )
    }
}

/** Static invite-accept form (no API) — parallel to iOS `InviteAcceptPreview`. */
@Composable
fun InviteAcceptPreview() {
    val colors = inboxiesColors()
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("Alex") }
    val mailbox = "you@${PreviewSupport.mailDomain()}"

    Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
        ) {
            TextButton(onClick = {}) {
                Text("Cancel", color = colors.muted, fontFamily = InterFontFamily)
            }
            Spacer(Modifier.height(16.dp))
            Text(
                "Accept invite",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = colors.ink,
            )
            Text(
                "You've been invited to $mailbox.",
                color = colors.muted,
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
            )
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                label = { Text("Display name (optional)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password (10+ characters)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = confirm,
                onValueChange = { confirm = it },
                label = { Text("Confirm password") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {},
                enabled = password.length >= 10 && password == confirm,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.ink,
                    contentColor = colors.surface,
                ),
            ) {
                Text("Create account", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium)
            }
        }
    }
}

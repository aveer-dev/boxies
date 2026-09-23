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
            PreviewMode.SignInMethods,
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
        PreviewMode.SignInMethods -> SignInMethodsPreview()
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

/**
 * Static Sign-in methods surface (no API) — Connected list + Change password form expanded.
 * Mirrors the production layout for DEBUG emulator review.
 */
@Composable
fun SignInMethodsPreview() {
    val colors = inboxiesColors()
    var currentPassword by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordConfirm by remember { mutableStateOf("") }

    Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 32.dp),
        ) {
            Text(
                "Sign-in methods",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
            Text(
                "Connected methods share this account. Connect Apple or Google on this device, add or change your password, or link another device.",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )

            Text(
                "CONNECTED",
                modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = colors.muted,
            )
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                Text("emmanuel@example.com", fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.ink)
                Text("Email · this session", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
            }
            Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp)) {
                Text("Password", fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.ink)
                Text("Password", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
            }

            Text(
                "CONNECT ON THIS DEVICE",
                modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 8.dp),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = colors.muted,
            )
            Text(
                "Connect Apple isn’t available on Android. Use iPhone, or Link another device.",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
            TextButton(onClick = {}, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text("Connect Google", fontFamily = InterFontFamily, color = colors.accent)
            }

            Text(
                "Change password",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = colors.ink,
            )
            OutlinedTextField(
                value = currentPassword,
                onValueChange = { currentPassword = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                label = { Text("Current password", fontFamily = InterFontFamily) },
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                label = { Text("New password (10+ characters)", fontFamily = InterFontFamily) },
                singleLine = true,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = passwordConfirm,
                onValueChange = { passwordConfirm = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                label = { Text("Confirm new password", fontFamily = InterFontFamily) },
                singleLine = true,
            )
            TextButton(onClick = {}, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text("Update password", fontFamily = InterFontFamily, color = colors.accent)
            }

            Text(
                "LINK ANOTHER DEVICE",
                modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 8.dp),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = colors.muted,
            )
            TextButton(onClick = {}, modifier = Modifier.padding(horizontal = 8.dp)) {
                Text("Link another device", fontFamily = InterFontFamily, color = colors.muted)
            }
        }
    }
}

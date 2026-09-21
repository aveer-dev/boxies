package co.inboxies.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

@Composable
fun SignInMethodsSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var identities by remember { mutableStateOf<List<LinkedIdentity>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isMinting by remember { mutableStateOf(false) }
    var isRedeeming by remember { mutableStateOf(false) }
    var linkCode by remember { mutableStateOf<String?>(null) }
    var expiresAt by remember { mutableStateOf<String?>(null) }
    var redeemDraft by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            isLoading = true
            errorMessage = null
            runCatching { ApiClient.shared.listIdentities() }
                .onSuccess { identities = it.identities }
                .onFailure { errorMessage = "Could not load sign-in methods" }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Text(
                "Sign-in methods",
                modifier = Modifier.padding(start = 4.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
        }

        Text(
            "Link Access email, Apple, Google, or password so every sign-in uses the same account and mailbox access.",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 8.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )

        SettingsSectionHeader("Connected")

        when {
            isLoading -> {
                Text(
                    "Loading…",
                    modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                )
            }
            identities.isEmpty() -> {
                Text(
                    "No linked identities yet.",
                    modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                )
            }
            else -> {
                identities.forEach { identity ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 8.dp),
                    ) {
                        Text(
                            identity.label,
                            fontFamily = InterFontFamily,
                            fontSize = 15.sp,
                            color = colors.ink,
                        )
                        Text(
                            identityTypeLabel(identity.type) + if (identity.current) " · this session" else "",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                    }
                }
            }
        }

        SettingsSectionHeader("Connect another method")
        Text(
            "On web (email / Access), generate a code, then redeem it here after Sign in with Apple. Codes expire in 15 minutes.",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
        TextButton(
            onClick = {
                scope.launch {
                    isMinting = true
                    errorMessage = null
                    runCatching { ApiClient.shared.createIdentityLinkCode() }
                        .onSuccess {
                            linkCode = it.code
                            expiresAt = it.expiresAt
                            statusMessage = "Link code created — expires in 15 minutes"
                        }
                        .onFailure { errorMessage = "Could not create link code" }
                    isMinting = false
                }
            },
            enabled = !isMinting,
            modifier = Modifier.padding(horizontal = 4.dp),
        ) {
            Text(
                if (isMinting) "Creating…" else "Generate link code",
                fontFamily = InterFontFamily,
                color = colors.accent,
            )
        }

        linkCode?.let { code ->
            Column(
                modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    code,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 18.sp,
                    color = colors.ink,
                )
                expiresAt?.let { exp ->
                    Text(
                        "Expires ${formatExpiry(exp)}",
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
                TextButton(
                    onClick = {
                        clipboard.setText(AnnotatedString(code))
                        statusMessage = "Code copied"
                    },
                ) {
                    Text("Copy code", fontFamily = InterFontFamily, color = colors.accent)
                }
            }
        }

        SettingsSectionHeader("Redeem a code")
        OutlinedTextField(
            value = redeemDraft,
            onValueChange = { redeemDraft = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
            label = { Text("Link code", fontFamily = InterFontFamily) },
            singleLine = true,
        )
        TextButton(
            onClick = {
                val code = redeemDraft.trim()
                if (code.isEmpty()) return@TextButton
                scope.launch {
                    isRedeeming = true
                    errorMessage = null
                    runCatching { ApiClient.shared.redeemIdentityLink(code) }
                        .onSuccess { res ->
                            redeemDraft = ""
                            statusMessage = if (res.isAdmin) {
                                "Linked — Domain Admin access restored"
                            } else {
                                "Sign-in method linked"
                            }
                            if (res.identities.isNotEmpty()) {
                                identities = res.identities
                            } else {
                                reload()
                            }
                            app.refreshMailboxes(showLoading = false)
                        }
                        .onFailure { errorMessage = "Invalid or expired code" }
                    isRedeeming = false
                }
            },
            enabled = !isRedeeming && redeemDraft.trim().isNotEmpty(),
            modifier = Modifier.padding(horizontal = 4.dp),
        ) {
            Text(
                if (isRedeeming) "Linking…" else "Link to this account",
                fontFamily = InterFontFamily,
                color = colors.accent,
            )
        }

        statusMessage?.let {
            Text(
                it,
                modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 8.dp),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.accent,
            )
        }
        errorMessage?.let {
            Text(
                it,
                modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 8.dp),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.deepDarkRed,
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

private fun identityTypeLabel(type: String): String = when (type) {
    "email" -> "Email"
    "password" -> "Password"
    "apple" -> "Apple"
    "google" -> "Google"
    "sub" -> "Sign-in provider"
    "access" -> "Access"
    else -> type
}

private fun formatExpiry(iso: String): String = runCatching {
    val instant = Instant.parse(iso)
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM)
        .withZone(ZoneId.systemDefault())
        .format(instant)
}.getOrDefault(iso)

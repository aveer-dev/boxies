package co.inboxies.app.ui.settings

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
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
    val context = LocalContext.current

    var identities by remember { mutableStateOf<List<LinkedIdentity>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isConnectingGoogle by remember { mutableStateOf(false) }
    var isAddingPassword by remember { mutableStateOf(false) }
    var isMinting by remember { mutableStateOf(false) }
    var isRedeeming by remember { mutableStateOf(false) }
    var showPasswordForm by remember { mutableStateOf(false) }
    var showAdvanced by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var passwordConfirm by remember { mutableStateOf("") }
    var linkCode by remember { mutableStateOf<String?>(null) }
    var expiresAt by remember { mutableStateOf<String?>(null) }
    var redeemDraft by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val hasGoogle = identities.any { it.type == "google" }
    val hasPassword = identities.any { it.type == "password" }

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

    fun applyAttach(res: co.inboxies.app.models.AttachIdentityResponse, success: String) {
        statusMessage = if (res.isAdmin) {
            "$success — Domain Admin access restored"
        } else {
            success
        }
        if (res.identities.isNotEmpty()) {
            identities = res.identities
        } else {
            reload()
        }
        scope.launch {
            app.refreshMailboxes(showLoading = false)
        }
    }

    fun friendlyAttachError(message: String?): String {
        val text = message.orEmpty()
        return when {
            text.contains("already linked", ignoreCase = true) ->
                "That identity is already linked to another Inboxies account"
            text.contains("already has a password", ignoreCase = true) ->
                "This account already has a password"
            else -> "Could not connect sign-in method"
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
            "Connect Google or add a password on this device while signed in. Every method uses the same account and mailbox access.",
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

        SettingsSectionHeader("Connect on this device")
        Text(
            "Completes Google’s normal sign-in and attaches it to this account — you stay signed in.",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )

        if (!hasGoogle) {
            Button(
                onClick = {
                    scope.launch {
                        isConnectingGoogle = true
                        errorMessage = null
                        try {
                            val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
                            if (webClientId.isBlank()) {
                                errorMessage =
                                    "Google Sign-In isn’t configured. Set GOOGLE_WEB_CLIENT_ID, or use Link another device."
                                return@launch
                            }
                            val googleIdOption = GetGoogleIdOption.Builder()
                                .setFilterByAuthorizedAccounts(false)
                                .setServerClientId(webClientId)
                                .build()
                            val request = GetCredentialRequest.Builder()
                                .addCredentialOption(googleIdOption)
                                .build()
                            val activity = context as Activity
                            val result = CredentialManager.create(context)
                                .getCredential(activity, request)
                            val credential = result.credential
                            if (credential is CustomCredential &&
                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                            ) {
                                val google = GoogleIdTokenCredential.createFrom(credential.data)
                                val res = ApiClient.shared.attachGoogleIdentity(google.idToken)
                                applyAttach(res, "Google connected")
                            } else {
                                errorMessage = "Google Sign-In failed"
                            }
                        } catch (e: Exception) {
                            errorMessage = friendlyAttachError(e.message)
                        } finally {
                            isConnectingGoogle = false
                        }
                    }
                },
                enabled = !isConnectingGoogle,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding)
                    .height(48.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.ink,
                    contentColor = colors.surface,
                ),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text(
                    if (isConnectingGoogle) "Connecting…" else "Connect Google",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                )
            }
        }

        if (!hasPassword) {
            if (!showPasswordForm) {
                TextButton(
                    onClick = { showPasswordForm = true },
                    modifier = Modifier.padding(horizontal = 4.dp),
                ) {
                    Text("Add password", fontFamily = InterFontFamily, color = colors.accent)
                }
            } else {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("New password (10+ characters)", fontFamily = InterFontFamily) },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = passwordConfirm,
                    onValueChange = { passwordConfirm = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("Confirm password", fontFamily = InterFontFamily) },
                    singleLine = true,
                )
                Row(
                    modifier = Modifier.padding(horizontal = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                when {
                                    password.length < 10 -> {
                                        errorMessage = "Password must be at least 10 characters"
                                    }
                                    password != passwordConfirm -> {
                                        errorMessage = "Passwords do not match"
                                    }
                                    else -> {
                                        isAddingPassword = true
                                        errorMessage = null
                                        runCatching {
                                            ApiClient.shared.attachPasswordIdentity(password)
                                        }.onSuccess { res ->
                                            password = ""
                                            passwordConfirm = ""
                                            showPasswordForm = false
                                            applyAttach(res, "Password added")
                                        }.onFailure {
                                            errorMessage = friendlyAttachError(it.message)
                                        }
                                        isAddingPassword = false
                                    }
                                }
                            }
                        },
                        enabled = !isAddingPassword && password.isNotBlank() && passwordConfirm.isNotBlank(),
                    ) {
                        Text(
                            if (isAddingPassword) "Saving…" else "Save password",
                            fontFamily = InterFontFamily,
                            color = colors.accent,
                        )
                    }
                    TextButton(
                        onClick = {
                            showPasswordForm = false
                            password = ""
                            passwordConfirm = ""
                        },
                    ) {
                        Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                    }
                }
            }
        }

        SettingsSectionHeader("Advanced")
        TextButton(
            onClick = { showAdvanced = !showAdvanced },
            modifier = Modifier.padding(horizontal = 4.dp),
        ) {
            Text(
                if (showAdvanced) "Hide · Link another device" else "Link another device",
                fontFamily = InterFontFamily,
                color = colors.muted,
            )
        }

        if (showAdvanced) {
            Text(
                "Cross-device fallback when Connect can’t run on the other surface. Codes expire in 15 minutes.",
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
                                applyAttach(
                                    co.inboxies.app.models.AttachIdentityResponse(
                                        ok = res.ok,
                                        accountId = res.accountId,
                                        linkedEmails = res.linkedEmails,
                                        keys = res.keys,
                                        isAdmin = res.isAdmin,
                                        identities = res.identities,
                                    ),
                                    "Sign-in method linked",
                                )
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

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.models.RecoveryEmailStatus
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

@Composable
fun SignInMethodsSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val cachedIdentities by app.identities.collectAsState()
    var identities by remember { mutableStateOf<List<LinkedIdentity>>(cachedIdentities ?: emptyList()) }
    var isLoading by remember { mutableStateOf(cachedIdentities == null) }
    var isConnectingGoogle by remember { mutableStateOf(false) }
    var isAddingPassword by remember { mutableStateOf(false) }
    var isChangingPassword by remember { mutableStateOf(false) }
    var removingType by remember { mutableStateOf<String?>(null) }
    var identityToRemove by remember { mutableStateOf<LinkedIdentity?>(null) }
    var showPasswordForm by remember { mutableStateOf(false) }
    var showChangePassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var passwordConfirm by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var newPasswordConfirm by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    val hasGoogle = identities.any { it.type == "google" }
    val hasPassword = identities.any { it.type == "password" }
    val canAddMethod = !hasGoogle || !hasPassword

    fun reload() {
        // DEBUG previews show the cached fixture identities only.
        if (app.isDebugPreview) {
            isLoading = false
            return
        }
        scope.launch {
            if (identities.isEmpty()) {
                isLoading = true
            }
            errorMessage = null
            runCatching { ApiClient.shared.listIdentities() }
                .onSuccess {
                    identities = it.identities
                    app.setIdentities(it.identities)
                }
                .onFailure {
                    if (identities.isEmpty()) {
                        errorMessage = "Could not load sign-in methods"
                    }
                }
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
            app.setIdentities(res.identities)
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

    fun friendlyChangePasswordError(message: String?): String {
        val text = message.orEmpty()
        return when {
            text.contains("incorrect", ignoreCase = true) ->
                "Current password is incorrect"
            text.contains("no password", ignoreCase = true) ->
                "This account has no password yet — add one first"
            text.contains("at least 10", ignoreCase = true) ->
                "New password must be at least 10 characters"
            else -> "Could not change password"
        }
    }

    LaunchedEffect(cachedIdentities) {
        cachedIdentities?.let {
            identities = it
            isLoading = false
        }
    }

    LaunchedEffect(Unit) {
        if (identities.isEmpty()) {
            reload()
        }
    }

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
                "Sign-in & recovery",
                modifier = Modifier.padding(start = 4.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
        }

        Text(
            "Ways you can sign in to this account. Every method reaches the same mailboxes. Keep at least one.",
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
                    "Nothing linked yet.",
                    modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                )
            }
            else -> {
                identities.forEach { identity ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = HomeChromeMetrics.chromeHorizontalPadding, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
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
                        if (removingType == identity.type) {
                            CircularProgressIndicator(
                                modifier = Modifier.padding(end = 12.dp).size(18.dp),
                                color = colors.muted,
                                strokeWidth = 2.dp,
                            )
                        } else if (identities.size > 1) {
                            TextButton(onClick = { identityToRemove = identity }) {
                                Text("Disconnect", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.deepDarkRed)
                            }
                        }
                    }
                }
            }
        }

        if (hasPassword) {
            SettingsSectionHeader("Password")
            Text(
                "Change the password used to sign in with email.",
                modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
            if (!showChangePassword) {
                TextButton(
                    onClick = { showChangePassword = true },
                    modifier = Modifier.padding(horizontal = 4.dp),
                ) {
                    Text("Change password", fontFamily = InterFontFamily, color = colors.accent)
                }
            } else {
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("Current password", fontFamily = InterFontFamily) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = newPassword,
                    onValueChange = { newPassword = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("New password (10+ characters)", fontFamily = InterFontFamily) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = newPasswordConfirm,
                    onValueChange = { newPasswordConfirm = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("Confirm new password", fontFamily = InterFontFamily) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
                Row(
                    modifier = Modifier.padding(horizontal = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                when {
                                    currentPassword.isBlank() -> {
                                        errorMessage = "Enter your current password"
                                    }
                                    newPassword.length < 10 -> {
                                        errorMessage = "New password must be at least 10 characters"
                                    }
                                    newPassword != newPasswordConfirm -> {
                                        errorMessage = "New passwords do not match"
                                    }
                                    currentPassword == newPassword -> {
                                        errorMessage =
                                            "New password must be different from the current password"
                                    }
                                    else -> {
                                        isChangingPassword = true
                                        errorMessage = null
                                        runCatching {
                                            ApiClient.shared.changePassword(
                                                currentPassword = currentPassword,
                                                newPassword = newPassword,
                                            )
                                        }.onSuccess { res ->
                                            currentPassword = ""
                                            newPassword = ""
                                            newPasswordConfirm = ""
                                            showChangePassword = false
                                            statusMessage = "Password updated"
                                            if (res.identities.isNotEmpty()) {
                                                identities = res.identities
                                                app.setIdentities(res.identities)
                                            } else {
                                                reload()
                                            }
                                        }.onFailure {
                                            errorMessage = friendlyChangePasswordError(it.message)
                                        }
                                        isChangingPassword = false
                                    }
                                }
                            }
                        },
                        enabled = !isChangingPassword &&
                            currentPassword.isNotBlank() &&
                            newPassword.isNotBlank() &&
                            newPasswordConfirm.isNotBlank(),
                    ) {
                        Text(
                            if (isChangingPassword) "Updating…" else "Update password",
                            fontFamily = InterFontFamily,
                            color = colors.accent,
                        )
                    }
                    TextButton(
                        onClick = {
                            showChangePassword = false
                            currentPassword = ""
                            newPassword = ""
                            newPasswordConfirm = ""
                        },
                    ) {
                        Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                    }
                }
            }
        }

        if (canAddMethod) {
            SettingsSectionHeader("Add a method")
            Text(
                "Stay signed in — we attach the new method to this account.",
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
                        visualTransformation = PasswordVisualTransformation(),
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
                        visualTransformation = PasswordVisualTransformation(),
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
        }

        RecoveryEmailSection(onStatus = { statusMessage = it })

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

    identityToRemove?.let { identity ->
        AlertDialog(
            onDismissRequest = { identityToRemove = null },
            containerColor = colors.surface,
            title = {
                Text("Disconnect ${identityTypeLabel(identity.type)}?", fontFamily = InterFontFamily, fontSize = 17.sp)
            },
            text = {
                Text("You won't be able to sign in with it until you connect it again.", fontFamily = InterFontFamily)
            },
            confirmButton = {
                TextButton(onClick = {
                    identityToRemove = null
                    scope.launch {
                        removingType = identity.type
                        errorMessage = null
                        runCatching { ApiClient.shared.removeIdentity(identity.type) }
                            .onSuccess {
                                statusMessage = "${identityTypeLabel(identity.type)} disconnected"
                                identities = identities.filterNot { it.type == identity.type }
                                app.setIdentities(identities)
                            }
                            .onFailure { errorMessage = it.message }
                        removingType = null
                    }
                }) {
                    Text("Disconnect", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { identityToRemove = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

private fun identityTypeLabel(type: String): String = when (type) {
    "email" -> "Email"
    "password" -> "Password"
    "apple" -> "Apple"
    "google" -> "Google"
    "sub" -> "Sign-in provider"
    else -> type
}

/**
 * Recovery email: where password reset codes go. It must be outside Inboxies
 * (other members can read a mailbox) and confirmed with a code before resets use it.
 */
@Composable
private fun RecoveryEmailSection(onStatus: (String) -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<RecoveryEmailStatus?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var isEditing by remember { mutableStateOf(false) }
    var emailDraft by remember { mutableStateOf("") }
    var codeDraft by remember { mutableStateOf("") }
    var isBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val email = status?.email?.takeIf { it.isNotBlank() }
    val verified = status?.verified == true

    LaunchedEffect(Unit) {
        if (app.isDebugPreview) {
            status = RecoveryEmailStatus()
        } else {
            runCatching { ApiClient.shared.getRecoveryEmail() }.onSuccess { status = it }
        }
        isLoading = false
    }

    fun sendCode(address: String) {
        val trimmed = address.trim()
        if (trimmed.isEmpty()) return
        scope.launch {
            isBusy = true
            error = null
            runCatching { ApiClient.shared.setRecoveryEmail(trimmed) }
                .onSuccess {
                    status = RecoveryEmailStatus(email = it.email, verified = it.verified)
                    isEditing = false
                    emailDraft = ""
                    if (BuildConfig.DEBUG) codeDraft = it.devCode.orEmpty()
                    onStatus("Code sent to ${it.email ?: trimmed}")
                }
                .onFailure { error = it.message }
            isBusy = false
        }
    }

    SettingsSectionHeader("Recovery email")
    when {
        isLoading && status == null -> Text(
            "Loading…",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = colors.muted,
        )
        email == null || isEditing -> {
            OutlinedTextField(
                value = emailDraft,
                onValueChange = { emailDraft = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                placeholder = { Text("you@example.com", fontFamily = InterFontFamily) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            )
            Row(modifier = Modifier.padding(horizontal = 4.dp)) {
                TextButton(onClick = { sendCode(emailDraft) }, enabled = !isBusy && emailDraft.contains("@")) {
                    Text(if (isBusy) "Sending…" else "Send code", fontFamily = InterFontFamily, color = colors.accent)
                }
                if (isEditing) {
                    TextButton(onClick = {
                        isEditing = false
                        emailDraft = ""
                    }) {
                        Text("Keep $email", fontFamily = InterFontFamily, color = colors.muted)
                    }
                }
            }
        }
        else -> {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    email,
                    modifier = Modifier.weight(1f),
                    fontFamily = InterFontFamily,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                )
                Text(
                    if (verified) "Confirmed" else "Not confirmed",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 12.sp,
                    color = if (verified) colors.accent else colors.deepDarkRed,
                )
            }
            if (!verified) {
                OutlinedTextField(
                    value = codeDraft,
                    onValueChange = { codeDraft = it.filter(Char::isDigit).take(8) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
                    label = { Text("6-digit code", fontFamily = InterFontFamily) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            }
            Row(modifier = Modifier.padding(horizontal = 4.dp)) {
                if (!verified) {
                    TextButton(
                        onClick = {
                            scope.launch {
                                isBusy = true
                                error = null
                                runCatching { ApiClient.shared.verifyRecoveryEmail(codeDraft.trim()) }
                                    .onSuccess {
                                        status = it
                                        codeDraft = ""
                                        onStatus("Recovery email confirmed")
                                    }
                                    .onFailure { error = it.message }
                                isBusy = false
                            }
                        },
                        enabled = !isBusy && codeDraft.trim().length >= 6,
                    ) {
                        Text(if (isBusy) "Confirming…" else "Confirm", fontFamily = InterFontFamily, color = colors.accent)
                    }
                    TextButton(onClick = { sendCode(email) }, enabled = !isBusy) {
                        Text("Resend", fontFamily = InterFontFamily, color = colors.muted)
                    }
                }
                TextButton(onClick = {
                    emailDraft = ""
                    isEditing = true
                }) {
                    Text("Change", fontFamily = InterFontFamily, color = colors.accent)
                }
                TextButton(
                    onClick = {
                        scope.launch {
                            isBusy = true
                            error = null
                            runCatching { ApiClient.shared.removeRecoveryEmail() }
                                .onSuccess {
                                    status = RecoveryEmailStatus()
                                    onStatus("Recovery email removed")
                                }
                                .onFailure { error = it.message }
                            isBusy = false
                        }
                    },
                    enabled = !isBusy,
                ) {
                    Text("Remove", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            }
        }
    }
    error?.let {
        Text(
            it,
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.deepDarkRed,
        )
    }
    Text(
        when {
            isEditing && verified -> "Your current recovery email stops working for password resets until you confirm the new one."
            email == null -> "Password reset codes go only to a confirmed recovery email. Without one, you can't reset a forgotten password. Use an address outside Inboxies."
            !verified -> "We sent a code to this address. Password resets won't reach it until you confirm."
            else -> "Password reset codes go to this address."
        },
        modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
        fontFamily = InterFontFamily,
        fontSize = 12.sp,
        color = colors.muted,
    )
}

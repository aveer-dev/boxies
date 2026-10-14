package co.inboxies.app.ui.auth

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.InvitePublic
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

/**
 * Accept a mailbox invite from its link. Either way the invitee first proves
 * the invite reached them with a code mailed to the invited address.
 * - Signed in: the mailbox joins the current account; the session is kept.
 * - Signed out: creates an account with a password, or hands off to sign-in
 *   ([onSignIn]), after which this screen comes back signed in.
 */
@Composable
fun InviteAcceptView(
    token: String,
    onSignIn: () -> Unit,
    onDone: () -> Unit,
    /** DEBUG preview: render this invite without the network. */
    previewInvite: InvitePublic? = null,
) {
    val auth = LocalAuthStore.current
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val sessionToken by auth.token.collectAsState()
    val userEmail by auth.userEmail.collectAsState()
    val isSignedIn = !sessionToken.isNullOrBlank()

    var invite by remember { mutableStateOf(previewInvite) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var codeSentTo by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var sendingCode by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }
    var needsSignIn by remember { mutableStateOf(false) }

    LaunchedEffect(token) {
        if (previewInvite != null) return@LaunchedEffect
        runCatching { ApiClient.shared.getInvite(token) }
            .onSuccess { invite = it }
            .onFailure { e ->
                loadError = when {
                    e is ApiException.Http && (e.code == 404 || e.code == 410) ->
                        e.message?.takeIf { it.isNotBlank() } ?: "This invite is no longer active."
                    else -> e.message
                }
            }
    }

    fun sendCode() {
        if (previewInvite != null) {
            codeSentTo = previewInvite.inviteeEmail
            return
        }
        scope.launch {
            sendingCode = true
            formError = null
            runCatching { ApiClient.shared.sendInviteCode(token) }
                .onSuccess {
                    codeSentTo = it.sentTo
                    if (BuildConfig.DEBUG) it.devCode?.let { dev -> code = dev }
                }
                .onFailure { formError = it.message }
            sendingCode = false
        }
    }

    fun accept() {
        formError = null
        needsSignIn = false
        if (!isSignedIn) {
            if (password != confirm) {
                formError = "Passwords do not match"
                return
            }
            if (password.length < 10) {
                formError = "Password must be at least 10 characters"
                return
            }
        }
        scope.launch {
            submitting = true
            try {
                val result = ApiClient.shared.acceptInvite(
                    token = token,
                    code = code.trim(),
                    password = if (isSignedIn) null else password,
                    displayName = displayName.ifBlank { null },
                )
                if (isSignedIn) {
                    app.refreshMailboxes(showLoading = false)
                    if (app.mailboxes.value.any { it.id == result.mailboxId }) {
                        app.loadMailbox(result.mailboxId)
                    }
                    app.showToast("You joined ${result.mailboxId}")
                } else {
                    // RootView bootstraps the new session when the token changes.
                    result.token?.let { auth.applySession(it, result.email ?: result.mailboxId) }
                }
                onDone()
            } catch (e: ApiException.Http) {
                formError = e.message
                needsSignIn = e.code == 409
            } catch (e: Exception) {
                formError = e.message
            } finally {
                submitting = false
            }
        }
    }

    val canSubmit = code.trim().length >= 6 && !submitting && (isSignedIn || password.length >= 10)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 8.dp),
    ) {
        IconButton(onClick = onDone, modifier = Modifier.size(40.dp)) {
            Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Accept invite",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = colors.ink,
        )
        val current = invite
        when {
            loadError != null -> Text(
                loadError!!,
                color = colors.deepDarkRed,
                fontFamily = InterFontFamily,
                modifier = Modifier.padding(top = 12.dp),
            )
            current == null -> CircularProgressIndicator(
                modifier = Modifier.padding(top = 24.dp).size(24.dp),
                color = colors.muted,
                strokeWidth = 2.dp,
            )
            else -> {
                val role = if (current.role == "owner") "an owner" else "a member"
                Text(
                    if (isSignedIn) {
                        "Join ${current.mailboxId} as $role, signed in as ${userEmail ?: "your account"}."
                    } else {
                        "You've been invited to ${current.mailboxId} as $role."
                    },
                    color = colors.muted,
                    fontFamily = InterFontFamily,
                    fontSize = 15.sp,
                    modifier = Modifier.padding(top = 6.dp, bottom = 24.dp),
                )

                SectionLabel("Confirm it's you")
                if (codeSentTo == null) {
                    TextButton(
                        onClick = { sendCode() },
                        enabled = !sendingCode,
                        modifier = Modifier.offset(x = (-12).dp),
                    ) {
                        Text(
                            if (sendingCode) "Sending…" else "Email a code to ${current.inviteeEmail}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                            color = colors.accent,
                        )
                    }
                } else {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { code = it.filter(Char::isDigit).take(8) },
                        label = { Text("6-digit code", fontFamily = InterFontFamily) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    Row {
                        Text(
                            "Sent to $codeSentTo",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(top = 14.dp).weight(1f),
                        )
                        TextButton(onClick = { sendCode() }, enabled = !sendingCode) {
                            Text(
                                if (sendingCode) "Sending…" else "Send a new code",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                color = colors.muted,
                            )
                        }
                    }
                }
                Text(
                    "Invites are confirmed with a code sent to the invited address.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(bottom = 20.dp),
                )

                if (codeSentTo != null && !isSignedIn) {
                    SectionLabel("Create your account")
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it },
                        label = { Text("Display name (optional)", fontFamily = InterFontFamily) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password (10+ characters)", fontFamily = InterFontFamily) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = confirm,
                        onValueChange = { confirm = it },
                        label = { Text("Confirm password", fontFamily = InterFontFamily) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    Spacer(Modifier.height(16.dp))
                }

                formError?.let {
                    Text(
                        it,
                        color = colors.deepDarkRed,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    if (needsSignIn) {
                        TextButton(onClick = onSignIn, modifier = Modifier.offset(x = (-12).dp)) {
                            Text("Sign in to accept", fontFamily = InterFontFamily, color = colors.accent)
                        }
                    }
                }

                if (codeSentTo != null) {
                    Button(
                        onClick = { accept() },
                        enabled = canSubmit,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        shape = RoundedCornerShape(50),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.ink,
                            contentColor = colors.surface,
                            disabledContainerColor = colors.pillActive,
                            disabledContentColor = colors.muted,
                        ),
                    ) {
                        if (submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = colors.surface,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                if (isSignedIn) "Accept invite" else "Create account",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }

                if (!isSignedIn) {
                    Spacer(Modifier.height(20.dp))
                    TextButton(onClick = onSignIn, modifier = Modifier.offset(x = (-12).dp)) {
                        Text(
                            "I already have an account",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                        )
                    }
                    Text(
                        "Sign in first, then accept the invite into that account.",
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    val colors = inboxiesColors()
    Text(
        text.uppercase(),
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        color = colors.muted,
        modifier = Modifier.padding(bottom = 6.dp),
    )
}

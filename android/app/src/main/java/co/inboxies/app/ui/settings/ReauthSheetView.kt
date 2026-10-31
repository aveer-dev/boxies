package co.inboxies.app.ui.settings

import android.app.Activity
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Password
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.Passkeys
import co.inboxies.app.services.ReauthChallenge
import co.inboxies.app.services.ReauthCoordinator
import co.inboxies.app.services.ReauthMethod
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Lets this screen show "Confirm it's you" when a request inside it hits the
 * `reauth_required` gate (AVE-171, twin of iOS `.reauthPromptHost()`). Place once per
 * surface that makes sensitive account changes (the settings sheet); the innermost
 * mounted host presents.
 */
@Composable
fun ReauthPromptHost(coordinator: ReauthCoordinator = ReauthCoordinator.shared) {
    val hostId = remember { coordinator.newHostId() }
    DisposableEffect(coordinator, hostId) {
        coordinator.register(hostId)
        onDispose { coordinator.unregister(hostId) }
    }
    val prompt by coordinator.prompt.collectAsState()
    val hosts by coordinator.hosts.collectAsState()
    val current = prompt
    if (current != null && hosts.lastOrNull() == hostId) {
        key(current.id) {
            ReauthSheet(challenge = current.challenge, onFinish = { coordinator.finish(it) })
        }
    }
}

/**
 * "Confirm it's you" (AVE-171): the Android twin of the web `ReauthDialog` and iOS
 * `ReauthSheetView`. Offers what the account has (password + 2FA code, passkey, emailed
 * code) and always falls back to signing in again. `onFinish(true)` once
 * `POST /api/v1/me/reauth` accepted the proof; the caller retries its request.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReauthSheet(
    challenge: ReauthChallenge,
    onFinish: (Boolean) -> Unit,
    initialMethod: ReauthMethod? = null,
) {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    var method by remember { mutableStateOf(initialMethod ?: challenge.usableMethods.firstOrNull()) }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var useBackupCode by remember { mutableStateOf(false) }
    var codeSentTo by remember { mutableStateOf<String?>(null) }
    var isBusy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val busy by rememberUpdatedState(isBusy)
    val passwordFocus = remember { FocusRequester() }
    val codeFocus = remember { FocusRequester() }

    // Busy: a drag can't close it under a request in flight.
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { it != SheetValue.Hidden || !busy },
    )

    val otherMethods = challenge.usableMethods.filter { it != method }
    val passwordReady = password.isNotEmpty() && (!challenge.twoFactor || code.isNotBlank())

    fun close(ok: Boolean) {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onFinish(ok) }
    }

    fun signOut() {
        onFinish(false)
        app.signOut(auth)
    }

    fun attempt(fallback: String, work: suspend () -> Unit) {
        if (isBusy) return
        isBusy = true
        errorMessage = null
        scope.launch {
            try {
                work()
                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                isBusy = false
                close(true)
            } catch (_: Passkeys.Cancelled) {
                // A dismissed passkey sheet isn't worth an error.
                isBusy = false
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                isBusy = false
                errorMessage = e.message?.takeIf { it.isNotBlank() } ?: fallback
            }
        }
    }

    fun submitPassword() {
        if (!passwordReady) return
        attempt("Couldn't confirm it's you.") {
            if (app.isDebugPreview) return@attempt
            ApiClient.shared.reauthWithPassword(
                password = password,
                code = if (challenge.twoFactor) code else null,
                useBackupCode = useBackupCode,
            )
        }
    }

    fun usePasskey() {
        attempt(Passkeys.REAUTH_FAILED) {
            if (app.isDebugPreview) return@attempt
            val activity = context as? Activity ?: throw Passkeys.Failure(Passkeys.BAD_OPTIONS)
            Passkeys.reauthenticate(activity)
        }
    }

    fun sendEmailCode() {
        if (isBusy) return
        isBusy = true
        errorMessage = null
        scope.launch {
            if (app.isDebugPreview) {
                codeSentTo = challenge.emailCodeTo
                isBusy = false
                return@launch
            }
            try {
                val res = ApiClient.shared.sendReauthEmailCode()
                codeSentTo = res.sentTo ?: challenge.emailCodeTo ?: "your email"
                res.devCode?.let { code = it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                errorMessage = e.message?.takeIf { it.isNotBlank() } ?: "Couldn't send the code."
            }
            isBusy = false
        }
    }

    fun submitEmailCode() {
        attempt("Invalid or expired code.") {
            if (app.isDebugPreview) return@attempt
            ApiClient.shared.reauthWithEmailCode(code)
        }
    }

    fun switchTo(next: ReauthMethod) {
        method = next
        code = ""
        errorMessage = null
    }

    ModalBottomSheet(
        onDismissRequest = { if (!isBusy) onFinish(false) },
        sheetState = sheetState,
        containerColor = colors.background,
        scrimColor = HomeChromeMetrics.modalScrim,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
        ) {
            // Grabber (36×5 muted pill) + close.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .width(36.dp)
                        .height(5.dp)
                        .background(colors.muted.copy(alpha = 0.45f), RoundedCornerShape(50)),
                )
            }
            Box(modifier = Modifier.padding(horizontal = 8.dp)) {
                IconButton(onClick = { close(false) }, enabled = !isBusy) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
                }
            }

            ReauthHeader()

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(top = 22.dp)
                    .animateContentSize(settingsNavSpring()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AnimatedContent(
                    targetState = method,
                    transitionSpec = { fadeIn(settingsNavSpring()) togetherWith fadeOut(settingsNavSpring()) },
                    label = "reauthMethod",
                ) { shown ->
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        when (shown) {
                            ReauthMethod.Password -> {
                                ReauthField(
                                    value = password,
                                    onValueChange = { password = it },
                                    placeholder = "Password",
                                    visualTransformation = if (showPassword) {
                                        VisualTransformation.None
                                    } else {
                                        PasswordVisualTransformation()
                                    },
                                    keyboardOptions = KeyboardOptions(
                                        keyboardType = KeyboardType.Password,
                                        imeAction = if (challenge.twoFactor) ImeAction.Next else ImeAction.Go,
                                    ),
                                    keyboardActions = KeyboardActions(
                                        onNext = { codeFocus.requestFocus() },
                                        onGo = { submitPassword() },
                                    ),
                                    modifier = Modifier.focusRequester(passwordFocus),
                                    trailing = {
                                        IconButton(onClick = { showPassword = !showPassword }) {
                                            Icon(
                                                if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                                contentDescription = if (showPassword) "Hide password" else "Show password",
                                                tint = colors.muted,
                                                modifier = Modifier.size(18.dp),
                                            )
                                        }
                                    },
                                )
                                if (challenge.twoFactor) {
                                    ReauthField(
                                        value = code,
                                        onValueChange = { code = it },
                                        placeholder = if (useBackupCode) "Backup code" else "Authenticator code",
                                        keyboardOptions = KeyboardOptions(
                                            keyboardType = if (useBackupCode) KeyboardType.Ascii else KeyboardType.NumberPassword,
                                            imeAction = ImeAction.Go,
                                        ),
                                        keyboardActions = KeyboardActions(onGo = { submitPassword() }),
                                        modifier = Modifier.focusRequester(codeFocus),
                                    )
                                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                                        QuietLink(
                                            title = if (useBackupCode) "Use your authenticator app" else "Use a backup code",
                                            accent = true,
                                        ) {
                                            useBackupCode = !useBackupCode
                                            code = ""
                                            errorMessage = null
                                        }
                                    }
                                }
                                ReauthPrimaryButton("Confirm", enabled = passwordReady, isBusy = isBusy) {
                                    submitPassword()
                                }
                            }
                            ReauthMethod.Passkey -> {
                                ReauthPrimaryButton(
                                    "Use a passkey",
                                    icon = Icons.Filled.Key,
                                    enabled = true,
                                    isBusy = isBusy,
                                ) { usePasskey() }
                            }
                            ReauthMethod.EmailCode -> {
                                val sentTo = codeSentTo
                                if (sentTo != null) {
                                    BodyLine(prefix = "Enter the 6-digit code we sent to ", bold = sentTo, suffix = ".")
                                    ReauthField(
                                        value = code,
                                        onValueChange = { code = it.filter(Char::isDigit).take(6) },
                                        placeholder = "6-digit code",
                                        centered = true,
                                        large = true,
                                        keyboardOptions = KeyboardOptions(
                                            keyboardType = KeyboardType.NumberPassword,
                                            imeAction = ImeAction.Go,
                                        ),
                                        keyboardActions = KeyboardActions(onGo = { submitEmailCode() }),
                                        modifier = Modifier.focusRequester(codeFocus),
                                    )
                                    ReauthPrimaryButton(
                                        "Confirm",
                                        enabled = code.trim().length >= 6,
                                        isBusy = isBusy,
                                    ) { submitEmailCode() }
                                } else {
                                    BodyLine(
                                        prefix = "We'll email a 6-digit code to ",
                                        bold = challenge.emailCodeTo ?: "your recovery email",
                                        suffix = ".",
                                    )
                                    ReauthPrimaryButton("Send code", enabled = true, isBusy = isBusy) {
                                        sendEmailCode()
                                    }
                                }
                            }
                            ReauthMethod.SignIn, null -> {
                                Text(
                                    "Sign out and sign back in, then try again within 5 minutes.",
                                    fontFamily = InterFontFamily,
                                    fontSize = 14.sp,
                                    color = colors.ink,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                                ReauthPrimaryButton("Sign out", enabled = true, isBusy = isBusy) { signOut() }
                            }
                        }
                    }
                }

                AnimatedVisibility(
                    visible = errorMessage != null,
                    enter = fadeIn(settingsNavSpring()),
                    exit = fadeOut(settingsNavSpring()),
                ) {
                    Text(
                        errorMessage.orEmpty(),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 13.sp,
                        color = colors.deepDarkRed,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp),
                    )
                }
            }

            if (otherMethods.isNotEmpty() || method != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 24.dp)
                        .padding(top = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(0.5.dp)
                            .background(colors.line),
                    )
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        otherMethods.forEach { other ->
                            QuietLink(title = switchLabel(other), icon = switchIcon(other), enabled = !isBusy) {
                                switchTo(other)
                            }
                        }
                        if (method != null) {
                            QuietLink(title = "Sign in again instead", enabled = !isBusy) { signOut() }
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(method, codeSentTo) {
        when {
            method == ReauthMethod.Password -> runCatching { passwordFocus.requestFocus() }
            method == ReauthMethod.EmailCode && codeSentTo != null -> runCatching { codeFocus.requestFocus() }
        }
    }
}

@Composable
private fun ReauthHeader() {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(52.dp)
                .background(colors.pillFill, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Security, contentDescription = null, tint = colors.muted, modifier = Modifier.size(24.dp))
        }
        Text(
            "Confirm it's you",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = AppThemeDims.FontSize.largeTitle,
            color = colors.ink,
            modifier = Modifier.padding(top = 14.dp),
        )
        Text(
            "You're changing how your account signs in or recovers. Confirm it's you to continue.",
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = colors.muted,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(horizontal = 48.dp)
                .padding(top = 4.dp),
        )
    }
}

@Composable
private fun BodyLine(prefix: String, bold: String, suffix: String) {
    val colors = inboxiesColors()
    Text(
        buildAnnotatedString {
            append(prefix)
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(bold) }
            append(suffix)
        },
        fontFamily = InterFontFamily,
        fontSize = 14.sp,
        color = colors.ink,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Settings field surface: `surface` fill, 12.dp corners, `line` hairline. */
@Composable
private fun ReauthField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    centered: Boolean = false,
    large: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(12.dp)
    val align = if (centered) TextAlign.Center else TextAlign.Start
    val size = if (large) 20.sp else 16.sp
    val weight = if (large) FontWeight.Bold else FontWeight.Normal
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp)
            .background(colors.surface, shape)
            .border(1.dp, colors.line, shape)
            .padding(start = 14.dp, end = if (trailing != null) 2.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                fontFamily = InterFontFamily,
                fontSize = size,
                fontWeight = weight,
                color = colors.ink,
                textAlign = align,
            ),
            cursorBrush = SolidColor(colors.accent),
            visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            modifier = modifier.weight(1f),
            decorationBox = { inner ->
                Box(contentAlignment = if (centered) Alignment.Center else Alignment.CenterStart) {
                    if (value.isEmpty()) {
                        Text(
                            placeholder,
                            fontFamily = InterFontFamily,
                            fontSize = size,
                            fontWeight = weight,
                            color = colors.muted.copy(alpha = 0.7f),
                            textAlign = align,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    inner()
                }
            },
        )
        trailing?.invoke()
    }
}

/** Ink capsule, 50.dp tall (iOS `primaryButton`). */
@Composable
private fun ReauthPrimaryButton(
    title: String,
    enabled: Boolean,
    isBusy: Boolean,
    icon: ImageVector? = null,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val active = enabled && !isBusy
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(50.dp)
            .background(if (active || isBusy) colors.ink else colors.pillActive, RoundedCornerShape(50))
            .clickable(
                enabled = active,
                role = Role.Button,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isBusy) {
            CircularProgressIndicator(color = colors.surface, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        } else {
            val tint = if (active) colors.surface else colors.muted
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(title, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = tint)
        }
    }
}

@Composable
private fun QuietLink(
    title: String,
    icon: ImageVector? = null,
    accent: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val tint = if (accent) colors.accent else colors.muted
    Row(
        modifier = Modifier
            .clickable(
                enabled = enabled,
                role = Role.Button,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(15.dp))
        Text(title, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 13.sp, color = tint)
    }
}

private fun switchLabel(method: ReauthMethod): String = when (method) {
    ReauthMethod.Password -> "Use your password"
    ReauthMethod.Passkey -> "Use a passkey"
    ReauthMethod.EmailCode -> "Email me a code"
    ReauthMethod.SignIn -> "Sign in again instead"
}

private fun switchIcon(method: ReauthMethod): ImageVector? = when (method) {
    ReauthMethod.Password -> Icons.Outlined.Password
    ReauthMethod.Passkey -> Icons.Outlined.Key
    ReauthMethod.EmailCode -> Icons.Outlined.Email
    ReauthMethod.SignIn -> null
}

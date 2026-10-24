package co.inboxies.app.ui.settings

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.PasskeyRow
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.Passkeys
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Sign-in & recovery → Passkeys: the account's passkeys, add one on this device, remove one.
 * A passkey signs in on its own (no password, no 2FA step). Twin of iOS
 * `PasskeysSettingsSection`.
 */
@Composable
internal fun PasskeysSection(onStatus: (String) -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var passkeys by remember { mutableStateOf<List<PasskeyRow>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isAdding by remember { mutableStateOf(false) }
    var removingId by remember { mutableStateOf<String?>(null) }
    var passkeyToRemove by remember { mutableStateOf<PasskeyRow?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        if (app.isDebugPreview) {
            passkeys = listOf(
                PasskeyRow(
                    id = "preview-passkey",
                    name = Passkeys.DEVICE_NAME,
                    createdAt = "2026-10-01T09:00:00.000Z",
                    deviceType = "multiDevice",
                    backedUp = true,
                ),
            )
            isLoading = false
            return@LaunchedEffect
        }
        runCatching { Passkeys.list() }
            .onSuccess { passkeys = it }
            .onFailure { if (passkeys.isEmpty()) error = it.message }
        isLoading = false
    }

    SettingsSectionHeader("Passkeys")
    if (isLoading && passkeys.isEmpty()) {
        Text(
            "Loading…",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding),
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = colors.muted,
        )
    } else {
        passkeys.forEach { passkey ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = HomeChromeMetrics.chromeHorizontalPadding, end = 4.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Key,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(18.dp),
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        passkeyDisplayName(passkey),
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        color = colors.ink,
                        maxLines = 1,
                    )
                    Text(
                        passkeyDetail(passkey),
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
                if (removingId == passkey.id) {
                    CircularProgressIndicator(
                        modifier = Modifier.padding(end = 12.dp).size(18.dp),
                        color = colors.muted,
                        strokeWidth = 2.dp,
                    )
                } else {
                    TextButton(onClick = { passkeyToRemove = passkey }) {
                        Text("Remove", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.deepDarkRed)
                    }
                }
            }
        }
        Row(
            modifier = Modifier.padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = {
                    val activity = context as? Activity ?: return@TextButton
                    if (app.isDebugPreview) return@TextButton
                    scope.launch {
                        isAdding = true
                        error = null
                        try {
                            Passkeys.register(activity)
                            onStatus("Passkey added")
                            passkeys = runCatching { Passkeys.list() }.getOrDefault(passkeys)
                        } catch (_: Passkeys.Cancelled) {
                            // Dismissed.
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            isAdding = false
                        }
                    }
                },
                enabled = !isAdding,
            ) {
                Text(
                    if (isAdding) "Adding…" else "Add a passkey",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    color = colors.accent,
                )
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
        "Sign in with your fingerprint, face or screen lock instead of a password. Passkeys are saved to your password manager, like Google Password Manager, and work on your other devices too.",
        modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
        fontFamily = InterFontFamily,
        fontSize = 12.sp,
        color = colors.muted,
    )

    passkeyToRemove?.let { passkey ->
        AlertDialog(
            onDismissRequest = { passkeyToRemove = null },
            containerColor = colors.surface,
            title = {
                Text("Remove ${passkeyDisplayName(passkey)}?", fontFamily = InterFontFamily, fontSize = 17.sp)
            },
            text = {
                Text(
                    "You won't be able to sign in with it anymore. Also delete it from your password manager.",
                    fontFamily = InterFontFamily,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    passkeyToRemove = null
                    if (app.isDebugPreview) return@TextButton
                    scope.launch {
                        removingId = passkey.id
                        error = null
                        runCatching { Passkeys.delete(passkey.id) }
                            .onSuccess {
                                passkeys = passkeys.filterNot { it.id == passkey.id }
                                onStatus("Passkey removed")
                            }
                            .onFailure { error = it.message }
                        removingId = null
                    }
                }) {
                    Text("Remove", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { passkeyToRemove = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

/**
 * Sign-in & recovery → Two-factor authentication: whether TOTP 2FA is on. Turning it on or
 * off and new backup codes live in Inboxies on the web for now; it only ever challenges
 * password sign-in.
 */
@Composable
internal fun TwoFactorStatusSection() {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val uriHandler = LocalUriHandler.current

    var isEnabled by remember { mutableStateOf<Boolean?>(null) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        if (app.isDebugPreview) {
            isEnabled = false
        } else {
            runCatching { ApiClient.shared.getMe() }.onSuccess { isEnabled = it.twoFactorEnabled ?: false }
        }
        isLoading = false
    }

    SettingsSectionHeader("Two-factor authentication")
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Authenticator app",
            modifier = Modifier.weight(1f),
            fontFamily = InterFontFamily,
            fontSize = 15.sp,
            color = colors.ink,
        )
        when {
            isEnabled == true -> Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.padding(end = 4.dp).size(14.dp),
                )
                Text("On", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.accent)
            }
            isEnabled == false ->
                Text("Off", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.muted)
            isLoading -> CircularProgressIndicator(modifier = Modifier.size(16.dp), color = colors.muted, strokeWidth = 2.dp)
            else ->
                Text("Unknown", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.muted)
        }
    }
    val footer = buildAnnotatedString {
        append(
            if (isEnabled == true) {
                "Signing in with your password also asks for a code from your authenticator app, or a backup code. Turn it off or get new backup codes in "
            } else {
                "Optional. Ask for a code from an authenticator app after your password. Turn it on in "
            },
        )
        withLink(
            LinkAnnotation.Clickable("web", TextLinkStyles(SpanStyle(color = colors.accent, fontWeight = FontWeight.Medium))) {
                runCatching { uriHandler.openUri(AppConfig.apiBaseURL) }
            },
        ) { append("Inboxies on the web") }
        append(" → Settings → Sign-in & recovery. Passkeys and Google don't ask for a code.")
    }
    Text(
        footer,
        modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 4.dp),
        fontFamily = InterFontFamily,
        fontSize = 12.sp,
        color = colors.muted,
    )
}

private fun passkeyDisplayName(passkey: PasskeyRow): String =
    passkey.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Passkey"

/** "Added Oct 1, 2026 · Synced". */
internal fun passkeyDetail(passkey: PasskeyRow, zone: ZoneId = ZoneId.systemDefault()): String {
    val parts = mutableListOf<String>()
    passkey.createdAt
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }
        ?.let { parts += "Added " + DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withZone(zone).format(it) }
    if (passkey.backedUp == true || passkey.deviceType == "multiDevice") {
        parts += "Synced"
    } else if (passkey.deviceType == "singleDevice") {
        parts += "This device only"
    }
    return if (parts.isEmpty()) "Passkey" else parts.joinToString(" · ")
}

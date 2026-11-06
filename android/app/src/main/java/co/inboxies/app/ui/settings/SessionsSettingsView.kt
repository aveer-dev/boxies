package co.inboxies.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Login
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Laptop
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AccountSession
import co.inboxies.app.models.McpGrant
import co.inboxies.app.models.SecurityActivityItem
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/**
 * Account → Devices & sessions: every signed-in device, browser, extension and
 * AutoFill session, with sign-out per session or everywhere else; plus the apps
 * connected over MCP OAuth, each with Disconnect (revokes the grant and its tokens);
 * then a read-only list of the last 30 days of sign-ins and account changes (AVE-151).
 *
 * [previewActivity] (DEBUG previews only) picks the Recent security activity state and
 * scrolls down to it; null in a preview shows the fixture events unscrolled.
 */
@Composable
fun SessionsSettingsView(onBack: () -> Unit, previewActivity: SecurityActivityPreview? = null) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val scrollState = rememberScrollState()

    var sessions by remember { mutableStateOf<List<AccountSession>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var revokingId by remember { mutableStateOf<String?>(null) }
    var sessionToRevoke by remember { mutableStateOf<AccountSession?>(null) }
    var showRevokeOthers by remember { mutableStateOf(false) }
    var isRevokingOthers by remember { mutableStateOf(false) }
    var grants by remember { mutableStateOf<List<McpGrant>>(emptyList()) }
    var isLoadingGrants by remember { mutableStateOf(true) }
    var grantsError by remember { mutableStateOf<String?>(null) }
    var revokingGrantId by remember { mutableStateOf<String?>(null) }
    var grantToRevoke by remember { mutableStateOf<McpGrant?>(null) }
    var activity by remember { mutableStateOf<List<SecurityActivityItem>>(emptyList()) }
    var isLoadingActivity by remember { mutableStateOf(true) }
    var activityFailed by remember { mutableStateOf(false) }

    val others = sessions.filterNot { it.current }

    fun load() {
        if (app.isDebugPreview) {
            sessions = previewSessions()
            grants = previewGrants()
            isLoading = false
            isLoadingGrants = false
            when (previewActivity ?: SecurityActivityPreview.Events) {
                SecurityActivityPreview.Events -> activity = previewSecurityActivity()
                SecurityActivityPreview.Empty -> activity = emptyList()
                SecurityActivityPreview.Error -> {
                    activity = emptyList()
                    activityFailed = true
                }
            }
            isLoadingActivity = false
            return
        }
        // Read-only; a failure (e.g. the server not migrated yet) shows a calm note.
        scope.launch {
            isLoadingActivity = true
            runCatching { ApiClient.shared.securityActivity() }
                .onSuccess {
                    activity = it.events
                    activityFailed = false
                }
                .onFailure { activityFailed = true }
            isLoadingActivity = false
        }
        scope.launch {
            isLoadingGrants = true
            runCatching { ApiClient.shared.listMcpGrants() }
                .onSuccess {
                    grants = it
                    grantsError = null
                }
                .onFailure { grantsError = "Couldn't load connected apps. ${it.message.orEmpty()}" }
            isLoadingGrants = false
        }
        scope.launch {
            isLoading = true
            runCatching { ApiClient.shared.listSessions() }
                .onSuccess {
                    sessions = it
                    errorMessage = null
                }
                .onFailure { errorMessage = "Couldn't load sessions. ${it.message.orEmpty()}" }
            isLoading = false
        }
    }

    LaunchedEffect(Unit) { load() }
    if (previewActivity != null) {
        LaunchedEffect(previewActivity) {
            delay(400)
            scrollState.animateScrollTo(scrollState.maxValue)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(scrollState)
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
                "Devices & sessions",
                modifier = Modifier.padding(start = 4.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
        }

        Text(
            "Where your account is signed in. Sign out anything you don't recognize, then change your password.",
            modifier = Modifier.padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding, vertical = 8.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )

        SettingsSectionHeader("Signed in")

        if (isLoading && sessions.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.muted, strokeWidth = 2.dp)
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface),
            ) {
                sessions.forEachIndexed { index, session ->
                    SessionRow(
                        session = session,
                        busy = revokingId == session.id,
                        onSignOut = { sessionToRevoke = session },
                    )
                    if (index < sessions.lastIndex) {
                        HorizontalDivider(modifier = Modifier.padding(start = 52.dp), color = colors.line)
                    }
                }
            }
        }

        if (others.isNotEmpty()) {
            Spacer(Modifier.height(20.dp))
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .clickable(enabled = !isRevokingOthers) { showRevokeOthers = true }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Text(
                    if (isRevokingOthers) "Signing out…" else "Sign out everywhere else",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.deepDarkRed,
                )
            }
            Text(
                "Keeps you signed in on this phone. Browser extensions sign out too.",
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }

        SettingsSectionHeader("Connected apps")

        when {
            isLoadingGrants && grants.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.muted, strokeWidth = 2.dp)
            }
            grants.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Text(
                    grantsError ?: "No apps connected",
                    fontFamily = InterFontFamily,
                    fontSize = if (grantsError != null) 12.sp else 15.sp,
                    color = colors.muted,
                )
            }
            else -> Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface),
            ) {
                grants.forEachIndexed { index, grant ->
                    GrantRow(
                        grant = grant,
                        busy = revokingGrantId == grant.id,
                        onDisconnect = { grantToRevoke = grant },
                    )
                    if (index < grants.lastIndex) {
                        HorizontalDivider(modifier = Modifier.padding(start = 52.dp), color = colors.line)
                    }
                }
            }
        }
        Text(
            "AI assistants and other apps you allowed to use your mail over MCP. Disconnecting cuts off access right away.",
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )

        SettingsSectionHeader("Recent security activity")

        when {
            isLoadingActivity && activity.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.muted, strokeWidth = 2.dp)
            }
            activity.isEmpty() -> Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Text(
                    if (activityFailed) "Couldn't load recent activity. Try again later." else "No security activity in the last 30 days",
                    fontFamily = InterFontFamily,
                    fontSize = if (activityFailed) 12.sp else 15.sp,
                    color = colors.muted,
                )
            }
            else -> Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface),
            ) {
                activity.forEachIndexed { index, event ->
                    ActivityRow(event)
                    if (index < activity.lastIndex) {
                        HorizontalDivider(modifier = Modifier.padding(start = 52.dp), color = colors.line)
                    }
                }
            }
        }
        Text(
            "Sign-ins and changes to how you sign in, from the last 30 days. Locations are approximate.",
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )

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
    }

    sessionToRevoke?.let { session ->
        AlertDialog(
            onDismissRequest = { sessionToRevoke = null },
            containerColor = colors.surface,
            title = { Text("Sign out ${sessionTitle(session)}?", fontFamily = InterFontFamily, fontSize = 17.sp) },
            confirmButton = {
                TextButton(onClick = {
                    sessionToRevoke = null
                    scope.launch {
                        revokingId = session.id
                        errorMessage = null
                        runCatching { ApiClient.shared.revokeSession(session.id) }
                            .onSuccess {
                                sessions = sessions.filterNot { it.id == session.id }
                                statusMessage = "Signed out ${sessionTitle(session)}"
                            }
                            .onFailure { errorMessage = it.message }
                        revokingId = null
                    }
                }) {
                    Text("Sign out", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { sessionToRevoke = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }

    grantToRevoke?.let { grant ->
        AlertDialog(
            onDismissRequest = { grantToRevoke = null },
            containerColor = colors.surface,
            title = { Text("Disconnect ${grantTitle(grant)}?", fontFamily = InterFontFamily, fontSize = 17.sp) },
            text = {
                Text(
                    "It loses access to your mail immediately. To use it again, connect it again from the app.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    grantToRevoke = null
                    scope.launch {
                        revokingGrantId = grant.id
                        errorMessage = null
                        runCatching { ApiClient.shared.revokeMcpGrant(grant.id) }
                            .onSuccess {
                                grants = grants.filterNot { it.id == grant.id }
                                statusMessage = "Disconnected ${grantTitle(grant)}"
                            }
                            .onFailure { errorMessage = it.message }
                        revokingGrantId = null
                    }
                }) {
                    Text("Disconnect", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { grantToRevoke = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }

    if (showRevokeOthers) {
        AlertDialog(
            onDismissRequest = { showRevokeOthers = false },
            containerColor = colors.surface,
            title = { Text("Sign out everywhere else?", fontFamily = InterFontFamily, fontSize = 17.sp) },
            confirmButton = {
                TextButton(onClick = {
                    showRevokeOthers = false
                    scope.launch {
                        isRevokingOthers = true
                        errorMessage = null
                        runCatching { ApiClient.shared.revokeOtherSessions() }
                            .onSuccess {
                                load()
                                statusMessage = "Signed out ${it.revoked} other session${if (it.revoked == 1) "" else "s"}"
                            }
                            .onFailure { errorMessage = it.message }
                        isRevokingOthers = false
                    }
                }) {
                    val count = others.size
                    Text(
                        "Sign out $count other session${if (count == 1) "" else "s"}",
                        fontFamily = InterFontFamily,
                        color = colors.deepDarkRed,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showRevokeOthers = false }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

@Composable
private fun SessionRow(session: AccountSession, busy: Boolean, onSignOut: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(sessionIcon(session), contentDescription = null, tint = colors.ink, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    sessionTitle(session),
                    fontFamily = InterFontFamily,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (session.current) {
                    Text(
                        "This device",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 11.sp,
                        color = colors.accent,
                        modifier = Modifier
                            .background(colors.pillFill, RoundedCornerShape(50))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                sessionSubtitle(session),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
                maxLines = 1,
            )
        }
        when {
            busy -> CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
            !session.current -> TextButton(onClick = onSignOut) {
                Text("Sign out", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.deepDarkRed)
            }
        }
    }
}

@Composable
private fun GrantRow(grant: McpGrant, busy: Boolean, onDisconnect: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = colors.ink, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                grantTitle(grant),
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
            )
            Text(
                grantSubtitle(grant),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
                maxLines = 2,
            )
        }
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
        } else {
            TextButton(onClick = onDisconnect) {
                Text("Disconnect", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.deepDarkRed)
            }
        }
    }
}

@Composable
private fun ActivityRow(event: SecurityActivityItem) {
    val colors = inboxiesColors()
    // Time first so it survives truncation; the title keeps the full row width (same as iOS).
    val time = runCatching { Instant.parse(event.createdAt) }.getOrNull()?.let { relative(it) }
    val subtitle = listOfNotNull(time, securityEventDetail(event))
        .filter { it.isNotEmpty() }
        .joinToString(" · ")
        .replaceFirstChar { it.uppercase() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(securityEventIcon(event), contentDescription = null, tint = colors.ink, modifier = Modifier.size(22.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                securityEventTitle(event),
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 2,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    subtitle,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    maxLines = 2,
                )
            }
        }
    }
}

/** Which Recent security activity state a DEBUG preview shows (AVE-151). */
enum class SecurityActivityPreview { Events, Empty, Error }

internal const val SECURITY_EVENT_FALLBACK_TITLE = "Account security change"

/**
 * "Signed in from a new device", "Password changed", "Google sign-in connected", …
 * Same copy as iOS `SecurityActivity.title` and web `securityEventTitle`.
 */
internal fun securityEventTitle(event: SecurityActivityItem): String = when (event.kind) {
    "sign_in" -> if (event.newDevice) "Signed in from a new device" else "Signed in"
    "password_changed" -> "Password changed"
    "password_added" -> "Password added"
    "password_reset" -> "Password reset"
    "two_factor_enabled" -> "Two-factor authentication turned on"
    "two_factor_disabled" -> "Two-factor authentication turned off"
    "passkey_added" -> "Passkey added"
    "passkey_removed" -> "Passkey removed"
    "sign_in_method_added" -> providerName(event.provider)?.let { "$it sign-in connected" } ?: "Sign-in method connected"
    "sign_in_method_removed" -> providerName(event.provider)?.let { "$it sign-in removed" } ?: "Sign-in method removed"
    "recovery_email_set" -> "Recovery email changed"
    "recovery_email_removed" -> "Recovery email removed"
    else -> SECURITY_EVENT_FALLBACK_TITLE
}

/** "Chrome on macOS · Lagos, Nigeria"; empty when neither is known. */
internal fun securityEventDetail(event: SecurityActivityItem): String =
    listOfNotNull(event.device?.trim(), event.location?.trim())
        .filter { it.isNotEmpty() }
        .joinToString(" · ")

private fun providerName(provider: String?): String? {
    val p = provider?.trim()?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
    return when (p) {
        "google" -> "Google"
        "apple" -> "Apple"
        "password", "credential" -> "Password"
        else -> p.replaceFirstChar { it.uppercase() }
    }
}

private fun securityEventIcon(event: SecurityActivityItem): ImageVector = when (event.kind) {
    "sign_in" -> Icons.AutoMirrored.Outlined.Login
    "password_changed", "password_added", "password_reset" -> Icons.Outlined.Key
    "two_factor_enabled", "two_factor_disabled" -> Icons.Outlined.Security
    "passkey_added", "passkey_removed" -> Icons.Outlined.Fingerprint
    "recovery_email_set", "recovery_email_removed" -> Icons.Outlined.Email
    "sign_in_method_added", "sign_in_method_removed" -> Icons.Outlined.AccountCircle
    else -> Icons.Outlined.Shield
}

/** The app's registered name (unverified). Same rules as iOS `SessionsSettingsView.grantTitle`. */
internal fun grantTitle(grant: McpGrant): String =
    grant.clientName?.trim()?.takeIf { it.isNotEmpty() } ?: "Unnamed app"

private val scopeLabels = mapOf("read" to "Read", "draft" to "Drafts", "send" to "Send", "manage" to "Organize")

/** "Connected 3 days ago · Read, Drafts · All mailboxes" */
internal fun grantSubtitle(grant: McpGrant): String {
    val parts = mutableListOf<String>()
    runCatching { Instant.parse(grant.createdAt) }.getOrNull()?.let { parts += "Connected ${relative(it)}" }
    grant.scopes.joinToString(", ") { scopeLabels[it] ?: it }.takeIf { it.isNotEmpty() }?.let { parts += it }
    val mailboxes = grant.mailboxIds
    parts += when {
        mailboxes == null -> "All mailboxes"
        mailboxes.size == 1 -> mailboxes[0]
        else -> "${mailboxes.size} mailboxes"
    }
    return parts.joinToString(" · ")
}

/** Server label, else a name from the user agent. Same rules as iOS `SessionsSettingsView.title`. */
internal fun sessionTitle(session: AccountSession): String {
    session.label?.takeIf { it.isNotBlank() }?.let { return it }
    val agent = session.userAgent.orEmpty().lowercase()
    if (agent.contains("inboxies") && agent.contains("android")) return "Inboxies for Android"
    if (agent.contains("cfnetwork") || (agent.contains("inboxies") && agent.contains("ios"))) return "Inboxies for iPhone"
    if (agent.contains("okhttp")) return "Inboxies for Android"
    val browser = when {
        agent.contains("edg/") -> "Edge"
        agent.contains("firefox/") -> "Firefox"
        agent.contains("chrome/") -> "Chrome"
        agent.contains("safari/") -> "Safari"
        else -> null
    }
    val os = when {
        agent.contains("iphone") -> "iPhone"
        agent.contains("ipad") -> "iPad"
        agent.contains("android") -> "Android"
        agent.contains("mac os") -> "Mac"
        agent.contains("windows") -> "Windows"
        agent.contains("linux") -> "Linux"
        else -> null
    }
    return when {
        browser != null && os != null -> "$browser on $os"
        browser != null -> browser
        os != null -> os
        else -> "Unknown device"
    }
}

private fun sessionSubtitle(session: AccountSession): String {
    val parts = mutableListOf<String>()
    runCatching { Instant.parse(session.lastActiveAt) }.getOrNull()?.let { at ->
        parts += if (session.current) "Active now" else "Active ${relative(at)}"
    }
    session.ipAddress?.takeIf { it.isNotBlank() }?.let { parts += it }
    if (session.scope == "aliases") parts += "Private emails only"
    return parts.joinToString(" · ")
}

internal fun relative(at: Instant, now: Instant = Instant.now()): String {
    val elapsed = Duration.between(at, now).let { if (it.isNegative) Duration.ZERO else it }
    return when {
        elapsed.toMinutes() < 1 -> "just now"
        elapsed.toHours() < 1 -> "${elapsed.toMinutes()} min ago"
        elapsed.toDays() < 1 -> "${elapsed.toHours()} hr ago"
        elapsed.toDays() == 1L -> "yesterday"
        else -> "${elapsed.toDays()} days ago"
    }
}

private fun sessionIcon(session: AccountSession): ImageVector {
    val title = sessionTitle(session).lowercase()
    return when {
        session.scope == "aliases" -> if (title.contains("extension")) Icons.Outlined.Extension else Icons.Outlined.Key
        title.contains("android") -> Icons.Outlined.PhoneAndroid
        title.contains("iphone") || title.contains("ipad") -> Icons.Outlined.PhoneIphone
        else -> Icons.Outlined.Laptop
    }
}

private fun previewGrants(): List<McpGrant> {
    val now = Instant.now()
    return listOf(
        McpGrant(
            id = "g-1", clientId = "c-1", clientName = "Claude Desktop",
            scopes = listOf("read", "draft", "send", "manage"),
            createdAt = now.minusSeconds(3 * 86_400).toString(),
        ),
        McpGrant(
            id = "g-2", clientId = "c-2", scopes = listOf("read"), mailboxIds = listOf("hello@inboxies.email"),
            createdAt = now.minusSeconds(3_600).toString(),
        ),
    )
}

private fun previewSecurityActivity(): List<SecurityActivityItem> {
    val now = Instant.now()
    fun ago(seconds: Long) = now.minusSeconds(seconds).toString()
    return listOf(
        SecurityActivityItem(
            id = "a-1", kind = "sign_in", createdAt = ago(12 * 60), device = "Inboxies app on Android",
            location = "Lagos, Nigeria", country = "NG", newDevice = true,
        ),
        SecurityActivityItem(
            id = "a-2", kind = "two_factor_enabled", createdAt = ago(3 * 3_600),
            device = "Safari on macOS", location = "Lagos, Nigeria",
        ),
        SecurityActivityItem(
            id = "a-3", kind = "sign_in_method_added", createdAt = ago(26 * 3_600),
            device = "Chrome on Windows", provider = "google",
        ),
        SecurityActivityItem(
            id = "a-4", kind = "password_changed", createdAt = ago(4 * 86_400),
            device = "Safari on macOS", location = "Accra, Ghana",
        ),
        SecurityActivityItem(id = "a-5", kind = "recovery_email_set", createdAt = ago(12 * 86_400)),
    )
}

private fun previewSessions(): List<AccountSession> {
    val now = Instant.now()
    return listOf(
        AccountSession(
            id = "s-1", userAgent = "okhttp/4.12.0", ipAddress = "203.0.113.4",
            createdAt = now.toString(), lastActiveAt = now.toString(),
            expiresAt = now.plusSeconds(30 * 86_400).toString(), current = true,
        ),
        AccountSession(
            id = "s-2",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
            ipAddress = "198.51.100.20", createdAt = now.minusSeconds(5 * 86_400).toString(),
            lastActiveAt = now.minusSeconds(3_600).toString(), expiresAt = now.plusSeconds(25 * 86_400).toString(),
        ),
        AccountSession(
            id = "s-3", label = "Browser extension", scope = "aliases",
            createdAt = now.minusSeconds(2 * 86_400).toString(), lastActiveAt = now.minusSeconds(2 * 86_400).toString(),
            expiresAt = now.plusSeconds(28 * 86_400).toString(),
        ),
    )
}

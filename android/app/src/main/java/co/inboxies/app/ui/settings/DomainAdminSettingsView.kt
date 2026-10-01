package co.inboxies.app.ui.settings

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun DomainAdminSettingsView(
    onBack: (() -> Unit)? = null,
    onAssigned: (() -> Unit)? = null,
    /** DEBUG preview fixtures — skips network reload when non-null. */
    previewRows: List<AdminMailboxRow>? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    val cachedRows by app.adminMailboxes.collectAsState()
    var rows by remember { mutableStateOf(previewRows ?: cachedRows ?: emptyList()) }
    var loading by remember { mutableStateOf(previewRows == null && cachedRows == null) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var lastInviteUrl by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var selectedMailboxId by remember { mutableStateOf<String?>(null) }
    var showingDns by remember { mutableStateOf(false) }

    LaunchedEffect(cachedRows) {
        if (previewRows == null && cachedRows != null) {
            rows = cachedRows!!
            loading = false
        }
    }

    fun reload() {
        if (previewRows != null) {
            rows = previewRows
            loading = false
            return
        }
        scope.launch {
            loading = rows.isEmpty()
            error = null
            runCatching { ApiClient.shared.listAdminMailboxes() }
                .onSuccess {
                    rows = it
                    app.setAdminMailboxes(it)
                }
                .onFailure {
                    if (rows.isEmpty()) {
                        error = it.message
                    }
                }
            loading = false
        }
    }

    LaunchedEffect(previewRows) {
        if (previewRows != null || rows.isEmpty()) {
            reload()
        }
    }

    BackHandler(enabled = showingDns || selectedMailboxId != null) {
        if (showingDns) {
            showingDns = false
        } else {
            selectedMailboxId = null
        }
    }

    val currentScreen = when {
        showingDns -> "dns"
        selectedMailboxId != null -> selectedMailboxId
        else -> null
    }

    AnimatedContent(
        targetState = currentScreen,
        transitionSpec = {
            val forward = targetState != null
            (
                slideInHorizontally(settingsNavSpring()) { full -> if (forward) full / 4 else -full / 4 } +
                fadeIn(settingsNavSpring())
            ) togetherWith (
                slideOutHorizontally(settingsNavSpring()) { full -> if (forward) -full / 4 else full / 4 } +
                fadeOut(settingsNavSpring())
            )
        },
        label = "DomainAdminAnimatedContent",
    ) { screen ->
        when (screen) {
            "dns" -> {
                DomainAdminDNSView(
                    onBack = { showingDns = false },
                )
            }
            null -> {
                Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (onBack != null) {
                        HomeChromeToolbarButton(
                            icon = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back",
                            onClick = onBack,
                        )
                    }
                    Text(
                        "Admin",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                    )
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Refresh,
                        contentDescription = "Refresh",
                        onClick = { reload() },
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 40.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    error?.let {
                        Text(it, color = colors.deepDarkRed, fontFamily = InterFontFamily, fontSize = 13.sp)
                    }
                    status?.let {
                        Text(it, color = colors.muted, fontFamily = InterFontFamily, fontSize = 13.sp)
                    }
                    lastInviteUrl?.let { url ->
                        Text("Invite link", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, color = colors.ink)
                        Text(url, fontFamily = InterFontFamily, fontSize = 11.sp, color = colors.muted)
                        TextButton(onClick = {
                            clipboard.setText(AnnotatedString(url))
                            status = "Invite link copied"
                        }) {
                            Text("Copy link", color = colors.accent, fontFamily = InterFontFamily)
                        }
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors.surface)
                            .border(BorderStroke(0.5.dp, colors.line.copy(alpha = 0.65f)), RoundedCornerShape(12.dp))
                            .clickable { showingDns = true }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Public,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "DNS & Domain Configuration",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 15.sp,
                                color = colors.ink,
                            )
                            Text(
                                "Cloudflare zones, nameservers & email health",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                        }
                        Icon(
                            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                            contentDescription = null,
                            tint = colors.muted.copy(alpha = 0.55f),
                            modifier = Modifier.size(18.dp),
                        )
                    }

                    Button(
                        onClick = { showCreate = true },
                        colors = ButtonDefaults.buttonColors(containerColor = colors.ink, contentColor = colors.surface),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Create email",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                        )
                    }

                    Text(
                        "Domain mailboxes",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = colors.ink,
                        modifier = Modifier.padding(top = 8.dp),
                    )

                    if (loading) {
                        CircularProgressIndicator(modifier = Modifier.padding(24.dp))
                    } else if (rows.isEmpty()) {
                        Text(
                            "No mailboxes yet. Create the first address.",
                            fontFamily = InterFontFamily,
                            color = colors.muted,
                            fontSize = 14.sp,
                        )
                    } else {
                        rows.forEachIndexed { index, row ->
                            if (index > 0) {
                                HorizontalDivider(
                                    thickness = 0.5.dp,
                                    color = colors.line.copy(alpha = 0.65f),
                                    modifier = Modifier.padding(start = 4.dp),
                                )
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { selectedMailboxId = row.id }
                                    .padding(vertical = 12.dp, horizontal = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(
                                        row.email,
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 15.sp,
                                        color = colors.ink,
                                    )
                                    Text(
                                        if (row.claimed) "Claimed · ${row.name}" else "Unclaimed · ${row.name}",
                                        fontFamily = InterFontFamily,
                                        fontSize = 12.sp,
                                        color = colors.muted,
                                    )
                                }
                                Icon(
                                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                                    contentDescription = null,
                                    tint = colors.muted.copy(alpha = 0.55f),
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
        else -> {
                val targetMailbox = rows.find { it.id == screen }
                if (targetMailbox != null) {
                    DomainAdminMailboxDetailView(
                        mailbox = targetMailbox,
                        onBack = { selectedMailboxId = null },
                        onAssigned = onAssigned,
                        onMailboxUpdated = { updated ->
                            rows = rows.map { if (it.id == updated.id) updated else it }
                            app.setAdminMailboxes(rows)
                        },
                        onMailboxDeleted = { deletedId ->
                            rows = rows.filter { it.id != deletedId }
                            app.setAdminMailboxes(rows)
                            selectedMailboxId = null
                            status = "Mailbox deleted"
                        },
                        previewRows = previewRows,
                    )
                } else {
                    selectedMailboxId = null
                }
            }
        }
    }

    if (showCreate) {
        DomainAdminCreateDialog(
            onDismiss = { showCreate = false },
            onCreated = { url ->
                showCreate = false
                lastInviteUrl = url
                status = if (url == null) "Mailbox created" else "Mailbox created — invite ready"
                reload()
            },
        )
    }
}

/**
 * Extracts valid user email addresses from ACL keys, filtering out OAuth/auth methods, sub:, user:, account: identifiers.
 */
fun userEmailsFromAcl(keys: List<String>?): List<String> {
    if (keys.isNullOrEmpty()) return emptyList()
    val emails = mutableListOf<String>()
    for (key in keys) {
        val trimmed = key.trim()
        val lower = trimmed.lowercase()
        val email = when {
            lower.startsWith("email:") -> trimmed.removePrefix("email:").trim()
            !lower.startsWith("sub:") && !lower.startsWith("user:") && !lower.startsWith("account:") && trimmed.contains("@") -> trimmed
            else -> null
        }
        if (!email.isNullOrEmpty() && email.contains("@") && emails.none { it.equals(email, ignoreCase = true) }) {
            emails.add(email)
        }
    }
    return emails
}

@Composable
private fun DomainAdminMailboxDetailView(
    mailbox: AdminMailboxRow,
    onBack: () -> Unit,
    onAssigned: (() -> Unit)? = null,
    onMailboxUpdated: (AdminMailboxRow) -> Unit,
    onMailboxDeleted: (String) -> Unit,
    previewRows: List<AdminMailboxRow>? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    val auth = LocalAuthStore.current
    val authEmail by auth.userEmail.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()

    var currentMailbox by remember(mailbox) { mutableStateOf(mailbox) }
    var isAssigning by remember { mutableStateOf(false) }
    var isDeleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var lastInviteUrl by remember { mutableStateOf<String?>(null) }
    var showInviteDialog by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val isAssignedToCurrentUser = remember(currentMailbox, mailboxes, authEmail) {
        val normalizedAuth = authEmail?.trim()?.lowercase()
        mailboxes.any { it.id == currentMailbox.id || it.email.equals(currentMailbox.email, ignoreCase = true) } ||
            (!normalizedAuth.isNullOrEmpty() && (
                currentMailbox.email.equals(normalizedAuth, ignoreCase = true) ||
                userEmailsFromAcl(currentMailbox.acl?.owners).any { it.equals(normalizedAuth, ignoreCase = true) } ||
                userEmailsFromAcl(currentMailbox.acl?.members).any { it.equals(normalizedAuth, ignoreCase = true) }
            ))
    }

    Column(modifier = Modifier.fillMaxWidth()) {
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
                currentMailbox.email,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            error?.let {
                Text(
                    it,
                    color = colors.deepDarkRed,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            status?.let {
                Text(
                    it,
                    color = colors.muted,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            lastInviteUrl?.let { url ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "Invite link",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.ink,
                    )
                    Text(url, fontFamily = InterFontFamily, fontSize = 11.sp, color = colors.muted)
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(url))
                        status = "Invite link copied"
                    }) {
                        Text("Copy link", color = colors.accent, fontFamily = InterFontFamily)
                    }
                }
            }

            SettingsFormSectionHeader("Mailbox details")
            SettingsFormGroup {
                MailboxDetailInfoRow("Address", currentMailbox.email)
                SettingsFormDivider()
                MailboxDetailInfoRow("Display name", currentMailbox.name)
                SettingsFormDivider()
                MailboxDetailInfoRow("Status", if (currentMailbox.claimed) "Claimed" else "Unclaimed")

                val owners = userEmailsFromAcl(currentMailbox.acl?.owners)
                SettingsFormDivider()
                MailboxDetailInfoRow(
                    label = "Owners",
                    value = owners.joinToString(", ").ifBlank { "None" },
                    singleLine = true,
                )

                val members = userEmailsFromAcl(currentMailbox.acl?.members)
                if (members.isNotEmpty()) {
                    SettingsFormDivider()
                    MailboxDetailInfoRow(
                        label = "Members",
                        value = members.joinToString(", "),
                        singleLine = true,
                    )
                }
            }

            SettingsFormSectionHeader("Actions")
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!isAssignedToCurrentUser) {
                    Button(
                        onClick = {
                            scope.launch {
                                isAssigning = true
                                error = null
                                runCatching {
                                    if (previewRows == null) {
                                        ApiClient.shared.assignAdminMailboxToSelf(currentMailbox.id)
                                        app.refreshMailboxes(showLoading = true)
                                    }
                                    status = "Assigned to you"
                                    val updated = currentMailbox.copy(claimed = true)
                                    currentMailbox = updated
                                    onMailboxUpdated(updated)
                                    onAssigned?.invoke()
                                }.onFailure { error = it.message }
                                isAssigning = false
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = colors.accent.copy(alpha = 0.12f),
                            contentColor = colors.accent,
                        ),
                        border = BorderStroke(1.dp, colors.accent.copy(alpha = 0.35f)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        enabled = !isAssigning && !isDeleting,
                    ) {
                        if (isAssigning) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = colors.accent,
                            )
                        } else {
                            Icon(
                                imageVector = Icons.Outlined.PersonAdd,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Assign to me",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                        )
                    }
                }

                Button(
                    onClick = { showInviteDialog = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.surface,
                        contentColor = colors.ink,
                    ),
                    border = BorderStroke(1.dp, colors.line),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    enabled = !isAssigning && !isDeleting,
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Mail,
                        contentDescription = null,
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Invite someone",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                    )
                }

                Button(
                    onClick = { showDeleteConfirm = true },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = colors.deepDarkRed.copy(alpha = 0.08f),
                        contentColor = colors.deepDarkRed,
                    ),
                    border = BorderStroke(1.dp, colors.deepDarkRed.copy(alpha = 0.25f)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    enabled = !isAssigning && !isDeleting,
                ) {
                    if (isDeleting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = colors.deepDarkRed,
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.Delete,
                            contentDescription = null,
                            tint = colors.deepDarkRed,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "Delete mailbox",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                    )
                }
            }
        }
    }

    if (showInviteDialog) {
        DomainAdminInviteDialog(
            mailboxId = currentMailbox.id,
            onDismiss = { showInviteDialog = false },
            onInvited = { url ->
                showInviteDialog = false
                lastInviteUrl = url
                status = "Invite ready"
            },
        )
    }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete mailbox", fontFamily = InterFontFamily) },
            text = {
                Text("Delete ${currentMailbox.email}? This cannot be undone.", fontFamily = InterFontFamily)
            },
            confirmButton = {
                TextButton(onClick = {
                    showDeleteConfirm = false
                    scope.launch {
                        isDeleting = true
                        error = null
                        runCatching {
                            if (previewRows == null) {
                                ApiClient.shared.deleteAdminMailbox(currentMailbox.id)
                                app.refreshMailboxes(showLoading = true)
                            }
                            onMailboxDeleted(currentMailbox.id)
                        }.onFailure {
                            error = it.message
                            isDeleting = false
                        }
                    }
                }) {
                    Text("Delete", color = colors.deepDarkRed, fontFamily = InterFontFamily)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancel", fontFamily = InterFontFamily)
                }
            },
        )
    }
}

@Composable
private fun MailboxDetailInfoRow(
    label: String,
    value: String,
    singleLine: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            fontFamily = InterFontFamily,
            fontSize = 15.sp,
            color = colors.muted,
        )
        Spacer(Modifier.width(12.dp))
        Text(
            value,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = colors.ink,
            textAlign = TextAlign.End,
            maxLines = if (singleLine) 1 else Int.MAX_VALUE,
            overflow = if (singleLine) TextOverflow.Ellipsis else TextOverflow.Clip,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

@Composable
private fun DomainAdminCreateDialog(
    onDismiss: () -> Unit,
    onCreated: (String?) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var localPart by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var assignSelf by remember { mutableStateOf(true) }
    var inviteEmail by remember { mutableStateOf("") }
    var inviteName by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val app = LocalAppModel.current
    val domain by app.mailDomain.collectAsState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Create email", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = localPart,
                    onValueChange = { localPart = it.substringBefore('@') },
                    label = { Text("Username") },
                    trailingIcon = { Text("@$domain", color = colors.muted, fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Display name (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(
                        selected = assignSelf,
                        onClick = { assignSelf = true },
                        colors = RadioButtonDefaults.colors(selectedColor = colors.accent),
                    )
                    Text("Assign to me", fontFamily = InterFontFamily, color = colors.ink)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(
                        selected = !assignSelf,
                        onClick = { assignSelf = false },
                        colors = RadioButtonDefaults.colors(selectedColor = colors.accent),
                    )
                    Text("Invite someone", fontFamily = InterFontFamily, color = colors.ink)
                }
                if (!assignSelf) {
                    OutlinedTextField(
                        value = inviteEmail,
                        onValueChange = { inviteEmail = it },
                        label = { Text("Invitee email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    OutlinedTextField(
                        value = inviteName,
                        onValueChange = { inviteName = it },
                        label = { Text("Invitee name (optional)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                }
                error?.let { Text(it, color = colors.deepDarkRed, fontSize = 13.sp) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !saving && localPart.isNotBlank() && (assignSelf || inviteEmail.isNotBlank()),
                onClick = {
                    scope.launch {
                        saving = true
                        error = null
                        runCatching {
                            ApiClient.shared.createAdminMailbox(
                                email = "$localPart@$domain",
                                name = displayName.ifBlank { localPart },
                                assignToSelf = assignSelf,
                                inviteEmail = inviteEmail.ifBlank { null },
                                inviteeName = inviteName.ifBlank { null },
                            )
                        }.onSuccess { onCreated(it.invite?.inviteUrl) }
                            .onFailure { error = it.message }
                        saving = false
                    }
                },
            ) {
                Text(if (saving) "Creating…" else "Create", color = colors.accent, fontFamily = InterFontFamily)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", fontFamily = InterFontFamily)
            }
        },
    )
}

@Composable
private fun DomainAdminInviteDialog(
    mailboxId: String,
    onDismiss: () -> Unit,
    onInvited: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var inviteEmail by remember { mutableStateOf("") }
    var inviteName by remember { mutableStateOf("") }
    var asOwner by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Invite", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(mailboxId, fontFamily = InterFontFamily, color = colors.muted, fontSize = 13.sp)
                OutlinedTextField(
                    value = inviteEmail,
                    onValueChange = { inviteEmail = it },
                    label = { Text("Invitee email") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                OutlinedTextField(
                    value = inviteName,
                    onValueChange = { inviteName = it },
                    label = { Text("Name (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(
                        selected = asOwner,
                        onClick = { asOwner = true },
                        colors = RadioButtonDefaults.colors(selectedColor = colors.accent),
                    )
                    Text("Owner", fontFamily = InterFontFamily)
                    RadioButton(
                        selected = !asOwner,
                        onClick = { asOwner = false },
                        colors = RadioButtonDefaults.colors(selectedColor = colors.accent),
                    )
                    Text("Member", fontFamily = InterFontFamily)
                }
                error?.let { Text(it, color = colors.deepDarkRed, fontSize = 13.sp) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !saving && inviteEmail.isNotBlank(),
                onClick = {
                    scope.launch {
                        saving = true
                        runCatching {
                            ApiClient.shared.createAdminInvite(
                                mailboxId,
                                inviteEmail.trim(),
                                inviteName.ifBlank { null },
                                if (asOwner) "owner" else "member",
                            )
                        }.onSuccess { onInvited(it.inviteUrl) }
                            .onFailure { error = it.message }
                        saving = false
                    }
                },
            ) {
                Text(if (saving) "Sending…" else "Send", color = colors.accent, fontFamily = InterFontFamily)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", fontFamily = InterFontFamily)
            }
        },
    )
}

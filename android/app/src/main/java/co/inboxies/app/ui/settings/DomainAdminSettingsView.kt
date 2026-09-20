package co.inboxies.app.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
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
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    var rows by remember { mutableStateOf<List<AdminMailboxRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var lastInviteUrl by remember { mutableStateOf<String?>(null) }
    var assigningId by remember { mutableStateOf<String?>(null) }
    var showCreate by remember { mutableStateOf(false) }
    var inviteMailboxId by remember { mutableStateOf<String?>(null) }
    var deleteTarget by remember { mutableStateOf<AdminMailboxRow?>(null) }

    fun reload() {
        scope.launch {
            loading = rows.isEmpty()
            error = null
            runCatching { ApiClient.shared.listAdminMailboxes() }
                .onSuccess { rows = it }
                .onFailure { error = it.message }
            loading = false
        }
    }

    LaunchedEffect(Unit) { reload() }

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

            Button(
                onClick = { showCreate = true },
                colors = ButtonDefaults.buttonColors(containerColor = colors.ink, contentColor = colors.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Create email", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium)
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
                rows.forEach { row ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(row.email, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, color = colors.ink)
                        Text(
                            if (row.claimed) "Claimed · ${row.name}" else "Unclaimed · ${row.name}",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(
                                onClick = {
                                    scope.launch {
                                        assigningId = row.id
                                        runCatching {
                                            ApiClient.shared.assignAdminMailboxToSelf(row.id)
                                            app.refreshMailboxes(showLoading = true)
                                            status = "Assigned to you"
                                            onAssigned?.invoke()
                                            reload()
                                        }.onFailure { error = it.message }
                                        assigningId = null
                                    }
                                },
                                enabled = assigningId == null,
                            ) {
                                Text("Assign to me", color = colors.accent, fontFamily = InterFontFamily)
                            }
                            TextButton(onClick = { inviteMailboxId = row.id }) {
                                Text("Invite", color = colors.accent, fontFamily = InterFontFamily)
                            }
                            TextButton(onClick = { deleteTarget = row }) {
                                Text("Delete", color = colors.deepDarkRed, fontFamily = InterFontFamily)
                            }
                        }
                    }
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

    inviteMailboxId?.let { mailboxId ->
        DomainAdminInviteDialog(
            mailboxId = mailboxId,
            onDismiss = { inviteMailboxId = null },
            onInvited = { url ->
                inviteMailboxId = null
                lastInviteUrl = url
                status = "Invite ready"
            },
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete mailbox", fontFamily = InterFontFamily) },
            text = {
                Text("Delete ${target.email}? This cannot be undone.", fontFamily = InterFontFamily)
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        runCatching {
                            ApiClient.shared.deleteAdminMailbox(target.id)
                            app.refreshMailboxes(showLoading = true)
                            status = "Mailbox deleted"
                            reload()
                        }.onFailure { error = it.message }
                        deleteTarget = null
                    }
                }) {
                    Text("Delete", color = colors.deepDarkRed, fontFamily = InterFontFamily)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("Cancel", fontFamily = InterFontFamily)
                }
            },
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

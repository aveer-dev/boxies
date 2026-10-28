package co.inboxies.app.ui.settings

import androidx.compose.foundation.layout.navigationBarsPadding
import co.inboxies.app.theme.ToastMetrics
import co.inboxies.app.ui.components.InboxiesToast
import co.inboxies.app.ui.components.AnimatedToast
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.MailboxInviteRow
import co.inboxies.app.models.MailboxMember
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private enum class SharingRole(val wire: String, val label: String) {
    MEMBER("member", "Member"),
    OWNER("owner", "Owner"),
}

/**
 * Who can use this mailbox. Owners invite people, change roles and remove
 * members; anyone can leave. People join only by accepting an emailed invite.
 */
@Composable
fun SharingSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val mailboxId by app.selectedMailboxId.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()
    val mailbox = mailboxes.firstOrNull { it.id == mailboxId }

    var members by remember { mutableStateOf<List<MailboxMember>>(emptyList()) }
    var invites by remember { mutableStateOf<List<MailboxInviteRow>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var showAddModal by remember { mutableStateOf(false) }
    var showLeaveConfirm by remember { mutableStateOf(false) }
    var memberToRemove by remember { mutableStateOf<MailboxMember?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var isLeaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    val me = members.firstOrNull { it.you }
    val canManage = mailbox?.canManage == true || me?.isOwner == true
    val owners = members.filter { it.isOwner }
    val plainMembers = members.filterNot { it.isOwner }
    val pendingInvites = invites.filter { it.status == "pending" }

    fun toast(message: String) {
        saveMessage = message
        scope.launch {
            delay(2_500)
            if (saveMessage == message) saveMessage = null
        }
    }

    fun load() {
        val id = mailboxId ?: return
        if (app.isDebugPreview) {
            members = previewMembers(mailbox?.email ?: id)
            invites = previewInvites(id)
            isLoading = false
            return
        }
        scope.launch {
            isLoading = true
            runCatching { ApiClient.shared.listMembers(id) }
                .onSuccess { list ->
                    if (id != app.selectedMailboxId.value) return@onSuccess
                    members = list
                    loadError = null
                    invites = if (list.firstOrNull { it.you }?.isOwner == true || mailbox?.canManage == true) {
                        runCatching { ApiClient.shared.listMailboxInvites(id) }.getOrDefault(emptyList())
                    } else {
                        emptyList()
                    }
                }
                .onFailure { loadError = "Couldn't load members. ${it.message.orEmpty()}" }
            isLoading = false
        }
    }

    fun setRole(member: MailboxMember, role: SharingRole) {
        val id = mailboxId ?: return
        scope.launch {
            busyId = member.userId
            runCatching { ApiClient.shared.setMemberRole(id, member.userId, role.wire) }
                .onSuccess {
                    load()
                    toast(if (role == SharingRole.OWNER) "Now an owner" else "Now a member")
                }
                .onFailure { toast(it.message ?: "Couldn't change role") }
            busyId = null
        }
    }

    fun remove(member: MailboxMember) {
        val id = mailboxId ?: return
        scope.launch {
            busyId = member.userId
            runCatching { ApiClient.shared.removeMember(id, member.userId) }
                .onSuccess {
                    members = members.filterNot { it.userId == member.userId }
                    toast("Removed")
                }
                .onFailure { toast(it.message ?: "Couldn't remove") }
            busyId = null
        }
    }

    fun revoke(invite: MailboxInviteRow) {
        scope.launch {
            busyId = invite.id
            runCatching { ApiClient.shared.revokeInvite(invite.id) }
                .onSuccess {
                    invites = invites.filterNot { it.id == invite.id }
                    toast("Invite revoked")
                }
                .onFailure { toast(it.message ?: "Couldn't revoke") }
            busyId = null
        }
    }

    fun leave() {
        val id = mailboxId ?: return
        val self = me ?: return
        scope.launch {
            isLeaving = true
            runCatching { ApiClient.shared.removeMember(id, self.userId) }
                .onSuccess {
                    onBack()
                    app.refreshMailboxes(showLoading = true)
                    app.showToast("You left $id")
                }
                .onFailure { toast(it.message ?: "Couldn't leave") }
            isLeaving = false
        }
    }

    LaunchedEffect(mailboxId) { load() }

    val mailboxEmails = remember(mailboxes) { mailboxes.map { it.email.trim().lowercase() }.toSet() }

    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
            ) {
                HomeChromeToolbarButton(
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Text(
                    "Members",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                if (canManage) {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Add,
                        contentDescription = "Invite someone",
                        onClick = { showAddModal = true },
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    "People who can use this mailbox. Owners invite people and manage who has access. Members can read and send mail but can't change access.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .padding(top = 16.dp, bottom = 8.dp),
                )

                when {
                    isLoading && members.isEmpty() -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 40.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            color = colors.muted,
                            strokeWidth = 2.dp,
                        )
                    }
                    loadError != null && members.isEmpty() -> Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 40.dp, start = 20.dp, end = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(loadError!!, fontFamily = InterFontFamily, fontSize = 14.sp, color = colors.muted)
                        TextButton(onClick = { load() }) {
                            Text("Try again", fontFamily = InterFontFamily, color = colors.accent)
                        }
                    }
                    else -> {
                        MembersSectionHeader("Owners")
                        MembersCard {
                            MemberRows(
                                list = owners,
                                empty = "No owners yet.",
                                canManage = canManage,
                                busyId = busyId,
                                onSetRole = ::setRole,
                                onRemove = { memberToRemove = it },
                            )
                        }
                        MembersSectionHeader("Members")
                        MembersCard {
                            MemberRows(
                                list = plainMembers,
                                empty = "No members yet.",
                                canManage = canManage,
                                busyId = busyId,
                                onSetRole = ::setRole,
                                onRemove = { memberToRemove = it },
                            )
                        }
                        if (canManage && pendingInvites.isNotEmpty()) {
                            MembersSectionHeader("Pending invites")
                            MembersCard {
                                pendingInvites.forEachIndexed { index, invite ->
                                    InviteRow(invite, busy = busyId == invite.id, onRevoke = { revoke(invite) })
                                    if (index < pendingInvites.lastIndex) {
                                        HorizontalDivider(modifier = Modifier.padding(start = 16.dp), color = colors.line)
                                    }
                                }
                            }
                        }
                        if (me != null) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp)
                                    .padding(top = 28.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(colors.surface)
                                    .clickable(enabled = !isLeaving) { showLeaveConfirm = true }
                                    .padding(vertical = 14.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    if (isLeaving) "Leaving…" else "Leave mailbox",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 15.sp,
                                    color = colors.deepDarkRed,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(32.dp))
            }
        }

        if (showAddModal) {
            AddMemberDialog(
                existingEmails = (members.map { it.email.lowercase() } + pendingInvites.map { it.inviteeEmail.lowercase() }).toSet(),
                mailboxEmails = mailboxEmails,
                onDismiss = { showAddModal = false },
                onSendInvite = { email, role, done ->
                    val id = mailboxId ?: return@AddMemberDialog
                    scope.launch {
                        try {
                            val res = ApiClient.shared.createMailboxInvite(id, email.trim(), role.wire)
                            if (res.emailSent) {
                                toast("Invite emailed")
                            } else {
                                clipboard.setText(AnnotatedString(res.inviteUrl))
                                toast("Invite created — link copied")
                            }
                            showAddModal = false
                            load()
                        } catch (e: Exception) {
                            toast(e.message ?: "Invite failed")
                        } finally {
                            done()
                        }
                    }
                },
            )
        }

        memberToRemove?.let { member ->
            AlertDialog(
                onDismissRequest = { memberToRemove = null },
                title = { Text("Remove ${member.email}?", fontFamily = InterFontFamily, fontSize = 17.sp) },
                text = { Text("They lose access to this mailbox right away.", fontFamily = InterFontFamily) },
                confirmButton = {
                    TextButton(onClick = {
                        memberToRemove = null
                        remove(member)
                    }) {
                        Text("Remove", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { memberToRemove = null }) {
                        Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                    }
                },
                containerColor = colors.surface,
            )
        }

        if (showLeaveConfirm) {
            AlertDialog(
                onDismissRequest = { showLeaveConfirm = false },
                title = { Text("Leave this mailbox?", fontFamily = InterFontFamily, fontSize = 17.sp) },
                text = {
                    Text(
                        "You'll lose access to ${mailbox?.email ?: "this mailbox"} until an owner invites you again.",
                        fontFamily = InterFontFamily,
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        showLeaveConfirm = false
                        leave()
                    }) {
                        Text("Leave mailbox", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showLeaveConfirm = false }) {
                        Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                    }
                },
                containerColor = colors.surface,
            )
        }

        AnimatedToast(
            value = saveMessage,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = ToastMetrics.screenInset)
                .padding(bottom = ToastMetrics.standaloneBottomInset),
        ) { message ->
            InboxiesToast(message = message, onDismiss = { saveMessage = null })
        }
    }
}

@Composable
private fun MembersSectionHeader(title: String) {
    Text(
        title,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        color = inboxiesColors().ink,
        modifier = Modifier
            .padding(horizontal = 20.dp)
            .padding(top = 20.dp),
    )
}

@Composable
private fun MembersCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(inboxiesColors().surface),
        content = content,
    )
}

@Composable
private fun MemberRows(
    list: List<MailboxMember>,
    empty: String,
    canManage: Boolean,
    busyId: String?,
    onSetRole: (MailboxMember, SharingRole) -> Unit,
    onRemove: (MailboxMember) -> Unit,
) {
    val colors = inboxiesColors()
    if (list.isEmpty()) {
        Text(
            empty,
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = colors.muted,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
        )
        return
    }
    list.forEachIndexed { index, member ->
        MemberRow(member, canManage, busy = busyId == member.userId, onSetRole = onSetRole, onRemove = onRemove)
        if (index < list.lastIndex) {
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp), color = colors.line)
        }
    }
}

@Composable
private fun MemberRow(
    member: MailboxMember,
    canManage: Boolean,
    busy: Boolean,
    onSetRole: (MailboxMember, SharingRole) -> Unit,
    onRemove: (MailboxMember) -> Unit,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    val name = member.name?.trim().orEmpty()
    val showsName = name.isNotEmpty() && !name.equals(member.email, ignoreCase = true)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    if (showsName) name else member.email,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                )
                if (member.you) {
                    Text(
                        "You",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 11.sp,
                        color = colors.muted,
                        modifier = Modifier
                            .background(colors.pillFill, RoundedCornerShape(50))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            if (showsName) {
                Text(member.email, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted, maxLines = 1)
            }
        }
        when {
            busy -> CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
            canManage && !member.you -> Box {
                IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Outlined.MoreHoriz, contentDescription = "Manage ${member.email}", tint = colors.muted)
                }
                InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
                    if (member.isOwner) {
                        InboxiesMenuItem(text = "Make member", icon = Icons.Outlined.Person, onClick = {
                            menuOpen = false
                            onSetRole(member, SharingRole.MEMBER)
                        })
                    } else {
                        InboxiesMenuItem(text = "Make owner", icon = Icons.Outlined.Shield, onClick = {
                            menuOpen = false
                            onSetRole(member, SharingRole.OWNER)
                        })
                    }
                    InboxiesMenuItem(text = "Remove", icon = Icons.Outlined.PersonRemove, destructive = true, onClick = {
                        menuOpen = false
                        onRemove(member)
                    })
                }
            }
        }
    }
}

@Composable
private fun InviteRow(invite: MailboxInviteRow, busy: Boolean, onRevoke: () -> Unit) {
    val colors = inboxiesColors()
    val role = if (invite.role == "owner") "Owner" else "Member"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                invite.inviteeEmail,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
            )
            Text(
                "$role · expires ${shortDate(invite.expiresAt)}",
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
        } else {
            TextButton(onClick = onRevoke) {
                Text("Revoke", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.deepDarkRed)
            }
        }
    }
}

@Composable
private fun AddMemberDialog(
    existingEmails: Set<String>,
    mailboxEmails: Set<String>,
    onDismiss: () -> Unit,
    onSendInvite: (String, SharingRole, done: () -> Unit) -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    var email by remember { mutableStateOf("") }
    var isOwner by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }

    val role = if (isOwner) SharingRole.OWNER else SharingRole.MEMBER
    val trimmedEmail = email.trim().lowercase()
    val isMailboxEmail = mailboxEmails.contains(trimmedEmail)
    val isAlreadyListed = existingEmails.contains(trimmedEmail)
    val isValidEmail = !isMailboxEmail && !isAlreadyListed &&
        trimmedEmail.contains("@") && trimmedEmail.contains(".") && trimmedEmail.length >= 5

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = colors.surface,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Invite someone",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                    color = colors.ink,
                )
                IconButton(
                    onClick = {
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                        onDismiss()
                    },
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink, modifier = Modifier.size(20.dp))
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "Email address",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        placeholder = { Text("person@example.com", fontSize = 14.sp) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    when {
                        isMailboxEmail -> DialogHint("Mailboxes can't be members. Invite the person who uses it.", warning = true)
                        isAlreadyListed -> DialogHint("Already a member or invited.", warning = true)
                        isValidEmail -> DialogHint("We'll email them an invite. They confirm it with a code sent to this address.", warning = false)
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { isOwner = !isOwner }
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(end = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text("Owner", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 15.sp, color = colors.ink)
                        Text(
                            "Owners can manage mailbox settings and who has access.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                    }
                    Switch(
                        checked = isOwner,
                        onCheckedChange = { isOwner = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = Color.White),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = isValidEmail && !isSubmitting,
                onClick = {
                    isSubmitting = true
                    onSendInvite(trimmedEmail, role) { isSubmitting = false }
                },
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), color = colors.accent, strokeWidth = 2.dp)
                } else {
                    Text(
                        "Send invite",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isValidEmail) colors.accent else colors.muted,
                    )
                }
            }
        },
    )
}

@Composable
private fun DialogHint(text: String, warning: Boolean) {
    val colors = inboxiesColors()
    val tint = if (warning) colors.deepDarkRed else colors.muted
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier.padding(top = 4.dp),
    ) {
        Icon(if (warning) Icons.Outlined.Error else Icons.Outlined.Mail, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Text(text, fontFamily = InterFontFamily, fontSize = 12.sp, color = tint)
    }
}

private fun shortDate(iso: String): String = runCatching {
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
        .withZone(ZoneId.systemDefault())
        .format(Instant.parse(iso))
}.getOrDefault(iso)

private fun previewMembers(mailboxEmail: String) = listOf(
    MailboxMember(userId = "u-1", email = mailboxEmail, name = "Alex Rivera", role = "owner", you = true),
    MailboxMember(userId = "u-2", email = "ada@example.com", name = "Ada Lovelace", role = "owner"),
    MailboxMember(userId = "u-3", email = "jordan@example.com", role = "member"),
)

private fun previewInvites(mailboxId: String) = listOf(
    MailboxInviteRow(
        id = "inv-1",
        mailboxId = mailboxId,
        role = "member",
        inviteeEmail = "sam@example.com",
        expiresAt = Instant.now().plusSeconds(6 * 86_400).toString(),
        status = "pending",
    ),
)

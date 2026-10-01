package co.inboxies.app.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.Mail
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.AccountSummary
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SharingRole {
    MEMBER,
    OWNER,
}

private fun canonicalEmailAclKey(key: String): String? {
    if (!key.startsWith("email:")) return null
    val email = key.removePrefix("email:")
    val at = email.lastIndexOf('@')
    if (at <= 0) return null
    val local = email.substring(0, at)
    val plus = local.indexOf('+')
    return if (plus > 0) {
        "email:${local.substring(0, plus)}@${email.substring(at + 1)}"
    } else {
        "email:$email"
    }
}

private fun keysForEmail(email: String): Set<String> {
    val tagged = "email:$email"
    val canonical = canonicalEmailAclKey(tagged)
    return if (canonical != null && canonical != tagged) setOf(tagged, canonical) else setOf(tagged)
}

/// Checks if a key represents a user account and not an auth method / sub id.
private fun isUserAccountKey(key: String): Boolean {
    val trimmed = key.trim().lowercase()
    if (trimmed.startsWith("sub:")) return false
    if (trimmed.startsWith("user:")) return false
    return true
}

private fun normalizeKey(raw: String): String? {
    val trimmed = raw.trim().lowercase()
    if (trimmed.isEmpty()) return null
    if (trimmed.startsWith("email:")) {
        val email = trimmed.removePrefix("email:")
        return if (email.contains("@")) "email:$email" else null
    }
    if (trimmed.startsWith("sub:")) return trimmed
    return if (trimmed.contains("@")) "email:$trimmed" else null
}

private fun displayAccount(key: String, accounts: List<AccountSummary>): Pair<String, String?> {
    val trimmed = key.trim()
    if (trimmed.startsWith("email:", ignoreCase = true)) {
        val email = trimmed.removePrefix("email:")
        val match = accounts.firstOrNull { it.email.equals(email, ignoreCase = true) }
        if (match?.name != null && match.name.isNotBlank() && match.name != email) {
            return match.name to email
        }
        return email to null
    }
    if (trimmed.startsWith("account:", ignoreCase = true)) {
        val id = trimmed.removePrefix("account:")
        val match = accounts.firstOrNull { it.id == id }
        if (match != null) {
            if (match.name != null && match.name.isNotBlank() && match.name != match.email) {
                return match.name to match.email
            }
            return match.email to null
        }
        return "Account ${id.take(8)}…" to null
    }
    if (trimmed.contains("@")) {
        val match = accounts.firstOrNull { it.email.equals(trimmed, ignoreCase = true) }
        if (match?.name != null && match.name.isNotBlank() && match.name != trimmed) {
            return match.name to trimmed
        }
        return trimmed to null
    }
    return trimmed to null
}

@Composable
fun SharingSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailbox = app.selectedMailbox
    val authEmail by auth.userEmail.collectAsState()

    var owners by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.acl?.owners.orEmpty())
    }
    var members by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.acl?.members.orEmpty())
    }
    var viewerKeys by remember { mutableStateOf<Set<String>>(emptySet()) }
    var existingAccounts by remember { mutableStateOf<List<AccountSummary>>(emptyList()) }
    var showAddModal by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(mailbox?.id) {
        val me = runCatching { ApiClient.shared.getMe() }.getOrNull()
        viewerKeys = if (me != null) {
            me.keys.toSet()
        } else {
            authEmail?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }?.let { keysForEmail(it) }
                .orEmpty()
        }

        val mailboxEmails = app.mailboxes.value.map { it.email.trim().lowercase() }.toSet()

        // Load existing accounts
        val collected = mutableListOf<AccountSummary>()
        val fetched = runCatching { ApiClient.shared.listAccounts() }.getOrNull()
        if (fetched != null) {
            collected.addAll(fetched.filter { !mailboxEmails.contains(it.email.lowercase()) })
        }
        if (collected.isEmpty()) {
            collected.addAll(
                listOf(
                    AccountSummary(id = "acc-1", email = "admin@example.com", name = "Domain Admin"),
                    AccountSummary(id = "acc-2", email = "ada@example.com", name = "Ada Lovelace"),
                    AccountSummary(id = "acc-3", email = "jordan@example.com", name = "Jordan Hale"),
                    AccountSummary(id = "acc-4", email = "alex@example.com", name = "Alex Rivera"),
                    AccountSummary(id = "acc-5", email = "sam@example.com", name = "Sam Chen"),
                ).filter { !mailboxEmails.contains(it.email.lowercase()) },
            )
        }
        existingAccounts = collected
    }

    LaunchedEffect(mailbox?.id, mailbox?.settings?.acl) {
        owners = mailbox?.settings?.acl?.owners.orEmpty()
        members = mailbox?.settings?.acl?.members.orEmpty()
    }

    val canManage = mailbox?.canManage ?: owners.any { key ->
        viewerKeys.contains(key) || canonicalEmailAclKey(key)?.let(viewerKeys::contains) == true
    }

    /// Owners list should only be a list of user accounts, not auth methods and sub ids.
    val visibleOwners = owners.filter { isUserAccountKey(it) }
    val visibleMembers = members.filter { isUserAccountKey(it) }

    fun toast(message: String, ok: Boolean = true) {
        scope.launch {
            saveMessage = message
            delay(if (ok) 1400 else 2200)
            saveMessage = null
        }
    }

    fun persistAcl(newOwners: List<String>, newMembers: List<String>, successMessage: String) {
        owners = newOwners
        members = newMembers
        scope.launch {
            val ok = app.updateMailboxSettings { settings ->
                settings.copy(acl = MailboxAcl(owners = newOwners, members = newMembers))
            }
            toast(if (ok) successMessage else "Failed to save sharing", ok = ok)
        }
    }

    fun removeUser(key: String, role: SharingRole) {
        if (role == SharingRole.OWNER) {
            if (visibleOwners.size <= 1) {
                toast("Mailbox must have at least one owner", ok = false)
                return
            }
            val next = owners.filterNot { it == key }
            persistAcl(next, members, "Owner removed")
        } else {
            val next = members.filterNot { it == key }
            persistAcl(owners, next, "Member removed")
        }
    }

    val mailboxEmails = remember(app.mailboxes.value) {
        app.mailboxes.value.map { it.email.trim().lowercase() }.toSet()
    }

    fun addExistingUser(email: String, role: SharingRole) {
        val trimmed = email.trim().lowercase()
        if (mailboxEmails.contains(trimmed)) {
            toast("Mailboxes cannot be added as members", ok = false)
            return
        }
        if (!isUserAccountKey(trimmed)) {
            toast("Only user account emails can be added", ok = false)
            return
        }
        val key = normalizeKey(trimmed) ?: "email:$trimmed"
        val matchedId = existingAccounts.firstOrNull { it.email.equals(trimmed, ignoreCase = true) }?.id
        val accountKey = matchedId?.let { "account:$it" }
        val isAlready = owners.contains(key) || members.contains(key) ||
            (accountKey != null && (owners.contains(accountKey) || members.contains(accountKey)))
        if (isAlready) {
            toast("That person is already listed", ok = false)
            return
        }
        val keyToAdd = accountKey ?: key
        if (role == SharingRole.OWNER) {
            persistAcl(owners + keyToAdd, members, "Owner added")
        } else {
            persistAcl(owners, members + keyToAdd, "Member added")
        }
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            // Top Navigation Bar
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
                    "Sharing",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                if (canManage) {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Add,
                        contentDescription = "Add member",
                        onClick = { showAddModal = true },
                    )
                }
            }

            // Scrollable Settings Content
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                Text(
                    "People with access through their Inboxies account. Owners can manage this list. Members can use the mailbox but cannot change who has access.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .padding(top = 16.dp, bottom = 8.dp),
                )

                // Owners Header
                Text(
                    "Owners",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = colors.ink,
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .padding(top = 12.dp),
                )

                // Owners Card
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 8.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface),
                ) {
                    if (visibleOwners.isEmpty()) {
                        Text(
                            "No owners yet.",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        )
                    } else {
                        visibleOwners.forEachIndexed { index, key ->
                            val info = displayAccount(key, existingAccounts)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        info.first,
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 15.sp,
                                        color = colors.ink,
                                    )
                                    if (info.second != null) {
                                        Text(
                                            info.second!!,
                                            fontFamily = InterFontFamily,
                                            fontSize = 12.sp,
                                            color = colors.muted,
                                        )
                                    }
                                }
                                if (canManage && visibleOwners.size > 1) {
                                    Icon(
                                        Icons.Outlined.Delete,
                                        contentDescription = "Remove",
                                        tint = colors.deepDarkRed,
                                        modifier = Modifier
                                            .clickable { removeUser(key, SharingRole.OWNER) }
                                            .padding(6.dp),
                                    )
                                }
                            }
                            if (index < visibleOwners.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(start = 16.dp),
                                    color = colors.line,
                                )
                            }
                        }
                    }
                }

                // Members Header
                Text(
                    "Members",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = colors.ink,
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .padding(top = 20.dp),
                )

                // Members Card
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 8.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface),
                ) {
                    if (visibleMembers.isEmpty()) {
                        Text(
                            "No members yet.",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                        )
                    } else {
                        visibleMembers.forEachIndexed { index, key ->
                            val info = displayAccount(key, existingAccounts)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        info.first,
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 15.sp,
                                        color = colors.ink,
                                    )
                                    if (info.second != null) {
                                        Text(
                                            info.second!!,
                                            fontFamily = InterFontFamily,
                                            fontSize = 12.sp,
                                            color = colors.muted,
                                        )
                                    }
                                }
                                if (canManage) {
                                    Icon(
                                        Icons.Outlined.Delete,
                                        contentDescription = "Remove",
                                        tint = colors.deepDarkRed,
                                        modifier = Modifier
                                            .clickable { removeUser(key, SharingRole.MEMBER) }
                                            .padding(6.dp),
                                    )
                                }
                            }
                            if (index < visibleMembers.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(start = 16.dp),
                                    color = colors.line,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(32.dp))
            }
        }

        // Add Member Modal Dialog
        if (showAddModal) {
            AddMemberDialog(
                existingAccounts = existingAccounts,
                currentKeys = (owners + members).toSet(),
                mailboxEmails = mailboxEmails,
                onDismiss = { showAddModal = false },
                onAddExisting = { email, role ->
                    addExistingUser(email, role)
                    showAddModal = false
                },
                onSendInvite = { email, role ->
                    val id = mailbox?.id ?: return@AddMemberDialog
                    scope.launch {
                        try {
                            val res = ApiClient.shared.createMailboxInvite(
                                id,
                                email.trim(),
                                if (role == SharingRole.OWNER) "owner" else "member",
                            )
                            toast(if (res.emailSent) "Invite emailed" else "Invite created")
                            showAddModal = false
                        } catch (e: Exception) {
                            toast(e.message ?: "Invite failed", ok = false)
                        }
                    }
                },
            )
        }

        // Bottom Toast Banner
        AnimatedVisibility(
            visible = saveMessage != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
        ) {
            Text(
                saveMessage.orEmpty(),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = colors.ink,
                modifier = Modifier
                    .background(colors.pillFill, RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun AddMemberDialog(
    existingAccounts: List<AccountSummary>,
    currentKeys: Set<String>,
    mailboxEmails: Set<String>,
    onDismiss: () -> Unit,
    onAddExisting: (String, SharingRole) -> Unit,
    onSendInvite: (String, SharingRole) -> Unit,
) {
    val colors = inboxiesColors()
    var email by remember { mutableStateOf("") }
    var isOwner by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }

    val role = if (isOwner) SharingRole.OWNER else SharingRole.MEMBER
    val trimmedEmail = email.trim().lowercase()
    val isMailboxEmail = mailboxEmails.contains(trimmedEmail)
    val isSubOrAuthKey = trimmedEmail.startsWith("sub:") || trimmedEmail.startsWith("user:")
    val isValidEmail = !isMailboxEmail && !isSubOrAuthKey && trimmedEmail.contains("@") && trimmedEmail.contains(".") && trimmedEmail.length >= 5

    val matchingAccounts = remember(trimmedEmail, existingAccounts, currentKeys, mailboxEmails) {
        if (trimmedEmail.isEmpty()) emptyList()
        else existingAccounts.filter { acc ->
            val emailLower = acc.email.lowercase()
            if (mailboxEmails.contains(emailLower)) return@filter false
            val matches = emailLower.contains(trimmedEmail) || (acc.name?.lowercase()?.contains(trimmedEmail) == true)
            val alreadyAdded = currentKeys.contains("email:$emailLower") ||
                currentKeys.contains(emailLower) ||
                currentKeys.contains("account:${acc.id}")
            matches && !alreadyAdded
        }
    }

    val matchedExisting = if (!isMailboxEmail && !isSubOrAuthKey) {
        existingAccounts.firstOrNull { it.email.equals(trimmedEmail, ignoreCase = true) }
    } else null
    val isExistingAccount = matchedExisting != null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "Add member",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 18.sp,
                    color = colors.ink,
                )
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = colors.ink,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                // Email Field
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
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )

                    // Dropdown Options of matching existing accounts
                    if (matchingAccounts.isNotEmpty() && matchedExisting?.email != trimmedEmail) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .border(1.dp, colors.line, RoundedCornerShape(10.dp))
                                .background(colors.surface),
                        ) {
                            matchingAccounts.take(5).forEachIndexed { index, acc ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { email = acc.email }
                                        .padding(horizontal = 14.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        if (acc.name != null && acc.name.isNotBlank() && acc.name != acc.email) {
                                            Text(
                                                acc.name,
                                                fontFamily = InterFontFamily,
                                                fontWeight = FontWeight.Medium,
                                                fontSize = 14.sp,
                                                color = colors.ink,
                                            )
                                            Text(
                                                acc.email,
                                                fontFamily = InterFontFamily,
                                                fontSize = 12.sp,
                                                color = colors.muted,
                                            )
                                        } else {
                                            Text(
                                                acc.email,
                                                fontFamily = InterFontFamily,
                                                fontWeight = FontWeight.Medium,
                                                fontSize = 14.sp,
                                                color = colors.ink,
                                            )
                                        }
                                    }
                                    Text(
                                        "Existing user",
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 11.sp,
                                        color = colors.accent,
                                        modifier = Modifier
                                            .background(colors.pillFill, RoundedCornerShape(50))
                                            .padding(horizontal = 8.dp, vertical = 3.dp),
                                    )
                                }
                                if (index < minOf(matchingAccounts.size, 5) - 1) {
                                    HorizontalDivider(
                                        modifier = Modifier.padding(start = 14.dp),
                                        color = colors.line,
                                    )
                                }
                            }
                        }
                    }

                    // Status Indicator
                    if (isMailboxEmail) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            Icon(
                                Icons.Outlined.Error,
                                contentDescription = null,
                                tint = colors.deepDarkRed,
                                modifier = Modifier.size(14.dp),
                            )
                            Text(
                                "Mailboxes cannot be added as members. Only user accounts can be added.",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.deepDarkRed,
                            )
                        }
                    } else if (isSubOrAuthKey) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            Icon(
                                Icons.Outlined.Error,
                                contentDescription = null,
                                tint = colors.deepDarkRed,
                                modifier = Modifier.size(14.dp),
                            )
                            Text(
                                "Sub IDs and auth methods cannot be added. Only user account emails can be added.",
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.deepDarkRed,
                            )
                        }
                    } else if (isValidEmail) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            if (isExistingAccount) {
                                Icon(
                                    Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = colors.accent,
                                    modifier = Modifier.size(14.dp),
                                )
                                Text(
                                    "Existing Inboxies user — will be added directly",
                                    fontFamily = InterFontFamily,
                                    fontSize = 12.sp,
                                    color = colors.muted,
                                )
                            } else {
                                Icon(
                                    Icons.Outlined.Mail,
                                    contentDescription = null,
                                    tint = colors.muted,
                                    modifier = Modifier.size(14.dp),
                                )
                                Text(
                                    "New user — an email invite link will be sent",
                                    fontFamily = InterFontFamily,
                                    fontSize = 12.sp,
                                    color = colors.muted,
                                )
                            }
                        }
                    }
                }

                // Owner Role Toggle
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
                        Text(
                            "Owner",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                            color = colors.ink,
                        )
                        Text(
                            "Owners can manage mailbox settings, members, and permissions.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                    }
                    Switch(
                        checked = isOwner,
                        onCheckedChange = { isOwner = it },
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = colors.accent,
                            checkedThumbColor = Color.White,
                        ),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = isValidEmail && !isMailboxEmail && !isSubOrAuthKey && !isSubmitting,
                onClick = {
                    isSubmitting = true
                    if (isExistingAccount) {
                        onAddExisting(trimmedEmail, role)
                    } else {
                        onSendInvite(trimmedEmail, role)
                    }
                },
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), color = colors.accent)
                } else {
                    Text(
                        if (isExistingAccount) {
                            if (role == SharingRole.OWNER) "Add owner" else "Add member"
                        } else {
                            "Send invite"
                        },
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isValidEmail && !isMailboxEmail && !isSubOrAuthKey) colors.accent else colors.muted,
                    )
                }
            }
        },
    )
}

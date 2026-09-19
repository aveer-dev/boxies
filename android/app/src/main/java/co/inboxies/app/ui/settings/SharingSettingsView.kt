package co.inboxies.app.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

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
    var draft by remember { mutableStateOf("") }
    var addAsOwner by remember { mutableStateOf(false) }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(mailbox?.id) {
        val me = runCatching { ApiClient.shared.getMe() }.getOrNull()
        viewerKeys = if (me != null) {
            me.keys.toSet()
        } else {
            authEmail?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }?.let { keysForEmail(it) }
                .orEmpty()
        }
    }

    LaunchedEffect(mailbox?.id, mailbox?.settings?.acl) {
        owners = mailbox?.settings?.acl?.owners.orEmpty()
        members = mailbox?.settings?.acl?.members.orEmpty()
    }

    val canManage = mailbox?.canManage ?: owners.any { key ->
        viewerKeys.contains(key) || canonicalEmailAclKey(key)?.let(viewerKeys::contains) == true
    }

    fun toast(message: String, ok: Boolean = true) {
        scope.launch {
            saveMessage = message
            delay(if (ok) 1200 else 2000)
            saveMessage = null
        }
    }

    fun normalizeKey(raw: String): String? {
        val trimmed = raw.trim().lowercase()
        if (trimmed.isEmpty()) return null
        if (trimmed.startsWith("email:")) {
            val email = trimmed.removePrefix("email:")
            return if (email.contains("@")) "email:$email" else null
        }
        if (trimmed.startsWith("sub:")) return trimmed
        return if (trimmed.contains("@")) "email:$trimmed" else null
    }

    fun displayKey(key: String): String =
        if (key.startsWith("email:")) key.removePrefix("email:") else key

    fun addPerson() {
        val key = normalizeKey(draft)
        if (key == null) {
            toast("Enter a valid email address", ok = false)
            return
        }
        if (owners.contains(key) || members.contains(key)) {
            toast("That person is already listed", ok = false)
            return
        }
        if (addAsOwner) owners = owners + key else members = members + key
        draft = ""
    }

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
                    "Sharing",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = {
                        if (!canManage) return@TextButton
                        if (owners.isEmpty()) {
                            toast("Mailbox must have at least one owner", ok = false)
                            return@TextButton
                        }
                        isSaving = true
                        scope.launch {
                            val nextOwners = owners
                            val nextMembers = members
                            val ok = app.updateMailboxSettings { settings ->
                                settings.copy(acl = MailboxAcl(owners = nextOwners, members = nextMembers))
                            }
                            saveMessage = if (ok) "Sharing saved" else "Failed to save"
                            isSaving = false
                            delay(if (ok) 1200 else 2000)
                            saveMessage = null
                        }
                    },
                    enabled = canManage && !isSaving && mailbox != null,
                ) {
                    Text(
                        "Save",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = if (canManage) colors.ink else colors.muted,
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "Owners can manage this list. Members can use the mailbox but cannot change who has access.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                Text(
                    "Add people by the email on their Cloudflare Access or mobile sign-in account. That address may differ from the mailbox address.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )

                Text(
                    "Owners",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = colors.ink,
                )
                if (owners.isEmpty()) {
                    Text(
                        "No owners yet.",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.muted,
                    )
                }
                owners.forEach { key ->
                    AclKeyRow(
                        title = displayKey(key),
                        subtitle = key,
                        canRemove = canManage && owners.size > 1,
                        onRemove = { owners = owners.filterNot { it == key } },
                    )
                }

                Text(
                    "Members",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = colors.ink,
                    modifier = Modifier.padding(top = 8.dp),
                )
                if (members.isEmpty()) {
                    Text(
                        "No members yet.",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.muted,
                    )
                }
                members.forEach { key ->
                    AclKeyRow(
                        title = displayKey(key),
                        subtitle = key,
                        canRemove = canManage,
                        onRemove = { members = members.filterNot { it == key } },
                    )
                }

                if (canManage) {
                    Text(
                        "Add person",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 14.sp,
                        color = colors.ink,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        label = { Text("Email") },
                        placeholder = { Text("ada@example.com") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp),
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { addAsOwner = !addAsOwner },
                    ) {
                        Checkbox(
                            checked = addAsOwner,
                            onCheckedChange = { addAsOwner = it },
                            colors = CheckboxDefaults.colors(checkedColor = colors.accent),
                        )
                        Text(
                            "Add as owner",
                            fontFamily = InterFontFamily,
                            fontSize = 16.sp,
                            color = colors.ink,
                        )
                    }
                    Text(
                        "Add",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                        color = colors.accent,
                        modifier = Modifier.clickable { addPerson() },
                    )
                }

                Spacer(Modifier.height(24.dp))
            }
        }

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
private fun AclKeyRow(
    title: String,
    subtitle: String,
    canRemove: Boolean,
    onRemove: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.ink,
            )
            Text(
                subtitle,
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        if (canRemove) {
            Icon(
                Icons.Outlined.Delete,
                contentDescription = "Remove",
                tint = colors.muted,
                modifier = Modifier
                    .clickable(onClick = onRemove)
                    .padding(8.dp),
            )
        }
    }
}

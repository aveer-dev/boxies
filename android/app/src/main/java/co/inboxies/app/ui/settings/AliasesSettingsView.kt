package co.inboxies.app.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.HapticFeedbackConstants
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.MaskedAlias
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AliasesSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val mailboxId by app.selectedMailboxId.collectAsState()

    var aliases by remember { mutableStateOf<List<MaskedAlias>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var showCreateDialog by remember { mutableStateOf(false) }
    var copiedAliasId by remember { mutableStateOf<String?>(null) }
    var deletingAlias by remember { mutableStateOf<MaskedAlias?>(null) }

    fun refreshAliases() {
        val mid = mailboxId ?: return
        scope.launch {
            isLoading = true
            errorMessage = null
            try {
                val res = ApiClient.shared.listAliases(mid)
                aliases = res.aliases
            } catch (e: Exception) {
                errorMessage = "Failed to load masked emails"
            } finally {
                isLoading = false
            }
        }
    }

    LaunchedEffect(mailboxId) {
        refreshAliases()
    }

    val filteredAliases = remember(aliases, searchQuery) {
        val q = searchQuery.trim().lowercase()
        if (q.isEmpty()) {
            aliases
        } else {
            aliases.filter {
                it.aliasEmail.lowercase().contains(q) ||
                    (it.label?.lowercase()?.contains(q) == true) ||
                    (it.notes?.lowercase()?.contains(q) == true)
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            // Header bar
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
                    "Masked emails",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
            }

            // Info Card
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .border(0.5.dp, colors.line, RoundedCornerShape(12.dp))
                    .padding(16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Shield,
                            contentDescription = null,
                            tint = colors.accent,
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            "Hide My Email",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            color = colors.ink,
                        )
                    }
                    Text(
                        "Generate private alphanumeric email addresses that forward directly into this mailbox. Keep your primary address private from web trackers, spam lists, and signups.",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                        lineHeight = 18.sp,
                    )
                }
            }

            // Create Button
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 6.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .border(0.5.dp, colors.line, RoundedCornerShape(12.dp))
                    .clickable {
                        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                        showCreateDialog = true
                    }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.Outlined.Shield,
                        contentDescription = null,
                        tint = colors.accent,
                        modifier = Modifier.size(20.dp),
                    )
                    Text(
                        "Create new masked email",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                        color = colors.accent,
                    )
                }
            }

            // Search Bar
            if (aliases.isNotEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 6.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(colors.surface)
                        .border(0.5.dp, colors.line, RoundedCornerShape(10.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Search,
                            contentDescription = null,
                            tint = colors.muted,
                            modifier = Modifier.size(16.dp),
                        )
                        androidx.compose.foundation.text.BasicTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            modifier = Modifier.weight(1f),
                            textStyle = androidx.compose.ui.text.TextStyle(
                                fontFamily = InterFontFamily,
                                fontSize = 14.sp,
                                color = colors.ink,
                            ),
                            decorationBox = { innerTextField ->
                                if (searchQuery.isEmpty()) {
                                    Text(
                                        "Search aliases",
                                        fontFamily = InterFontFamily,
                                        fontSize = 14.sp,
                                        color = colors.muted,
                                    )
                                }
                                innerTextField()
                            },
                        )
                        if (searchQuery.isNotEmpty()) {
                            Icon(
                                Icons.Outlined.Close,
                                contentDescription = "Clear",
                                tint = colors.muted,
                                modifier = Modifier
                                    .size(16.dp)
                                    .clickable { searchQuery = "" },
                            )
                        }
                    }
                }
            }

            // Aliases List
            SettingsSectionHeader(
                if (filteredAliases.isEmpty()) "Aliases"
                else "${filteredAliases.size} ${if (filteredAliases.size == 1) "Address" else "Addresses"}",
            )

            if (isLoading && aliases.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.muted,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(24.dp),
                    )
                }
            } else if (filteredAliases.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Shield,
                            contentDescription = null,
                            tint = colors.muted.copy(alpha = 0.5f),
                            modifier = Modifier.size(36.dp),
                        )
                        Text(
                            if (searchQuery.isEmpty()) "No masked emails yet" else "No matching addresses",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 15.sp,
                            color = colors.ink,
                        )
                        Text(
                            if (searchQuery.isEmpty()) "Tap 'Create new masked email' to protect your address."
                            else "Try searching for a different label or address.",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                        )
                    }
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface)
                        .border(0.5.dp, colors.line, RoundedCornerShape(12.dp)),
                ) {
                    Column {
                        filteredAliases.forEachIndexed { index, alias ->
                            AliasRow(
                                alias = alias,
                                isCopied = copiedAliasId == alias.id,
                                onCopy = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    clipboard.setPrimaryClip(ClipData.newPlainText("Masked Email", alias.aliasEmail))
                                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                                    copiedAliasId = alias.id
                                    scope.launch {
                                        delay(1500)
                                        if (copiedAliasId == alias.id) {
                                            copiedAliasId = null
                                        }
                                    }
                                },
                                onToggleActive = { active ->
                                    val mid = mailboxId ?: return@AliasRow
                                    scope.launch {
                                        try {
                                            val res = ApiClient.shared.updateAlias(
                                                mailboxId = mid,
                                                aliasId = alias.id,
                                                isActive = active,
                                            )
                                            aliases = aliases.map {
                                                if (it.id == alias.id) res.alias else it
                                            }
                                        } catch (e: Exception) {
                                            app.showToast("Could not update status", isError = true)
                                        }
                                    }
                                },
                                onDelete = {
                                    deletingAlias = alias
                                },
                            )
                            if (index < filteredAliases.lastIndex) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(start = 16.dp),
                                    thickness = 0.5.dp,
                                    color = colors.line,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(32.dp))
        }

        // Delete Confirmation Dialog
        deletingAlias?.let { alias ->
            AlertDialog(
                onDismissRequest = { deletingAlias = null },
                title = {
                    Text(
                        "Delete Masked Email",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.ink,
                    )
                },
                text = {
                    Text(
                        "Emails sent to ${alias.aliasEmail} will no longer be delivered. This action cannot be undone.",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.muted,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val mid = mailboxId
                            val toDelete = deletingAlias
                            deletingAlias = null
                            if (mid != null && toDelete != null) {
                                scope.launch {
                                    try {
                                        ApiClient.shared.deleteAlias(mid, toDelete.id)
                                        aliases = aliases.filterNot { it.id == toDelete.id }
                                        app.showToast("Masked address deleted")
                                    } catch (e: Exception) {
                                        app.showToast("Could not delete address", isError = true)
                                    }
                                }
                            }
                        },
                    ) {
                        Text("Delete Address", color = colors.deepDarkRed, fontWeight = FontWeight.SemiBold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { deletingAlias = null }) {
                        Text("Cancel", color = colors.muted)
                    }
                },
            )
        }

        // Create Alias Dialog
        if (showCreateDialog) {
            CreateAliasDialog(
                onDismiss = { showCreateDialog = false },
                onCreated = { newAlias ->
                    aliases = listOf(newAlias) + aliases
                    showCreateDialog = false
                },
            )
        }
    }
}

@Composable
private fun AliasRow(
    alias: MaskedAlias,
    isCopied: Boolean,
    onCopy: () -> Unit,
    onToggleActive: (Boolean) -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var showMenu by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    alias.label?.ifBlank { "Untitled alias" } ?: "Untitled alias",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                // Active/Paused pill
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(if (alias.isActive) colors.accent.copy(alpha = 0.12f) else colors.pillFill)
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                ) {
                    Text(
                        if (alias.isActive) "Active" else "Paused",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp,
                        color = if (alias.isActive) colors.accent else colors.muted,
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    alias.aliasEmail,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = if (alias.isActive) colors.ink else colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(
                    if (isCopied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                    contentDescription = "Copy",
                    tint = if (isCopied) colors.accent else colors.muted,
                    modifier = Modifier
                        .size(14.dp)
                        .clickable(onClick = onCopy),
                )
                if (alias.forwardedCount > 0) {
                    Spacer(Modifier.width(4.dp))
                    Text(
                        "${alias.forwardedCount} received",
                        fontFamily = InterFontFamily,
                        fontSize = 11.sp,
                        color = colors.muted,
                    )
                }
            }
        }

        // Switch toggle
        Switch(
            checked = alias.isActive,
            onCheckedChange = onToggleActive,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accent,
                checkedThumbColor = Color.White,
            ),
            modifier = Modifier.padding(start = 8.dp),
        )

        // Overflow Menu
        Box {
            IconButton(
                onClick = { showMenu = true },
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    Icons.Outlined.MoreVert,
                    contentDescription = "More",
                    tint = colors.muted,
                    modifier = Modifier.size(18.dp),
                )
            }

            InboxiesDropdownMenu(
                expanded = showMenu,
                onDismiss = { showMenu = false },
            ) {
                InboxiesMenuItem(
                    text = "Copy address",
                    icon = Icons.Outlined.ContentCopy,
                    onClick = {
                        showMenu = false
                        onCopy()
                    },
                )
                InboxiesMenuItem(
                    text = if (alias.isActive) "Pause forwarding" else "Resume forwarding",
                    icon = if (alias.isActive) Icons.Outlined.PauseCircle else Icons.Outlined.PlayCircle,
                    onClick = {
                        showMenu = false
                        onToggleActive(!alias.isActive)
                    },
                )
                InboxiesMenuItem(
                    text = "Delete address",
                    icon = Icons.Outlined.Delete,
                    destructive = true,
                    onClick = {
                        showMenu = false
                        onDelete()
                    },
                )
            }
        }
    }
}

@Composable
private fun CreateAliasDialog(
    onDismiss: () -> Unit,
    onCreated: (MaskedAlias) -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId = app.selectedMailboxId.collectAsState().value

    var label by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var expirySeconds by remember { mutableStateOf<Int?>(null) }
    var pausedAction by remember { mutableStateOf("drop") }
    var isCreating by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Dialog(onDismissRequest = onDismiss) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .border(0.5.dp, colors.line, RoundedCornerShape(16.dp))
                .padding(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "New Masked Email",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                    )
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = colors.ink,
                        modifier = Modifier
                            .size(24.dp)
                            .clickable(onClick = onDismiss),
                    )
                }

                Text(
                    "A private address like random@private.domain.com will be automatically assigned.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )

                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("Label", fontFamily = InterFontFamily) },
                    placeholder = { Text("e.g., Online Store, Newsletter", fontFamily = InterFontFamily) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Note (optional)", fontFamily = InterFontFamily) },
                    placeholder = { Text("Notes about this address", fontFamily = InterFontFamily) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                // Expiry options row
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "Expiration",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.ink,
                        fontWeight = FontWeight.Medium,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        listOf(
                            "Never" to null,
                            "24h" to 24 * 3600,
                            "7d" to 7 * 86400,
                            "30d" to 30 * 86400,
                        ).forEach { (title, secs) ->
                            val selected = expirySeconds == secs
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) colors.accent else colors.pillFill)
                                    .clickable { expirySeconds = secs }
                                    .padding(vertical = 8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    title,
                                    fontFamily = InterFontFamily,
                                    fontSize = 12.sp,
                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (selected) Color.White else colors.ink,
                                )
                            }
                        }
                    }
                }

                if (errorMessage != null) {
                    Text(
                        errorMessage!!,
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.deepDarkRed,
                    )
                }

                // Create Action
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = {
                            val mid = mailboxId ?: return@TextButton
                            scope.launch {
                                isCreating = true
                                errorMessage = null
                                try {
                                    val res = ApiClient.shared.createAlias(
                                        mailboxId = mid,
                                        label = label.trim().takeIf { it.isNotEmpty() },
                                        notes = notes.trim().takeIf { it.isNotEmpty() },
                                        expiresInSeconds = expirySeconds,
                                        pausedAction = pausedAction,
                                    )
                                    onCreated(res.alias)
                                } catch (e: Exception) {
                                    errorMessage = "Failed to create masked address"
                                } finally {
                                    isCreating = false
                                }
                            }
                        },
                        enabled = !isCreating && mailboxId != null,
                    ) {
                        if (isCreating) {
                            CircularProgressIndicator(
                                color = colors.accent,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(16.dp),
                            )
                        } else {
                            Text(
                                "Create Address",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                color = colors.accent,
                            )
                        }
                    }
                }
            }
        }
    }
}

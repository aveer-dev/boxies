package co.inboxies.app.ui.settings

import android.view.HapticFeedbackConstants
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.SubdirectoryArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.MoreHoriz
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.AppToast
import co.inboxies.app.models.DomainAliasItem
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.DomainAliases
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ToastMetrics
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.AnimatedToast
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.InboxiesToast
import co.inboxies.app.ui.components.toastIcon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Which Aliases surface a DEBUG preview opens (`domainAliasAdd` / `…Conflict` / `…Delete`). */
enum class DomainAliasPreview { None, Add, Conflict, Delete }

private val SheetCornerRadius = 28.dp

/**
 * Domain Admin → Aliases (AVE-219): lists the domain's aliases (alias → mailbox), adds one
 * from a sheet and deletes with a confirm. iOS twin: the `aliasesSection` of
 * `DomainAdminSettingsView.swift`. [previewAliases] keeps adds and deletes in memory.
 */
@Composable
internal fun DomainAliasesSection(
    domain: String,
    mailboxes: List<AdminMailboxRow>,
    serviceEnded: Boolean,
    showToast: (String, Boolean) -> Unit,
    previewAliases: List<DomainAliasItem>? = null,
    previewDialog: DomainAliasPreview = DomainAliasPreview.None,
    reloadKey: Int = 0,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()

    var aliases by remember { mutableStateOf(previewAliases?.let(DomainAliases::sorted) ?: emptyList()) }
    var loading by remember { mutableStateOf(previewAliases == null) }
    var failed by remember { mutableStateOf(false) }
    var showAdd by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<DomainAliasItem?>(null) }
    var busyLocal by remember { mutableStateOf<String?>(null) }

    fun reload() {
        if (previewAliases != null) {
            loading = false
            return
        }
        scope.launch {
            loading = true
            runCatching { ApiClient.shared.listDomainAliases(domain) }
                .onSuccess {
                    aliases = DomainAliases.sorted(it)
                    failed = false
                }
                .onFailure { if (it is CancellationException) throw it else failed = true }
            loading = false
        }
    }

    LaunchedEffect(domain, reloadKey) { reload() }

    LaunchedEffect(previewDialog) {
        if (previewAliases == null) return@LaunchedEffect
        delay(400)
        when (previewDialog) {
            DomainAliasPreview.Add, DomainAliasPreview.Conflict -> showAdd = true
            DomainAliasPreview.Delete -> deleting = aliases.firstOrNull()
            DomainAliasPreview.None -> Unit
        }
    }

    fun delete(alias: DomainAliasItem) {
        deleting = null
        busyLocal = alias.aliasLocal
        scope.launch {
            try {
                if (previewAliases == null) ApiClient.shared.deleteDomainAlias(domain, alias.aliasLocal)
                aliases = aliases.filterNot { it.aliasLocal == alias.aliasLocal }
                showToast("Alias deleted", false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showToast(DomainAliases.deleteErrorMessage(e), true)
            } finally {
                busyLocal = null
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            DomainAliases.SECTION_TITLE,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            color = colors.ink,
            modifier = Modifier.padding(top = 8.dp),
        )

        when {
            loading && aliases.isEmpty() ->
                CircularProgressIndicator(
                    modifier = Modifier.padding(16.dp).size(20.dp),
                    strokeWidth = 2.dp,
                    color = colors.muted,
                )
            failed && aliases.isEmpty() -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    DomainAliases.LOAD_FAILED,
                    fontFamily = InterFontFamily,
                    fontSize = 14.sp,
                    color = colors.muted,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { reload() }) {
                    Text("Retry", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, color = colors.accent)
                }
            }
            aliases.isEmpty() -> Text(
                DomainAliases.EMPTY_MESSAGE,
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.muted,
            )
        }

        if (aliases.isNotEmpty()) {
            Column(
                modifier = Modifier.animateContentSize(
                    spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                ),
            ) {
                aliases.forEachIndexed { index, alias ->
                    if (index > 0) {
                        HorizontalDivider(
                            thickness = 0.5.dp,
                            color = colors.line.copy(alpha = 0.65f),
                            modifier = Modifier.padding(start = 4.dp),
                        )
                    }
                    DomainAliasRow(
                        alias = alias,
                        busy = busyLocal == alias.aliasLocal,
                        enabled = busyLocal == null && !serviceEnded,
                        onDelete = { deleting = alias },
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .graphicsLayer { alpha = if (serviceEnded) 0.45f else 1f }
                .clip(RoundedCornerShape(8.dp))
                .clickable(enabled = !serviceEnded, role = Role.Button) { showAdd = true }
                .padding(vertical = 12.dp, horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Add, contentDescription = null, tint = colors.accent, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                DomainAliases.ADD_TITLE,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.accent,
            )
        }
    }

    if (showAdd) {
        DomainAliasAddSheet(
            domain = domain,
            targets = DomainAliases.targets(mailboxes, domain),
            existing = aliases,
            isPreview = previewAliases != null,
            autoConflict = previewDialog == DomainAliasPreview.Conflict,
            onDismiss = { showAdd = false },
            onAdded = { created ->
                aliases = DomainAliases.sorted(aliases.filterNot { it.aliasLocal == created.aliasLocal } + created)
                showAdd = false
                showToast("Alias added", false)
            },
        )
    }

    deleting?.let { alias ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = colors.surface,
            title = {
                Text(DomainAliases.deleteConfirmTitle(alias), fontFamily = InterFontFamily, fontSize = 17.sp)
            },
            text = {
                Text(
                    DomainAliases.deleteConfirmMessage(alias),
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = { delete(alias) }) {
                    Text("Delete alias", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleting = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

/** Alias address over its target mailbox, trailing menu to delete. iOS twin: `DomainAliasRow`. */
@Composable
private fun DomainAliasRow(
    alias: DomainAliasItem,
    busy: Boolean,
    enabled: Boolean,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                alias.aliasEmail,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Outlined.SubdirectoryArrowRight,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(12.dp),
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    alias.targetMailboxId,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
            } else {
                Icon(
                    Icons.Outlined.MoreHoriz,
                    contentDescription = "Actions for ${alias.aliasEmail}",
                    tint = colors.muted.copy(alpha = if (enabled) 1f else 0.45f),
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(50))
                        .clickable(enabled = enabled, role = Role.Button) { menuOpen = true }
                        .padding(6.dp),
                )
            }
            InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
                InboxiesMenuItem(
                    text = "Delete alias",
                    icon = Icons.Outlined.Delete,
                    destructive = true,
                    onClick = {
                        menuOpen = false
                        onDelete()
                    },
                )
            }
        }
    }
}

/**
 * Add-alias sheet: alias local part on the domain + the mailbox it delivers to. Errors (bad
 * name, target not allowed, address in use) show as a toast in the sheet. iOS twin:
 * `DomainAliasAddSheet`.
 */
@Composable
private fun DomainAliasAddSheet(
    domain: String,
    targets: List<AdminMailboxRow>,
    existing: List<DomainAliasItem>,
    isPreview: Boolean,
    autoConflict: Boolean,
    onDismiss: () -> Unit,
    onAdded: (DomainAliasItem) -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    var draft by remember { mutableStateOf("") }
    var targetId by remember { mutableStateOf(targets.firstOrNull()?.id) }
    var saving by remember { mutableStateOf(false) }
    // The sheet is its own window, so it shows its own toast.
    var toast by remember { mutableStateOf<AppToast?>(null) }
    var toastVisible by remember { mutableStateOf(false) }

    LaunchedEffect(toast?.id) {
        val current = toast ?: return@LaunchedEffect
        delay(3000)
        if (toast?.id == current.id) toastVisible = false
    }

    fun showError(message: String) {
        toast = AppToast(message = message, isError = true)
        toastVisible = true
    }

    val local = DomainAliases.normalizedLocal(draft)
    val canAdd = !saving && local.isNotEmpty() && targetId != null

    fun add() {
        if (saving) return
        val name = DomainAliases.normalizedLocal(draft)
        if (!DomainAliases.isValidLocal(name)) return showError(DomainAliases.INVALID_LOCAL)
        val target = targetId ?: return showError(DomainAliases.NO_TARGETS)
        DomainAliases.conflict(name, domain, existing, targets)?.let { return showError(it) }
        val fallback = DomainAliasItem(
            aliasLocal = name,
            aliasEmail = "$name@${domain.lowercase()}",
            targetMailboxId = target,
        )
        saving = true
        scope.launch {
            try {
                val created = if (isPreview) fallback else ApiClient.shared.createDomainAlias(domain, name, target)
                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                onAdded(created ?: fallback)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showError(DomainAliases.addErrorMessage(e))
            } finally {
                saving = false
            }
        }
    }

    LaunchedEffect(autoConflict) {
        // DEBUG `domainAliasConflict`: try an address that's already a mailbox (409 toast).
        if (!isPreview || !autoConflict) return@LaunchedEffect
        val taken = targets.drop(1).firstOrNull() ?: targets.firstOrNull() ?: return@LaunchedEffect
        draft = taken.email.substringBefore('@')
        delay(500)
        add()
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(HomeChromeMetrics.modalScrim)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onDismiss,
                    ),
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = SheetCornerRadius, topEnd = SheetCornerRadius))
                    .background(colors.background)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {},
                    )
                    .navigationBarsPadding()
                    .imePadding(),
            ) {
                Box(
                    modifier = Modifier
                        .padding(top = 10.dp, bottom = 6.dp)
                        .align(Alignment.CenterHorizontally)
                        .size(width = 36.dp, height = 5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors.muted.copy(alpha = 0.45f)),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Close,
                        contentDescription = "Close",
                        onClick = onDismiss,
                    )
                    Text(
                        DomainAliases.ADD_TITLE,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                        maxLines = 1,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 8.dp),
                    )
                    SettingsChromeTextButton(
                        label = if (saving) "Adding…" else "Add",
                        enabled = canAdd,
                        onClick = { add() },
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(bottom = 20.dp),
                ) {
                    SettingsFormSectionHeader("Alias")
                    SettingsFormGroup {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            BasicTextField(
                                value = draft,
                                onValueChange = { draft = it },
                                singleLine = true,
                                enabled = !saving,
                                textStyle = TextStyle(fontFamily = InterFontFamily, fontSize = 16.sp, color = colors.ink),
                                cursorBrush = SolidColor(colors.accent),
                                keyboardOptions = KeyboardOptions(
                                    capitalization = KeyboardCapitalization.None,
                                    autoCorrectEnabled = false,
                                    keyboardType = KeyboardType.Email,
                                    imeAction = ImeAction.Done,
                                ),
                                keyboardActions = KeyboardActions(onDone = { add() }),
                                modifier = Modifier
                                    .weight(1f)
                                    .semantics { contentDescription = "Alias" },
                                decorationBox = { inner ->
                                    Box {
                                        if (draft.isEmpty()) {
                                            Text(
                                                "sales",
                                                fontFamily = InterFontFamily,
                                                fontSize = 16.sp,
                                                color = colors.muted.copy(alpha = 0.7f),
                                            )
                                        }
                                        inner()
                                    }
                                },
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                "@$domain",
                                fontFamily = InterFontFamily,
                                fontSize = 16.sp,
                                color = colors.muted,
                                maxLines = 1,
                            )
                        }
                    }

                    SettingsFormSectionHeader("Delivers to")
                    SettingsFormGroup {
                        if (targets.isEmpty()) {
                            Text(
                                DomainAliases.NO_TARGETS,
                                fontFamily = InterFontFamily,
                                fontSize = 14.sp,
                                color = colors.muted,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                            )
                        }
                        targets.forEachIndexed { index, row ->
                            if (index > 0) SettingsFormDivider()
                            val selected = targetId == row.id
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .semantics { this.selected = selected }
                                    .clickable(role = Role.RadioButton) { targetId = row.id }
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        row.email,
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.Medium,
                                        fontSize = 15.sp,
                                        color = colors.ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        row.name,
                                        fontFamily = InterFontFamily,
                                        fontSize = 12.sp,
                                        color = colors.muted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                if (selected) {
                                    Icon(
                                        Icons.Outlined.Check,
                                        contentDescription = null,
                                        tint = colors.accent,
                                        modifier = Modifier.size(18.dp),
                                    )
                                }
                            }
                        }
                    }
                    SettingsFormFooter(
                        "Mail sent to ${if (local.isEmpty()) "the alias" else "$local@$domain"} is delivered to this mailbox.",
                    )
                }
            }

            AnimatedToast(
                value = toast?.takeIf { toastVisible },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = ToastMetrics.screenInset)
                    .padding(bottom = ToastMetrics.standaloneBottomInset),
            ) { current ->
                InboxiesToast(
                    message = current.message,
                    icon = current.toastIcon,
                    onDismiss = { toastVisible = false },
                )
            }
        }
    }
}

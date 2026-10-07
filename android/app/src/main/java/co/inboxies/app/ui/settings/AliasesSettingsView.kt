package co.inboxies.app.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.autofill.AutofillManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.net.toUri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AddCircle
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PauseCircle
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AppToast
import co.inboxies.app.models.MaskedAlias
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.services.FieldUpdate
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuHeader
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.PrivateEmailLogoView
import co.inboxies.app.ui.components.UndoToastBanner
import co.inboxies.app.utils.DateUtils
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Worker caps labels at 100 characters. */
private const val ALIAS_LABEL_MAX = 100

/** Top corners of the bottom sheets in this settings stack (Filters, email actions). */
private val SheetCornerRadius = 28.dp

/** Private email aliases management — Android twin of iOS `AliasesSettingsView`. */
@OptIn(ExperimentalMaterial3Api::class)
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

    var aliases by remember(mailboxId) { mutableStateOf<List<MaskedAlias>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isRefreshing by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var searchQuery by remember { mutableStateOf("") }
    var showCreateSheet by remember { mutableStateOf(false) }
    var copiedAliasId by remember { mutableStateOf<String?>(null) }
    var editingAlias by remember { mutableStateOf<MaskedAlias?>(null) }
    var deletingAlias by remember { mutableStateOf<MaskedAlias?>(null) }
    // The app toast sits under this sheet, so the page shows its own.
    var toast by remember { mutableStateOf<AppToast?>(null) }
    var toastVisible by remember { mutableStateOf(false) }

    LaunchedEffect(toast?.id) {
        val current = toast ?: return@LaunchedEffect
        delay(2500)
        if (toast?.id == current.id) toastVisible = false
    }

    fun showToast(message: String, isError: Boolean = false) {
        toast = AppToast(message = message, isError = isError)
        toastVisible = true
    }

    suspend fun load(mid: String) {
        errorMessage = null
        try {
            aliases = ApiClient.shared.listAliases(mid).aliases
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (aliases.isEmpty()) {
                errorMessage = "Couldn’t load private emails"
            } else {
                showToast("Couldn’t refresh private emails", isError = true)
            }
        }
    }

    LaunchedEffect(mailboxId) {
        val mid = mailboxId
        if (mid == null) {
            // No mailbox: explain instead of spinning forever.
            isLoading = false
            errorMessage = "Select a mailbox to manage its private emails."
            return@LaunchedEffect
        }
        isLoading = true
        load(mid)
        isLoading = false
    }

    fun replace(updated: MaskedAlias) {
        aliases = aliases.map { if (it.id == updated.id) updated else it }
    }

    /** Shows [optimistic] right away, then saves; rolls back and toasts on failure. */
    fun applyUpdate(
        alias: MaskedAlias,
        optimistic: MaskedAlias,
        failureMessage: String,
        save: suspend (mailboxId: String) -> MaskedAlias,
    ) {
        val mid = mailboxId ?: return
        replace(optimistic)
        scope.launch {
            try {
                replace(save(mid))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                replace(alias)
                showToast(failureMessage, isError = true)
            }
        }
    }

    fun setActive(alias: MaskedAlias, active: Boolean) {
        applyUpdate(alias, alias.copy(isActive = active), "Couldn’t update status") { mid ->
            ApiClient.shared.updateAlias(mid, alias.id, isActive = active).alias
        }
    }

    fun saveLabel(alias: MaskedAlias, label: String) {
        // Empty clears the label (JSON null).
        val trimmed = label.trim().ifEmpty { null }
        applyUpdate(alias, alias.copy(label = trimmed), "Couldn’t save label") { mid ->
            ApiClient.shared.updateAlias(mid, alias.id, label = FieldUpdate(trimmed)).alias
        }
    }

    fun setPausedAction(alias: MaskedAlias, action: String) {
        if (action == alias.pausedAction) return
        applyUpdate(alias, alias.copy(pausedAction = action), "Couldn’t update paused behavior") { mid ->
            ApiClient.shared.updateAlias(mid, alias.id, pausedAction = action).alias
        }
    }

    fun setExpiry(alias: MaskedAlias, option: AliasExpiry) {
        val expiresAt = option.from(Instant.now())
        val optimistic = alias.copy(expiresAt = expiresAt?.truncatedTo(ChronoUnit.SECONDS)?.toString())
        applyUpdate(alias, optimistic, "Couldn’t update expiration") { mid ->
            ApiClient.shared.updateAlias(mid, alias.id, expiresAt = FieldUpdate(expiresAt)).alias
        }
    }

    fun delete(alias: MaskedAlias) {
        val mid = mailboxId ?: return
        scope.launch {
            try {
                ApiClient.shared.deleteAlias(mid, alias.id)
                aliases = aliases.filterNot { it.id == alias.id }
                showToast("Private email deleted")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showToast("Couldn’t delete address", isError = true)
            }
        }
    }

    fun copy(alias: MaskedAlias) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Private email", alias.aliasEmail))
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        copiedAliasId = alias.id
        scope.launch {
            delay(1500)
            if (copiedAliasId == alias.id) copiedAliasId = null
        }
    }

    val filteredAliases = remember(aliases, searchQuery) {
        val q = searchQuery.trim().lowercase()
        if (q.isEmpty()) {
            aliases
        } else {
            aliases.filter {
                it.aliasEmail.lowercase().contains(q) ||
                    (it.label?.lowercase()?.contains(q) == true)
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
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
                    "Private email",
                    fontFamily = InterFontFamily,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.ink,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }

            PullToRefreshBox(
                isRefreshing = isRefreshing,
                onRefresh = {
                    val mid = mailboxId
                    if (mid != null) {
                        scope.launch {
                            isRefreshing = true
                            try {
                                load(mid)
                            } finally {
                                isRefreshing = false
                            }
                        }
                    }
                },
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    Spacer(Modifier.height(8.dp))

                    SettingsFormGroup {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                PrivateEmailLogoView(size = 20.dp)
                                Text(
                                    "Private email",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 15.sp,
                                    color = colors.ink,
                                )
                            }
                            Text(
                                "Random addresses on your domain that deliver straight into this mailbox. Replies to mail sent to one go out from that address, so your real address stays private.",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                                color = colors.muted,
                            )
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    SettingsFormGroup {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .alpha(if (mailboxId != null) 1f else 0.45f)
                                .clickable(enabled = mailboxId != null) {
                                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                                    showCreateSheet = true
                                }
                                .padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(
                                Icons.Outlined.AddCircle,
                                contentDescription = null,
                                tint = colors.accent,
                                modifier = Modifier.size(20.dp),
                            )
                            Text(
                                "Create new private email",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 15.sp,
                                color = colors.accent,
                            )
                        }
                    }
                    mailboxId?.let { id ->
                        AutofillMailboxFooter(mailboxEmail = app.selectedMailbox?.email ?: id)
                    }

                    if (aliases.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        AliasSearchField(
                            query = searchQuery,
                            onQueryChange = { searchQuery = it },
                        )
                    }

                    if (filteredAliases.isNotEmpty()) {
                        SettingsSectionHeader(
                            "${filteredAliases.size} ${if (filteredAliases.size == 1) "Address" else "Addresses"}",
                        )
                    } else {
                        Spacer(Modifier.height(12.dp))
                    }

                    val error = errorMessage
                    when {
                        isLoading && aliases.isEmpty() -> Box(
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
                        error != null && aliases.isEmpty() -> SettingsFormErrorBanner(error)
                        filteredAliases.isEmpty() -> AliasesEmptyState(
                            title = if (searchQuery.isBlank()) "No Private Emails" else "No Matches",
                            subtitle = if (searchQuery.isBlank()) {
                                "Tap 'Create new private email' to generate your first private address."
                            } else {
                                "No private emails match '${searchQuery.trim()}'."
                            },
                        )
                        else -> {
                            SettingsFormGroup {
                                filteredAliases.forEachIndexed { index, alias ->
                                    AliasRow(
                                        alias = alias,
                                        isCopied = copiedAliasId == alias.id,
                                        onCopy = { copy(alias) },
                                        onToggleActive = { active -> setActive(alias, active) },
                                        onEditLabel = { editingAlias = alias },
                                        onSetPausedAction = { action -> setPausedAction(alias, action) },
                                        onSetExpiry = { option -> setExpiry(alias, option) },
                                        onDelete = { deletingAlias = alias },
                                    )
                                    if (index < filteredAliases.lastIndex) {
                                        SettingsFormDivider()
                                    }
                                }
                            }
                            SettingsFormFooter(
                                "Touch and hold an address to pause it, relabel it, or change what happens to its mail.",
                            )
                        }
                    }

                    Spacer(Modifier.height(32.dp))
                }
            }
        }

        AnimatedVisibility(
            visible = toastVisible,
            enter = slideInVertically(settingsNavSpring()) { it } + fadeIn(settingsNavSpring()),
            exit = slideOutVertically(settingsNavSpring()) { it } + fadeOut(settingsNavSpring()),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding)
                .padding(bottom = HomeChromeMetrics.chromeBottomPadding),
        ) {
            toast?.let { UndoToastBanner(message = it.message, isError = it.isError) }
        }

        editingAlias?.let { alias ->
            EditAliasLabelDialog(
                initialLabel = alias.label.orEmpty(),
                onDismiss = { editingAlias = null },
                onSave = { label ->
                    editingAlias = null
                    saveLabel(alias, label)
                },
            )
        }

        deletingAlias?.let { alias ->
            AlertDialog(
                onDismissRequest = { deletingAlias = null },
                title = {
                    Text(
                        "Delete Private Email",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.ink,
                    )
                },
                text = {
                    Text(
                        "Emails sent to ${alias.aliasEmail} will no longer be delivered, and you won't be able to reply from it. This action cannot be undone.",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.muted,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            deletingAlias = null
                            delete(alias)
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
                containerColor = colors.surface,
            )
        }

        if (showCreateSheet) {
            CreateAliasSheet(
                mailboxId = mailboxId,
                domain = (app.selectedMailbox?.email ?: mailboxId)
                    ?.substringAfterLast('@', missingDelimiterValue = "")
                    ?.ifEmpty { null },
                onDismiss = { showCreateSheet = false },
                onCreated = { created ->
                    aliases = listOf(created) + aliases.filterNot { it.id == created.id }
                    errorMessage = null
                    showCreateSheet = false
                },
            )
        }
    }
}

/** Row state. Expired wins over paused: resuming alone won't revive it. */
private enum class AliasStatus(val label: String) {
    Active("Active"),
    Paused("Paused"),
    Expired("Expired"),
}

private fun MaskedAlias.status(now: Instant = Instant.now()): AliasStatus = when {
    isExpired(now) -> AliasStatus.Expired
    isActive -> AliasStatus.Active
    else -> AliasStatus.Paused
}

/** Expiry presets; relative choices become an absolute instant when saved. */
private enum class AliasExpiry(val label: String, private val duration: Duration?) {
    Never("Never", null),
    Hours24("24 Hours", Duration.ofHours(24)),
    Days7("7 Days", Duration.ofDays(7)),
    Days30("30 Days", Duration.ofDays(30)),
    ;

    /** Menu wording on an existing address, where the clock starts when you pick it. */
    val editLabel: String get() = if (duration == null) label else "$label from Now"

    fun from(now: Instant): Instant? = duration?.let { now.plus(it) }
}

private val pausedActions = listOf(MaskedAlias.PAUSED_DROP, MaskedAlias.PAUSED_REJECT)

private fun pausedActionLabel(action: String): String =
    if (action == MaskedAlias.PAUSED_REJECT) "Reject (Bounce)" else "Drop Silently"

private fun pausedActionFooter(action: String): String =
    if (action == MaskedAlias.PAUSED_REJECT) {
        "Senders receive an SMTP 550 mailbox unavailable bounce."
    } else {
        "Incoming messages are silently discarded without notifying the sender."
    }

/** "12 received · 3 blocked · Expires Oct 8, 2026, 4:00 PM" */
private fun aliasMetaLine(alias: MaskedAlias, status: AliasStatus): String {
    val parts = mutableListOf("${alias.statsReceived} received", "${alias.statsBlocked} blocked")
    alias.expiresAt?.let {
        val formatted = DateUtils.formatMediumDateTime(it)
        parts += if (status == AliasStatus.Expired) "Expired $formatted" else "Expires $formatted"
    }
    return parts.joinToString(" · ")
}

/**
 * System autofill offers "Create private email" in other apps; it uses the mailbox selected
 * here. When Inboxies isn't the autofill service yet, offer to switch.
 */
@Composable
private fun AutofillMailboxFooter(mailboxEmail: String) {
    val context = LocalContext.current
    val colors = inboxiesColors()
    val autofillManager = remember(context) { context.getSystemService(AutofillManager::class.java) }
    var isEnabled by remember { mutableStateOf(autofillManager?.hasEnabledAutofillServices() == true) }
    val chooseService = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        isEnabled = autofillManager?.hasEnabledAutofillServices() == true
    }

    when {
        isEnabled -> SettingsFormFooter("Autofill creates private emails in $mailboxEmail.")
        autofillManager?.isAutofillSupported == true -> Text(
            "Use Inboxies for autofill to create private emails right from sign-up forms.",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.accent,
            modifier = Modifier
                .fillMaxWidth()
                .clickable {
                    runCatching {
                        chooseService.launch(
                            Intent(
                                Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE,
                                "package:${context.packageName}".toUri(),
                            ),
                        )
                    }
                }
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 4.dp),
        )
    }
}

@Composable
private fun AliasSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(colors.surface)
            .border(1.dp, colors.line.copy(alpha = 0.65f), RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Outlined.Search,
            contentDescription = null,
            tint = colors.muted,
            modifier = Modifier.size(16.dp),
        )
        BasicTextField(
            value = query,
            onValueChange = onQueryChange,
            singleLine = true,
            modifier = Modifier.weight(1f),
            textStyle = TextStyle(
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.ink,
            ),
            cursorBrush = SolidColor(colors.accent),
            decorationBox = { innerTextField ->
                Box {
                    if (query.isEmpty()) {
                        Text(
                            "Search private emails",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                        )
                    }
                    innerTextField()
                }
            },
        )
        if (query.isNotEmpty()) {
            Icon(
                Icons.Outlined.Close,
                contentDescription = "Clear search",
                tint = colors.muted,
                modifier = Modifier
                    .size(16.dp)
                    .clickable { onQueryChange("") },
            )
        }
    }
}

@Composable
private fun AliasesEmptyState(
    title: String,
    subtitle: String,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PrivateEmailLogoView(size = 40.dp, modifier = Modifier.alpha(0.5f))
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 17.sp,
            color = colors.ink,
            textAlign = TextAlign.Center,
        )
        Text(
            subtitle,
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
    }
}

private enum class AliasMenuPage { Main, WhenPaused, Expiration }

@Composable
private fun AliasRow(
    alias: MaskedAlias,
    isCopied: Boolean,
    onCopy: () -> Unit,
    onToggleActive: (Boolean) -> Unit,
    onEditLabel: () -> Unit,
    onSetPausedAction: (String) -> Unit,
    onSetExpiry: (AliasExpiry) -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    var showMenu by remember { mutableStateOf(false) }
    var menuPage by remember { mutableStateOf(AliasMenuPage.Main) }
    val status = alias.status()

    fun openMenu() {
        menuPage = AliasMenuPage.Main
        showMenu = true
    }

    fun closeMenu() {
        showMenu = false
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            // Touch-and-hold opens the actions menu (iOS context menu twin).
            .pointerInput(alias.id) {
                detectTapGestures(
                    onLongPress = {
                        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        openMenu()
                    },
                )
            }
            .padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    alias.label?.trim()?.takeIf { it.isNotEmpty() } ?: "Untitled",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                AliasStatusPill(status)
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    alias.aliasEmail,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = if (status == AliasStatus.Active) colors.ink else colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Icon(
                    if (isCopied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
                    contentDescription = if (isCopied) "Copied" else "Copy address",
                    tint = if (isCopied) colors.accent else colors.muted,
                    modifier = Modifier
                        .size(14.dp)
                        .clickable(onClick = onCopy),
                )
            }

            Text(
                aliasMetaLine(alias, status),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                color = colors.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Switch(
            checked = alias.isActive,
            onCheckedChange = onToggleActive,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accent,
                checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
            ),
            modifier = Modifier.padding(start = 8.dp),
        )

        Box {
            IconButton(
                onClick = { openMenu() },
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
                onDismiss = { closeMenu() },
            ) {
                when (menuPage) {
                    AliasMenuPage.Main -> {
                        InboxiesMenuItem(
                            text = "Copy Address",
                            icon = Icons.Outlined.ContentCopy,
                            onClick = {
                                closeMenu()
                                onCopy()
                            },
                        )
                        InboxiesMenuItem(
                            text = if (alias.isActive) "Pause" else "Resume",
                            icon = if (alias.isActive) Icons.Outlined.PauseCircle else Icons.Outlined.PlayCircle,
                            onClick = {
                                closeMenu()
                                onToggleActive(!alias.isActive)
                            },
                        )
                        InboxiesMenuItem(
                            text = "Edit Label",
                            icon = Icons.Outlined.Edit,
                            onClick = {
                                closeMenu()
                                onEditLabel()
                            },
                        )
                        InboxiesMenuItem(
                            text = "When Paused",
                            icon = Icons.Outlined.PanTool,
                            onClick = { menuPage = AliasMenuPage.WhenPaused },
                        )
                        InboxiesMenuItem(
                            text = "Expiration",
                            icon = Icons.Outlined.Schedule,
                            onClick = { menuPage = AliasMenuPage.Expiration },
                        )
                        InboxiesMenuDivider()
                        InboxiesMenuItem(
                            text = "Delete Address",
                            icon = Icons.Outlined.Delete,
                            destructive = true,
                            onClick = {
                                closeMenu()
                                onDelete()
                            },
                        )
                    }
                    AliasMenuPage.WhenPaused -> {
                        InboxiesMenuHeader(title = "When Paused")
                        InboxiesMenuDivider()
                        pausedActions.forEach { action ->
                            InboxiesMenuItem(
                                text = pausedActionLabel(action),
                                icon = if (action == alias.pausedAction) Icons.Outlined.Check else null,
                                onClick = {
                                    closeMenu()
                                    onSetPausedAction(action)
                                },
                            )
                        }
                    }
                    AliasMenuPage.Expiration -> {
                        InboxiesMenuHeader(title = "Expiration")
                        InboxiesMenuDivider()
                        AliasExpiry.entries.forEach { option ->
                            val selected = option == AliasExpiry.Never && alias.expiresAt == null
                            InboxiesMenuItem(
                                text = option.editLabel,
                                icon = if (selected) Icons.Outlined.Check else null,
                                onClick = {
                                    closeMenu()
                                    onSetExpiry(option)
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AliasStatusPill(status: AliasStatus) {
    val colors = inboxiesColors()
    val (foreground, background) = when (status) {
        AliasStatus.Active -> colors.accent to colors.accent.copy(alpha = 0.12f)
        AliasStatus.Paused -> colors.muted to colors.pillFill
        AliasStatus.Expired -> colors.deepDarkRed to colors.deepDarkRed.copy(alpha = 0.12f)
    }
    Text(
        status.label,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        color = foreground,
        maxLines = 1,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(background)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

@Composable
private fun EditAliasLabelDialog(
    initialLabel: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    var draft by remember { mutableStateOf(initialLabel) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Edit Label",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                        onDismiss()
                    },
                    modifier = Modifier.size(28.dp),
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Provide a recognizable label or purpose for this private address. Leave it empty to remove the label.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(ALIAS_LABEL_MAX) },
                    placeholder = { Text("Label", fontFamily = InterFontFamily) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(draft) }) {
                Text("Save", color = colors.accent, fontWeight = FontWeight.SemiBold)
            }
        },
        containerColor = colors.surface,
    )
}

/** Bottom sheet twin of iOS `CreateAliasSheet` (Identity + Rules form). */
@Composable
private fun CreateAliasSheet(
    mailboxId: String?,
    domain: String?,
    onDismiss: () -> Unit,
    onCreated: (MaskedAlias) -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    var label by remember { mutableStateOf("") }
    var expiry by remember { mutableStateOf(AliasExpiry.Never) }
    var pausedAction by remember { mutableStateOf(MaskedAlias.PAUSED_DROP) }
    var expiryMenuOpen by remember { mutableStateOf(false) }
    var pausedMenuOpen by remember { mutableStateOf(false) }
    var isCreating by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    fun create() {
        if (isCreating) return
        val mid = mailboxId ?: run {
            errorMessage = "Select a mailbox first."
            return
        }
        scope.launch {
            isCreating = true
            errorMessage = null
            try {
                val res = ApiClient.shared.createAlias(
                    mailboxId = mid,
                    label = label.trim().ifEmpty { null },
                    expiresAt = expiry.from(Instant.now()),
                    pausedAction = pausedAction,
                )
                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                onCreated(res.alias)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Server reasons (e.g. the per-mailbox limit) are worth showing as-is.
                errorMessage = (e as? ApiException.Http)?.message?.takeIf { it.isNotBlank() }
                    ?: "Failed to create private email"
            } finally {
                isCreating = false
            }
        }
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
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
                        onClick = {
                            view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                            onDismiss()
                        },
                    )
                    Text(
                        "New Private Email",
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
                        label = if (isCreating) "Creating…" else "Create",
                        enabled = !isCreating,
                        onClick = { create() },
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(bottom = 20.dp),
                ) {
                    SettingsFormSectionHeader("Identity")
                    SettingsFormGroup {
                        SettingsFormTextRow(
                            title = "Label",
                            value = label,
                            onValueChange = { label = it.take(ALIAS_LABEL_MAX) },
                            placeholder = "e.g., Online Store, Newsletter",
                            enabled = !isCreating,
                        )
                    }
                    SettingsFormFooter(
                        if (domain != null) {
                            "A random address like k8m2p9v4@$domain will be assigned automatically."
                        } else {
                            "A random address on your mailbox's domain will be assigned automatically."
                        },
                    )

                    SettingsFormSectionHeader("Rules")
                    SettingsFormGroup {
                        SettingsFormMenuRow(
                            title = "Expiration",
                            valueLabel = expiry.label,
                            expanded = expiryMenuOpen,
                            onExpandChange = { expiryMenuOpen = it },
                        ) {
                            AliasExpiry.entries.forEach { option ->
                                InboxiesMenuItem(
                                    text = option.label,
                                    icon = if (option == expiry) Icons.Outlined.Check else null,
                                    onClick = {
                                        expiry = option
                                        expiryMenuOpen = false
                                    },
                                )
                            }
                        }
                        SettingsFormDivider()
                        SettingsFormMenuRow(
                            title = "When Paused",
                            valueLabel = pausedActionLabel(pausedAction),
                            expanded = pausedMenuOpen,
                            onExpandChange = { pausedMenuOpen = it },
                        ) {
                            pausedActions.forEach { action ->
                                InboxiesMenuItem(
                                    text = pausedActionLabel(action),
                                    icon = if (action == pausedAction) Icons.Outlined.Check else null,
                                    onClick = {
                                        pausedAction = action
                                        pausedMenuOpen = false
                                    },
                                )
                            }
                        }
                    }
                    SettingsFormFooter(pausedActionFooter(pausedAction))

                    errorMessage?.let { SettingsFormErrorBanner(it) }
                }
            }
        }
    }
}

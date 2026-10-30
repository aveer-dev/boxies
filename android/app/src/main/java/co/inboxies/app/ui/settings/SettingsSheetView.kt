package co.inboxies.app.ui.settings

import co.inboxies.app.ui.components.AiUsageMeter
import android.Manifest
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import co.inboxies.app.ui.components.PrivateEmailLogoView
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ForwardToInbox
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.SignatureSettings
import co.inboxies.app.services.BounceSuppression
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.AvatarInitials
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.TransparentSystemBars
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuHeader
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.launch

private sealed class SettingsPage {
    data object Root : SettingsPage()
    data object Theme : SettingsPage()
    data object Swipe : SettingsPage()
    data object AgentPrompt : SettingsPage()
    data object Forwarding : SettingsPage()
    data object AutoReply : SettingsPage()
    data object Filters : SettingsPage()
    data object Senders : SettingsPage()
    data object Suppressions : SettingsPage()
    data object Aliases : SettingsPage()
    data object Sharing : SettingsPage()
    data object SignInMethods : SettingsPage()
    data object Sessions : SettingsPage()
    data object DomainAdmin : SettingsPage()
    data object Support : SettingsPage()
    data class AddSwipeAction(val edge: SwipeEdge) : SettingsPage()
}

@Composable
fun SettingsSheetView(
    onClose: () -> Unit,
    onThemeModeChange: (ThemeMode) -> Unit = {},
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    initialDomainAdmin: Boolean = false,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val mailboxId by app.selectedMailboxId.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()
    val current = mailboxes.firstOrNull { it.id == mailboxId }
    var page by remember {
        mutableStateOf<SettingsPage>(if (initialDomainAdmin) SettingsPage.DomainAdmin else SettingsPage.Root)
    }
    val scope = rememberCoroutineScope()

    val push = PushNotificationManager.shared
    var notificationsEnabled by remember {
        // Off until the OS permission is granted, not just the stored preference.
        mutableStateOf(push.isEffectivelyEnabled())
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            notificationsEnabled = true
            push.enableNotifications()
        } else {
            push.setNotificationsEnabled(false)
            notificationsEnabled = false
        }
    }

    fun enableNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !push.hasNotificationPermission()) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            notificationsEnabled = true
            // Registers this device for every mailbox the user has, not just the open one.
            push.enableNotifications()
        }
    }

    fun disableNotifications() {
        notificationsEnabled = false
        // Off means off for every mailbox (runs app-scoped; closing Settings can't cancel it).
        app.disablePushNotifications()
    }

    fun navigateBack() {
        page = when (val currentPage = page) {
            is SettingsPage.AddSwipeAction -> SettingsPage.Swipe
            SettingsPage.Root -> {
                onClose()
                return
            }
            else -> SettingsPage.Root
        }
    }

    BackHandler(enabled = page !is SettingsPage.Root) { navigateBack() }
    BackHandler(enabled = page is SettingsPage.Root) { onClose() }

    TransparentSystemBars()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding(),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp, bottom = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .width(36.dp)
                    .height(5.dp)
                    .clip(RoundedCornerShape(50))
                    .background(colors.muted.copy(alpha = 0.45f)),
            )
        }

        AnimatedContent(
            targetState = page,
            modifier = Modifier.fillMaxWidth(),
            transitionSpec = {
                val forward = when {
                    initialState is SettingsPage.Root -> true
                    initialState is SettingsPage.Swipe &&
                        targetState is SettingsPage.AddSwipeAction -> true
                    targetState is SettingsPage.Root -> false
                    targetState is SettingsPage.Swipe &&
                        initialState is SettingsPage.AddSwipeAction -> false
                    else -> true
                }
                (
                    slideInHorizontally(settingsNavSpring()) { full ->
                        if (forward) full / 4 else -full / 4
                    } + fadeIn(settingsNavSpring())
                ) togetherWith (
                    slideOutHorizontally(settingsNavSpring()) { full ->
                        if (forward) -full / 6 else full / 6
                    } + fadeOut(settingsNavSpring())
                ) using SizeTransform(clip = true) { _, _ ->
                    settingsNavSpring()
                }
            },
            contentAlignment = Alignment.TopStart,
            label = "settingsNav",
        ) { currentPage ->
            when (currentPage) {
                SettingsPage.Root -> SettingsRootPage(
                    mailbox = current,
                    notificationsEnabled = notificationsEnabled,
                    onClose = onClose,
                    onOpenTheme = { page = SettingsPage.Theme },
                    onOpenSwipe = { page = SettingsPage.Swipe },
                    onOpenAgentPrompt = { page = SettingsPage.AgentPrompt },
                    onOpenForwarding = { page = SettingsPage.Forwarding },
                    onOpenAutoReply = { page = SettingsPage.AutoReply },
                    onOpenFilters = { page = SettingsPage.Filters },
                    onOpenSenders = { page = SettingsPage.Senders },
                    onOpenSuppressions = { page = SettingsPage.Suppressions },
                    onOpenAliases = { page = SettingsPage.Aliases },
                    onOpenSharing = { page = SettingsPage.Sharing },
                    onOpenSignInMethods = { page = SettingsPage.SignInMethods },
                    onOpenSessions = { page = SettingsPage.Sessions },
                    onOpenDomainAdmin = { page = SettingsPage.DomainAdmin },
                    onOpenSupport = { page = SettingsPage.Support },
                    onNotificationsChange = { enabled ->
                        if (enabled) enableNotifications() else disableNotifications()
                    },
                    onDeleteMailbox = { id ->
                        onClose()
                        scope.launch { app.deleteMailbox(id) }
                    },
                )
                SettingsPage.Theme -> ThemeSettingsView(
                    themeMode = themeMode,
                    onThemeModeChange = onThemeModeChange,
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Swipe -> SwipeSettingsView(
                    onBack = { page = SettingsPage.Root },
                    onAddAction = { edge -> page = SettingsPage.AddSwipeAction(edge) },
                )
                SettingsPage.AgentPrompt -> AgentPromptSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Forwarding -> ForwardingSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.AutoReply -> AutoReplySettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Filters -> FiltersSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Senders -> SendersSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Suppressions -> SuppressionsSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Aliases -> AliasesSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Sharing -> SharingSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.SignInMethods -> SignInMethodsSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Sessions -> SessionsSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.DomainAdmin -> DomainAdminSettingsView(
                    onBack = { page = SettingsPage.Root },
                )
                SettingsPage.Support -> SupportSettingsView(
                    onBack = { page = SettingsPage.Root },
                    onCloseSettings = onClose,
                )
                is SettingsPage.AddSwipeAction -> SwipeAddActionView(
                    edge = currentPage.edge,
                    onBack = { page = SettingsPage.Swipe },
                    onDone = { page = SettingsPage.Swipe },
                )
            }
        }
    }
}

@Composable
private fun SettingsRootPage(
    mailbox: Mailbox?,
    notificationsEnabled: Boolean,
    onClose: () -> Unit,
    onOpenTheme: () -> Unit,
    onOpenSwipe: () -> Unit,
    onOpenAgentPrompt: () -> Unit,
    onOpenForwarding: () -> Unit,
    onOpenAutoReply: () -> Unit,
    onOpenFilters: () -> Unit,
    onOpenSenders: () -> Unit,
    onOpenSuppressions: () -> Unit,
    onOpenAliases: () -> Unit,
    onOpenSharing: () -> Unit,
    onOpenSignInMethods: () -> Unit,
    onOpenSessions: () -> Unit,
    onOpenDomainAdmin: () -> Unit,
    onOpenSupport: () -> Unit,
    onNotificationsChange: (Boolean) -> Unit,
    onDeleteMailbox: (String) -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val isAdmin by app.isAdmin.collectAsState()
    val readOnly by app.selectedMailboxReadOnly.collectAsState()

    val displayName = remember(mailbox) { mailboxDisplayName(mailbox) }
    val emailAddress = mailbox?.email.orEmpty()
    val initials = AvatarInitials.from(displayName.ifBlank { emailAddress.ifBlank { "A" } })

    var showEditName by remember { mutableStateOf(false) }
    var editNameDraft by remember { mutableStateOf("") }
    var showDeleteMenu by remember { mutableStateOf(false) }
    var showDeleteAccount by remember { mutableStateOf(false) }
    var isDeletingAccount by remember { mutableStateOf(false) }
    var deleteAccountError by remember { mutableStateOf<String?>(null) }
    val auth = LocalAuthStore.current
    var loadingSignInMethods by remember { mutableStateOf(false) }
    var loadingDomainAdmin by remember { mutableStateOf(false) }

    val signature = mailbox?.settings?.signature
    val signatureConfigured = !signature?.text.isNullOrBlank() || !signature?.html.isNullOrBlank()
    var signatureEnabled by remember(mailbox?.id, signature?.enabled, signatureConfigured) {
        mutableStateOf(
            when {
                signature == null -> true
                signature.enabled == false && !signatureConfigured -> true
                else -> signature.enabled != false
            },
        )
    }

    // Per-mailbox Screener switch (AVE-104). Absent means on.
    val savedScreenerEnabled = mailbox?.settings?.screener?.enabled != false
    var screenerEnabled by remember(mailbox?.id, savedScreenerEnabled) { mutableStateOf(savedScreenerEnabled) }

    Column(modifier = Modifier.fillMaxWidth()) {
        val view = LocalView.current
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
                    onClose()
                },
            )
            Spacer(Modifier.weight(1f))
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 40.dp),
        ) {

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(top = 8.dp, bottom = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(70.dp)
                        .background(colors.pillFill, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        initials,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = if (initials.length > 1) 28.sp else 34.sp,
                        color = colors.ink,
                    )
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        displayName,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 20.sp,
                        color = colors.ink,
                        textAlign = TextAlign.Center,
                    )
                    if (emailAddress.isNotBlank()) {
                        Text(
                            emailAddress,
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            color = colors.muted,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                if (!readOnly) Text(
                    "Edit",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = colors.accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(50))
                        .background(colors.pillFill)
                        .clickable {
                            editNameDraft = mailbox?.settings?.fromName
                                ?: mailbox?.name?.takeIf { it != mailbox.email }.orEmpty()
                            showEditName = true
                        }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            SettingsSectionHeader("Preferences")
            SettingsNavRow(
                title = "Swipe settings",
                icon = Icons.Outlined.SwapHoriz,
                onClick = onOpenSwipe,
            )
            // Service ended: mailbox settings, sharing and private emails are frozen.
            if (!readOnly) {
                SettingsNavRow(
                    title = "AI prompt",
                    icon = Icons.Outlined.AutoAwesome,
                    onClick = onOpenAgentPrompt,
                )
                SettingsNavRow(
                    title = "Forwarding",
                    icon = Icons.Outlined.ForwardToInbox,
                    onClick = onOpenForwarding,
                )
                SettingsNavRow(
                    title = "Auto-reply",
                    icon = Icons.AutoMirrored.Outlined.Reply,
                    onClick = onOpenAutoReply,
                )
                SettingsNavRow(
                    title = "Filters",
                    icon = Icons.Outlined.FilterList,
                    onClick = onOpenFilters,
                )
                SettingsNavRow(
                    title = "Senders",
                    icon = Icons.Outlined.Person,
                    onClick = onOpenSenders,
                )
                SettingsNavRow(
                    title = "Private email",
                    onClick = onOpenAliases,
                    icon = {
                        PrivateEmailLogoView(size = 20.dp, showTile = false)
                    },
                )
                SettingsNavRow(
                    title = "Members",
                    icon = Icons.Outlined.Group,
                    onClick = onOpenSharing,
                )
            }
            SettingsNavRow(
                title = "Sign-in & recovery",
                icon = Icons.Outlined.Key,
                isLoading = loadingSignInMethods,
                onClick = {
                    if (app.identities.value != null) {
                        onOpenSignInMethods()
                    } else {
                        if (loadingSignInMethods) return@SettingsNavRow
                        loadingSignInMethods = true
                        scope.launch {
                            try {
                                app.loadIdentities()
                                onOpenSignInMethods()
                            } catch (e: Exception) {
                                app.showToast("Could not load sign-in methods", isError = true)
                            } finally {
                                loadingSignInMethods = false
                            }
                        }
                    }
                },
            )
            SettingsNavRow(
                title = "Devices & sessions",
                icon = Icons.Outlined.Devices,
                onClick = onOpenSessions,
            )
            if (isAdmin) {
                SettingsNavRow(
                    title = "Domain Admin",
                    icon = Icons.Outlined.AdminPanelSettings,
                    isLoading = loadingDomainAdmin,
                    onClick = {
                        if (app.adminMailboxes.value != null) {
                            onOpenDomainAdmin()
                        } else {
                            if (loadingDomainAdmin) return@SettingsNavRow
                            loadingDomainAdmin = true
                            scope.launch {
                                try {
                                    app.loadAdminMailboxes()
                                    onOpenDomainAdmin()
                                } catch (e: Exception) {
                                    app.showToast("Could not load Domain Admin", isError = true)
                                } finally {
                                    loadingDomainAdmin = false
                                }
                            }
                        }
                    },
                )
            }
            SettingsToggleRow(
                title = "Notifications",
                subtitle = "Receive alerts for new messages.",
                icon = Icons.Outlined.Notifications,
                checked = notificationsEnabled,
                onCheckedChange = onNotificationsChange,
            )
            if (readOnly) {
                SettingsFormFooter(
                    "The subscription for ${mailbox?.domain.orEmpty()} ended, so this mailbox's " +
                        "settings, sharing and private emails can't be changed until it's renewed.",
                )
            } else SettingsToggleRow(
                title = "Default signature",
                subtitle = "Show 'Sent with Inboxies Email' in emails",
                icon = Icons.Outlined.Edit,
                checked = signatureEnabled,
                onCheckedChange = { enabled ->
                    signatureEnabled = enabled
                    scope.launch {
                        val ok = app.updateMailboxSettings { settings ->
                            val currentSig = settings.signature ?: SignatureSettings()
                            val nextText = if (
                                enabled &&
                                currentSig.text.isNullOrBlank() &&
                                currentSig.html.isNullOrBlank()
                            ) {
                                "Sent with Inboxies Email"
                            } else {
                                currentSig.text
                            }
                            settings.copy(
                                signature = currentSig.copy(enabled = enabled, text = nextText),
                            )
                        }
                        if (!ok) {
                            signatureEnabled = mailbox?.settings?.signature?.enabled != false
                        }
                    }
                },
            )
            if (!readOnly) {
                SettingsToggleRow(
                    title = "Screener",
                    subtitle = if (screenerEnabled) {
                        "First-time senders wait for you to accept them."
                    } else {
                        "First-time senders go to your Inbox. Spam is still filtered."
                    },
                    icon = Icons.Outlined.Shield,
                    checked = screenerEnabled,
                    onCheckedChange = { enabled ->
                        screenerEnabled = enabled
                        scope.launch {
                            if (app.setScreenerEnabled(enabled)) {
                                app.showToast(
                                    if (enabled) "Screener on" else "Screener off: new senders go to your Inbox",
                                )
                            } else {
                                screenerEnabled = app.isScreenerEnabled
                            }
                        }
                    },
                )
            }

            // Web: Settings → Outgoing mail → Bounced addresses (AVE-157).
            SettingsSectionHeader("Outgoing mail")
            SettingsNavRow(
                title = BounceSuppression.PAGE_TITLE,
                icon = Icons.Outlined.Block,
                onClick = onOpenSuppressions,
            )

            AiUsageSettingsSection(mailboxId = mailbox?.id)

            SettingsSectionHeader("Display")
            SettingsNavRow(
                title = "Theme",
                icon = Icons.Outlined.Contrast,
                onClick = onOpenTheme,
            )

            SettingsSectionHeader("Support")
            SettingsNavRow(
                title = "Support & feedback",
                icon = Icons.AutoMirrored.Outlined.HelpOutline,
                onClick = onOpenSupport,
            )

            SettingsSectionHeader("Account")
            SettingsActionRow(
                title = "Delete account",
                icon = Icons.Outlined.PersonRemove,
                destructive = true,
                onClick = {
                    deleteAccountError = null
                    showDeleteAccount = true
                },
            )

            if (!readOnly) Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Delete email",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = colors.deepDarkRed,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = mailbox != null) { showDeleteMenu = true }
                        .padding(20.dp),
                )
                InboxiesDropdownMenu(
                    expanded = showDeleteMenu,
                    onDismiss = { showDeleteMenu = false },
                ) {
                    InboxiesMenuHeader(
                        title = "This will permanently delete this email and all its messages.",
                    )
                    InboxiesMenuItem(
                        text = "Confirm delete",
                        destructive = true,
                        onClick = {
                            showDeleteMenu = false
                            mailbox?.id?.let(onDeleteMailbox)
                        },
                    )
                    InboxiesMenuItem(
                        text = "Cancel",
                        onClick = { showDeleteMenu = false },
                    )
                }
            }
        }
    }

    if (showEditName) {
        AlertDialog(
            onDismissRequest = { showEditName = false },
            title = {
                Text("Edit name", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "This name appears when you send email.",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )
                    OutlinedTextField(
                        value = editNameDraft,
                        onValueChange = { editNameDraft = it },
                        label = { Text("Display name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showEditName = false
                        val trimmed = editNameDraft.trim()
                        scope.launch {
                            app.updateMailboxSettings { it.copy(fromName = trimmed) }
                        }
                    },
                ) {
                    Text("Save", fontFamily = InterFontFamily)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEditName = false }) {
                    Text("Cancel", fontFamily = InterFontFamily)
                }
            },
        )
    }

    if (showDeleteAccount) {
        DeleteAccountDialog(
            isDeleting = isDeletingAccount,
            error = deleteAccountError,
            onConfirm = {
                isDeletingAccount = true
                deleteAccountError = null
                scope.launch {
                    try {
                        // Unregisters push, deletes server-side, clears the local cache, signs out.
                        app.deleteAccount(auth)
                        showDeleteAccount = false
                        onClose()
                    } catch (e: Exception) {
                        deleteAccountError = e.message ?: "Couldn't delete account"
                    } finally {
                        isDeletingAccount = false
                    }
                }
            },
            onDismiss = { showDeleteAccount = false },
        )
    }
}

@Composable
private fun DeleteAccountDialog(
    isDeleting: Boolean,
    error: String?,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    AlertDialog(
        onDismissRequest = { if (!isDeleting) onDismiss() },
        title = {
            Text("Delete account?", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "This permanently deletes your Inboxies account and signs you out on this device.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.ink,
                )
                Text(
                    "Mailboxes where you're the only owner are deleted with all their mail, " +
                        "for everyone who uses them. Mailboxes with another owner stay; you just lose access. " +
                        "This can't be undone.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                if (error != null) {
                    Text(error, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.deepDarkRed)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !isDeleting) {
                if (isDeleting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = colors.deepDarkRed,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Delete account", fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isDeleting) {
                Text("Cancel", fontFamily = InterFontFamily)
            }
        },
    )
}

private fun mailboxDisplayName(mailbox: Mailbox?): String {
    if (mailbox == null) return "Mailbox"
    val fromName = mailbox.settings?.fromName?.trim().orEmpty()
    if (fromName.isNotEmpty()) return fromName
    val name = mailbox.name.trim()
    if (name.isNotEmpty() && name != mailbox.email) return name
    val local = mailbox.email.substringBefore("@")
    if (local.isNotEmpty()) return local
    return mailbox.name.ifBlank { "Mailbox" }
}

/**
 * "AI usage" (AVE-45): today's agent-chat and inbound-AI counters for this mailbox,
 * with the plan and the UTC-midnight reset. Twin of the web/iOS settings section.
 */
@Composable
private fun AiUsageSettingsSection(mailboxId: String?) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val usage by app.aiUsage.collectAsState()
    LaunchedEffect(mailboxId) { app.refreshAiUsage() }
    val snapshot = usage ?: return

    SettingsSectionHeader("AI usage")
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            snapshot.planLabel,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 16.sp,
            color = colors.ink,
        )
        Text(
            "Daily limits for this mailbox. Counters reset at midnight UTC.",
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Agent chat",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = colors.ink,
        )
        AiUsageMeter(
            counter = snapshot.chat,
            noun = "AI chats",
            resetsAt = snapshot.resetsAtInstant,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "Inbound AI",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            color = colors.ink,
        )
        AiUsageMeter(
            counter = snapshot.inbound,
            noun = "AI checks",
            resetsAt = snapshot.resetsAtInstant,
        )
        Text(
            "Spam checks and auto-drafts for new mail. Past the limit, mail is sorted by your rules only.",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

package co.inboxies.app.ui.settings

import android.Manifest
import android.os.Build
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ForwardToInbox
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.SignatureSettings
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
    data object Sharing : SettingsPage()
    data object Support : SettingsPage()
    data class AddSwipeAction(val edge: SwipeEdge) : SettingsPage()
}

@Composable
fun SettingsSheetView(
    onClose: () -> Unit,
    onThemeModeChange: (ThemeMode) -> Unit = {},
    themeMode: ThemeMode = ThemeMode.SYSTEM,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val mailboxId by app.selectedMailboxId.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()
    val current = mailboxes.firstOrNull { it.id == mailboxId }
    var page by remember { mutableStateOf<SettingsPage>(SettingsPage.Root) }
    val scope = rememberCoroutineScope()

    val push = PushNotificationManager.shared
    var notificationsEnabled by remember {
        mutableStateOf(push.isNotificationsEnabled())
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            push.setNotificationsEnabled(true)
            notificationsEnabled = true
            mailboxId?.let { push.requestPermissionAndRegister(it) }
        } else {
            push.setNotificationsEnabled(false)
            notificationsEnabled = false
        }
    }

    fun enableNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !push.hasNotificationPermission()) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            push.setNotificationsEnabled(true)
            notificationsEnabled = true
            mailboxId?.let { push.requestPermissionAndRegister(it) }
        }
    }

    fun disableNotifications() {
        push.setNotificationsEnabled(false)
        notificationsEnabled = false
        mailboxId?.let { push.unregisterToken(it) }
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
                    onOpenSharing = { page = SettingsPage.Sharing },
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
                SettingsPage.Sharing -> SharingSettingsView(
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
    onOpenSharing: () -> Unit,
    onOpenSupport: () -> Unit,
    onNotificationsChange: (Boolean) -> Unit,
    onDeleteMailbox: (String) -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()

    val displayName = remember(mailbox) { mailboxDisplayName(mailbox) }
    val emailAddress = mailbox?.email.orEmpty()
    val initials = AvatarInitials.from(displayName.ifBlank { emailAddress.ifBlank { "A" } })

    var showEditName by remember { mutableStateOf(false) }
    var editNameDraft by remember { mutableStateOf("") }
    var showDeleteMenu by remember { mutableStateOf(false) }

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

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeChromeToolbarButton(
                icon = Icons.Outlined.Close,
                contentDescription = "Close",
                onClick = onClose,
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
                Text(
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
                title = "Sharing",
                icon = Icons.Outlined.Group,
                onClick = onOpenSharing,
            )
            SettingsToggleRow(
                title = "Notifications",
                subtitle = "Receive alerts for new messages.",
                icon = Icons.Outlined.Notifications,
                checked = notificationsEnabled,
                onCheckedChange = onNotificationsChange,
            )
            SettingsToggleRow(
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

            Box(
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

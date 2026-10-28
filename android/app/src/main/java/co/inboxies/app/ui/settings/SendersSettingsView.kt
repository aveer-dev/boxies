package co.inboxies.app.ui.settings

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.SenderPreference
import co.inboxies.app.models.SenderRule
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.ui.components.LoadFailedContent
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID

/** Settings → Senders tabs. iOS twin: `SendersSettingsView.Tab`. */
enum class SendersTab(val title: String) {
    Allowed("Allowed"),
    Blocked("Blocked"),
    Sorting("Sorting"),
}

/**
 * Settings → Senders: Allowed / Blocked rules and Sorting (per-sender purpose-box
 * defaults). iOS twin: `SendersSettingsView.swift`. Web:
 * `app/components/settings/SendersSettings.tsx`.
 */
@Composable
fun SendersSettingsView(
    onBack: () -> Unit,
    initialTab: SendersTab = SendersTab.Allowed,
) {
    val colors = inboxiesColors()
    var tab by remember { mutableStateOf(initialTab) }

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
                "Senders",
                fontFamily = InterFontFamily,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors.ink,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
        SendersTabBar(
            selection = tab,
            onSelect = { tab = it },
            modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 4.dp),
        )
        when (tab) {
            SendersTab.Allowed -> androidx.compose.runtime.key(SendersTab.Allowed) { SenderRulesTab(verdict = "allow") }
            SendersTab.Blocked -> androidx.compose.runtime.key(SendersTab.Blocked) { SenderRulesTab(verdict = "block") }
            SendersTab.Sorting -> SenderSortingTab()
        }
    }
}

/** Pill segmented control (iOS twin: `SendersTabBar`). */
@Composable
private fun SendersTabBar(
    selection: SendersTab,
    onSelect: (SendersTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val haptics = LocalHapticFeedback.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.pillFill, RoundedCornerShape(10.dp))
            .padding(3.dp),
    ) {
        SendersTab.entries.forEach { tab ->
            val active = tab == selection
            val fill by animateColorAsState(
                if (active) colors.surface else Color.Transparent,
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                label = "sendersTabFill",
            )
            val stroke by animateColorAsState(
                if (active) colors.line else Color.Transparent,
                animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                label = "sendersTabStroke",
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(30.dp)
                    .background(fill, RoundedCornerShape(8.dp))
                    .border(0.5.dp, stroke, RoundedCornerShape(8.dp))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Tab,
                    ) {
                        if (!active) {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            onSelect(tab)
                        }
                    }
                    .semantics { selected = active },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    tab.title,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (active) colors.ink else colors.muted,
                )
            }
        }
    }
}

/** Mirrors `shared/sender-rules.ts` (web) and `SenderRuleInput` (iOS). */
object SenderRuleInput {
    /** "ada@acme.com" is an address; "@acme.com" or "acme.com" is a domain. */
    fun parse(raw: String): Pair<String, String>? {
        val value = raw.trim().lowercase()
        if (value.isEmpty()) return null
        if (value.startsWith("@")) return "domain" to value.drop(1)
        if (value.contains("@")) return "address" to value
        return "domain" to value
    }

    fun sourceLabel(source: String): String = when (source) {
        "not_spam" -> "Not spam"
        "report_spam" -> "Reported spam"
        "settings" -> "Added in Settings"
        "screener" -> "Screener"
        "sent" -> "You emailed them"
        "bootstrap" -> "Imported"
        else -> "Other"
    }

    fun displayValue(rule: SenderRule): String =
        if (rule.kind == "domain") "@${rule.value}" else rule.value

    private val dateFormat = DateTimeFormatter.ofPattern("MMM d, yyyy")

    fun dateLabel(iso: String): String = runCatching {
        dateFormat.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
    }.getOrDefault("")

    fun metaLine(rule: SenderRule): String =
        listOfNotNull(
            if (rule.kind == "domain") "Domain" else null,
            sourceLabel(rule.source),
            dateLabel(rule.createdAt),
        ).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** DEBUG preview fixtures (`senders` / `sendersBlocked`); no server. */
object PreviewSenderRules {
    fun rules(verdict: String): List<SenderRule> = if (verdict == "allow") {
        listOf(
            rule("r1", "address", "ada@lovelace.dev", "allow", "not_spam", "2026-10-24T09:12:00.000Z"),
            rule("r2", "domain", "acme.com", "allow", "settings", "2026-10-20T15:40:00.000Z"),
            rule("r3", "address", "billing@stripe.com", "allow", "sent", "2026-09-02T11:00:00.000Z"),
        )
    } else {
        listOf(
            rule("r4", "domain", "promo-blast.biz", "block", "settings", "2026-10-25T08:30:00.000Z"),
            rule("r5", "address", "deals@shopnow.example", "block", "report_spam", "2026-10-18T19:05:00.000Z"),
            rule("r6", "address", "cold@outreach.io", "block", "screener", "2026-08-30T13:22:00.000Z"),
        )
    }

    /** Mimics the server's free-mail refusal so the inline error can be reviewed. */
    fun add(kind: String, value: String, verdict: String): SenderRule {
        val freeMail = setOf("gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me")
        if (kind == "domain" && value in freeMail) {
            throw ApiException.Http(400, "$value is a free email provider; add the sender's address instead")
        }
        return rule(UUID.randomUUID().toString(), kind, value, verdict, "settings", Instant.now().toString())
    }

    private fun rule(id: String, kind: String, value: String, verdict: String, source: String, date: String) =
        SenderRule(id = id, kind = kind, value = value, verdict = verdict, source = source, createdAt = date, updatedAt = date)
}

/** Allowed or Blocked list with the Add field. */
@Composable
private fun SenderRulesTab(verdict: String) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId = app.selectedMailbox?.id
    val isAllow = verdict == "allow"

    var rules by remember { mutableStateOf<List<SenderRule>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }
    var addError by remember { mutableStateOf<String?>(null) }
    var isAdding by remember { mutableStateOf(false) }
    var busyRuleId by remember { mutableStateOf<String?>(null) }

    fun reload() {
        scope.launch {
            if (app.isDebugPreview) {
                rules = PreviewSenderRules.rules(verdict)
                isLoading = false
                return@launch
            }
            val id = mailboxId ?: run { isLoading = false; return@launch }
            isLoading = rules.isEmpty()
            loadError = null
            runCatching { ApiClient.shared.listSenderRules(id, verdict) }
                .onSuccess { rules = it }
                .onFailure { loadError = it.message ?: "Failed to load senders" }
            isLoading = false
        }
    }

    fun add() {
        if (isAdding || draft.isBlank()) return
        val parsed = SenderRuleInput.parse(draft) ?: run {
            addError = "Enter an address or @domain"
            return
        }
        addError = null
        isAdding = true
        scope.launch {
            runCatching {
                if (app.isDebugPreview) {
                    PreviewSenderRules.add(parsed.first, parsed.second, verdict)
                } else {
                    val id = mailboxId ?: error("No mailbox selected")
                    ApiClient.shared.upsertSenderRule(id, parsed.first, parsed.second, verdict)
                }
            }.onSuccess { rule ->
                draft = ""
                rules = listOf(rule) + rules.filterNot {
                    it.id == rule.id || (it.kind == rule.kind && it.value == rule.value)
                }
            }.onFailure { e ->
                // Free-mail provider, public suffix or a malformed value: the server's
                // sentence is written for the user.
                addError = if (e is ApiException.Http && e.code == 400 && !e.serverMessage.isNullOrBlank()) {
                    e.serverMessage
                } else {
                    "Couldn’t save the rule. Try again."
                }
            }
            isAdding = false
        }
    }

    fun remove(rule: SenderRule) {
        busyRuleId = rule.id
        scope.launch {
            runCatching {
                if (!app.isDebugPreview) {
                    val id = mailboxId ?: error("No mailbox selected")
                    ApiClient.shared.deleteSenderRule(id, rule.id)
                }
            }.onSuccess {
                rules = rules.filterNot { it.id == rule.id }
            }.onFailure {
                loadError = it.message
            }
            busyRuleId = null
        }
    }

    LaunchedEffect(mailboxId, verdict) { reload() }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            if (isAllow) {
                "Mail from these senders skips Spam. A domain rule only applies to mail that passes sender verification."
            } else {
                "Mail from these senders goes to Spam (or Screened out when the Screener is on)."
            },
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
        )

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val fieldShape = RoundedCornerShape(10.dp)
                BasicTextField(
                    value = draft,
                    onValueChange = {
                        draft = it
                        addError = null
                    },
                    singleLine = true,
                    textStyle = TextStyle(fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.ink),
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
                        .height(40.dp)
                        .background(colors.surface, fieldShape)
                        .border(
                            if (addError == null) 0.5.dp else 1.dp,
                            if (addError == null) colors.line else colors.deepDarkRed,
                            fieldShape,
                        )
                        .semantics {
                            contentDescription = if (isAllow) "Allow an address or domain" else "Block an address or domain"
                        },
                    decorationBox = { inner ->
                        Box(
                            modifier = Modifier.padding(horizontal = 14.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (draft.isEmpty()) {
                                Text(
                                    "name@example.com or @example.com",
                                    fontFamily = InterFontFamily,
                                    fontSize = 15.sp,
                                    color = colors.muted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            inner()
                        }
                    },
                )
                val canAdd = !isAdding && draft.isNotBlank()
                Box(
                    modifier = Modifier
                        .width(64.dp)
                        .height(40.dp)
                        .background(
                            colors.accent.copy(alpha = if (canAdd) 1f else 0.45f),
                            RoundedCornerShape(10.dp),
                        )
                        .clickable(enabled = canAdd, role = Role.Button) { add() },
                    contentAlignment = Alignment.Center,
                ) {
                    if (isAdding) {
                        CircularProgressIndicator(
                            color = Color.White,
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text(
                            "Add",
                            fontFamily = InterFontFamily,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White,
                        )
                    }
                }
            }
            addError?.let { message ->
                Text(
                    message,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.deepDarkRed,
                )
            }
        }

        when {
            isLoading -> {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = colors.accent,
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
            loadError != null -> {
                LoadFailedContent(
                    title = if (isAllow) "Couldn’t load allowed senders" else "Couldn’t load blocked senders",
                    message = loadError,
                    isRetrying = false,
                    onRetry = { reload() },
                )
            }
            rules.isEmpty() -> {
                Column(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        if (isAllow) "No allowed senders yet" else "No blocked senders yet",
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        color = colors.ink,
                    )
                    Text(
                        if (isAllow) {
                            "Marking mail as Not spam adds the sender here, or add an address or @domain above."
                        } else {
                            "Reporting spam adds the sender here, or add an address or @domain above."
                        },
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )
                }
            }
            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface, RoundedCornerShape(12.dp)),
                ) {
                    rules.forEachIndexed { index, rule ->
                        SenderRuleRow(
                            rule = rule,
                            busy = busyRuleId == rule.id,
                            onRemove = { remove(rule) },
                        )
                        if (index != rules.lastIndex) {
                            Spacer(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(0.5.dp)
                                    .background(colors.line),
                            )
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
    }
}

@Composable
private fun SenderRuleRow(
    rule: SenderRule,
    busy: Boolean,
    onRemove: () -> Unit,
) {
    val colors = inboxiesColors()
    val display = SenderRuleInput.displayValue(rule)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                display,
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                SenderRuleInput.metaLine(rule),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box(
            modifier = Modifier
                .size(32.dp)
                .clickable(enabled = !busy, role = Role.Button, onClick = onRemove)
                .semantics { contentDescription = "Remove $display" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Delete,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** Sorting tab: per-sender purpose-box defaults (Inbox / Promotions / Updates). */
@Composable
private fun SenderSortingTab() {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId = app.selectedMailbox?.id

    var query by remember { mutableStateOf("") }
    var preferences by remember { mutableStateOf<List<SenderPreference>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var busyAddress by remember { mutableStateOf<String?>(null) }

    fun reload() {
        val id = mailboxId ?: return
        scope.launch {
            isLoading = preferences.isEmpty()
            errorMessage = null
            runCatching {
                ApiClient.shared.listSenderPreferences(id, q = query.trim())
            }.onSuccess {
                preferences = it
            }.onFailure {
                errorMessage = it.message ?: "Failed to load senders"
            }
            isLoading = false
        }
    }

    LaunchedEffect(mailboxId, query) {
        reload()
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Choose which purpose box each sender goes to. Changing a destination also moves their existing Inbox, Promotions, and Updates mail.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )

                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("Search senders") },
                )

                when {
                    isLoading -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                color = colors.accent,
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp,
                            )
                        }
                    }
                    errorMessage != null -> {
                        Text(
                            errorMessage!!,
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.deepDarkRed,
                        )
                    }
                    preferences.isEmpty() -> {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "No sender defaults yet",
                                fontFamily = InterFontFamily,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                                color = colors.ink,
                            )
                            Text(
                                "When you move mail into Inbox, Promotions, or Updates, you can set where future mail from that sender goes.",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                color = colors.muted,
                            )
                        }
                    }
                    else -> {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(colors.surface, RoundedCornerShape(12.dp)),
                        ) {
                            preferences.forEachIndexed { index, pref ->
                                SenderPreferenceRow(
                                    preference = pref,
                                    busy = busyAddress == pref.address,
                                    onChangeFolder = { folderId ->
                                        val id = mailboxId ?: return@SenderPreferenceRow
                                        busyAddress = pref.address
                                        scope.launch {
                                            runCatching {
                                                ApiClient.shared.upsertSenderPreference(
                                                    id,
                                                    pref.address,
                                                    folderId,
                                                    displayName = pref.displayName,
                                                    refile = true,
                                                )
                                            }.onSuccess {
                                                reload()
                                            }.onFailure {
                                                errorMessage = it.message
                                            }
                                            busyAddress = null
                                        }
                                    },
                                    onDelete = {
                                        val id = mailboxId ?: return@SenderPreferenceRow
                                        busyAddress = pref.address
                                        scope.launch {
                                            runCatching {
                                                ApiClient.shared.deleteSenderPreference(id, pref.address)
                                            }.onSuccess {
                                                preferences = preferences.filterNot { it.address == pref.address }
                                            }.onFailure {
                                                errorMessage = it.message
                                            }
                                            busyAddress = null
                                        }
                                    },
                                )
                                if (index != preferences.lastIndex) {
                                    Spacer(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(1.dp)
                                            .background(colors.line),
                                    )
                                }
                            }
                        }
                    }
                }

                Text(
                    "Filters still override these defaults when a rule matches. Spam is never routed by sender preference.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun SenderPreferenceRow(
    preference: SenderPreference,
    busy: Boolean,
    onChangeFolder: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    val title = preference.displayName?.takeIf { it.isNotBlank() } ?: preference.address

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!preference.displayName.isNullOrBlank()) {
                Text(
                    preference.address,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Box {
            Text(
                FolderIds.purposeDisplayName(preference.folderId),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = colors.accent,
                modifier = Modifier
                    .clickable(enabled = !busy) { menuOpen = true }
                    .padding(vertical = 4.dp, horizontal = 4.dp),
            )
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                FolderIds.purposeFolderIds.forEach { folderId ->
                    DropdownMenuItem(
                        text = { Text(FolderIds.purposeDisplayName(folderId)) },
                        onClick = {
                            menuOpen = false
                            onChangeFolder(folderId)
                        },
                    )
                }
            }
        }

        Icon(
            Icons.Outlined.Delete,
            contentDescription = "Remove",
            tint = colors.muted,
            modifier = Modifier
                .size(18.dp)
                .clickable(enabled = !busy, onClick = onDelete),
        )
    }
}

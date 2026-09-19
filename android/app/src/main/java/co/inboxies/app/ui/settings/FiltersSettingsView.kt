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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.InboxFilterRule
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun FiltersSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailbox = app.selectedMailbox
    val folders by app.folders.collectAsState()

    var rules by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.filters.orEmpty())
    }
    var editingId by remember { mutableStateOf<String?>(null) }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }
    var folderMenuExpanded by remember { mutableStateOf(false) }

    val editing = rules.firstOrNull { it.id == editingId }

    fun summarize(rule: InboxFilterRule): String {
        val conditions = buildList {
            rule.from?.trim()?.takeIf { it.isNotEmpty() }?.let { add("from $it") }
            rule.list?.trim()?.takeIf { it.isNotEmpty() }?.let {
                add(if (it == "*") "any list" else "list $it")
            }
            rule.subject?.trim()?.takeIf { it.isNotEmpty() }?.let { add("subject \"$it\"") }
        }
        val actions = buildList {
            rule.folderId?.trim()?.takeIf { it.isNotEmpty() }?.let { id ->
                add(folders.firstOrNull { it.id == id }?.name ?: id)
            }
            if (rule.skipAutoDraft == true) add("skip auto-draft")
            rule.forwardTo?.trim()?.takeIf { it.isNotEmpty() }?.let { add("forward to $it") }
        }
        val left = conditions.ifEmpty { listOf("no conditions") }.joinToString(", ")
        val right = actions.ifEmpty { listOf("no actions") }.joinToString(", ")
        return "$left → $right"
    }

    fun updateRule(id: String, transform: (InboxFilterRule) -> InboxFilterRule) {
        rules = rules.map { if (it.id == id) transform(it) else it }
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
                    "Filters",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                SettingsChromeTextButton(
                    label = "Save",
                    enabled = !isSaving && mailbox != null,
                    onClick = {
                        scope.launch {
                            val cleaned = rules.map { rule ->
                                rule.copy(
                                    enabled = rule.enabled != false,
                                    name = rule.name?.trim()?.ifEmpty { null },
                                    from = rule.from?.trim()?.ifEmpty { null },
                                    list = rule.list?.trim()?.ifEmpty { null },
                                    subject = rule.subject?.trim()?.ifEmpty { null },
                                    folderId = rule.folderId?.trim()?.ifEmpty { null },
                                    skipAutoDraft = if (rule.skipAutoDraft == true) true else null,
                                    forwardTo = rule.forwardTo?.trim()?.ifEmpty { null },
                                )
                            }
                            for (rule in cleaned) {
                                val hasCondition =
                                    rule.from != null || rule.list != null || rule.subject != null
                                val hasAction =
                                    rule.folderId != null ||
                                        rule.skipAutoDraft == true ||
                                        rule.forwardTo != null
                                if (!hasCondition) {
                                    saveMessage =
                                        "Each filter needs a from, list, or subject condition"
                                    delay(2000)
                                    saveMessage = null
                                    return@launch
                                }
                                if (!hasAction) {
                                    saveMessage =
                                        "Each filter needs a folder, skip auto-draft, or forward action"
                                    delay(2000)
                                    saveMessage = null
                                    return@launch
                                }
                                val forwardTo = rule.forwardTo
                                if (forwardTo != null) {
                                    if (!forwardTo.contains("@")) {
                                        saveMessage = "Enter a valid filter forward address"
                                        delay(2000)
                                        saveMessage = null
                                        return@launch
                                    }
                                    if (forwardTo.equals(mailbox?.email, ignoreCase = true)) {
                                        saveMessage =
                                            "Filter forward address cannot be this mailbox"
                                        delay(2000)
                                        saveMessage = null
                                        return@launch
                                    }
                                }
                            }
                            if (cleaned.size > 50) {
                                saveMessage = "At most 50 filters allowed"
                                delay(2000)
                                saveMessage = null
                                return@launch
                            }

                            isSaving = true
                            val ok = app.updateMailboxSettings { settings ->
                                settings.copy(filters = cleaned)
                            }
                            saveMessage = if (ok) "Filters saved" else "Failed to save"
                            isSaving = false
                            if (ok) editingId = null
                            delay(if (ok) 1200 else 2000)
                            saveMessage = null
                        }
                    },
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "If a message matches, file it, skip auto-draft, or forward. First matching rule wins.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                Text(
                    "Conditions use AND. For sender, use an address, @domain.com, or a substring. For lists, use List-Id text or * for any mailing list.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )

                if (rules.isEmpty()) {
                    Text(
                        "No filters yet.",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.muted,
                    )
                }

                rules.forEach { rule ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.surface, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Switch(
                            checked = rule.enabled != false,
                            onCheckedChange = { checked ->
                                updateRule(rule.id) { it.copy(enabled = checked) }
                            },
                            colors = SwitchDefaults.colors(
                                checkedTrackColor = colors.accent,
                                checkedThumbColor = Color.White,
                            ),
                        )
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clickable {
                                    editingId = if (editingId == rule.id) null else rule.id
                                },
                        ) {
                            Text(
                                rule.name?.trim()?.ifEmpty { null } ?: "Untitled filter",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 15.sp,
                                color = colors.ink,
                            )
                            Text(
                                summarize(rule),
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.muted,
                            )
                        }
                        IconButton(
                            onClick = {
                                rules = rules.filterNot { it.id == rule.id }
                                if (editingId == rule.id) editingId = null
                            },
                        ) {
                            Icon(
                                Icons.Outlined.Delete,
                                contentDescription = "Delete filter",
                                tint = colors.muted,
                            )
                        }
                    }
                }

                editing?.let { rule ->
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.surface, RoundedCornerShape(12.dp))
                            .padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            "Edit filter",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 14.sp,
                            color = colors.ink,
                        )
                        OutlinedTextField(
                            value = rule.name.orEmpty(),
                            onValueChange = { value ->
                                updateRule(rule.id) { it.copy(name = value) }
                            },
                            label = { Text("Name") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        )
                        Text(
                            "Conditions",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                        OutlinedTextField(
                            value = rule.from.orEmpty(),
                            onValueChange = { value ->
                                updateRule(rule.id) { it.copy(from = value) }
                            },
                            label = { Text("From") },
                            placeholder = { Text("boss@company.com or @company.com") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        )
                        OutlinedTextField(
                            value = rule.list.orEmpty(),
                            onValueChange = { value ->
                                updateRule(rule.id) { it.copy(list = value) }
                            },
                            label = { Text("List") },
                            placeholder = { Text("* or list-id fragment") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        )
                        OutlinedTextField(
                            value = rule.subject.orEmpty(),
                            onValueChange = { value ->
                                updateRule(rule.id) { it.copy(subject = value) }
                            },
                            label = { Text("Subject contains") },
                            placeholder = { Text("invoice") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        )
                        Text(
                            "Actions",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                        Box {
                            TextButton(onClick = { folderMenuExpanded = true }) {
                                val label = rule.folderId
                                    ?.let { id -> folders.firstOrNull { it.id == id }?.name ?: id }
                                    ?: "Keep classified folder"
                                Text(label, color = colors.ink)
                            }
                            DropdownMenu(
                                expanded = folderMenuExpanded,
                                onDismissRequest = { folderMenuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Keep classified folder") },
                                    onClick = {
                                        updateRule(rule.id) { it.copy(folderId = null) }
                                        folderMenuExpanded = false
                                    },
                                )
                                folders.forEach { folder ->
                                    DropdownMenuItem(
                                        text = { Text(folder.name) },
                                        onClick = {
                                            updateRule(rule.id) { it.copy(folderId = folder.id) }
                                            folderMenuExpanded = false
                                        },
                                    )
                                }
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Skip auto-draft",
                                fontFamily = InterFontFamily,
                                fontSize = 16.sp,
                                color = colors.ink,
                                modifier = Modifier.weight(1f),
                            )
                            Switch(
                                checked = rule.skipAutoDraft == true,
                                onCheckedChange = { checked ->
                                    updateRule(rule.id) { it.copy(skipAutoDraft = checked) }
                                },
                                colors = SwitchDefaults.colors(
                                    checkedTrackColor = colors.accent,
                                    checkedThumbColor = Color.White,
                                ),
                            )
                        }
                        OutlinedTextField(
                            value = rule.forwardTo.orEmpty(),
                            onValueChange = { value ->
                                updateRule(rule.id) { it.copy(forwardTo = value) }
                            },
                            label = { Text("Forward to") },
                            placeholder = { Text("optional@example.com") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp),
                        )
                    }
                }

                TextButton(
                    onClick = {
                        val rule = InboxFilterRule(
                            id = UUID.randomUUID().toString(),
                            enabled = true,
                        )
                        rules = rules + rule
                        editingId = rule.id
                    },
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.accent)
                    Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                    Text(
                        "Add filter",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        color = colors.accent,
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }

        androidx.compose.animation.AnimatedVisibility(
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

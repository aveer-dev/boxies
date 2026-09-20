package co.inboxies.app.ui.settings

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Folder
import co.inboxies.app.models.InboxFilterRule
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesMenuItem
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class FilterEditorDraft(
    val rule: InboxFilterRule,
    val isNew: Boolean,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FiltersSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val mailbox = app.selectedMailbox
    val folders by app.folders.collectAsState()

    var rules by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.filters.orEmpty())
    }
    var editorDraft by remember { mutableStateOf<FilterEditorDraft?>(null) }
    var actionRuleId by remember { mutableStateOf<String?>(null) }
    var isSelectMode by remember { mutableStateOf(false) }
    var selectedIds by remember { mutableStateOf(setOf<String>()) }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    val actionRule = rules.firstOrNull { it.id == actionRuleId }

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

    fun exitSelectMode() {
        isSelectMode = false
        selectedIds = emptySet()
    }

    fun deleteSelected() {
        rules = rules.filterNot { selectedIds.contains(it.id) }
        exitSelectMode()
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
                if (isSelectMode) {
                    SettingsChromeTextButton(
                        label = "Cancel",
                        onClick = { exitSelectMode() },
                    )
                } else {
                    HomeChromeToolbarButton(
                        icon = Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = "Back",
                        onClick = onBack,
                    )
                }
                Text(
                    when {
                        isSelectMode && selectedIds.isEmpty() -> "Select filters"
                        isSelectMode -> "${selectedIds.size} selected"
                        else -> "Filters"
                    },
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                if (isSelectMode) {
                    SettingsChromeTextButton(
                        label = "Delete",
                        enabled = selectedIds.isNotEmpty(),
                        onClick = { deleteSelected() },
                    )
                } else {
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
                                delay(if (ok) 1200 else 2000)
                                saveMessage = null
                            }
                        },
                    )
                }
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
                    val isSelected = selectedIds.contains(rule.id)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(colors.surface, RoundedCornerShape(12.dp))
                            .border(1.dp, colors.line, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .combinedClickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = {
                                        if (isSelectMode) {
                                            selectedIds = if (isSelected) {
                                                selectedIds - rule.id
                                            } else {
                                                selectedIds + rule.id
                                            }
                                        } else {
                                            actionRuleId = rule.id
                                        }
                                    },
                                    onLongClick = {
                                        if (!isSelectMode) {
                                            view.performHapticFeedback(
                                                HapticFeedbackConstants.LONG_PRESS,
                                            )
                                            isSelectMode = true
                                            selectedIds = setOf(rule.id)
                                        }
                                    },
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            AnimatedVisibility(
                                visible = isSelectMode,
                                enter = fadeIn(settingsNavSpring()) +
                                    expandHorizontally(
                                        animationSpec = settingsNavSpring(),
                                        expandFrom = Alignment.Start,
                                        clip = false,
                                    ) +
                                    scaleIn(animationSpec = settingsNavSpring(), initialScale = 0.72f),
                                exit = fadeOut(settingsNavSpring()) +
                                    shrinkHorizontally(
                                        animationSpec = settingsNavSpring(),
                                        shrinkTowards = Alignment.Start,
                                        clip = false,
                                    ) +
                                    scaleOut(animationSpec = settingsNavSpring(), targetScale = 0.72f),
                            ) {
                                Icon(
                                    imageVector = if (isSelected) {
                                        Icons.Outlined.CheckCircle
                                    } else {
                                        Icons.Outlined.Circle
                                    },
                                    contentDescription = if (isSelected) "Selected" else "Not selected",
                                    tint = if (isSelected) colors.ink else colors.muted.copy(alpha = 0.6f),
                                    modifier = Modifier.size(22.dp),
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
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
                        }
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
                    }
                }

                if (!isSelectMode) {
                    TextButton(
                        onClick = {
                            val id = UUID.randomUUID().toString()
                            editorDraft = FilterEditorDraft(
                                rule = InboxFilterRule(id = id, enabled = true),
                                isNew = true,
                            )
                        },
                    ) {
                        Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.accent)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            "Add filter",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            color = colors.accent,
                        )
                    }
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

    editorDraft?.let { draft ->
        FilterEditorDialog(
            draft = draft,
            folders = folders,
            mailboxEmail = mailbox?.email.orEmpty(),
            onDismiss = { editorDraft = null },
            onSave = { rule ->
                rules = if (rules.any { it.id == rule.id }) {
                    rules.map { if (it.id == rule.id) rule else it }
                } else {
                    rules + rule
                }
                editorDraft = null
            },
        )
    }

    if (actionRule != null) {
        FilterActionsSheet(
            title = actionRule.name?.trim()?.ifEmpty { null } ?: "Untitled filter",
            onDismiss = { actionRuleId = null },
            onDelete = {
                rules = rules.filterNot { it.id == actionRule.id }
                actionRuleId = null
            },
        )
    }
}

@Composable
private fun FilterActionsSheet(
    title: String,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
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
                    .align(Alignment.Center)
                    .padding(horizontal = 32.dp)
                    .fillMaxWidth(0.88f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(colors.surface)
                    .border(1.dp, colors.line, RoundedCornerShape(16.dp))
                    .padding(20.dp),
            ) {
                Text(
                    title,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                )
                Text(
                    "Remove this filter from the list. Save to apply the change.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors.pillFill),
                    ) {
                        Text(
                            "Cancel",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            color = colors.ink,
                        )
                    }
                    TextButton(
                        onClick = onDelete,
                        modifier = Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors.deepDarkRed),
                    ) {
                        Text(
                            "Delete",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterEditorDialog(
    draft: FilterEditorDraft,
    folders: List<Folder>,
    mailboxEmail: String,
    onDismiss: () -> Unit,
    onSave: (InboxFilterRule) -> Unit,
) {
    val colors = inboxiesColors()
    var rule by remember(draft.rule.id) { mutableStateOf(draft.rule) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var folderMenuExpanded by remember { mutableStateOf(false) }

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
                    .fillMaxHeight(0.92f)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(colors.background)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {},
                    )
                    .navigationBarsPadding(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Close,
                        contentDescription = "Cancel",
                        onClick = onDismiss,
                    )
                    Text(
                        if (draft.isNew) "New Filter" else "Edit Filter",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = colors.ink,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 8.dp),
                    )
                    SettingsChromeTextButton(
                        label = if (draft.isNew) "Add" else "Done",
                        onClick = {
                            val cleaned = rule.copy(
                                enabled = rule.enabled != false,
                                name = rule.name?.trim()?.ifEmpty { null },
                                from = rule.from?.trim()?.ifEmpty { null },
                                list = rule.list?.trim()?.ifEmpty { null },
                                subject = rule.subject?.trim()?.ifEmpty { null },
                                folderId = rule.folderId?.trim()?.ifEmpty { null },
                                skipAutoDraft = if (rule.skipAutoDraft == true) true else null,
                                forwardTo = rule.forwardTo?.trim()?.ifEmpty { null },
                            )
                            val hasCondition =
                                cleaned.from != null || cleaned.list != null || cleaned.subject != null
                            val hasAction =
                                cleaned.folderId != null ||
                                    cleaned.skipAutoDraft == true ||
                                    cleaned.forwardTo != null
                            when {
                                !hasCondition -> {
                                    errorMessage = "Add a from, list, or subject condition"
                                }
                                !hasAction -> {
                                    errorMessage =
                                        "Add a folder, skip auto-draft, or forward action"
                                }
                                cleaned.forwardTo != null && !cleaned.forwardTo.contains("@") -> {
                                    errorMessage = "Enter a valid forward address"
                                }
                                cleaned.forwardTo != null &&
                                    cleaned.forwardTo.equals(mailboxEmail, ignoreCase = true) -> {
                                    errorMessage = "Forward address cannot be this mailbox"
                                }
                                else -> onSave(cleaned)
                            }
                        },
                    )
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(bottom = 24.dp),
                ) {
                    errorMessage?.let { message ->
                        SettingsFormErrorBanner(message)
                    }

                    SettingsFormSectionHeader("Name")
                    SettingsFormGroup {
                        SettingsFormPlainFieldRow(
                            value = rule.name.orEmpty(),
                            onValueChange = { value -> rule = rule.copy(name = value) },
                            placeholder = "Newsletters",
                        )
                    }
                    SettingsFormFooter(
                        "Optional label so you can recognize this filter in the list.",
                    )

                    SettingsFormSectionHeader("Conditions")
                    SettingsFormGroup {
                        SettingsFormTextRow(
                            title = "From",
                            value = rule.from.orEmpty(),
                            onValueChange = { value -> rule = rule.copy(from = value) },
                            placeholder = "name@ or @domain.com",
                        )
                        SettingsFormDivider()
                        SettingsFormTextRow(
                            title = "List",
                            value = rule.list.orEmpty(),
                            onValueChange = { value -> rule = rule.copy(list = value) },
                            placeholder = "* or list-id",
                        )
                        SettingsFormDivider()
                        SettingsFormTextRow(
                            title = "Subject",
                            value = rule.subject.orEmpty(),
                            onValueChange = { value -> rule = rule.copy(subject = value) },
                            placeholder = "Contains…",
                        )
                    }
                    SettingsFormFooter(
                        "Match sender, mailing list, or subject text. At least one condition is required. Multiple conditions use AND.",
                    )

                    SettingsFormSectionHeader("Actions")
                    SettingsFormGroup {
                        SettingsFormMenuRow(
                            title = "Move to Folder",
                            valueLabel = rule.folderId
                                ?.let { id -> folders.firstOrNull { it.id == id }?.name ?: id }
                                ?: "Keep classified",
                            expanded = folderMenuExpanded,
                            onExpandChange = { folderMenuExpanded = it },
                        ) {
                            InboxiesMenuItem(
                                text = "Keep classified",
                                onClick = {
                                    rule = rule.copy(folderId = null)
                                    folderMenuExpanded = false
                                },
                            )
                            folders.forEach { folder ->
                                InboxiesMenuItem(
                                    text = folder.name,
                                    onClick = {
                                        rule = rule.copy(folderId = folder.id)
                                        folderMenuExpanded = false
                                    },
                                )
                            }
                        }
                        SettingsFormDivider()
                        SettingsFormSwitchRow(
                            title = "Skip Auto-Draft",
                            checked = rule.skipAutoDraft == true,
                            onCheckedChange = { checked ->
                                rule = rule.copy(skipAutoDraft = checked)
                            },
                        )
                        SettingsFormDivider()
                        SettingsFormTextRow(
                            title = "Forward To",
                            value = rule.forwardTo.orEmpty(),
                            onValueChange = { value -> rule = rule.copy(forwardTo = value) },
                            placeholder = "optional@example.com",
                        )
                    }
                    SettingsFormFooter(
                        "Choose what happens when mail matches. At least one action is required.",
                    )
                }
            }
        }
    }
}

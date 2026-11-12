package co.inboxies.app.ui.piles

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.models.WorkflowPile
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.MailPiles
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.tags.TagNameDialog
import co.inboxies.app.ui.tags.TagSheetFrame
import kotlinx.coroutines.launch

/**
 * Piles people make on Android (AVE-194), beside Reply Later and Set Aside: the Move to
 * pile picker, the home Piles sheet / folder column rows and the create / rename / delete
 * dialogs. One pile per mail. iOS twin: `Views/Piles/PileViews.swift`. Copy lives in
 * [MailPiles].
 */

/** The glyph for piles people make everywhere. */
val PileIcon = Icons.Outlined.Layers

/**
 * Move [email] to a pile people made: tap a pile to move it there, tap its ticked pile to
 * take it out, or make a new pile for it.
 */
@Composable
fun PilePickerSheet(email: Email, onDismiss: () -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val piles by app.customPiles.collectAsState()
    val rows by app.emails.collectAsState()
    val open by app.selectedEmail.collectAsState()
    val current = remember(rows, open, email) {
        (open?.takeIf { it.id == email.id } ?: rows.firstOrNull { it.id == email.id } ?: email).currentPileId
    }
    val editor = rememberPileEditor()
    LaunchedEffect(Unit) { app.refreshPiles() }

    TagSheetFrame(title = MailPiles.PICKER_TITLE, onDismiss = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 400.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 4.dp),
        ) {
            if (piles.isEmpty()) {
                Text(
                    MailPiles.LIST_EMPTY,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
            piles.forEach { pile ->
                val on = pile.id == current
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Checkbox) {
                            scope.launch { app.setPile(email, if (on) null else pile.id) }
                            onDismiss()
                        }
                        .semantics { selected = on }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Icon(PileIcon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(16.dp))
                    Text(
                        MailPiles.displayName(pile),
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (on) {
                        Icon(Icons.Outlined.Check, contentDescription = "In this pile", tint = colors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button) { editor.startCreate(applyingTo = email) { onDismiss() } }
                    .padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.accent, modifier = Modifier.size(16.dp))
                Text(
                    MailPiles.CREATE_MENU,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.accent,
                )
            }
        }
    }
    PileEditorDialogs(editor)
}

/** Create / rename / delete dialogs for piles, opened from the Piles list or a pile view. */
class PileEditorState {
    var creating by mutableStateOf(false)
    var renaming by mutableStateOf<WorkflowPile?>(null)
    var deleting by mutableStateOf<WorkflowPile?>(null)
    /** A new pile takes this mail (the picker's New pile row). */
    var applyingTo: Email? = null
    /** Runs with the new pile after a create. */
    var onCreated: ((WorkflowPile) -> Unit)? = null

    fun startCreate(applyingTo: Email? = null, then: ((WorkflowPile) -> Unit)? = null) {
        this.applyingTo = applyingTo
        onCreated = then
        creating = true
    }
}

@Composable
fun rememberPileEditor(): PileEditorState = remember { PileEditorState() }

@Composable
fun PileEditorDialogs(state: PileEditorState) {
    val app = LocalAppModel.current
    val scope = rememberCoroutineScope()
    if (state.creating) {
        TagNameDialog(
            title = MailPiles.CREATE_TITLE,
            confirm = "Create",
            initial = "",
            onDismiss = { state.creating = false },
            onConfirm = { name ->
                val pile = app.createPile(name)
                state.creating = false
                state.applyingTo?.let { app.setPile(it, pile.id) }
                state.onCreated?.invoke(pile)
            },
            fallbackError = MailPiles.CREATE_FAILED,
            label = MailPiles.NAME_LABEL,
        )
    }
    state.renaming?.let { pile ->
        TagNameDialog(
            title = MailPiles.RENAME_TITLE,
            confirm = "Save",
            initial = MailPiles.displayName(pile),
            onDismiss = { state.renaming = null },
            onConfirm = { name ->
                app.renamePile(pile, name)
                state.renaming = null
            },
            fallbackError = MailPiles.RENAME_FAILED,
            label = MailPiles.NAME_LABEL,
        )
    }
    state.deleting?.let { pile ->
        val colors = inboxiesColors()
        AlertDialog(
            onDismissRequest = { state.deleting = null },
            containerColor = colors.surface,
            title = { Text(MailPiles.deleteTitle(MailPiles.displayName(pile)), fontFamily = InterFontFamily, fontSize = 17.sp) },
            text = { Text(MailPiles.DELETE_MESSAGE, fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.muted) },
            confirmButton = {
                TextButton(onClick = {
                    state.deleting = null
                    scope.launch {
                        try {
                            app.deletePile(pile)
                        } catch (e: Exception) {
                            app.showToast(
                                (e as? AppModel.TagException)?.message ?: MailPiles.DELETE_FAILED,
                                isError = true,
                            )
                        }
                    }
                }) {
                    Text(MailPiles.DELETE_BUTTON, fontFamily = InterFontFamily, color = colors.deepDarkRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { state.deleting = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

/** One pile in the Piles list / folder column: glyph, name, count; long-press menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PileListRow(
    pile: WorkflowPile,
    isSelected: Boolean,
    canEdit: Boolean,
    onOpen: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
    compact: Boolean = false,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(HomeChromeMetrics.folderRowCornerRadius)
    val name = MailPiles.displayName(pile)
    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .then(if (compact) Modifier.height(HomeChromeMetrics.folderRowHeight) else Modifier)
                .clip(shape)
                .background(if (isSelected) colors.pillFill else Color.Transparent, shape)
                .combinedClickable(
                    role = Role.Tab,
                    onClick = onOpen,
                    onLongClick = if (canEdit) ({ menuOpen = true }) else null,
                    onLongClickLabel = if (canEdit) "Pile actions" else null,
                )
                .semantics(mergeDescendants = true) { selected = isSelected }
                .padding(horizontal = if (compact) 10.dp else 20.dp, vertical = if (compact) 0.dp else 12.dp),
        ) {
            Icon(PileIcon, contentDescription = null, tint = if (isSelected) colors.ink else colors.muted, modifier = Modifier.size(if (compact) 18.dp else 16.dp))
            Text(
                name,
                fontFamily = InterFontFamily,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (pile.count > 0) {
                Text(
                    if (pile.count > 999) "999+" else "${pile.count}",
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.FontSize.meta,
                    color = colors.muted,
                    modifier = Modifier.semantics { contentDescription = "${pile.count} in pile" },
                )
            }
        }
        InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
            InboxiesMenuItem(text = "Rename…", icon = Icons.Outlined.Edit, onClick = {
                menuOpen = false
                onRename()
            })
            InboxiesMenuItem(text = MailPiles.DELETE_BUTTON, icon = Icons.Outlined.Delete, destructive = true, onClick = {
                menuOpen = false
                onDelete()
            })
        }
    }
}

/** "+" (New pile) for the Piles list header and the folder column's Workflow section. */
@Composable
fun CreatePileButton(onClick: () -> Unit, size: Dp = 40.dp) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(50))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = MailPiles.CREATE_LABEL },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.ink, modifier = Modifier.size(20.dp))
    }
}

/** Phone home's Piles group (folders menu → Piles): every pile people made, with counts. */
@Composable
fun PileListSheet(
    selectedPileId: String?,
    onOpenPile: (WorkflowPile) -> Unit,
    onDismiss: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val piles by app.customPiles.collectAsState()
    val readOnly by app.selectedMailboxReadOnly.collectAsState()
    val editor = rememberPileEditor()
    LaunchedEffect(Unit) { app.refreshPiles() }
    TagSheetFrame(
        title = MailPiles.TITLE,
        onDismiss = onDismiss,
        trailing = if (readOnly) null else ({ CreatePileButton(onClick = { editor.startCreate() }) }),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 4.dp),
        ) {
            if (piles.isEmpty()) {
                Text(
                    MailPiles.LIST_EMPTY,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
            piles.forEach { pile ->
                PileListRow(
                    pile = pile,
                    isSelected = pile.id == selectedPileId,
                    canEdit = !readOnly,
                    onOpen = { onOpenPile(pile) },
                    onRename = { editor.renaming = pile },
                    onDelete = { editor.deleting = pile },
                )
            }
        }
    }
    PileEditorDialogs(editor)
}

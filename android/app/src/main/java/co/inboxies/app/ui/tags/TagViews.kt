package co.inboxies.app.ui.tags

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.models.MailTag
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.MailTags
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.launch

/**
 * Tags on Android (AVE-242): pills on rows, chips in the reader, the picker, the home
 * Tags sheet and the create / rename / delete dialogs. Many tags per email, on top of
 * its one folder. iOS twin: `Views/Tags/`. Copy lives in [MailTags].
 */

/** The tag a tag view lists; its rows don't repeat it as a pill. */
val LocalHiddenTagId = staticCompositionLocalOf<String?> { null }

/** The glyph for tags everywhere (custom folders use a folder). */
val TagIcon = Icons.Outlined.Sell

private fun <T> tagSpring() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

/** Mail-row pill: same shape and colours as the row's other chips, with the tag glyph. */
@Composable
fun MailTagPill(name: String) {
    val colors = inboxiesColors()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(colors.pillFill)
            .padding(horizontal = 7.dp, vertical = 3.dp)
            .semantics(mergeDescendants = true) { contentDescription = "Tag $name" },
    ) {
        Icon(TagIcon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(10.dp))
        Text(
            name,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.List.badge,
            color = colors.muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Reader chip (above the messages): tag glyph + name; opens the tag's view. */
@Composable
fun ReaderTagChip(name: String, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(colors.pillFill)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 5.dp)
            .semantics(mergeDescendants = true) { contentDescription = "Tag $name" },
    ) {
        Icon(TagIcon, contentDescription = null, tint = colors.ink, modifier = Modifier.size(12.dp))
        Text(name, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.ink, maxLines = 1)
    }
}

/** "Add tag" (no tags yet) or a compact "+" chip after the conversation's tags. */
@Composable
fun AddTagChip(hasTags: Boolean, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .border(0.5.dp, colors.line, RoundedCornerShape(7.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = if (hasTags) 7.dp else 10.dp, vertical = 5.dp)
            .semantics(mergeDescendants = true) { contentDescription = if (hasTags) "Edit tags" else MailTags.ADD_TAG },
    ) {
        Icon(if (hasTags) Icons.Outlined.Add else TagIcon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(12.dp))
        if (!hasTags) {
            Text(MailTags.ADD_TAG, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, fontSize = 12.sp, color = colors.muted)
        }
    }
}

/**
 * Bottom sheet frame shared by the picker and the Tags list: grabber, title, close (x).
 * A Material sheet (like the reader's) so it sits above the gesture bar and the keyboard.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TagSheetFrame(
    title: String,
    onDismiss: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = inboxiesColors()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.background,
        scrimColor = HomeChromeMetrics.modalScrim,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = null,
        contentWindowInsets = { WindowInsets.ime.union(WindowInsets.navigationBars) },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 12.dp, bottom = 16.dp)
                .animateContentSize(tagSpring()),
        ) {
            Box(modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp), contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .width(36.dp)
                        .height(5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(colors.muted.copy(alpha = 0.45f)),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    title,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f).semantics { heading() },
                )
                trailing?.invoke()
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(50))
                        .clickable(role = Role.Button, onClick = onDismiss),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink, modifier = Modifier.size(20.dp))
                }
            }
            content()
        }
    }
}

/**
 * The tag picker for [email]'s conversation: find, toggle and create tags. Tapping a
 * tag adds or removes it on the whole conversation at once.
 */
@Composable
fun TagPickerSheet(email: Email, onDismiss: () -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val tags by app.tags.collectAsState()
    // Recompose with the open thread / rows so checkmarks follow each toggle.
    val rows by app.emails.collectAsState()
    val open by app.selectedEmail.collectAsState()
    val thread by app.threadEmails.collectAsState()
    val applied = remember(rows, open, thread, email) { app.conversationTags(email).map { it.id }.toSet() }
    var query by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    val options = remember(tags, query) { MailTags.pickerOptions(tags, query) }
    val focus = remember { FocusRequester() }

    fun create() {
        val name = options.create ?: return
        if (creating) return
        creating = true
        scope.launch {
            try {
                val tag = app.createTag(name)
                query = ""
                app.setTag(email, tag.ref, on = true)
            } catch (e: AppModel.TagException) {
                error = e.message
            } catch (_: Exception) {
                error = MailTags.CREATE_FAILED
            } finally {
                creating = false
            }
        }
    }

    TagSheetFrame(title = MailTags.TITLE, onDismiss = onDismiss) {
        val fieldShape = RoundedCornerShape(10.dp)
        BasicTextField(
            value = query,
            onValueChange = {
                query = it
                error = null
            },
            singleLine = true,
            textStyle = TextStyle(fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.ink),
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { create() }),
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp, bottom = 8.dp)
                .fillMaxWidth()
                .height(40.dp)
                .background(colors.surface, fieldShape)
                .border(0.5.dp, if (error == null) colors.line else colors.deepDarkRed, fieldShape)
                .focusRequester(focus)
                .semantics { contentDescription = MailTags.PICKER_PLACEHOLDER },
            decorationBox = { inner ->
                Box(modifier = Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) {
                        Text(MailTags.PICKER_PLACEHOLDER, fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.muted)
                    }
                    inner()
                }
            },
        )
        error?.let {
            Text(
                it,
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.deepDarkRed,
                modifier = Modifier.padding(horizontal = 20.dp).padding(bottom = 6.dp),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 360.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            if (tags.isEmpty() && options.create == null) {
                Text(
                    MailTags.PICKER_EMPTY,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
            options.matches.forEach { tag ->
                val on = tag.id in applied
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Checkbox) { scope.launch { app.setTag(email, tag.ref, !on) } }
                        .semantics { selected = on }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Icon(TagIcon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(16.dp))
                    Text(
                        tag.name,
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (on) {
                        Icon(Icons.Outlined.Check, contentDescription = "Added", tint = colors.accent, modifier = Modifier.size(18.dp))
                    }
                }
            }
            options.create?.let { name ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !creating, role = Role.Button) { create() }
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.accent, modifier = Modifier.size(16.dp))
                    Text(
                        MailTags.createRowLabel(name),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 15.sp,
                        color = colors.accent,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/** Create / rename / delete dialogs for tags, opened from the Tags list or a tag view. */
class TagEditorState {
    var creating by mutableStateOf(false)
    var renaming by mutableStateOf<MailTag?>(null)
    var deleting by mutableStateOf<MailTag?>(null)
    /** Runs with the new tag after a create (the Tags list opens its view). */
    var onCreated: ((MailTag) -> Unit)? = null

    fun startCreate(then: ((MailTag) -> Unit)? = null) {
        onCreated = then
        creating = true
    }
}

@Composable
fun rememberTagEditor(): TagEditorState = remember { TagEditorState() }

@Composable
fun TagEditorDialogs(state: TagEditorState) {
    val app = LocalAppModel.current
    val scope = rememberCoroutineScope()
    if (state.creating) {
        TagNameDialog(
            title = MailTags.CREATE_TITLE,
            confirm = "Create",
            initial = "",
            onDismiss = { state.creating = false },
            onConfirm = { name ->
                val tag = app.createTag(name)
                state.creating = false
                state.onCreated?.invoke(tag)
            },
            fallbackError = MailTags.CREATE_FAILED,
        )
    }
    state.renaming?.let { tag ->
        TagNameDialog(
            title = MailTags.RENAME_TITLE,
            confirm = "Save",
            initial = tag.name,
            onDismiss = { state.renaming = null },
            onConfirm = { name ->
                app.renameTag(tag, name)
                state.renaming = null
            },
            fallbackError = MailTags.RENAME_FAILED,
        )
    }
    state.deleting?.let { tag ->
        val colors = inboxiesColors()
        AlertDialog(
            onDismissRequest = { state.deleting = null },
            containerColor = colors.surface,
            title = { Text(MailTags.deleteTitle(tag.name), fontFamily = InterFontFamily, fontSize = 17.sp) },
            text = { Text(MailTags.DELETE_MESSAGE, fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.muted) },
            confirmButton = {
                TextButton(onClick = {
                    state.deleting = null
                    scope.launch {
                        try {
                            app.deleteTag(tag)
                        } catch (e: Exception) {
                            app.showToast(
                                (e as? AppModel.TagException)?.message ?: MailTags.DELETE_FAILED,
                                isError = true,
                            )
                        }
                    }
                }) {
                    Text(MailTags.DELETE_BUTTON, fontFamily = InterFontFamily, color = colors.deepDarkRed)
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

/** Name prompt for tags, reused by piles (AVE-194) with their own [label]. */
@Composable
internal fun TagNameDialog(
    title: String,
    confirm: String,
    initial: String,
    onDismiss: () -> Unit,
    onConfirm: suspend (String) -> Unit,
    fallbackError: String,
    label: String = MailTags.NAME_LABEL,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(initial) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    fun submit() {
        if (busy || draft.isBlank()) return
        busy = true
        scope.launch {
            try {
                onConfirm(draft)
            } catch (e: AppModel.TagException) {
                error = e.message
            } catch (_: Exception) {
                error = fallbackError
            } finally {
                busy = false
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        containerColor = colors.surface,
        title = { Text(title, fontFamily = InterFontFamily, fontSize = 17.sp) },
        text = {
            OutlinedTextField(
                value = draft,
                onValueChange = {
                    draft = it
                    error = null
                },
                label = { Text(label, fontFamily = InterFontFamily) },
                singleLine = true,
                isError = error != null,
                supportingText = error?.let { message ->
                    { Text(message, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.deepDarkRed) }
                },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(onClick = { submit() }, enabled = !busy && draft.isNotBlank()) {
                Text(confirm, fontFamily = InterFontFamily, color = colors.accent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !busy) {
                Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
            }
        },
    )
}

/** One tag in the Tags list / folder column: glyph, name, unread count; long-press menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TagListRow(
    tag: MailTag,
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
    Box {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .then(if (compact) Modifier.height(HomeChromeMetrics.folderRowHeight) else Modifier)
                .clip(shape)
                .background(if (isSelected) colors.pillFill else androidx.compose.ui.graphics.Color.Transparent, shape)
                .combinedClickable(
                    role = Role.Tab,
                    onClick = onOpen,
                    onLongClick = if (canEdit) ({ menuOpen = true }) else null,
                    onLongClickLabel = if (canEdit) "Tag actions" else null,
                )
                .semantics(mergeDescendants = true) {
                    selected = isSelected
                }
                .padding(horizontal = if (compact) 10.dp else 20.dp, vertical = if (compact) 0.dp else 12.dp),
        ) {
            Icon(TagIcon, contentDescription = null, tint = if (isSelected) colors.ink else colors.muted, modifier = Modifier.size(if (compact) 18.dp else 16.dp))
            Text(
                tag.name,
                fontFamily = InterFontFamily,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (tag.unreadCount > 0) {
                Text(
                    if (tag.unreadCount > 999) "999+" else "${tag.unreadCount}",
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.FontSize.meta,
                    color = colors.muted,
                    modifier = Modifier.semantics { contentDescription = "${tag.unreadCount} unread" },
                )
            }
        }
        InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
            InboxiesMenuItem(text = "Rename…", icon = Icons.Outlined.Edit, onClick = {
                menuOpen = false
                onRename()
            })
            InboxiesMenuItem(text = MailTags.DELETE_BUTTON, icon = Icons.Outlined.Delete, destructive = true, onClick = {
                menuOpen = false
                onDelete()
            })
        }
    }
}

/** "+" (Create tag) for the Tags list header and the folder column's Tags section. */
@Composable
fun CreateTagButton(onClick: () -> Unit, size: androidx.compose.ui.unit.Dp = 40.dp) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(size)
            .clip(RoundedCornerShape(50))
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = "Create tag" },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Add, contentDescription = null, tint = colors.ink, modifier = Modifier.size(20.dp))
    }
}

/** Phone home's Tags group (folders menu → Tags): every tag with its unread count. */
@Composable
fun TagListSheet(
    selectedTagId: String?,
    onOpenTag: (MailTag) -> Unit,
    onDismiss: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val tags by app.tags.collectAsState()
    val readOnly by app.selectedMailboxReadOnly.collectAsState()
    val editor = rememberTagEditor()
    TagSheetFrame(
        title = MailTags.TITLE,
        onDismiss = onDismiss,
        trailing = if (readOnly) null else ({ CreateTagButton(onClick = { editor.startCreate() }) }),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 4.dp),
        ) {
            if (tags.isEmpty()) {
                Text(
                    MailTags.LIST_EMPTY,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                )
            }
            tags.forEach { tag ->
                TagListRow(
                    tag = tag,
                    isSelected = tag.id == selectedTagId,
                    canEdit = !readOnly,
                    onOpen = { onOpenTag(tag) },
                    onRename = { editor.renaming = tag },
                    onDelete = { editor.deleting = tag },
                )
            }
        }
    }
    TagEditorDialogs(editor)
}

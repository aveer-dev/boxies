package co.inboxies.app.ui.settings

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Folder
import co.inboxies.app.services.CustomFolders
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.launch

/** Which dialog a DEBUG preview opens on the first tag (`tagsRename` / `tagsDelete`). */
enum class TagsPreviewDialog { None, Rename, Delete }

/**
 * Settings → Tags (AVE-158): create, rename and delete the mailbox's custom folders. Web
 * shows them as tags in the Folders column (`FoldersColumn.tsx`); names, validation and
 * error copy follow web and the Worker ([CustomFolders]). Deleting a tag moves its mail to
 * the Inbox. iOS twin: `TagsSettingsView.swift`.
 */
@Composable
fun TagsSettingsView(
    onBack: () -> Unit,
    previewDialog: TagsPreviewDialog = TagsPreviewDialog.None,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val folders by app.folders.collectAsState()
    val tags = remember(folders) { CustomFolders.custom(folders) }

    var draft by remember { mutableStateOf("") }
    var createError by remember { mutableStateOf<String?>(null) }
    var isCreating by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<Folder?>(null) }
    var renameDraft by remember { mutableStateOf("") }
    var renameError by remember { mutableStateOf<String?>(null) }
    var isRenaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Folder?>(null) }
    var busyFolderId by remember { mutableStateOf<String?>(null) }

    fun beginRename(tag: Folder) {
        renameDraft = CustomFolders.bareName(tag.name)
        renameError = null
        renaming = tag
    }

    LaunchedEffect(previewDialog) {
        val first = tags.firstOrNull() ?: return@LaunchedEffect
        when (previewDialog) {
            TagsPreviewDialog.Rename -> beginRename(first)
            TagsPreviewDialog.Delete -> deleting = first
            TagsPreviewDialog.None -> Unit
        }
    }

    val canCreate = !isCreating && CustomFolders.normalizedName(draft).isNotEmpty()

    fun create() {
        if (!canCreate) return
        // Same checks as the Worker, so a duplicate never makes a round trip.
        CustomFolders.validateCreate(draft, folders)?.let {
            createError = it
            return
        }
        createError = null
        isCreating = true
        scope.launch {
            runCatching { app.createCustomFolder(draft) }
                .onSuccess { draft = "" }
                // Keep the name so it can be fixed (web keeps its dialog open).
                .onFailure { createError = it.message?.takeIf(String::isNotBlank) ?: CustomFolders.CREATE_FAILED }
            isCreating = false
        }
    }

    fun rename(tag: Folder) {
        CustomFolders.validateRename(renameDraft, tag, folders)?.let {
            renameError = it
            return
        }
        isRenaming = true
        scope.launch {
            runCatching { app.renameCustomFolder(tag, renameDraft) }
                .onSuccess { renaming = null }
                .onFailure { renameError = it.message?.takeIf(String::isNotBlank) ?: CustomFolders.RENAME_FAILED }
            isRenaming = false
        }
    }

    fun delete(tag: Folder) {
        deleting = null
        busyFolderId = tag.id
        scope.launch {
            runCatching { app.deleteCustomFolder(tag) }
                .onSuccess { app.showToast(CustomFolders.deletedToast(tag)) }
                .onFailure {
                    app.showToast(it.message?.takeIf(String::isNotBlank) ?: CustomFolders.DELETE_FAILED, isError = true)
                }
            busyFolderId = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
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
                CustomFolders.PAGE_TITLE,
                modifier = Modifier.padding(start = 4.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
        }

        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                CustomFolders.INTRO_TEXT,
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
                            createError = null
                        },
                        singleLine = true,
                        textStyle = TextStyle(fontFamily = InterFontFamily, fontSize = 15.sp, color = colors.ink),
                        cursorBrush = SolidColor(colors.accent),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None,
                            autoCorrectEnabled = false,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { create() }),
                        modifier = Modifier
                            .weight(1f)
                            .height(40.dp)
                            .background(colors.surface, fieldShape)
                            .border(
                                if (createError == null) 0.5.dp else 1.dp,
                                if (createError == null) colors.line else colors.deepDarkRed,
                                fieldShape,
                            )
                            .semantics { contentDescription = "Tag name" },
                        decorationBox = { inner ->
                            Box(
                                modifier = Modifier.padding(horizontal = 14.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                if (draft.isEmpty()) {
                                    Text(
                                        CustomFolders.NAME_PLACEHOLDER,
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
                    Box(
                        modifier = Modifier
                            .width(72.dp)
                            .height(40.dp)
                            .background(
                                colors.accent.copy(alpha = if (canCreate) 1f else 0.45f),
                                RoundedCornerShape(10.dp),
                            )
                            .clickable(enabled = canCreate, role = Role.Button) { create() }
                            .semantics { contentDescription = "Create tag" },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isCreating) {
                            CircularProgressIndicator(
                                color = Color.White,
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Create",
                                fontFamily = InterFontFamily,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.White,
                            )
                        }
                    }
                }
                createError?.let { message ->
                    Text(
                        message,
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.deepDarkRed,
                    )
                }
            }

            if (tags.isEmpty()) {
                Column(
                    modifier = Modifier.padding(top = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        CustomFolders.EMPTY_TITLE,
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        color = colors.ink,
                    )
                    Text(
                        CustomFolders.EMPTY_MESSAGE,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.surface)
                        .animateContentSize(spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)),
                ) {
                    tags.forEachIndexed { index, tag ->
                        TagRow(
                            tag = tag,
                            busy = busyFolderId == tag.id,
                            enabled = busyFolderId == null,
                            onRename = { beginRename(tag) },
                            onDelete = { deleting = tag },
                        )
                        if (index < tags.lastIndex) {
                            HorizontalDivider(color = colors.line, thickness = 0.5.dp)
                        }
                    }
                }
            }
        }
    }

    renaming?.let { tag ->
        AlertDialog(
            onDismissRequest = { if (!isRenaming) renaming = null },
            containerColor = colors.surface,
            title = {
                Text(CustomFolders.RENAME_TITLE, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        CustomFolders.renameMessage(tag),
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )
                    OutlinedTextField(
                        value = renameDraft,
                        onValueChange = {
                            renameDraft = it
                            renameError = null
                        },
                        label = { Text("Tag name", fontFamily = InterFontFamily) },
                        singleLine = true,
                        isError = renameError != null,
                        supportingText = renameError?.let { message ->
                            { Text(message, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.deepDarkRed) }
                        },
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None,
                            autoCorrectEnabled = false,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { rename(tag) }),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { rename(tag) },
                    enabled = !isRenaming && CustomFolders.normalizedName(renameDraft).isNotEmpty(),
                ) {
                    Text("Save", fontFamily = InterFontFamily, color = colors.accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { renaming = null }, enabled = !isRenaming) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }

    deleting?.let { tag ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            containerColor = colors.surface,
            title = {
                Text(CustomFolders.deleteConfirmTitle(tag), fontFamily = InterFontFamily, fontSize = 17.sp)
            },
            text = {
                Text(
                    CustomFolders.DELETE_CONFIRM_MESSAGE,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = { delete(tag) }) {
                    Text("Delete tag", fontFamily = InterFontFamily, color = colors.deepDarkRed)
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

@Composable
private fun TagRow(
    tag: Folder,
    busy: Boolean,
    enabled: Boolean,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "#",
            modifier = Modifier.width(18.dp),
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = colors.muted,
        )
        Text(
            CustomFolders.bareName(tag.name),
            modifier = Modifier.weight(1f),
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            color = colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (tag.unreadCount > 0) {
            Text(
                "${tag.unreadCount}",
                modifier = Modifier.semantics { contentDescription = "${tag.unreadCount} unread" },
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        Box(modifier = Modifier.size(32.dp), contentAlignment = Alignment.Center) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
            } else {
                Icon(
                    Icons.Outlined.MoreHoriz,
                    contentDescription = "Actions for ${CustomFolders.displayName(tag)}",
                    tint = colors.muted,
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(50))
                        .clickable(enabled = enabled, role = Role.Button) { menuOpen = true }
                        .padding(6.dp),
                )
            }
            InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
                InboxiesMenuItem(
                    text = "Rename",
                    icon = Icons.Outlined.Edit,
                    onClick = {
                        menuOpen = false
                        onRename()
                    },
                )
                InboxiesMenuItem(
                    text = "Delete",
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

/** DEBUG preview fixtures (`tags` preview mode): same custom folders as iOS `PreviewTags`. */
internal val previewTagFolders: List<Folder> = listOf(
    Folder(id = "engineering-prs", name = "Engineering-PRs", unreadCount = 4),
    Folder(id = "receipts", name = "Receipts", unreadCount = 0),
    Folder(id = "travel", name = "Travel", unreadCount = 1),
)

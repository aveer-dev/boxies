package co.inboxies.app.ui.notes

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ThreadNote
import co.inboxies.app.services.NoteFormat
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import java.text.NumberFormat

/** What the note editor is writing. */
sealed class NoteEditorTarget {
    /** Conversation key the note is filed under. */
    abstract val threadKey: String

    /** A new sticky pinned to the whole conversation. */
    data class NewSticky(override val threadKey: String) : NoteEditorTarget()

    /** A new private note on one message. */
    data class NewInline(override val threadKey: String, val emailId: String) : NoteEditorTarget()

    data class Edit(override val threadKey: String, val note: ThreadNote) : NoteEditorTarget()

    val isSticky: Boolean
        get() = when (this) {
            is NewSticky -> true
            is NewInline -> false
            is Edit -> note.isSticky
        }

    val initialBody: String get() = (this as? Edit)?.note?.body.orEmpty()

    val title: String
        get() = when (this) {
            is NewSticky -> "Sticky Note"
            is NewInline -> "Private Note"
            is Edit -> "Edit Note"
        }

    val submitLabel: String get() = if (this is Edit) "Save" else "Add"

    val placeholder: String
        get() = when (this) {
            is NewSticky -> "Pin a note to this conversation…"
            is NewInline -> "Add a private note about this message…"
            is Edit -> "Write a note to yourself…"
        }
}

private val NoteFormat.icon: ImageVector
    get() = when (this) {
        NoteFormat.Bold -> Icons.Outlined.FormatBold
        NoteFormat.Italic -> Icons.Outlined.FormatItalic
        NoteFormat.Code -> Icons.Outlined.Code
        NoteFormat.Link -> Icons.Outlined.Link
        NoteFormat.Bullet -> Icons.AutoMirrored.Outlined.FormatListBulleted
        NoteFormat.Checklist -> Icons.Outlined.Checklist
    }

/**
 * Markdown editor for a note to self: a plain text field with a few formatting
 * buttons and a Write / Preview switch. A sticky is written on its paper.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteEditorSheet(
    target: NoteEditorTarget,
    onDismiss: () -> Unit,
    startInPreview: Boolean = false,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var value by remember(target) {
        val body = target.initialBody
        mutableStateOf(TextFieldValue(body, TextRange(body.length)))
    }
    var preview by remember(target) { mutableStateOf(startInPreview) }
    var isSaving by remember { mutableStateOf(false) }

    val ink = if (target.isSticky) colors.note.ink else colors.ink
    val muted = if (target.isSticky) colors.note.muted else colors.muted
    val paper = if (target.isSticky) colors.note.paper else colors.background

    val text = value.text
    val trimmed = text.trim()
    val tooLong = text.length > ThreadNote.BODY_MAX
    val nearLimit = text.length > ThreadNote.BODY_MAX * 9 / 10
    val canSave = trimmed.isNotEmpty() && !tooLong && !isSaving && trimmed != target.initialBody

    fun close() {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }

    fun save() {
        if (!canSave) return
        val body = trimmed
        isSaving = true
        scope.launch {
            val saved = when (target) {
                is NoteEditorTarget.NewSticky ->
                    app.createThreadNote(target.threadKey, body, ThreadNote.STICKY)
                is NoteEditorTarget.NewInline ->
                    app.createThreadNote(target.threadKey, body, ThreadNote.INLINE, emailId = target.emailId)
                is NoteEditorTarget.Edit -> app.updateThreadNoteBody(target.note, body)
            }
            isSaving = false
            if (saved) close()
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!isSaving) onDismiss() },
        sheetState = sheetState,
        containerColor = paper,
        scrimColor = HomeChromeMetrics.modalScrim,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.92f)
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp, bottom = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .width(36.dp)
                        .height(5.dp)
                        .clip(RoundedCornerShape(50))
                        .background(muted.copy(alpha = 0.45f)),
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
            ) {
                IconButton(onClick = { close() }, modifier = Modifier.align(Alignment.CenterStart)) {
                    Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
                }
                Text(
                    target.title,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = ink,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center),
                )
                Box(modifier = Modifier.align(Alignment.CenterEnd)) {
                    if (isSaving) {
                        CircularProgressIndicator(
                            color = colors.accent,
                            strokeWidth = 2.dp,
                            modifier = Modifier
                                .padding(end = 14.dp)
                                .size(20.dp),
                        )
                    } else {
                        TextButton(onClick = { save() }, enabled = canSave) {
                            Text(
                                target.submitLabel,
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 16.sp,
                                color = if (canSave) colors.accent else muted.copy(alpha = 0.6f),
                            )
                        }
                    }
                }
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 16.dp)
                    .padding(top = 4.dp, bottom = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier.semantics(mergeDescendants = true) {},
                ) {
                    Icon(
                        if (target.isSticky) Icons.Filled.PushPin else Icons.Filled.Lock,
                        contentDescription = null,
                        tint = if (target.isSticky) colors.note.pin else muted,
                        modifier = Modifier
                            .size(11.dp)
                            .rotate(if (target.isSticky) 20f else 0f),
                    )
                    Text(
                        if (target.isSticky) {
                            "Note to self · Only visible to you"
                        } else {
                            "Private note to self · Only visible to you"
                        },
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = 12.sp,
                        color = muted,
                        maxLines = 1,
                    )
                }

                ModeSwitch(preview = preview, ink = ink, muted = muted, onChange = { preview = it })

                if (!preview) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(ink.copy(alpha = 0.06f))
                            .padding(2.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        NoteFormat.entries.forEach { format ->
                            Box(
                                modifier = Modifier
                                    .size(width = 36.dp, height = 32.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        val edit = format.apply(
                                            value.text,
                                            value.selection.start,
                                            value.selection.end,
                                        )
                                        value = TextFieldValue(
                                            edit.text,
                                            TextRange(edit.selectionStart, edit.selectionEnd),
                                        )
                                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                                    }
                                    .semantics { contentDescription = format.label },
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(format.icon, contentDescription = null, tint = ink, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                    val focus = remember { FocusRequester() }
                    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        BasicTextField(
                            value = value,
                            onValueChange = { value = it },
                            textStyle = TextStyle(fontFamily = InterFontFamily, fontSize = 15.sp, color = ink),
                            cursorBrush = SolidColor(colors.accent),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            modifier = Modifier
                                .fillMaxWidth()
                                .fillMaxHeight()
                                .focusRequester(focus)
                                .semantics { contentDescription = "Note (Markdown)" }
                                .padding(vertical = 8.dp),
                            decorationBox = { inner ->
                                Box {
                                    if (value.text.isEmpty()) {
                                        Text(
                                            target.placeholder,
                                            fontFamily = InterFontFamily,
                                            fontSize = 15.sp,
                                            color = muted.copy(alpha = 0.8f),
                                        )
                                    }
                                    inner()
                                }
                            },
                        )
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .verticalScroll(rememberScrollState()),
                    ) {
                        if (trimmed.isEmpty()) {
                            Text(
                                "Nothing to preview",
                                fontFamily = InterFontFamily,
                                fontSize = 14.sp,
                                color = muted,
                            )
                        } else {
                            NoteMarkdownView(text, fontSize = 15f, ink = ink)
                        }
                    }
                }

                val number = NumberFormat.getIntegerInstance()
                Text(
                    if (nearLimit) {
                        "${number.format(text.length)} / ${number.format(ThreadNote.BODY_MAX)}"
                    } else {
                        "Markdown supported"
                    },
                    fontFamily = InterFontFamily,
                    fontSize = 11.sp,
                    color = if (tooLong) colors.deepDarkRed else muted,
                )
            }
        }
    }
}

/** Write / Preview segmented pill (iOS segmented `Picker`). */
@Composable
private fun ModeSwitch(
    preview: Boolean,
    ink: androidx.compose.ui.graphics.Color,
    muted: androidx.compose.ui.graphics.Color,
    onChange: (Boolean) -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .width(220.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(ink.copy(alpha = 0.06f))
            .padding(2.dp),
    ) {
        listOf(false to "Write", true to "Preview").forEach { (isPreview, label) ->
            val selected = preview == isPreview
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(30.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (selected) colors.surface else androidx.compose.ui.graphics.Color.Transparent)
                    .clickable { onChange(isPreview) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontFamily = InterFontFamily,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    fontSize = 13.sp,
                    color = if (selected) colors.ink else muted,
                )
            }
        }
    }
}

package co.inboxies.app.ui.compose

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material.icons.outlined.FormatQuote
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.MailAddress
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.RecentRecipient
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ComposeSession
import co.inboxies.app.services.ComposeToast
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.TransparentSystemBars
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.rememberSheetDragY
import co.inboxies.app.ui.components.sheetDragToDismiss
import co.inboxies.app.util.ComposeHtml
import co.inboxies.app.util.OutboundImageCompressor
import co.inboxies.app.util.QuotedOriginal
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.roundToInt

private enum class ComposeField { To, Cc, Bcc, Subject, Body }

@Composable
fun ComposeSheetView(
    session: ComposeSession,
    onMinimize: () -> Unit,
    onClose: () -> Unit,
    onSend: suspend () -> Unit,
    onSaveDraft: suspend () -> Unit,
) {
    val colors = inboxiesColors()
    val app = LocalAppModel.current
    val form = session.form
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val mailboxes by app.mailboxes.collectAsState()
    val density = LocalDensity.current
    val context = LocalContext.current

    var toTokens by remember(form) { mutableStateOf(form.toTokens) }
    var ccTokens by remember(form) { mutableStateOf(form.ccTokens) }
    var bccTokens by remember(form) { mutableStateOf(form.bccTokens) }
    var toDraft by remember(form) { mutableStateOf(form.toDraft) }
    var ccDraft by remember(form) { mutableStateOf(form.ccDraft) }
    var bccDraft by remember(form) { mutableStateOf(form.bccDraft) }
    var subject by remember(form) { mutableStateOf(form.subject) }
    var body by remember(form) { mutableStateOf(form.body) }
    var attachments by remember(form) { mutableStateOf(form.attachments) }
    var showFormatSheet by remember { mutableStateOf(false) }
    var showAttachMenu by remember { mutableStateOf(false) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }
    val richText = remember(form) { ComposeRichTextController() }
    var formatState by remember { mutableStateOf(ComposeFormatState()) }
    var showCcBcc by remember(form) { mutableStateOf(form.showCcBcc) }
    var fromMailboxId by remember(form) { mutableStateOf(form.fromMailboxId) }
    var fromName by remember(form) { mutableStateOf(form.fromName) }
    var fromEmail by remember(form) { mutableStateOf(form.fromEmail) }
    var recipientFocus by remember { mutableStateOf<ComposeField?>(null) }
    var suggestions by remember { mutableStateOf<List<RecentRecipient>>(emptyList()) }
    var showCloseMenu by remember { mutableStateOf(false) }
    var showFromMenu by remember { mutableStateOf(false) }
    var showQuotedOriginal by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<ComposeToast?>(null) }
    var headerHeightPx by remember { mutableStateOf(0) }
    val dragY = rememberSheetDragY()
    val minimizeAction = rememberUpdatedState(onMinimize)

    val fromDisplayName = fromName?.takeIf { it.isNotEmpty() } ?: fromEmail
    val displayTitle = subject.trim().ifEmpty { form.title }
    val isEmpty = toTokens.isEmpty() && ccTokens.isEmpty() && bccTokens.isEmpty() &&
        toDraft.isBlank() && ccDraft.isBlank() && bccDraft.isBlank() &&
        subject.isBlank() && attachments.isEmpty() &&
        !ComposeHtml.bodyHasUserContent(body, form.signatureText)
    val overSize = form.exceedsOutboundLimit()
    val canSend = (toTokens.isNotEmpty() || toDraft.trim().isNotEmpty()) && !overSize

    fun persist() {
        form.toTokens = toTokens
        form.ccTokens = ccTokens
        form.bccTokens = bccTokens
        form.toDraft = toDraft
        form.ccDraft = ccDraft
        form.bccDraft = bccDraft
        form.subject = subject
        form.body = body
        form.attachments = attachments
        form.showCcBcc = showCcBcc
        form.fromMailboxId = fromMailboxId
        form.fromEmail = fromEmail
        form.fromName = fromName
    }

    fun commitTokens() {
        persist()
        form.commitPendingTokens()
        toTokens = form.toTokens
        ccTokens = form.ccTokens
        bccTokens = form.bccTokens
        toDraft = form.toDraft
        ccDraft = form.ccDraft
        bccDraft = form.bccDraft
    }

    DisposableEffect(form) {
        onDispose { persist() }
    }

    fun ingestBytes(bytes: ByteArray, filename: String, mime: String) {
        try {
            persist()
            val prepared = OutboundImageCompressor.prepare(
                bytes = bytes,
                filename = filename,
                mimeType = mime,
                budget = form.remainingAttachmentBudget(),
            )
            attachments = attachments + prepared
            form.attachments = attachments
        } catch (e: Exception) {
            toast = ComposeToast(e.message ?: "Couldn't attach file", isError = true)
        }
    }

    fun extensionForMime(mime: String): String {
        val type = mime.lowercase()
        return when {
            "png" in type -> "png"
            "gif" in type -> "gif"
            "webp" in type -> "webp"
            "jpeg" in type || "jpg" in type -> "jpg"
            "heic" in type || "heif" in type -> "heic"
            type.startsWith("image/") -> "jpg"
            "pdf" in type -> "pdf"
            else -> "bin"
        }
    }

    fun uriDisplayName(uri: Uri, fallback: String): String {
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val value = cursor.getString(index)
                    if (!value.isNullOrBlank()) return value
                }
            }
        }
        val segment = uri.lastPathSegment?.substringAfterLast('/')
        if (!segment.isNullOrBlank() && segment.contains('.')) return segment
        return fallback
    }

    fun ingestUri(uri: Uri, fallbackStem: String) {
        val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
        val fallback = if (fallbackStem.contains('.')) {
            fallbackStem
        } else {
            "$fallbackStem.${extensionForMime(mime)}"
        }
        val name = uriDisplayName(uri, fallback)
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return
        ingestBytes(bytes, name, mime)
    }

    fun uniquePhotoStem(): String = "photo-${UUID.randomUUID().toString().take(8)}"

    val photoLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(),
    ) { uris ->
        uris.forEach { ingestUri(it, uniquePhotoStem()) }
    }
    val fileLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetMultipleContents(),
    ) { uris ->
        uris.forEach { ingestUri(it, "file") }
    }
    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture(),
    ) { success ->
        if (success) {
            cameraUri?.let { ingestUri(it, uniquePhotoStem()) }
        }
    }

    fun launchCameraCapture() {
        val dir = File(context.cacheDir, "compose").apply { mkdirs() }
        val file = File(dir, "capture-${UUID.randomUUID().toString().take(8)}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        cameraUri = uri
        cameraLauncher.launch(uri)
    }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) launchCameraCapture()
    }

    fun launchCamera() {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            launchCameraCapture()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    LaunchedEffect(toast?.id) {
        val current = toast ?: return@LaunchedEffect
        delay(2500)
        if (toast?.id == current.id) toast = null
    }

    LaunchedEffect(richText) {
        richText.onStateChange = { formatState = it }
    }

    val suggestionDraft = when (recipientFocus) {
        ComposeField.To -> toDraft
        ComposeField.Cc -> ccDraft
        ComposeField.Bcc -> bccDraft
        else -> null
    }
    val suggestionExisting = when (recipientFocus) {
        ComposeField.To -> toTokens
        ComposeField.Cc -> ccTokens
        ComposeField.Bcc -> bccTokens
        else -> emptyList()
    }
    LaunchedEffect(recipientFocus, suggestionDraft, fromMailboxId) {
        val field = recipientFocus
        if (field != ComposeField.To && field != ComposeField.Cc && field != ComposeField.Bcc) {
            suggestions = emptyList()
            return@LaunchedEffect
        }
        delay(180)
        val q = suggestionDraft?.trim().orEmpty()
        val existingIds = suggestionExisting.map { it.id }.toSet()
        suggestions = runCatching {
            ApiClient.shared.listRecipients(fromMailboxId, q = q, limit = 8)
                .filter { it.id !in existingIds }
        }.getOrDefault(emptyList())
    }

    fun selectSuggestion(suggestion: RecentRecipient) {
        val address = suggestion.toMailAddress()
        when (recipientFocus) {
            ComposeField.To -> {
                if (toTokens.none { it.id == address.id }) {
                    toTokens = toTokens + address
                }
                toDraft = ""
                form.toTokens = toTokens
                form.toDraft = ""
            }
            ComposeField.Cc -> {
                if (ccTokens.none { it.id == address.id }) {
                    ccTokens = ccTokens + address
                }
                ccDraft = ""
                form.ccTokens = ccTokens
                form.ccDraft = ""
            }
            ComposeField.Bcc -> {
                if (bccTokens.none { it.id == address.id }) {
                    bccTokens = bccTokens + address
                }
                bccDraft = ""
                form.bccTokens = bccTokens
                form.bccDraft = ""
            }
            else -> Unit
        }
        suggestions = emptyList()
    }

    fun persistAndMinimize() {
        persist()
        minimizeAction.value()
    }

    BackHandler {
        if (showQuotedOriginal) {
            showQuotedOriginal = false
        } else {
            persist()
            onMinimize()
        }
    }

    TransparentSystemBars()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HomeChromeMetrics.modalScrim)
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = {},
            ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { translationY = dragY.floatValue.coerceAtLeast(0f) }
                .background(colors.background)
                .navigationBarsPadding()
                .imePadding(),
        ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = "Drag to close" }
                    .sheetDragToDismiss(
                        dragY = dragY,
                        enabled = !showQuotedOriginal,
                        onDismiss = { persistAndMinimize() },
                    )
                    .statusBarsPadding(),
            ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .padding(top = 12.dp, bottom = 16.dp),
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

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    HomeChromeToolbarButton(
                        icon = Icons.Outlined.Close,
                        contentDescription = "Close",
                        onClick = {
                            if (isEmpty) {
                                form.cancelAutoSave()
                                onClose()
                            } else {
                                showCloseMenu = true
                            }
                        },
                    )
                    InboxiesDropdownMenu(
                        expanded = showCloseMenu,
                        onDismiss = { showCloseMenu = false },
                    ) {
                        InboxiesMenuItem(
                            text = "Save Draft",
                            onClick = {
                                showCloseMenu = false
                                commitTokens()
                                scope.launch {
                                    onSaveDraft()
                                    persist()
                                    onMinimize()
                                }
                            },
                        )
                        InboxiesMenuItem(
                            text = "Minimize",
                            onClick = {
                                showCloseMenu = false
                                commitTokens()
                                onMinimize()
                            },
                        )
                        InboxiesMenuItem(
                            text = "Delete Draft",
                            destructive = true,
                            onClick = {
                                showCloseMenu = false
                                scope.launch {
                                    form.cancelAutoSave()
                                    val draftId = form.draftId
                                    if (!draftId.isNullOrEmpty()) {
                                        runCatching {
                                            co.inboxies.app.services.ApiClient.shared.deleteEmail(
                                                form.fromMailboxId,
                                                draftId,
                                            )
                                        }
                                    }
                                    onClose()
                                }
                            },
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                HomeChromeToolbarButton(
                    icon = Icons.Outlined.ArrowUpward,
                    contentDescription = "Send",
                    onClick = {
                        if (!canSend || sending || form.isSending) return@HomeChromeToolbarButton
                        sending = true
                        commitTokens()
                        persist()
                        scope.launch {
                            try {
                                onSend()
                            } finally {
                                sending = false
                            }
                        }
                    },
                    enabled = canSend && !sending && !form.isSending,
                )
            }

            Text(
                displayTitle,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = AppThemeDims.FontSize.largeTitle,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .padding(top = 12.dp, bottom = 8.dp),
            )
            }

            // Single page scroll: header + growing body. EditText must wrap content
            // (no inner scroll) or nested scrolling collapses the form to title-only.
            BoxWithConstraints(modifier = Modifier.weight(1f).fillMaxWidth()) {
                val viewportHeight = maxHeight
                val headerHeight = with(density) { headerHeightPx.toDp() }
                // First frame can report 0 height while the overlay inserts; keep a
                // provisional body min so From/To/Subject never collapse to title-only.
                val editorMin = if (viewportHeight < 8.dp) {
                    280.dp
                } else {
                    (viewportHeight - headerHeight).coerceAtLeast(200.dp)
                }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState()),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                            .onGloballyPositioned { headerHeightPx = it.size.height },
                    ) {
                        FromRow(
                            displayName = fromDisplayName,
                            mailboxes = mailboxes,
                            showMenu = showFromMenu,
                            onShowMenu = { showFromMenu = it },
                            onSelect = { mailbox ->
                                form.selectFrom(mailbox)
                                fromMailboxId = mailbox.id
                                fromEmail = mailbox.email
                                fromName = mailbox.settings?.fromName
                                    ?: mailbox.name.takeIf { it != mailbox.email }
                            },
                        )
                        RecipientRow(
                            label = "To:",
                            tokens = toTokens,
                            draft = toDraft,
                            focused = recipientFocus == ComposeField.To,
                            showsOverflowMenu = true,
                            showCcBcc = showCcBcc,
                            onDraftChange = {
                                toDraft = it
                                form.toDraft = it
                                if (shouldCommitToken(it)) {
                                    commitTokens()
                                    recipientFocus = ComposeField.To
                                }
                            },
                            onCommit = { commitTokens() },
                            onRemove = {
                                toTokens = toTokens.filterNot { token -> token.id == it.id }
                                form.toTokens = toTokens
                            },
                            onFocus = {
                                recipientFocus = ComposeField.To
                            },
                            onToggleCcBcc = {
                                showCcBcc = !showCcBcc
                                form.showCcBcc = showCcBcc
                                if (showCcBcc) recipientFocus = ComposeField.Cc
                            },
                        )
                        if (showCcBcc) {
                            RecipientRow(
                                label = "Cc",
                                tokens = ccTokens,
                                draft = ccDraft,
                                focused = recipientFocus == ComposeField.Cc,
                                onDraftChange = {
                                    ccDraft = it
                                    form.ccDraft = it
                                    if (shouldCommitToken(it)) {
                                        commitTokens()
                                        recipientFocus = ComposeField.Cc
                                    }
                                },
                                onCommit = { commitTokens() },
                                onRemove = {
                                    ccTokens = ccTokens.filterNot { token -> token.id == it.id }
                                    form.ccTokens = ccTokens
                                },
                                onFocus = { recipientFocus = ComposeField.Cc },
                            )
                            RecipientRow(
                                label = "Bcc",
                                tokens = bccTokens,
                                draft = bccDraft,
                                focused = recipientFocus == ComposeField.Bcc,
                                onDraftChange = {
                                    bccDraft = it
                                    form.bccDraft = it
                                    if (shouldCommitToken(it)) {
                                        commitTokens()
                                        recipientFocus = ComposeField.Bcc
                                    }
                                },
                                onCommit = { commitTokens() },
                                onRemove = {
                                    bccTokens = bccTokens.filterNot { token -> token.id == it.id }
                                    form.bccTokens = bccTokens
                                },
                                onFocus = { recipientFocus = ComposeField.Bcc },
                            )
                        }
                        if (suggestions.isNotEmpty() &&
                            (recipientFocus == ComposeField.To ||
                                recipientFocus == ComposeField.Cc ||
                                recipientFocus == ComposeField.Bcc)
                        ) {
                            RecipientSuggestions(
                                suggestions = suggestions,
                                onSelect = { selectSuggestion(it) },
                            )
                        }
                        SubjectField(
                            value = subject,
                            onValueChange = {
                                subject = it
                                form.subject = it
                                recipientFocus = null
                            },
                            onFocus = {
                                recipientFocus = null
                                suggestions = emptyList()
                                commitTokens()
                            },
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = 16.dp)
                                .height(1.dp)
                                .background(colors.line),
                        )
                    }

                    ComposeRichTextEditor(
                        html = body,
                        controller = richText,
                        onHtmlChange = {
                            body = it
                            form.body = it
                        },
                        minHeight = editorMin,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            val sizeError = if (overSize) co.inboxies.app.util.OutboundLimits.SIZE_ERROR else null
            (form.errorMessage ?: sizeError)?.let { error ->
                Text(
                    error,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.deepDarkRed,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            ComposeAttachChips(
                attachments = attachments,
                onRemove = { id ->
                    attachments = attachments.filterNot { it.id == id }
                    form.removeAttachment(id)
                },
            )

            Box {
                val formatSlide = spring<androidx.compose.ui.unit.IntOffset>(
                    dampingRatio = 0.86f,
                    stiffness = Spring.StiffnessMediumLow,
                )
                val formatFade = spring<Float>(
                    dampingRatio = 0.86f,
                    stiffness = Spring.StiffnessMediumLow,
                )
                androidx.compose.animation.AnimatedVisibility(
                    visible = showFormatSheet,
                    enter = slideInVertically(formatSlide) { it } + fadeIn(formatFade),
                    exit = slideOutVertically(formatSlide) { it } + fadeOut(formatFade),
                ) {
                    ComposeFormatSheet(
                        state = formatState,
                        controller = richText,
                        onClose = { showFormatSheet = false },
                    )
                }
                androidx.compose.animation.AnimatedVisibility(
                    visible = !showFormatSheet,
                    enter = fadeIn(formatFade),
                    exit = fadeOut(formatFade),
                ) {
                    ComposeFormatAttachBar(
                        onFormat = { showFormatSheet = true },
                        onAttach = { showAttachMenu = true },
                    )
                }
                InboxiesDropdownMenu(
                    expanded = showAttachMenu,
                    onDismiss = { showAttachMenu = false },
                ) {
                    InboxiesMenuItem(
                        text = "Photo library",
                        onClick = {
                            showAttachMenu = false
                            photoLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                            )
                        },
                    )
                    InboxiesMenuItem(
                        text = "Take photo",
                        onClick = {
                            showAttachMenu = false
                            launchCamera()
                        },
                    )
                    InboxiesMenuItem(
                        text = "Files",
                        onClick = {
                            showAttachMenu = false
                            fileLauncher.launch("*/*")
                        },
                    )
                }
            }

            val quoted = form.quotedOriginal
            AnimatedVisibility(
                visible = quoted != null && !showQuotedOriginal,
                enter = slideInVertically { it } + fadeIn(),
                exit = slideOutVertically { it } + fadeOut(),
            ) {
                if (quoted != null) {
                    QuotedOriginalDock(
                        quoted = quoted,
                        onClick = {
                            keyboard?.hide()
                            showQuotedOriginal = true
                        },
                    )
                }
            }
        }

        toast?.let { current ->
            ComposeSheetToast(
                toast = current,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 24.dp),
            )
        }

        AnimatedVisibility(
            visible = showQuotedOriginal && form.quotedOriginal != null,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            form.quotedOriginal?.let { quoted ->
                QuotedOriginalSheet(
                    quoted = quoted,
                    onDismiss = { showQuotedOriginal = false },
                )
            }
        }
        }
    }
}

@Composable
private fun FromRow(
    displayName: String,
    mailboxes: List<Mailbox>,
    showMenu: Boolean,
    onShowMenu: (Boolean) -> Unit,
    onSelect: (Mailbox) -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 12.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "From:",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.sender,
            color = colors.muted,
        )
        Spacer(Modifier.width(4.dp))
        if (mailboxes.size > 1) {
            Box {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { onShowMenu(true) }
                        .padding(end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        displayName,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = AppThemeDims.FontSize.sender,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Icon(
                        Icons.Outlined.KeyboardArrowDown,
                        contentDescription = "Select sender",
                        tint = colors.muted,
                        modifier = Modifier
                            .padding(start = 4.dp)
                            .size(12.dp),
                    )
                }
                InboxiesDropdownMenu(
                    expanded = showMenu,
                    onDismiss = { onShowMenu(false) },
                ) {
                    mailboxes.forEach { mailbox ->
                        InboxiesMenuItem(
                            text = mailbox.email,
                            onClick = {
                                onShowMenu(false)
                                onSelect(mailbox)
                            },
                        )
                    }
                }
            }
        } else {
            Text(
                displayName,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = AppThemeDims.FontSize.sender,
                color = colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RecipientSuggestions(
    suggestions: List<RecentRecipient>,
    onSelect: (RecentRecipient) -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.surface)
            .drawBehind {
                val stroke = 0.5.dp.toPx()
                drawLine(
                    color = colors.line.copy(alpha = 0.65f),
                    start = androidx.compose.ui.geometry.Offset(0f, 0f),
                    end = androidx.compose.ui.geometry.Offset(size.width, 0f),
                    strokeWidth = stroke,
                )
                drawLine(
                    color = colors.line.copy(alpha = 0.65f),
                    start = androidx.compose.ui.geometry.Offset(0f, size.height),
                    end = androidx.compose.ui.geometry.Offset(size.width, size.height),
                    strokeWidth = stroke,
                )
            },
    ) {
        suggestions.forEach { suggestion ->
            val trimmedName = suggestion.name?.trim().orEmpty()
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(
                        role = Role.Button,
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = { onSelect(suggestion) },
                    )
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            ) {
                Text(
                    text = trimmedName.ifEmpty { suggestion.email },
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = AppThemeDims.FontSize.sender,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (trimmedName.isNotEmpty()) {
                    Text(
                        text = suggestion.email,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Normal,
                        fontSize = AppThemeDims.FontSize.meta,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun RecipientRow(
    label: String,
    tokens: List<MailAddress>,
    draft: String,
    focused: Boolean,
    showsOverflowMenu: Boolean = false,
    showCcBcc: Boolean = false,
    onDraftChange: (String) -> Unit,
    onCommit: () -> Unit,
    onRemove: (MailAddress) -> Unit,
    onFocus: () -> Unit,
    onToggleCcBcc: () -> Unit = {},
) {
    val colors = inboxiesColors()
    val lineHeight = rememberTokenLineHeight()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .widthIn(min = 28.dp)
                .height(lineHeight),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(
                label,
                style = TokenLabelTextStyle.copy(color = colors.muted),
            )
        }
        RecipientTokenEditor(
            tokens = tokens,
            draft = draft,
            focused = focused,
            lineHeight = lineHeight,
            onDraftChange = onDraftChange,
            onCommit = onCommit,
            onRemove = onRemove,
            onFocus = onFocus,
            modifier = Modifier.weight(1f),
        )
        if (showsOverflowMenu) {
            Box(
                modifier = Modifier
                    .width(28.dp)
                    .height(lineHeight)
                    .clickable(
                        role = Role.Button,
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onToggleCcBcc,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.MoreHoriz,
                    contentDescription = if (showCcBcc) "Hide Cc and Bcc" else "Show Cc and Bcc",
                    tint = colors.muted,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecipientTokenEditor(
    tokens: List<MailAddress>,
    draft: String,
    focused: Boolean,
    lineHeight: Dp,
    onDraftChange: (String) -> Unit,
    onCommit: () -> Unit,
    onRemove: (MailAddress) -> Unit,
    onFocus: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var pendingRemovalId by remember { mutableStateOf<String?>(null) }
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(focused) {
        if (focused) {
            pendingRemovalId = null
            delay(16)
            runCatching { focusRequester.requestFocus() }
        } else {
            pendingRemovalId = null
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = lineHeight),
        contentAlignment = Alignment.TopStart,
    ) {
        if (focused) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(CollapsedTokenMetrics.spacing),
                verticalArrangement = Arrangement.spacedBy(CollapsedTokenMetrics.spacing),
                modifier = Modifier.fillMaxWidth(),
            ) {
                tokens.forEach { token ->
                    RecipientTokenPill(
                        token = token,
                        isPendingRemoval = token.id == pendingRemovalId,
                        showsRemove = true,
                        lineHeight = lineHeight,
                        onRemove = {
                            pendingRemovalId = null
                            onRemove(token)
                        },
                        modifier = Modifier.align(Alignment.CenterVertically),
                    )
                }
                TokenTextField(
                    value = draft,
                    placeholder = if (tokens.isEmpty()) "Add an email" else "",
                    onValueChange = {
                        pendingRemovalId = null
                        onDraftChange(it)
                    },
                    onCommit = onCommit,
                    onDeleteWhenEmpty = {
                        val last = tokens.lastOrNull() ?: return@TokenTextField
                        if (pendingRemovalId == last.id) {
                            pendingRemovalId = null
                            onRemove(last)
                        } else {
                            pendingRemovalId = last.id
                        }
                    },
                    onFocus = onFocus,
                    focusRequester = focusRequester,
                    modifier = Modifier
                        .widthIn(min = 128.dp)
                        .height(lineHeight)
                        .align(Alignment.CenterVertically),
                )
            }
        } else {
            CollapsedTokenSummary(
                tokens = tokens,
                placeholder = "Add an email",
                lineHeight = lineHeight,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(lineHeight)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                    ) { onFocus() },
            )
        }
    }
}

@Composable
private fun CollapsedTokenSummary(
    tokens: List<MailAddress>,
    placeholder: String,
    lineHeight: Dp,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current

    BoxWithConstraints(modifier = modifier, contentAlignment = Alignment.CenterStart) {
        if (tokens.isEmpty()) {
            Text(
                placeholder,
                style = TokenLabelTextStyle.copy(color = colors.muted),
                maxLines = 1,
            )
        } else {
            val maxWidthPx = with(density) { maxWidth.toPx() }
            val spacingPx = with(density) { CollapsedTokenMetrics.spacing.toPx() }
            val minPillPx = with(density) { CollapsedTokenMetrics.minPillWidth.toPx() }
            val padPx = with(density) { CollapsedTokenMetrics.pillHorizontalPadding.toPx() }

            fun textWidth(value: String): Float =
                textMeasurer.measure(value, TokenLabelTextStyle, constraints = Constraints()).size.width.toFloat()

            fun overflowWidth(hidden: Int): Float {
                if (hidden <= 0) return 0f
                return textWidth(CollapsedTokenMetrics.overflowLabel(hidden)) + spacingPx
            }

            var visible = tokens
            var hidden = 0
            var widths = emptyList<Float>()
            var fitted = false
            for (hide in 0 until tokens.size) {
                val candidate = tokens.take(tokens.size - hide)
                var remaining = maxWidthPx - overflowWidth(hide)
                val nextWidths = mutableListOf<Float>()
                var fits = true
                candidate.forEachIndexed { index, token ->
                    val natural = textWidth(token.tokenLabel) + padPx
                    val isLast = index == candidate.lastIndex
                    when {
                        natural <= remaining -> {
                            nextWidths += natural
                            remaining -= natural + spacingPx
                        }
                        isLast && remaining >= minPillPx -> {
                            nextWidths += remaining
                            remaining = 0f
                        }
                        else -> {
                            fits = false
                            return@forEachIndexed
                        }
                    }
                }
                if (fits) {
                    visible = candidate
                    hidden = hide
                    widths = nextWidths
                    fitted = true
                    break
                }
            }
            if (!fitted) {
                hidden = tokens.size - 1
                visible = tokens.take(1)
                widths = listOf(max(minPillPx, maxWidthPx - overflowWidth(hidden)))
            }

            Row(
                modifier = Modifier.height(lineHeight),
                horizontalArrangement = Arrangement.spacedBy(CollapsedTokenMetrics.spacing),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                visible.forEachIndexed { index, token ->
                    RecipientTokenPill(
                        token = token,
                        isPendingRemoval = false,
                        showsRemove = false,
                        lineHeight = lineHeight,
                        maxWidth = with(density) { widths[index].toDp() },
                        onRemove = {},
                    )
                }
                if (hidden > 0) {
                    Text(
                        CollapsedTokenMetrics.overflowLabel(hidden),
                        style = TokenLabelTextStyle.copy(color = colors.muted),
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun RecipientTokenPill(
    token: MailAddress,
    isPendingRemoval: Boolean,
    showsRemove: Boolean,
    lineHeight: Dp,
    maxWidth: Dp? = null,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val contentColor = if (isPendingRemoval) colors.ink else colors.muted
    Row(
        modifier = modifier
            .then(if (maxWidth != null) Modifier.widthIn(max = maxWidth) else Modifier)
            .height(lineHeight)
            .clip(RoundedCornerShape(50))
            .background(if (isPendingRemoval) colors.pillActive else colors.pillFill)
            .padding(start = 8.dp, end = if (showsRemove) 6.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            token.tokenLabel,
            style = TokenLabelTextStyle.copy(color = contentColor),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (showsRemove) {
            Icon(
                Icons.Outlined.Close,
                contentDescription = "Remove ${token.tokenLabel}",
                tint = contentColor,
                modifier = Modifier
                    .size(10.dp)
                    .clickable(
                        role = Role.Button,
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onRemove,
                    ),
            )
        }
    }
}

@Composable
private fun TokenTextField(
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit,
    onCommit: () -> Unit,
    onDeleteWhenEmpty: () -> Unit,
    onFocus: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val visual = if (value.isEmpty()) ZWSP else value
    BasicTextField(
        value = visual,
        onValueChange = { new ->
            val cleaned = new.replace(ZWSP, "")
            if (value.isEmpty() && cleaned.isEmpty() && !new.contains(ZWSP)) {
                onDeleteWhenEmpty()
            } else {
                onValueChange(cleaned)
            }
        },
        modifier = modifier
            .focusRequester(focusRequester)
            .onFocusChanged { focus ->
                if (focus.isFocused) onFocus()
            },
        textStyle = TokenFieldTextStyle.copy(color = colors.ink),
        cursorBrush = SolidColor(colors.ink),
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Next,
        ),
        keyboardActions = KeyboardActions(onNext = { onCommit() }),
        decorationBox = { inner ->
            Box(
                modifier = Modifier.fillMaxHeight(),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (value.isEmpty() && placeholder.isNotEmpty()) {
                    Text(
                        placeholder,
                        style = TokenLabelTextStyle.copy(color = colors.muted),
                    )
                }
                inner()
            }
        },
    )
}

@Composable
private fun SubjectField(
    value: String,
    onValueChange: (String) -> Unit,
    onFocus: () -> Unit,
) {
    val colors = inboxiesColors()
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .onFocusChanged { if (it.isFocused) onFocus() },
        textStyle = TextStyle(
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.inlineTitle,
            color = colors.ink,
        ),
        cursorBrush = SolidColor(colors.ink),
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.Sentences,
            imeAction = ImeAction.Next,
        ),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        "Subject",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        fontSize = AppThemeDims.FontSize.inlineTitle,
                        color = colors.muted,
                    )
                }
                inner()
            }
        },
    )
}

@Composable
private fun QuotedOriginalDock(
    quoted: QuotedOriginal,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .padding(bottom = 10.dp)
            .fillMaxWidth()
            .height(48.dp)
            .shadow(12.dp, RoundedCornerShape(16.dp), ambientColor = Color.Black.copy(alpha = 0.1f))
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            Icons.Outlined.FormatQuote,
            contentDescription = null,
            tint = colors.ink,
            modifier = Modifier.size(16.dp),
        )
        Text(
            quoted.header,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.FontSize.body,
            color = colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun QuotedOriginalSheet(
    quoted: QuotedOriginal,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    val dragY = rememberSheetDragY()

    Box(modifier = Modifier.fillMaxSize().background(HomeChromeMetrics.modalScrim)) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { translationY = dragY.floatValue.coerceAtLeast(0f) }
                .background(colors.background)
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = onDismiss,
                )
                .statusBarsPadding(),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .sheetDragToDismiss(dragY = dragY, onDismiss = onDismiss)
                    .padding(top = 12.dp, bottom = 8.dp),
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
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(top = 20.dp, bottom = 28.dp)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {},
                    ),
            ) {
                Text(
                    quoted.header,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                )
                Spacer(Modifier.height(16.dp))
                Text(
                    quoted.text,
                    fontFamily = InterFontFamily,
                    fontSize = AppThemeDims.FontSize.body,
                    color = colors.muted,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 12.dp)
                        .drawBehind {
                            drawRect(
                                color = colors.muted.copy(alpha = 0.35f),
                                size = androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height),
                            )
                        },
                )
            }
        }
    }
}

@Composable
private fun ComposeSheetToast(
    toast: ComposeToast,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    Row(
        modifier = modifier
            .shadow(12.dp, RoundedCornerShape(50))
            .clip(RoundedCornerShape(50))
            .background(colors.surface)
            .border(0.5.dp, colors.line.copy(alpha = 0.6f), RoundedCornerShape(50))
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            if (toast.isError) Icons.Outlined.Error else Icons.Outlined.CheckCircle,
            contentDescription = null,
            tint = if (toast.isError) colors.deepDarkRed else colors.ink,
            modifier = Modifier.size(14.dp),
        )
        Text(
            toast.message,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = colors.ink,
        )
    }
}

private val TokenLineHeightStyle = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.Both,
)

private val TokenLabelTextStyle = TextStyle(
    fontFamily = InterFontFamily,
    fontWeight = FontWeight.Medium,
    fontSize = AppThemeDims.FontSize.meta,
    lineHeight = 16.sp,
    lineHeightStyle = TokenLineHeightStyle,
)

private val TokenFieldTextStyle = TextStyle(
    fontFamily = InterFontFamily,
    fontWeight = FontWeight.Normal,
    fontSize = AppThemeDims.FontSize.recipient,
    lineHeight = 16.sp,
    lineHeightStyle = TokenLineHeightStyle,
)

private object CollapsedTokenMetrics {
    val spacing = 6.dp
    val minPillWidth = 56.dp
    val pillHorizontalPadding = 16.dp
    val pillVerticalPadding = 4.dp

    fun overflowLabel(hidden: Int): String = "+ $hidden others"
}

@Composable
private fun rememberTokenLineHeight(): Dp {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    return remember(measurer, density.density) {
        val textHeight = measurer.measure("Ag", TokenLabelTextStyle).size.height
        with(density) { textHeight.toDp() + CollapsedTokenMetrics.pillVerticalPadding * 2 }
    }
}

private const val ZWSP = "\u200B"

private fun shouldCommitToken(text: String): Boolean {
    val hasDelimiter = text.any { it == ',' || it == ';' }
    val hasSpacedEmail = text.any { it == ' ' } && text.any { it == '@' }
    return hasDelimiter || hasSpacedEmail
}

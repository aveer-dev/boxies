package co.inboxies.app.ui.notes

import android.os.SystemClock
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import co.inboxies.app.models.ThreadNote
import co.inboxies.app.services.NotePoint
import co.inboxies.app.services.NoteSize
import co.inboxies.app.services.NoteText
import co.inboxies.app.services.StickyNoteLayout
import co.inboxies.app.services.StickyNoteMotion
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.NoteDims
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.MarkdownContentView
import co.inboxies.app.ui.compose.rememberReduceMotion
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Default chrome spring (dampingRatio 0.86, StiffnessMediumLow). */
private fun <T> noteSpring() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

/** A dropped sticky's settle: slightly underdamped (~0.4s), so it overshoots a touch. */
private fun <T> settleSpring() = spring<T>(
    dampingRatio = StickyNoteMotion.SETTLE_DAMPING,
    stiffness = Spring.StiffnessMediumLow,
)

/** The quick pick-up (scale + shadow), ~120ms with no bounce. */
private fun <T> liftSpring() = spring<T>(dampingRatio = 1f, stiffness = Spring.StiffnessMedium)

/** Share of the gap to the drag lean closed each frame, so the lean eases rather than jitters. */
private const val DRAG_TILT_SMOOTHING = 0.25f

/** A held note that hasn't moved for this long eases its lean back to flat. */
private const val DRAG_IDLE_MILLIS = 60L

/**
 * A note's markdown, compact and in the surrounding ink, so it reads on the sticky's
 * paper and on the inline card alike. Images show their alt text (no remote loads),
 * raw HTML stays text, and links only open web or mail URLs.
 */
@Composable
fun NoteMarkdownView(
    markdown: String,
    modifier: Modifier = Modifier,
    fontSize: Float = 13f,
    ink: Color = inboxiesColors().ink,
) {
    val renderable = remember(markdown) { NoteText.renderable(markdown) }
    MarkdownContentView(
        markdown = renderable,
        modifier = modifier,
        fontSize = fontSize.sp,
        ink = ink,
        richInline = true,
    )
}

/**
 * The reader's sticky notes (whole-conversation notes to self), floating over the
 * message area like paper pinned to it. Each can be dragged anywhere in the view
 * (clamped to its edges); where it's dropped is saved.
 */
@Composable
fun StickyNotesLayer(
    notes: List<ThreadNote>,
    onEdit: (ThreadNote) -> Unit,
    onDelete: (ThreadNote) -> Unit,
    onMove: (ThreadNote, NotePoint) -> Unit,
    modifier: Modifier = Modifier,
) {
    var front by remember { mutableStateOf<String?>(null) }
    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val view = NoteSize(maxWidth.value, maxHeight.value)
        notes.forEachIndexed { index, note ->
            key(note.id) {
                val visible = remember { MutableTransitionState(false) }.apply { targetState = true }
                AnimatedVisibility(
                    visibleState = visible,
                    enter = fadeIn(noteSpring()) + scaleIn(noteSpring(), initialScale = 0.92f),
                    exit = fadeOut(noteSpring()),
                    modifier = Modifier.zIndex(if (front == note.id) 2f else 1f),
                ) {
                    StickyNoteView(
                        note = note,
                        index = index,
                        view = view,
                        onFocus = { front = note.id },
                        onEdit = { onEdit(note) },
                        onDelete = { onDelete(note) },
                        onMove = { onMove(note, it) },
                    )
                }
            }
        }
    }
}

/** Tallest the body grows before it fades out (the editor shows all of it). */
private const val BODY_MAX_HEIGHT = 220f

@Composable
private fun StickyNoteView(
    note: ThreadNote,
    index: Int,
    /** The message area the note lives in, in dp. */
    view: NoteSize,
    onFocus: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onMove: (NotePoint) -> Unit,
) {
    val colors = inboxiesColors()
    val paletteNote = colors.note
    val localDensity = LocalDensity.current
    val androidView = LocalView.current
    val scope = rememberCoroutineScope()
    val reduceMotion = rememberReduceMotion()

    val noteWidth = StickyNoteLayout.noteWidth(view.width)
    var measuredHeight by remember { mutableFloatStateOf(120f) }
    val size = NoteSize(noteWidth, measuredHeight)
    var collapsed by remember { mutableStateOf(false) }
    var isDragging by remember { mutableStateOf(false) }

    val saved = note.savedPosition?.let { NotePoint(it.first, it.second) }
    val resting = StickyNoteLayout.position(saved, index, size, view)

    /** Where the note was dropped, shown until the model holds that spot (or puts it back). */
    var pendingDrop by remember { mutableStateOf<NotePoint?>(null) }
    LaunchedEffect(note.posX, note.posY) { pendingDrop = null }
    val target = pendingDrop?.let { StickyNoteLayout.clamp(it, size, view) } ?: resting

    val position = remember { Animatable(Offset(resting.x, resting.y), Offset.VectorConverter) }
    /** The release velocity (dp/s) the next settle starts from, set once by a drop. */
    val throwVelocity = remember { arrayOfNulls<Offset>(1) }
    // Settle on the target: a throw (a slightly underdamped spring carrying the release
    // velocity, so it overshoots a touch), the model's spot after a save or a failed save
    // (put back), a measured height or a rotated / resized view (re-clamped).
    LaunchedEffect(target, isDragging) {
        if (isDragging) return@LaunchedEffect
        val thrown = throwVelocity[0]
        throwVelocity[0] = null
        val goal = Offset(target.x, target.y)
        when {
            reduceMotion -> position.animateTo(goal, tween(160, easing = FastOutSlowInEasing))
            thrown != null -> position.animateTo(goal, settleSpring(), initialVelocity = thrown)
            else -> position.animateTo(goal, noteSpring())
        }
    }

    val currentSize by rememberUpdatedState(size)
    val currentView by rememberUpdatedState(view)
    val currentResting by rememberUpdatedState(resting)
    val currentOnMove by rememberUpdatedState(onMove)
    val currentOnFocus by rememberUpdatedState(onFocus)
    val currentReduceMotion by rememberUpdatedState(reduceMotion)

    // Tilt: the resting lean, or while held a lean that follows horizontal speed and
    // eases back to flat as the drag slows or stops. Springs home on release.
    val restTilt = if (reduceMotion) 0f else NoteDims.tilt
    val tilt = remember { Animatable(restTilt) }
    /** Lean the drag is heading toward and when the pointer last moved (uptime ms). */
    var dragTiltTarget by remember { mutableFloatStateOf(0f) }
    var lastMoveMillis by remember { mutableLongStateOf(0L) }
    LaunchedEffect(isDragging, restTilt) {
        if (!isDragging) {
            tilt.animateTo(restTilt, settleSpring())
            return@LaunchedEffect
        }
        while (true) {
            withFrameMillis { }
            val idle = SystemClock.uptimeMillis() - lastMoveMillis > DRAG_IDLE_MILLIS
            val goal = if (idle || reduceMotion) 0f else dragTiltTarget
            tilt.snapTo(tilt.value + (goal - tilt.value) * DRAG_TILT_SMOOTHING)
        }
    }

    val liftedNow = isDragging
    val lift by animateFloatAsState(
        targetValue = if (liftedNow && !reduceMotion) StickyNoteMotion.LIFT_SCALE else 1f,
        animationSpec = if (liftedNow) liftSpring() else settleSpring(),
        label = "noteLift",
    )
    val elevation by animateDpAsState(
        targetValue = if (liftedNow) NoteDims.liftedElevation else NoteDims.restingElevation,
        animationSpec = if (liftedNow) liftSpring() else settleSpring(),
        label = "noteShadow",
    )

    val paperShape = RoundedCornerShape(
        topStart = NoteDims.cornerRadius,
        topEnd = NoteDims.cornerRadius,
        bottomEnd = NoteDims.curlRadius,
        bottomStart = NoteDims.cornerRadius,
    )

    Box(
        modifier = Modifier
            .offset {
                IntOffset(
                    (position.value.x * localDensity.density).roundToInt(),
                    (position.value.y * localDensity.density).roundToInt(),
                )
            }
            .width(noteWidth.dp)
            .onSizeChanged { measured ->
                val h = measured.height / localDensity.density
                if (h > 0f) measuredHeight = h
            }
            .graphicsLayer {
                rotationZ = tilt.value
                scaleX = lift
                scaleY = lift
            }
            .pointerInput(note.id) {
                val tracker = VelocityTracker()
                var start = NotePoint(0f, 0f)
                var translation = Offset.Zero
                detectDragGestures(
                    onDragStart = {
                        // Pick up: lift, deepen the shadow, ease the resting tilt to flat.
                        start = NotePoint(position.value.x, position.value.y)
                        translation = Offset.Zero
                        tracker.resetTracking()
                        dragTiltTarget = 0f
                        lastMoveMillis = SystemClock.uptimeMillis()
                        scope.launch { position.stop() }
                        isDragging = true
                        currentOnFocus()
                        androidView.performHapticFeedback(HapticFeedbackConstants.GESTURE_START)
                    },
                    onDrag = { change, amount ->
                        change.consume()
                        // Follow the finger 1:1 (clamped inside the view).
                        translation += Offset(amount.x / density, amount.y / density)
                        tracker.addPosition(change.uptimeMillis, translation)
                        lastMoveMillis = change.uptimeMillis
                        dragTiltTarget = StickyNoteMotion.tiltFor(tracker.calculateVelocity().x)
                        val live = StickyNoteLayout.clamp(
                            NotePoint(start.x + translation.x, start.y + translation.y),
                            currentSize,
                            currentView,
                        )
                        scope.launch { position.snapTo(Offset(live.x, live.y)) }
                    },
                    onDragEnd = {
                        val velocity = if (currentReduceMotion) {
                            Velocity.Zero
                        } else {
                            tracker.calculateVelocity()
                        }
                        // Throw: carry the release velocity a short way, then clamp.
                        val end = StickyNoteLayout.dropPosition(
                            start = start,
                            translation = NotePoint(translation.x, translation.y),
                            velocity = NotePoint(velocity.x, velocity.y),
                            note = currentSize,
                            view = currentView,
                        )
                        throwVelocity[0] = Offset(velocity.x, velocity.y)
                        if (end != currentResting) {
                            pendingDrop = end
                            currentOnMove(end)
                        }
                        isDragging = false
                    },
                    onDragCancel = { isDragging = false },
                )
            }
            .semantics {
                contentDescription = "Sticky note to self"
                customActions = listOf(
                    CustomAccessibilityAction("Move to top right") {
                        currentOnMove(StickyNoteLayout.position(null, 0, currentSize, currentView))
                        true
                    },
                )
            },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .drawWithContent {
                    drawContent()
                    // Dark only: a faint 1dp ring so the paper lifts off the dark page.
                    if (paletteNote.ring.alpha > 0f) {
                        val inset = 0.5.dp.toPx()
                        translate(-inset, -inset) {
                            drawOutline(
                                paperShape.createOutline(
                                    Size(size.width + inset * 2, size.height + inset * 2),
                                    layoutDirection,
                                    this,
                                ),
                                color = paletteNote.ring,
                                style = Stroke(1.dp.toPx()),
                            )
                        }
                    }
                }
                .shadow(elevation, paperShape, ambientColor = paletteNote.shadow, spotColor = paletteNote.shadow)
                .clip(paperShape)
                .background(paletteNote.paper)
                .border(0.5.dp, paletteNote.paperEdge, paperShape)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onFocus,
                )
                .animateContentSize(noteSpring()),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 2.dp, top = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Note to self",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 11.sp,
                    color = paletteNote.muted,
                    maxLines = 1,
                )
                Spacer(Modifier.weight(1f))
                NoteHeaderButton(
                    icon = if (collapsed) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.KeyboardArrowUp,
                    label = if (collapsed) "Expand note" else "Fold note",
                    tint = paletteNote.muted,
                ) { collapsed = !collapsed }
                NoteHeaderButton(Icons.Outlined.Edit, "Edit note", paletteNote.muted) {
                    collapsed = false
                    onEdit()
                }
                NoteHeaderButton(Icons.Outlined.Delete, "Delete note", paletteNote.muted, onClick = onDelete)
            }
            Column(modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
                if (collapsed) {
                    Text(
                        NoteText.preview(note.body),
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = paletteNote.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    StickyNoteBody(note.body, paletteNote.ink)
                    Row(
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .clearAndSetSemantics {
                                contentDescription = "Only visible to you"
                            },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(
                            Icons.Filled.Lock,
                            contentDescription = null,
                            tint = paletteNote.muted,
                            modifier = Modifier.size(9.dp),
                        )
                        // updatedAt also moves when the note is dragged, so show when it was written.
                        val date = DateUtils.formatListDate(note.createdAt)
                        Text(
                            if (date.isEmpty()) "Only visible to you" else "Only visible to you · $date",
                            fontFamily = InterFontFamily,
                            fontSize = 10.sp,
                            color = paletteNote.muted,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
        Icon(
            Icons.Filled.PushPin,
            contentDescription = null,
            tint = paletteNote.pin,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = (-9).dp)
                .size(16.dp)
                .rotate(20f),
        )
    }
}

/** The sticky's markdown, capped at [BODY_MAX_HEIGHT] with a fade when it runs longer. */
@Composable
private fun StickyNoteBody(markdown: String, ink: Color) {
    val density = LocalDensity.current
    var contentHeight by remember { mutableFloatStateOf(0f) }
    val clipped = contentHeight > BODY_MAX_HEIGHT
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = BODY_MAX_HEIGHT.dp)
            .clipToBounds()
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent {
                drawContent()
                if (clipped) {
                    drawRect(
                        brush = Brush.verticalGradient(
                            0.8f to Color.Black,
                            1f to Color.Transparent,
                        ),
                        blendMode = BlendMode.DstIn,
                    )
                }
            },
    ) {
        NoteMarkdownView(
            markdown,
            modifier = Modifier
                .wrapContentHeight(align = Alignment.Top, unbounded = true)
                .onSizeChanged { contentHeight = it.height / density.density },
            fontSize = 13f,
            ink = ink,
        )
    }
}

@Composable
private fun NoteHeaderButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
    }
}

/**
 * Notes to self on one message, in line under it in the thread. Drawn on the same
 * note paper as the sticky (paper fill, paper-edge hairline, note ink), so they read
 * as the user's own and never as part of the mail. Only their author sees them.
 */
@Composable
fun InlineNotesView(
    notes: List<ThreadNote>,
    onEdit: (ThreadNote) -> Unit,
    onDelete: (ThreadNote) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        notes.forEach { note ->
            key(note.id) {
                InlineNoteCard(threadNote = note, onEdit = { onEdit(note) }, onDelete = { onDelete(note) })
            }
        }
    }
}

/** "🔒 Private note to self · Only visible to you" (+ date when given). */
@Composable
fun PrivateNoteLabel(
    modifier: Modifier = Modifier,
    date: String? = null,
    edited: Boolean = false,
) {
    val note = inboxiesColors().note
    val formatted = date?.let { DateUtils.formatListDate(it) }.orEmpty()
    val suffix = if (formatted.isEmpty()) "" else " · ${if (edited) "Edited " else ""}$formatted"
    Row(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, tint = note.pin, modifier = Modifier.size(10.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = note.ink, fontWeight = FontWeight.Medium)) {
                    append("Private note to self")
                }
                withStyle(SpanStyle(color = note.muted)) {
                    append(" · Only visible to you$suffix")
                }
            },
            fontFamily = InterFontFamily,
            fontSize = 11.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun InlineNoteCard(
    threadNote: ThreadNote,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val note = inboxiesColors().note
    val shape = RoundedCornerShape(NoteDims.inlineCornerRadius)
    var menuOpen by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(note.paper)
            .border(1.dp, note.paperEdge, shape)
            .combinedClickable(onClick = {}, onLongClick = { menuOpen = true })
            .padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PrivateNoteLabel(
                modifier = Modifier.weight(1f),
                date = threadNote.updatedAt,
                edited = threadNote.updatedAt != threadNote.createdAt,
            )
            Box {
                Box(
                    modifier = Modifier
                        .size(width = 28.dp, height = 24.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { menuOpen = true }
                        .semantics { contentDescription = "Note options" },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Outlined.MoreHoriz,
                        contentDescription = null,
                        tint = note.muted,
                        modifier = Modifier.size(16.dp),
                    )
                }
                InboxiesDropdownMenu(expanded = menuOpen, onDismiss = { menuOpen = false }) {
                    InboxiesMenuItem(text = "Edit Note", icon = Icons.Outlined.Edit, onClick = {
                        menuOpen = false
                        onEdit()
                    })
                    InboxiesMenuItem(text = "Delete Note", icon = Icons.Outlined.Delete, destructive = true, onClick = {
                        menuOpen = false
                        onDelete()
                    })
                }
            }
        }
        Box(modifier = Modifier.padding(end = 6.dp)) {
            NoteMarkdownView(threadNote.body, fontSize = 13f, ink = note.ink)
        }
    }
}

/** The list row's sticky strip: the note's text on note paper, clamped to two lines. */
@Composable
fun StickyNoteRowStrip(text: String, modifier: Modifier = Modifier) {
    val note = inboxiesColors().note
    val shape = RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp, bottomEnd = 11.dp, bottomStart = 8.dp)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(note.paper)
            .border(0.5.dp, note.paperEdge, shape)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .clearAndSetSemantics { contentDescription = "Note to self: $text" },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.Filled.PushPin,
            contentDescription = null,
            tint = note.pin,
            modifier = Modifier
                .padding(top = 2.dp)
                .size(11.dp)
                .rotate(20f),
        )
        Text(
            text,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            color = note.ink,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

/** "🔒 N private notes" chip on a list row (notes on single messages), on note paper. */
@Composable
fun PrivateNotesChip(count: Int) {
    val note = inboxiesColors().note
    val shape = RoundedCornerShape(6.dp)
    Row(
        modifier = Modifier
            .clip(shape)
            .background(note.paper)
            .border(0.5.dp, note.paperEdge, shape)
            .padding(horizontal = 8.dp, vertical = 3.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(Icons.Filled.Lock, contentDescription = null, tint = note.pin, modifier = Modifier.size(9.dp))
        Text(
            "$count private note${if (count == 1) "" else "s"}",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = AppThemeDims.List.badge,
            color = note.muted,
            maxLines = 1,
        )
    }
}

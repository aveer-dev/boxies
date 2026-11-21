package co.inboxies.app.ui.components

import android.icu.text.BreakIterator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.util.lerp
import co.inboxies.app.ui.compose.rememberReduceMotion
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * Letter timing, ms (web `MorphText`, iOS `MorphingTitle`). Each letter fades over EXIT/ENTER;
 * neighbours start STEP apart, capped at SPREAD for the whole string so long titles take no
 * longer. The new text trails the old by LAG.
 */
private const val EXIT_MS = 140f
private const val ENTER_MS = 180f
private const val LAG_MS = 40f
private const val MAX_STEP_MS = 4f
private const val SPREAD_MS = 140f
private val Blur = 4.dp
private val Shift = 3.dp
private val EaseOut = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)
private val EaseIn = CubicBezierEasing(0.4f, 0f, 1f, 1f)

/** Joined or reordered scripts (Arabic, Indic…) can't be split into letters: they move a word at a time. */
private val ShapedScript = Regex("[֐-ࣿऀ-෿ༀ-႟ក-᢯ꡀ-ꣿ]")

private fun stepFor(count: Int) = min(MAX_STEP_MS, SPREAD_MS / max(count, 1))

private fun enterVisibility(index: Int, count: Int, ms: Float): Float =
    EaseOut.transform(((ms - LAG_MS - index * stepFor(count)) / ENTER_MS).coerceIn(0f, 1f))

private fun exitVisibility(index: Int, count: Int, ms: Float): Float =
    1f - EaseIn.transform(((ms - index * stepFor(count)) / EXIT_MS).coerceIn(0f, 1f))

/** One change of text: the layout that was on screen leaves, letter by letter. */
private class Morph(
    val leaving: TextLayoutResult,
    val leavingLetters: List<Rect>,
    /** Where each leaving letter starts: 1, or less when it was still coming in. */
    val startVisibility: FloatArray,
) {
    val clock: Animatable<Float, AnimationVector1D> = Animatable(0f)
    var entering: List<Rect> = emptyList()

    fun duration(): Float = max(
        EXIT_MS + stepFor(leavingLetters.size) * leavingLetters.size,
        LAG_MS + ENTER_MS + stepFor(entering.size) * entering.size,
    )
}

/**
 * The letters of a laid-out text, each as the box the paragraph drew it in (kerning and line
 * breaks included). Emoji and accents stay whole; whitespace is skipped; an ellipsis is one more.
 */
private fun letterBoxes(layout: TextLayoutResult): List<Rect> {
    val text = layout.layoutInput.text.text
    val ranges = mutableListOf<IntRange>()
    if (ShapedScript.containsMatchIn(text)) {
        Regex("\\S+").findAll(text).forEach { ranges += it.range }
    } else {
        val it = BreakIterator.getCharacterInstance().apply { setText(text) }
        var start = it.first()
        var end = it.next()
        while (end != BreakIterator.DONE) {
            ranges += start until end
            start = end
            end = it.next()
        }
    }
    val boxes = mutableListOf<Rect>()
    val lastLine = layout.lineCount - 1
    var lastLineRight = 0f
    for (range in ranges) {
        if (text.substring(range).isBlank()) continue
        val line = layout.getLineForOffset(range.first)
        var left = Float.MAX_VALUE
        var right = -Float.MAX_VALUE
        for (offset in range) {
            val box = layout.getBoundingBox(offset)
            left = min(left, box.left)
            right = max(right, box.right)
        }
        if (right - left < 0.5f) continue
        boxes += Rect(left, layout.getLineTop(line), right, layout.getLineBottom(line))
        if (line == lastLine) lastLineRight = max(lastLineRight, right)
    }
    if (lastLine >= 0 && layout.isLineEllipsized(lastLine)) {
        boxes += Rect(lastLineRight, layout.getLineTop(lastLine), layout.size.width.toFloat(), layout.getLineBottom(lastLine))
    }
    return boxes
}

/**
 * Title text that changes letter by letter: the old letters blur out and the new ones sharpen in,
 * left to right, in about 300 ms, and the height eases if the line count changes. Each letter is
 * the real paragraph clipped to its own box, so it settles into the plain [Text] without a shift.
 * With animations off it just swaps.
 */
@Composable
fun MorphingTitle(
    text: String,
    color: Color,
    fontFamily: FontFamily,
    fontWeight: FontWeight,
    fontSize: TextUnit,
    maxLines: Int,
    overflow: TextOverflow,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReduceMotion()
    var shown by remember { mutableStateOf<TextLayoutResult?>(null) }
    // The last morph, to find where an interrupted one got to. Not state: nothing redraws on it.
    val last = remember { arrayOfNulls<Morph>(1) }
    val morph = remember(text) {
        val old = shown
        val next = if (old == null || reduceMotion || old.layoutInput.text.text == text) {
            null
        } else {
            val letters = letterBoxes(old)
            // Cut short: the letters still coming in leave from where they got to.
            val cut = last[0]?.takeIf { it.clock.isRunning }
            val start = FloatArray(letters.size) { i ->
                if (cut == null) 1f else enterVisibility(i, letters.size, cut.clock.value)
            }
            Morph(old, letters, start)
        }
        last[0] = next
        next
    }
    var settled by remember(text) { mutableStateOf(morph == null) }
    val current = shown?.takeIf { it.layoutInput.text.text == text }
    if (morph != null && current != null && morph.entering.isEmpty()) morph.entering = letterBoxes(current)

    LaunchedEffect(morph) {
        if (morph == null) return@LaunchedEffect
        val total = morph.duration() + 40f
        morph.clock.animateTo(total, tween(total.roundToInt(), easing = LinearEasing))
        settled = true
    }

    val moving = morph != null && !settled
    Box(
        modifier.layout { measurable, constraints ->
            val placeable = measurable.measure(constraints)
            // A title gaining or losing a line eases to its new height.
            val height = if (moving && morph != null) {
                val t = EaseOut.transform((morph.clock.value / (LAG_MS + ENTER_MS + SPREAD_MS / 2)).coerceIn(0f, 1f))
                lerp(morph.leaving.size.height.toFloat(), placeable.height.toFloat(), t).roundToInt()
            } else {
                placeable.height
            }
            layout(placeable.width, height) { placeable.place(0, 0) }
        },
    ) {
        Text(
            text,
            fontFamily = fontFamily,
            fontWeight = fontWeight,
            fontSize = fontSize,
            color = if (moving) Color.Transparent else color,
            maxLines = maxLines,
            overflow = overflow,
            onTextLayout = { shown = it },
        )
        if (moving && morph != null) {
            val leaving = morph.leavingLetters
            leaving.forEachIndexed { i, box ->
                Letter(morph.leaving, box, color, rising = false) {
                    morph.startVisibility[i] * exitVisibility(i, leaving.size, morph.clock.value)
                }
            }
            val entering = morph.entering
            if (current != null) {
                entering.forEachIndexed { i, box ->
                    Letter(current, box, color, rising = true) {
                        enterVisibility(i, entering.size, morph.clock.value)
                    }
                }
            }
        }
    }
}

/** One letter: the paragraph clipped to [box], faded, blurred and nudged by its visibility. */
@Composable
private fun Letter(
    layout: TextLayoutResult,
    box: Rect,
    color: Color,
    rising: Boolean,
    visibility: () -> Float,
) {
    val density = LocalDensity.current
    // Room around the letter for the blur to spread into.
    val pad = with(density) { (Blur * 2).toPx() }
    val x = (box.left - pad).roundToInt()
    val y = (box.top - pad).roundToInt()
    val width = (box.width + pad * 2).roundToInt()
    val height = (box.height + pad * 2).roundToInt()
    Box(
        Modifier
            // Takes no room in the title: it only draws over its own letter.
            .layout { measurable, _ ->
                val placeable = measurable.measure(Constraints.fixed(width, height))
                layout(0, 0) { placeable.place(x, y) }
            }
            .graphicsLayer {
                val v = visibility()
                alpha = v
                translationY = (1f - v) * Shift.toPx() * if (rising) 1f else -1f
                val radius = (1f - v) * Blur.toPx()
                renderEffect = if (radius > 0.3f) BlurEffect(radius, radius, TileMode.Decal) else null
            }
            .drawBehind {
                translate(-x.toFloat(), -y.toFloat()) {
                    clipRect(box.left, box.top, box.right, box.bottom) {
                        drawText(layout, color = color)
                    }
                }
            },
    )
}

package co.inboxies.app.widget

import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import co.inboxies.app.theme.InboxiesColors
import co.inboxies.app.ui.widget.InboxWidgetDeckPose
import co.inboxies.app.ui.widget.InboxWidgetDepthMetrics
import co.inboxies.app.ui.widget.InboxWidgetMetrics
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The grey-scale palette for one render of the widget: `InboxiesColors` only (no accent,
 * no new hues), resolved for light or dark because the bitmaps are drawn with it too.
 */
internal data class WidgetPalette(val isDark: Boolean) {
    val surface: Color = if (isDark) InboxiesColors.DarkSurface else InboxiesColors.LightSurface
    val ink: Color = if (isDark) InboxiesColors.DarkInk else InboxiesColors.LightInk
    val muted: Color = if (isDark) InboxiesColors.DarkMuted else InboxiesColors.LightMuted
    val line: Color = if (isDark) InboxiesColors.DarkLine else InboxiesColors.LightLine
    val pillFill: Color = if (isDark) InboxiesColors.DarkPillFill else InboxiesColors.LightPillFill
    val unread: Color = if (isDark) InboxiesColors.DarkUnread else InboxiesColors.LightUnread

    /** Front card: dark mode lifts it with a little ink (elevated surfaces are lighter). */
    val cardFill: Color =
        if (isDark) ink.copy(alpha = InboxWidgetDepthMetrics.frontLiftDark).compositeOver(surface) else surface
    val cardHairline: Color = line.copy(alpha = if (isDark) 0.5f else 0.7f).compositeOver(cardFill)

    /** Frosted pill (Reply later): translucent surface, no blur (RemoteViews can't). */
    val frost: Color = surface.copy(alpha = if (isDark) 0.42f else 0.62f)

    fun avatarFill(index: Int = 0): Color =
        ink.copy(alpha = 0.14f - index * 0.03f).compositeOver(cardFill)
}

/**
 * Bitmaps for what RemoteViews can't draw (AVE-150): radial gradients, soft shadows and
 * the stacked card backs. Each is drawn at the size of the view it fills and stretched
 * to the real cell size (`ContentScale.FillBounds`), which only ever differs by a few
 * percent, so shapes keep their proportions. Same recipes as the in-app mocks
 * (`InboxWidgetMock.kt` / `InboxWidgetDepth.kt`).
 */
internal object InboxWidgetArt {
    /** Room around the front card for the card shadows (declared first: [frontInset] uses it). */
    private val shadowMargin = 6.dp

    /** Pixels per dp for the deck and the check. Capped to keep the RemoteViews small. */
    fun detailScale(density: Float): Float = min(density, 2f)

    /** The ink bloom only has soft gradients, so it renders at a low resolution. */
    private const val BLOOM_SCALE = 0.75f

    /** Surface + ink bloom (hot corner top-end, dimmer echo bottom-start) + top sheen. */
    fun bloom(widthDp: Float, heightDp: Float, newCount: Int, palette: WidgetPalette): Bitmap {
        val w = max(1, (widthDp * BLOOM_SCALE).roundToInt())
        val h = max(1, (heightDp * BLOOM_SCALE).roundToInt())
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val strength = InboxWidgetMetrics.glowStrength(newCount, palette.isDark)
        val reach = max(w, h).toFloat()
        canvas.drawColor(palette.surface.toArgb())
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = RadialGradient(
            w * 1.0f, h * -0.05f, reach * 0.95f,
            palette.ink.copy(alpha = strength).toArgb(), palette.ink.copy(alpha = 0f).toArgb(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
        paint.shader = RadialGradient(
            w * -0.1f, h * 1.1f, reach * 0.7f,
            palette.ink.copy(alpha = strength * 0.45f).toArgb(), palette.ink.copy(alpha = 0f).toArgb(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
        // Top sheen so the frosted pills have something to catch.
        val sheen = Color.White.copy(alpha = if (palette.isDark) 0.05f else 0.35f)
        paint.shader = LinearGradient(
            0f, 0f, 0f, h / 2f,
            sheen.toArgb(), Color.Transparent.toArgb(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w.toFloat(), h / 2f, paint)
        return bitmap
    }

    /**
     * The deck behind the live front card: the card backs (shade, hairline, lit top lip)
     * and every card's soft shadow, posed with [InboxWidgetDeckPose.forSlot] (the same
     * math as the in-app deck and iOS). The front card itself is a real Glance `Box`
     * sitting at [frontInset] inside this bitmap.
     */
    fun deckBacks(
        widthDp: Float,
        heightDp: Float,
        threadCount: Int,
        palette: WidgetPalette,
        density: Float,
    ): Bitmap {
        val scale = detailScale(density)
        val w = max(1, (widthDp * scale).roundToInt())
        val h = max(1, (heightDp * scale).roundToInt())
        val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        if (threadCount <= 0) return bitmap
        val canvas = Canvas(bitmap)
        fun px(dp: Dp) = dp.value * scale
        val m = InboxWidgetDepthMetrics
        val inset = frontInset
        val front = RectF(px(inset.start), px(inset.top), w - px(inset.end), h - px(inset.bottom))
        val radius = px(m.cardRadius)
        val shadowColor = Color.Black.copy(alpha = if (palette.isDark) m.cardShadowDark else m.cardShadowLight)
        val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = shadowColor.toArgb()
            maskFilter = BlurMaskFilter(px(5.dp), BlurMaskFilter.Blur.NORMAL)
        }
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        val lip = Color.White.copy(alpha = if (palette.isDark) m.lipDark else m.lipLight)

        // Back to front: the deepest visible card first.
        val backs = (1 until threadCount)
            .map { slot -> InboxWidgetDeckPose.forSlot(slot, threadCount) }
            .filter { it.alpha > 0f && it.depth > 0 }
            .sortedByDescending { it.depth }
        for (pose in backs) {
            val cw = front.width() * pose.scale
            val ch = front.height() * pose.scale
            val left = front.centerX() - cw / 2f
            val top = front.top + px(pose.offsetY)
            val card = RectF(left, top, left + cw, top + ch)
            drawShadow(canvas, card, radius, shadowPaint, px(2.dp))
            fill.shader = null
            fill.color = palette.surface.toArgb()
            canvas.drawRoundRect(card, radius, radius, fill)
            val shade = Color.Black.copy(alpha = (if (palette.isDark) m.shadeDark else m.shadeLight) * pose.depth)
            fill.color = shade.toArgb()
            canvas.drawRoundRect(card, radius, radius, fill)
            stroke.shader = null
            stroke.strokeWidth = px(0.5.dp)
            stroke.color = palette.line.copy(alpha = if (palette.isDark) 0.5f else 0.7f).toArgb()
            canvas.drawRoundRect(card, radius, radius, stroke)
            // Light on the top lip, fading down: reads as a card with thickness.
            stroke.strokeWidth = px(0.75.dp)
            stroke.shader = LinearGradient(
                0f, card.top, 0f, card.top + card.height() / 2f,
                lip.toArgb(), Color.Transparent.toArgb(),
                Shader.TileMode.CLAMP,
            )
            canvas.drawRoundRect(card, radius, radius, stroke)
        }
        // The front card's shadow; the live Box covers everything inside it.
        drawShadow(canvas, front, radius, shadowPaint, px(2.dp))
        return bitmap
    }

    /** Where the live front card sits inside [deckBacks]: room for the backs above, shadows around. */
    val frontInset = Inset(
        start = shadowMargin,
        top = InboxWidgetDepthMetrics.rise * InboxWidgetDepthMetrics.backLayers.toFloat(),
        end = shadowMargin,
        bottom = shadowMargin,
    )

    data class Inset(val start: Dp, val top: Dp, val end: Dp, val bottom: Dp)

    private fun drawShadow(canvas: Canvas, card: RectF, radius: Float, paint: Paint, dy: Float) {
        val r = RectF(card.left, card.top + dy, card.right, card.bottom + dy)
        canvas.drawRoundRect(r, radius, radius, paint)
    }

    /**
     * The inbox-zero check disc, floating: a faint ink halo, a soft elliptical ground
     * shadow, and the frosted disc lifted above it. The check glyph is a live image on
     * top. The bitmap is the disc plus [pad] on every side.
     */
    fun floatingZeroMark(sizeDp: Float, pad: Dp, palette: WidgetPalette, density: Float): Bitmap {
        val scale = detailScale(density)
        val s = sizeDp * scale
        val p = pad.value * scale
        val side = max(1, (s + 2 * p).roundToInt())
        val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val cx = side / 2f
        val lift = zeroLift(sizeDp).value * scale
        val discCy = p + s / 2f - lift
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        // Halo: a radial ink wash past the disc edge, faded out inside the padding.
        // The disc is lifted, so the halo must end `lift` short of the bitmap's top edge.
        val haloRadius = min(s * 0.8f, s / 2f + p - lift)
        paint.shader = RadialGradient(
            cx, discCy, haloRadius,
            palette.ink.copy(alpha = 0.12f).toArgb(), palette.ink.copy(alpha = 0f).toArgb(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(cx, discCy, haloRadius, paint)

        // Ground shadow under the resting position.
        val gw = s * 0.78f
        val gh = s * 0.16f
        val gcy = p + s + s * 0.06f - gh / 2f
        paint.shader = RadialGradient(
            cx, gcy, gw / 2f,
            Color.Black.copy(alpha = if (palette.isDark) 0.55f else 0.16f).toArgb(), Color.Transparent.toArgb(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawOval(RectF(cx - gw / 2f, gcy - gh / 2f, cx + gw / 2f, gcy + gh / 2f), paint)

        // Frosted disc + white hairline.
        paint.shader = null
        paint.color = palette.frost.toArgb()
        canvas.drawCircle(cx, discCy, s / 2f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 0.5f * scale
        paint.color = Color.White.copy(alpha = if (palette.isDark) 0.14f else 0.7f).toArgb()
        canvas.drawCircle(cx, discCy, s / 2f - paint.strokeWidth / 2f, paint)
        return bitmap
    }

    /** How far the check floats above its ground shadow (8dp at 64dp, scaled). */
    fun zeroLift(sizeDp: Float): Dp = InboxWidgetDepthMetrics.floatHeight * (sizeDp / 64f)
}

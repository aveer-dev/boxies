package co.inboxies.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.AppToast
import co.inboxies.app.models.ToastAction
import co.inboxies.app.services.ComposeToast
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ToastMetrics
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import co.inboxies.app.ui.compose.rememberReduceMotion
import kotlinx.coroutines.launch

/** Leading glyph on a toast. */
enum class ToastIcon { None, Success, Error, Loading }

/** Default chrome spring — iOS `.spring(response: 0.32, dampingFraction: 0.86)`. */
private fun <T> toastSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

/** Slide + fade up from the bottom; fade only with animations off. */
fun toastEnterTransition(reduceMotion: Boolean): EnterTransition =
    if (reduceMotion) {
        fadeIn(toastSpring())
    } else {
        slideInVertically(toastSpring()) { it } + fadeIn(toastSpring())
    }

fun toastExitTransition(reduceMotion: Boolean): ExitTransition =
    if (reduceMotion) {
        fadeOut(toastSpring())
    } else {
        slideOutVertically(toastSpring()) { it } + fadeOut(toastSpring())
    }

/**
 * Shows [value]'s toast with the shared enter/exit motion and keeps the last one on
 * screen while it animates out.
 */
@Composable
fun <T : Any> AnimatedToast(
    value: T?,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    val reduceMotion = rememberReduceMotion()
    val last = remember { arrayOfNulls<Any>(1) }
    if (value != null) last[0] = value
    AnimatedVisibility(
        visible = value != null,
        modifier = modifier,
        enter = toastEnterTransition(reduceMotion),
        exit = toastExitTransition(reduceMotion),
        label = "toast",
    ) {
        @Suppress("UNCHECKED_CAST")
        (last[0] as T?)?.let { content(it) }
    }
}

/**
 * The app's one toast (AVE-134): a frosted-glass pill that floats above the bottom
 * chrome — message, optional leading icon, optional trailing action; swipe it down or
 * tap it to dismiss. Callers own auto-dismiss timing (`AppModel.showToast`) and place
 * it with [ToastMetrics]. Twins: iOS `InboxiesToast`, web Kumo toasts in `app/index.css`.
 */
@Composable
fun InboxiesToast(
    message: String,
    modifier: Modifier = Modifier,
    icon: ToastIcon = ToastIcon.None,
    iconVector: ImageVector? = null,
    action: ToastAction? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(ToastMetrics.cornerRadius)
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val dismissPx = with(density) { ToastMetrics.dismissDistance.toPx() }
    val dragY = remember { Animatable(0f) }

    Row(
        modifier = modifier
            .widthIn(max = ToastMetrics.maxWidth)
            .fillMaxWidth()
            .graphicsLayer {
                translationY = dragY.value
                alpha = 1f - (dragY.value.coerceAtLeast(0f) / (dismissPx * 3.3f)).coerceAtMost(0.6f)
            }
            .heightIn(min = ToastMetrics.minHeight)
            .liquidGlass(shape)
            .then(
                if (onDismiss != null) {
                    Modifier
                        .draggable(
                            orientation = Orientation.Vertical,
                            state = rememberDraggableState { delta ->
                                scope.launch {
                                    val next = dragY.value + if (delta < 0 && dragY.value <= 0f) delta / 4 else delta
                                    dragY.snapTo(next)
                                }
                            },
                            onDragStopped = { velocity ->
                                if (dragY.value > dismissPx || velocity > dismissPx * 20) {
                                    onDismiss()
                                } else {
                                    dragY.animateTo(0f, toastSpring())
                                }
                            },
                        )
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClickLabel = "Dismiss",
                            onClick = onDismiss,
                        )
                        .semantics {
                            customActions = listOf(
                                CustomAccessibilityAction("Dismiss") { onDismiss(); true },
                            )
                        }
                } else {
                    Modifier
                },
            )
            .padding(
                start = ToastMetrics.horizontalPadding,
                end = if (action == null) ToastMetrics.horizontalPadding else ToastMetrics.actionTrailingPadding,
                top = ToastMetrics.verticalPadding,
                bottom = ToastMetrics.verticalPadding,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(ToastMetrics.contentSpacing),
    ) {
        when {
            icon == ToastIcon.Loading -> CircularProgressIndicator(
                modifier = Modifier.size(ToastMetrics.iconSize),
                strokeWidth = 2.dp,
                color = colors.ink,
            )
            iconVector != null -> ToastGlyph(iconVector, colors.ink)
            icon == ToastIcon.Success -> ToastGlyph(Icons.Filled.CheckCircle, colors.ink)
            icon == ToastIcon.Error -> ToastGlyph(Icons.Filled.Error, colors.deepDarkRed)
            else -> Unit
        }

        Text(
            message,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 15.sp,
            lineHeight = 20.sp,
            color = colors.ink,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )

        if (action != null) {
            Box(
                modifier = Modifier
                    .heightIn(min = ToastMetrics.actionHeight)
                    .clip(CircleShape)
                    .background(if (action.ink) colors.ink.copy(alpha = 0.08f) else colors.accent.copy(alpha = 0.12f))
                    .clickable(role = Role.Button, onClick = action.onClick)
                    .padding(horizontal = ToastMetrics.actionHorizontalPadding),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    action.title,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = if (action.ink) colors.ink else colors.accent,
                )
            }
        }
    }
}

@Composable
private fun ToastGlyph(vector: ImageVector, tint: Color) {
    Icon(vector, contentDescription = null, tint = tint, modifier = Modifier.size(ToastMetrics.iconSize))
}

val AppToast.toastIcon: ToastIcon
    get() = when {
        isLoading -> ToastIcon.Loading
        isError -> ToastIcon.Error
        else -> ToastIcon.Success
    }

val ComposeToast.toastIcon: ToastIcon
    get() = if (isError) ToastIcon.Error else ToastIcon.Success

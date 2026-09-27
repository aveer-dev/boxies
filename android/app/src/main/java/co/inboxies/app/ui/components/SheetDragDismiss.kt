package co.inboxies.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableFloatState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Drag-from-top dismiss for full-screen overlays (compose / AI chat).
 * Uses distance + flick velocity — mirrors iOS `CoverDragDismiss`.
 */
@Composable
fun rememberSheetDragY(): MutableFloatState = remember { mutableFloatStateOf(0f) }

@Composable
fun Modifier.sheetDragToDismiss(
    dragY: MutableFloatState,
    enabled: Boolean = true,
    onDismiss: () -> Unit,
): Modifier {
    val density = LocalDensity.current
    val dismissDistancePx = with(density) { 96.dp.toPx() }
    val dismissVelocityPx = with(density) { 1100.dp.toPx() }
    val scope = rememberCoroutineScope()
    val anim = remember { Animatable(0f) }
    val dismissAction = rememberUpdatedState(onDismiss)

    val dragState = rememberDraggableState { delta ->
        if (!enabled) return@rememberDraggableState
        // Cancel an in-flight snap-back if the user grabs again.
        if (anim.isRunning) {
            scope.launch { anim.stop() }
        }
        dragY.floatValue = (dragY.floatValue + delta).coerceAtLeast(0f)
    }

    return this.draggable(
        state = dragState,
        orientation = Orientation.Vertical,
        enabled = enabled,
        onDragStopped = { velocity ->
            if (!enabled) {
                dragY.floatValue = 0f
                return@draggable
            }
            val flicked = velocity > dismissVelocityPx
            val draggedFar = dragY.floatValue > dismissDistancePx
            if (flicked || draggedFar) {
                dismissAction.value()
                dragY.floatValue = 0f
            } else {
                val from = dragY.floatValue
                scope.launch {
                    anim.snapTo(from)
                    anim.animateTo(
                        0f,
                        spring(
                            dampingRatio = 0.86f,
                            stiffness = Spring.StiffnessMediumLow,
                        ),
                    ) {
                        dragY.floatValue = value
                    }
                    dragY.floatValue = 0f
                }
            }
        },
    )
}

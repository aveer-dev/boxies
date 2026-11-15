package co.inboxies.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.dialog.Alert
import androidx.wear.compose.material.dialog.Dialog

/**
 * One watch screen: time at the top, a [ScalingLazyColumn] (Digital Crown / rotary
 * scrolling built in) with its position indicator, on the near-black background.
 */
@Composable
fun WatchListScreen(
    modifier: Modifier = Modifier,
    listState: ScalingLazyListState = rememberScalingLazyListState(),
    content: ScalingLazyListScope.() -> Unit,
) {
    Scaffold(
        modifier = modifier.background(WearColors.background),
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize().background(WearColors.background),
            state = listState,
            contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 28.dp, bottom = 36.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            content = content,
        )
    }
}

/** A screen title in the list's first slot. */
@Composable
fun WatchHeader(title: String, modifier: Modifier = Modifier) {
    ListHeader(modifier = modifier) {
        Text(title, style = WearType.title, color = WearColors.ink, textAlign = TextAlign.Center, maxLines = 2)
    }
}

/**
 * A yes / no question on Wear (`Alert` in a swipe-to-dismiss `Dialog`): x to back out,
 * check to go ahead. [destructive] tints the check red (Report spam), on `pillFill`,
 * never a red fill.
 */
@Composable
fun WatchConfirmDialog(
    show: Boolean,
    title: String,
    message: String,
    confirmLabel: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    icon: ImageVector? = null,
) {
    Dialog(showDialog = show, onDismissRequest = onDismiss) {
        Alert(
            icon = icon?.let {
                { Icon(it, contentDescription = null, tint = if (destructive) WearColors.destructive else WearColors.accent) }
            },
            title = {
                Text(title, style = WearType.title, color = WearColors.ink, textAlign = TextAlign.Center)
            },
            negativeButton = {
                Button(
                    onClick = onDismiss,
                    colors = ButtonDefaults.buttonColors(backgroundColor = WearColors.pillFill, contentColor = WearColors.ink),
                ) {
                    Icon(Icons.Outlined.Close, contentDescription = "Cancel")
                }
            },
            positiveButton = {
                Button(
                    onClick = onConfirm,
                    colors = ButtonDefaults.buttonColors(
                        backgroundColor = if (destructive) WearColors.pillFill else WearColors.accentWash,
                        contentColor = if (destructive) WearColors.destructive else WearColors.accent,
                    ),
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = confirmLabel)
                }
            },
            backgroundColor = WearColors.background,
        ) {
            Text(message, style = WearType.subject, color = WearColors.muted, textAlign = TextAlign.Center)
        }
    }
}

/** "Couldn't do that" with the reason, dismissed with a check or a swipe. */
@Composable
fun WatchErrorDialog(title: String, message: String?, onDismiss: () -> Unit) {
    Dialog(showDialog = message != null, onDismissRequest = onDismiss) {
        Alert(
            title = {
                Text(title, style = WearType.title, color = WearColors.ink, textAlign = TextAlign.Center)
            },
            message = {
                Text(message.orEmpty(), style = WearType.subject, color = WearColors.muted, textAlign = TextAlign.Center)
            },
            backgroundColor = WearColors.background,
        ) {
            item { WatchPill(label = "OK", onClick = onDismiss) }
        }
    }
}

/** Full-screen busy / done overlay over a screen. */
@Composable
fun WatchOverlay(content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(WearColors.background.copy(alpha = 0.92f)).padding(16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { content() }
    }
}

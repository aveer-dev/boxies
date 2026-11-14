package co.inboxies.app.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ToastAction
import co.inboxies.app.theme.ToastMetrics

/**
 * Where `AppModel.toast` is drawn. The phone reader is a `ModalBottomSheet` in its own
 * window, so a toast hosted by the home shell sits behind it (AVE-231). While that sheet
 * is up the reader hosts the toast instead; exactly one host shows it at a time.
 * Two-pane layouts keep the reader inline, so the home shell hosts it there.
 */
enum class AppToastHost {
    Home,
    ReaderSheet,
    ;

    companion object {
        fun forReader(readerSheetOpen: Boolean): AppToastHost =
            if (readerSheetOpen) ReaderSheet else Home
    }
}

/**
 * The app toast (`AppModel.toast`) with its Undo wiring. [visible] is false in a host
 * that isn't the current [AppToastHost], so the toast animates out there rather than
 * showing twice.
 */
@Composable
fun AppToastView(visible: Boolean, modifier: Modifier = Modifier) {
    val appModel = LocalAppModel.current
    val toast by appModel.toast.collectAsState()
    AnimatedToast(if (visible) toast else null, modifier = modifier) { current ->
        InboxiesToast(
            message = current.message,
            icon = current.toastIcon,
            iconVector = current.icon,
            action = if (current.isUndo) {
                ToastAction("Undo") { appModel.undoPendingAction() }
            } else {
                current.action
            },
            onDismiss = { appModel.hideToast() },
            modifier = Modifier
                .padding(horizontal = ToastMetrics.screenInset)
                .padding(bottom = ToastMetrics.barGap),
        )
    }
}

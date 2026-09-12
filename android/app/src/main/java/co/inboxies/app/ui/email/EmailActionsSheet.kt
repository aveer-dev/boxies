package co.inboxies.app.ui.email

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.Email
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun EmailActionsSheet(
    email: Email,
    onDismiss: () -> Unit,
    onDone: () -> Unit = onDismiss,
    onReplyAll: (() -> Unit)? = null,
    onForward: (() -> Unit)? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()

    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 32.dp)) {
        Text(
            "Actions",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            color = colors.ink,
        )
        ActionRow("Reply") {
            scope.launch { app.startCompose(ComposeMode.Reply, original = email); onDismiss() }
        }
        ActionRow("Reply All") {
            onReplyAll?.invoke() ?: scope.launch {
                app.startCompose(ComposeMode.ReplyAll, original = email)
            }
            onDismiss()
        }
        ActionRow("Forward") {
            onForward?.invoke() ?: scope.launch {
                app.startCompose(ComposeMode.Forward, original = email)
            }
            onDismiss()
        }
        HorizontalDivider(color = colors.line)
        ActionRow(if (email.read) "Mark unread" else "Mark read") {
            scope.launch { app.toggleRead(email); onDismiss() }
        }
        ActionRow(if (email.starred) "Unstar" else "Star") {
            scope.launch { app.toggleStar(email); onDismiss() }
        }
        ActionRow("Archive") {
            scope.launch { app.archiveEmail(email); onDone() }
        }
        ActionRow("Delete", destructive = true) {
            scope.launch { app.deleteEmail(email); onDone() }
        }
    }
}

@Composable
private fun ActionRow(label: String, destructive: Boolean = false, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Text(
        label,
        fontFamily = InterFontFamily,
        fontSize = 16.sp,
        color = if (destructive) colors.deepDarkRed else colors.ink,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
    )
}

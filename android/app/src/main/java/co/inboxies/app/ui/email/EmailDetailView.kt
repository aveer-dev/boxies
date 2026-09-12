package co.inboxies.app.ui.email

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Reply
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailDetailView(
    onClose: () -> Unit = {},
    onReply: (() -> Unit)? = null,
    onReplyAll: (() -> Unit)? = null,
    onForward: (() -> Unit)? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val email by app.selectedEmail.collectAsState()
    val thread by app.threadEmails.collectAsState()
    val loading by app.isEmailDetailLoading.collectAsState()
    var showActions by remember { mutableStateOf(false) }
    val current = email ?: return

    Column(modifier = Modifier.fillMaxSize().padding(bottom = 24.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = {
                app.closeEmail()
                onClose()
            }) {
                Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
            }
            Spacer(modifier = Modifier.weight(1f))
            IconButton(onClick = { scope.launch { app.toggleStar(current) } }) {
                Icon(
                    if (current.starred) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                    contentDescription = "Star",
                    tint = colors.ink,
                )
            }
            IconButton(onClick = { onReply?.invoke() }) {
                Icon(Icons.AutoMirrored.Outlined.Reply, contentDescription = "Reply", tint = colors.ink)
            }
            IconButton(onClick = {
                scope.launch {
                    app.archiveEmail(current)
                    onClose()
                }
            }) {
                Icon(Icons.Outlined.Archive, contentDescription = "Archive", tint = colors.ink)
            }
            IconButton(onClick = { showActions = true }) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "More", tint = colors.ink)
            }
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            Text(
                current.subject.ifBlank { "(no subject)" },
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                color = colors.ink,
            )
            Spacer(Modifier.height(12.dp))
            Text(current.displaySender, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Text("To ${current.recipient}", fontSize = 12.sp, color = colors.muted)
            Text(current.date, fontSize = 12.sp, color = colors.muted)
            Spacer(Modifier.height(16.dp))
            if (loading) {
                CircularProgressIndicator(color = colors.ink, modifier = Modifier.align(Alignment.CenterHorizontally))
            }
            (thread.ifEmpty { listOf(current) }).forEach { msg ->
                EmailBodyView(email = msg)
                Spacer(Modifier.height(16.dp))
            }
        }
    }

    if (showActions) {
        ModalBottomSheet(
            onDismissRequest = { showActions = false },
            sheetState = rememberModalBottomSheetState(),
        ) {
            EmailActionsSheet(
                email = current,
                onDismiss = { showActions = false },
                onDone = {
                    showActions = false
                    onClose()
                },
                onReplyAll = onReplyAll,
                onForward = onForward,
            )
        }
    }
}

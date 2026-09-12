package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import co.inboxies.app.models.MailAddress
import co.inboxies.app.services.ComposeSession
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun ComposeSheetView(
    session: ComposeSession,
    onMinimize: () -> Unit,
    onClose: () -> Unit,
    onSend: suspend () -> Unit,
    onSaveDraft: suspend () -> Unit,
) {
    val colors = inboxiesColors()
    val form = session.form
    val scope = rememberCoroutineScope()
    var toText by remember(form) { mutableStateOf(form.toJoined()) }
    var ccText by remember(form) { mutableStateOf(form.ccJoined()) }
    var subject by remember(form) { mutableStateOf(form.subject) }
    var body by remember(form) { mutableStateOf(form.bodyHtml) }
    var showCc by remember(form) { mutableStateOf(form.showCcBcc) }
    var sending by remember { mutableStateOf(false) }

    fun syncForm() {
        form.toTokens = MailAddress.parseList(toText)
        form.ccTokens = MailAddress.parseList(ccText)
        form.subject = subject
        form.bodyHtml = body
        form.showCcBcc = showCc
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding()
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { syncForm(); onMinimize() }) {
                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Minimize", tint = colors.ink)
            }
            Text(
                form.displayTitle,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = {
                syncForm()
                scope.launch { onSaveDraft() }
            }) { Text("Save", fontFamily = InterFontFamily) }
            Button(
                onClick = {
                    syncForm()
                    scope.launch {
                        sending = true
                        onSend()
                        sending = false
                    }
                },
                enabled = !sending && !form.isSending,
            ) {
                Text(if (sending || form.isSending) "Sending…" else "Send", fontFamily = InterFontFamily)
            }
            IconButton(onClick = onClose) {
                Icon(Icons.Default.Close, contentDescription = "Close", tint = colors.ink)
            }
        }
        Text(
            "From ${form.fromName ?: ""} <${form.fromEmail}>",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = toText,
            onValueChange = { toText = it },
            label = { Text("To") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        TextButton(onClick = { showCc = !showCc }) {
            Text(if (showCc) "Hide Cc/Bcc" else "Cc/Bcc", fontFamily = InterFontFamily, fontSize = 12.sp)
        }
        if (showCc) {
            OutlinedTextField(
                value = ccText,
                onValueChange = { ccText = it },
                label = { Text("Cc") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        OutlinedTextField(
            value = subject,
            onValueChange = { subject = it },
            label = { Text("Subject") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = body,
            onValueChange = { body = it },
            label = { Text("Message") },
            modifier = Modifier.fillMaxWidth().weight(1f),
        )
        form.errorMessage?.let {
            Text(it, color = colors.deepDarkRed, fontFamily = InterFontFamily, fontSize = 12.sp)
        }
    }
}

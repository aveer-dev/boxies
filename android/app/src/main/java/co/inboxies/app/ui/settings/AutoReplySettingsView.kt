package co.inboxies.app.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AutoReplySettings
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AutoReplySettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailbox = app.selectedMailbox
    var enabled by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.autoReply?.enabled == true)
    }
    var subject by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.autoReply?.subject.orEmpty())
    }
    var message by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.autoReply?.message.orEmpty())
    }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
            ) {
                HomeChromeToolbarButton(
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Text(
                    "Auto-reply",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier.weight(1f),
                )
                SettingsChromeTextButton(
                    label = "Save",
                    enabled = !isSaving && mailbox != null,
                    onClick = {
                        scope.launch {
                            val trimmed = message.trim()
                            if (enabled && trimmed.isEmpty()) {
                                saveMessage = "Enter an auto-reply message"
                                delay(2000)
                                saveMessage = null
                                return@launch
                            }
                            isSaving = true
                            val ok = app.updateMailboxSettings { settings ->
                                settings.copy(
                                    autoReply = AutoReplySettings(
                                        enabled = enabled,
                                        subject = subject.trim(),
                                        message = trimmed,
                                    ),
                                )
                            }
                            saveMessage = if (ok) "Auto-reply saved" else "Failed to save"
                            isSaving = false
                            delay(if (ok) 1200 else 2000)
                            saveMessage = null
                        }
                    },
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "When this is on, people who email this mailbox get one automatic reply. You still receive their message.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
                Text(
                    "Each sender gets at most one auto-reply every 24 hours. Mail from lists, bulk senders, no-reply addresses, and other automated systems is skipped so this cannot loop.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Send automatic replies",
                        fontFamily = InterFontFamily,
                        fontSize = 16.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = enabled,
                        onCheckedChange = { enabled = it },
                        colors = SwitchDefaults.colors(
                            checkedTrackColor = colors.accent,
                            checkedThumbColor = Color.White,
                        ),
                    )
                }
                OutlinedTextField(
                    value = subject,
                    onValueChange = { subject = it },
                    label = { Text("Subject") },
                    placeholder = { Text("Leave blank to use Re: original subject") },
                    singleLine = true,
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it },
                    label = { Text("Message") },
                    placeholder = { Text("Thanks for your email. I am away and will reply when I return.") },
                    enabled = enabled,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 160.dp),
                    shape = RoundedCornerShape(10.dp),
                )
                Spacer(Modifier.height(24.dp))
            }
        }

        AnimatedVisibility(
            visible = saveMessage != null,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
        ) {
            Text(
                saveMessage.orEmpty(),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = colors.ink,
                modifier = Modifier
                    .background(colors.pillFill, RoundedCornerShape(50))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
        }
    }
}

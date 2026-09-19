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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
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
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.ForwardingSettings
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ForwardingSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailbox = app.selectedMailbox
    var enabled by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.forwarding?.enabled == true)
    }
    var email by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.forwarding?.email.orEmpty())
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
                    "Forwarding",
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
                            val dest = email.trim()
                            if (enabled) {
                                if (dest.isEmpty() || !dest.contains("@")) {
                                    saveMessage = "Enter a valid forwarding address"
                                    delay(2000)
                                    saveMessage = null
                                    return@launch
                                }
                                if (dest.equals(mailbox?.email, ignoreCase = true)) {
                                    saveMessage = "Cannot forward to this mailbox"
                                    delay(2000)
                                    saveMessage = null
                                    return@launch
                                }
                            }
                            isSaving = true
                            val ok = app.updateMailboxSettings { settings ->
                                settings.copy(
                                    forwarding = ForwardingSettings(enabled = enabled, email = dest),
                                )
                            }
                            saveMessage = if (ok) "Forwarding saved" else "Failed to save"
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
                    .padding(bottom = 24.dp),
            ) {
                SettingsFormSectionHeader("Forwarding")
                SettingsFormGroup {
                    SettingsFormSwitchRow(
                        title = "Forward Incoming Mail",
                        checked = enabled,
                        onCheckedChange = { enabled = it },
                    )
                }
                SettingsFormFooter(
                    "When on, a copy of each incoming message is sent to another address. This mailbox still keeps the original.",
                )

                SettingsFormSectionHeader("Destination")
                SettingsFormGroup {
                    SettingsFormTextRow(
                        title = "Forward To",
                        value = email,
                        onValueChange = { email = it },
                        placeholder = "you@example.com",
                        enabled = enabled,
                    )
                }
                SettingsFormFooter(
                    "Must be a verified Email Routing destination in your Cloudflare account. Unverified addresses are skipped. Spam and messages already in a forwarding loop are not forwarded.",
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

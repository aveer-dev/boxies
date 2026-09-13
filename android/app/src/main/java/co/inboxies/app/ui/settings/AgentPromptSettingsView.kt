package co.inboxies.app.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun AgentPromptSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailbox = app.selectedMailbox
    var agentPrompt by remember(mailbox?.id) {
        mutableStateOf(mailbox?.settings?.agentSystemPrompt.orEmpty())
    }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }
    val isCustom = agentPrompt.trim().isNotEmpty()

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
                    "AI Prompt",
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
                            isSaving = true
                            val trimmed = agentPrompt.trim()
                            val ok = app.updateMailboxSettings { settings ->
                                settings.copy(agentSystemPrompt = trimmed.ifEmpty { null })
                            }
                            saveMessage = if (ok) "Prompt saved" else "Failed to save"
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
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        if (isCustom) "Custom" else "Default",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp,
                        color = colors.muted,
                        modifier = Modifier
                            .background(colors.pillFill, RoundedCornerShape(50))
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                    if (isCustom) {
                        TextButton(onClick = { agentPrompt = "" }) {
                            Text(
                                "Reset to default",
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.Medium,
                                fontSize = 12.sp,
                                color = colors.accent,
                            )
                        }
                    }
                }

                Text(
                    "Customize how the AI agent behaves for this mailbox. Leave empty to use the built-in default prompt.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )

                BasicTextField(
                    value = agentPrompt,
                    onValueChange = { agentPrompt = it },
                    textStyle = TextStyle(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = colors.ink,
                    ),
                    cursorBrush = SolidColor(colors.accent),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 220.dp)
                        .background(colors.surface, RoundedCornerShape(10.dp))
                        .border(1.dp, colors.line, RoundedCornerShape(10.dp))
                        .padding(10.dp),
                )

                Text(
                    "The prompt is sent as the system message to the AI model. It controls the agent's personality, writing style, and behavior rules.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
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

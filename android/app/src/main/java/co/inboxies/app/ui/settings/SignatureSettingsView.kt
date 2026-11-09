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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.SignatureSettings
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.util.ComposeHtml
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Per-mailbox signature (AVE-204). The web writes it with formatting and links;
 * here you switch it on or off and edit its words. Compose adds it to new mail,
 * replies and forwards ([ComposeHtml.signatureText]). Twin of iOS
 * `SignatureSettingsView`.
 */
@Composable
fun SignatureSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId by app.selectedMailboxId.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()
    val mailbox = mailboxes.firstOrNull { it.id == mailboxId }
    val settings = mailbox?.settings
    val savedHtml = settings?.signature?.html
    val savedWords = ComposeHtml.signatureWords(settings)

    var enabled by remember(mailbox?.id, settings?.signature) {
        mutableStateOf(ComposeHtml.signatureEnabled(settings))
    }
    var text by remember(mailbox?.id, savedWords) { mutableStateOf(savedWords) }
    var isSaving by remember { mutableStateOf(false) }
    var saveMessage by remember { mutableStateOf<String?>(null) }

    // Formatted on the web: editing the words here drops that formatting.
    val hasWebFormatting = !savedHtml.isNullOrBlank()
    val footer = buildString {
        append("Added under new mail, replies and forwards from this mailbox. Replies from a private email go without it. ")
        append(
            when {
                !hasWebFormatting -> "Add formatting and links in Settings on the web."
                text == savedWords ->
                    "This signature has formatting from the web. Changing the words here keeps links as addresses and removes the formatting."
                else -> "Saving replaces the web's formatting with these words. Links stay as addresses."
            },
        )
    }

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
                    "Signature",
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
                            val words = text.trim()
                            if (enabled && words.isEmpty()) {
                                saveMessage = "Write a signature or turn it off"
                                delay(2000)
                                saveMessage = null
                                return@launch
                            }
                            isSaving = true
                            // Unchanged words keep the web's HTML; new words replace it (the
                            // Worker replaces the whole signature object, so a null `html`,
                            // left out of the JSON, clears it).
                            val keepHtml = if (text == savedWords) savedHtml else null
                            val ok = app.updateMailboxSettings { current ->
                                current.copy(
                                    signature = SignatureSettings(
                                        enabled = enabled,
                                        text = words,
                                        html = keepHtml,
                                    ),
                                )
                            }
                            saveMessage = if (ok) "Signature saved" else "Failed to save"
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
                SettingsFormSectionHeader("Signature")
                SettingsFormGroup {
                    SettingsFormSwitchRow(
                        title = "Add a Signature",
                        checked = enabled,
                        onCheckedChange = { enabled = it },
                    )
                }

                Spacer(Modifier.height(12.dp))
                SettingsFormGroup {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
                            .padding(horizontal = 16.dp, vertical = 12.dp)
                            .heightIn(min = 120.dp),
                    ) {
                        if (text.isBlank()) {
                            Text(
                                "Your name, role, a link…",
                                fontFamily = InterFontFamily,
                                fontSize = 16.sp,
                                color = colors.muted.copy(alpha = 0.7f),
                            )
                        }
                        BasicTextField(
                            value = text,
                            onValueChange = { text = it },
                            enabled = enabled,
                            textStyle = TextStyle(
                                fontFamily = InterFontFamily,
                                fontSize = 16.sp,
                                color = colors.ink,
                            ),
                            cursorBrush = SolidColor(colors.accent),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 120.dp)
                                .semantics { contentDescription = "Signature" },
                        )
                    }
                }
                SettingsFormFooter(footer)

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

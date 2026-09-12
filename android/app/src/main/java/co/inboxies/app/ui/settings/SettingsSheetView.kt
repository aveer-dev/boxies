package co.inboxies.app.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors

private enum class SettingsPage { Root, Theme, Swipe, AgentPrompt }

@Composable
fun SettingsSheetView(
    onClose: () -> Unit,
    onThemeModeChange: (ThemeMode) -> Unit = {},
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    onSignOut: (() -> Unit)? = null,
) {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val mailbox by app.selectedMailboxId.collectAsState()
    val mailboxes by app.mailboxes.collectAsState()
    val current = mailboxes.firstOrNull { it.id == mailbox }
    var page by remember { mutableStateOf(SettingsPage.Root) }
    var selectedTheme by remember { mutableStateOf(themeMode) }

    Column(modifier = Modifier.fillMaxWidth().padding(bottom = 40.dp)) {
        when (page) {
            SettingsPage.Root -> {
                Text(
                    "Settings",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 22.sp,
                    modifier = Modifier.padding(20.dp),
                    color = colors.ink,
                )
                current?.let {
                    Text(it.email, modifier = Modifier.padding(horizontal = 20.dp), color = colors.muted, fontSize = 13.sp)
                }
                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp), color = colors.line)
                SettingsRow("Theme") { page = SettingsPage.Theme }
                SettingsRow("Swipe actions") { page = SettingsPage.Swipe }
                SettingsRow("Agent prompt") { page = SettingsPage.AgentPrompt }
                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp), color = colors.line)
                Text(
                    "Sign out",
                    color = colors.deepDarkRed,
                    fontFamily = InterFontFamily,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            if (onSignOut != null) {
                                onSignOut()
                            } else {
                                auth.signOut()
                                onClose()
                            }
                        }
                        .padding(20.dp),
                )
                TextButton(onClick = onClose, modifier = Modifier.padding(horizontal = 12.dp)) {
                    Text("Done", color = colors.accent)
                }
            }
            SettingsPage.Theme -> {
                TextButton(onClick = { page = SettingsPage.Root }) {
                    Text("← Back", color = colors.accent)
                }
                Text(
                    "Theme",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                ThemeMode.entries.forEach { mode ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                selectedTheme = mode
                                onThemeModeChange(mode)
                            }
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = selectedTheme == mode,
                            onClick = {
                                selectedTheme = mode
                                onThemeModeChange(mode)
                            },
                        )
                        Text(mode.label, fontFamily = InterFontFamily)
                    }
                }
            }
            SettingsPage.Swipe -> {
                TextButton(onClick = { page = SettingsPage.Root }) {
                    Text("← Back", color = colors.accent)
                }
                Text(
                    "Swipe actions",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.padding(20.dp),
                )
                Text(
                    "Configure left/right swipe actions for the email list. Coming soon.",
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
            SettingsPage.AgentPrompt -> {
                TextButton(onClick = { page = SettingsPage.Root }) {
                    Text("← Back", color = colors.accent)
                }
                Text(
                    "Agent prompt",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    modifier = Modifier.padding(20.dp),
                )
                Text(
                    current?.settings?.agentSystemPrompt?.takeIf { it.isNotBlank() }
                        ?: "No custom agent system prompt set for this mailbox.",
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
        }
    }
}

@Composable
private fun SettingsRow(title: String, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontFamily = InterFontFamily, modifier = Modifier.weight(1f), color = colors.ink)
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = colors.muted)
    }
}

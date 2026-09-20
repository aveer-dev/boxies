package co.inboxies.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.SenderPreference
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun SendersSettingsView(
    onBack: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId = app.selectedMailbox?.id

    var query by remember { mutableStateOf("") }
    var preferences by remember { mutableStateOf<List<SenderPreference>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var busyAddress by remember { mutableStateOf<String?>(null) }

    fun reload() {
        val id = mailboxId ?: return
        scope.launch {
            isLoading = preferences.isEmpty()
            errorMessage = null
            runCatching {
                ApiClient.shared.listSenderPreferences(id, q = query.trim())
            }.onSuccess {
                preferences = it
            }.onFailure {
                errorMessage = it.message ?: "Failed to load senders"
            }
            isLoading = false
        }
    }

    LaunchedEffect(mailboxId, query) {
        reload()
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                HomeChromeToolbarButton(
                    icon = Icons.AutoMirrored.Outlined.ArrowBack,
                    contentDescription = "Back",
                    onClick = onBack,
                )
                Text(
                    "Senders",
                    fontFamily = InterFontFamily,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = colors.ink,
                    modifier = Modifier.padding(start = 4.dp),
                )
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Choose which purpose box each sender goes to. Changing a destination also moves their existing Inbox, Promotions, and Updates mail.",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )

                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("Search senders") },
                )

                when {
                    isLoading -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 24.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(
                                color = colors.accent,
                                modifier = Modifier.size(24.dp),
                                strokeWidth = 2.dp,
                            )
                        }
                    }
                    errorMessage != null -> {
                        Text(
                            errorMessage!!,
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.deepDarkRed,
                        )
                    }
                    preferences.isEmpty() -> {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                "No sender defaults yet",
                                fontFamily = InterFontFamily,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                                color = colors.ink,
                            )
                            Text(
                                "When you move mail into Inbox, Promotions, or Updates, you can set where future mail from that sender goes.",
                                fontFamily = InterFontFamily,
                                fontSize = 13.sp,
                                color = colors.muted,
                            )
                        }
                    }
                    else -> {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(colors.surface, RoundedCornerShape(12.dp)),
                        ) {
                            preferences.forEachIndexed { index, pref ->
                                SenderPreferenceRow(
                                    preference = pref,
                                    busy = busyAddress == pref.address,
                                    onChangeFolder = { folderId ->
                                        val id = mailboxId ?: return@SenderPreferenceRow
                                        busyAddress = pref.address
                                        scope.launch {
                                            runCatching {
                                                ApiClient.shared.upsertSenderPreference(
                                                    id,
                                                    pref.address,
                                                    folderId,
                                                    displayName = pref.displayName,
                                                    refile = true,
                                                )
                                            }.onSuccess {
                                                reload()
                                            }.onFailure {
                                                errorMessage = it.message
                                            }
                                            busyAddress = null
                                        }
                                    },
                                    onDelete = {
                                        val id = mailboxId ?: return@SenderPreferenceRow
                                        busyAddress = pref.address
                                        scope.launch {
                                            runCatching {
                                                ApiClient.shared.deleteSenderPreference(id, pref.address)
                                            }.onSuccess {
                                                preferences = preferences.filterNot { it.address == pref.address }
                                            }.onFailure {
                                                errorMessage = it.message
                                            }
                                            busyAddress = null
                                        }
                                    },
                                )
                                if (index != preferences.lastIndex) {
                                    Spacer(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(1.dp)
                                            .background(colors.line),
                                    )
                                }
                            }
                        }
                    }
                }

                Text(
                    "Filters still override these defaults when a rule matches. Spam is never routed by sender preference.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun SenderPreferenceRow(
    preference: SenderPreference,
    busy: Boolean,
    onChangeFolder: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val colors = inboxiesColors()
    var menuOpen by remember { mutableStateOf(false) }
    val title = preference.displayName?.takeIf { it.isNotBlank() } ?: preference.address

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (!preference.displayName.isNullOrBlank()) {
                Text(
                    preference.address,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Box {
            Text(
                FolderIds.purposeDisplayName(preference.folderId),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = colors.accent,
                modifier = Modifier
                    .clickable(enabled = !busy) { menuOpen = true }
                    .padding(vertical = 4.dp, horizontal = 4.dp),
            )
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                FolderIds.purposeFolderIds.forEach { folderId ->
                    DropdownMenuItem(
                        text = { Text(FolderIds.purposeDisplayName(folderId)) },
                        onClick = {
                            menuOpen = false
                            onChangeFolder(folderId)
                        },
                    )
                }
            }
        }

        Icon(
            Icons.Outlined.Delete,
            contentDescription = "Remove",
            tint = colors.muted,
            modifier = Modifier
                .size(18.dp)
                .clickable(enabled = !busy, onClick = onDelete),
        )
    }
}

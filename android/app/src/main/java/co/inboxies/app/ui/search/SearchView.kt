package co.inboxies.app.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import co.inboxies.app.models.Email
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SearchView(
    onClose: () -> Unit,
    onAskAi: (() -> Unit)? = null,
    onOpenEmail: ((Email) -> Unit)? = null,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Email>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var searchJob by remember { mutableStateOf<Job?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(top = 8.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { value ->
                    query = value
                    searchJob?.cancel()
                    searchJob = scope.launch {
                        delay(300)
                        val mailboxId = app.selectedMailboxId.value ?: return@launch
                        if (value.isBlank()) {
                            results = emptyList()
                            return@launch
                        }
                        loading = true
                        results = runCatching {
                            ApiClient.shared.searchEmails(mailboxId, value).emails
                        }.getOrElse { emptyList() }
                        loading = false
                    }
                },
                modifier = Modifier.weight(1f),
                singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("Search mail") },
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
            }
        }
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(24.dp),
                color = colors.ink,
            )
        }
        LazyColumn(modifier = Modifier.fillMaxSize()) {
            items(results, key = { it.id }) { email ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            scope.launch {
                                if (onOpenEmail != null) onOpenEmail(email)
                                else app.openEmail(email)
                                onClose()
                            }
                        }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                ) {
                    Text(email.displaySender, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, color = colors.ink)
                    Text(email.subject, fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.ink)
                    Text(email.previewText, fontSize = 12.sp, color = colors.muted, maxLines = 2)
                }
            }
        }
    }
}

package co.inboxies.app.ui.auth

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.InvitePublic
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun InviteAcceptView(
    token: String,
    onDone: () -> Unit,
) {
    val auth = LocalAuthStore.current
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var invite by remember { mutableStateOf<InvitePublic?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(token) {
        runCatching { ApiClient.shared.getInvite(token) }
            .onSuccess { invite = it }
            .onFailure { loadError = it.message }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        TextButton(onClick = onDone) {
            Text("Cancel", color = colors.muted, fontFamily = InterFontFamily)
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Accept invite",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            color = colors.ink,
        )
        when {
            loadError != null -> Text(loadError!!, color = colors.deepDarkRed, modifier = Modifier.padding(top = 12.dp))
            invite == null -> CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            else -> {
                Text(
                    "Set a password for ${invite!!.mailboxId}",
                    color = colors.muted,
                    fontFamily = InterFontFamily,
                    modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Display name (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = confirm,
                    onValueChange = { confirm = it },
                    label = { Text("Confirm password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                formError?.let {
                    Text(it, color = colors.deepDarkRed, modifier = Modifier.padding(top = 8.dp))
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        scope.launch {
                            formError = null
                            if (password != confirm) {
                                formError = "Passwords do not match"
                                return@launch
                            }
                            if (password.length < 10) {
                                formError = "Password must be at least 10 characters"
                                return@launch
                            }
                            submitting = true
                            try {
                                val result = ApiClient.shared.acceptInvite(
                                    token,
                                    password,
                                    displayName.ifBlank { null },
                                )
                                auth.applySession(result.token, result.mailboxId)
                                app.bootstrap(result.token)
                                onDone()
                            } catch (e: Exception) {
                                formError = e.message
                            } finally {
                                submitting = false
                            }
                        }
                    },
                    enabled = !submitting && password.length >= 10,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (submitting) CircularProgressIndicator()
                    else Text("Create account", fontFamily = InterFontFamily)
                }
            }
        }
    }
}

@Composable
fun MailboxOnboardingView() {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val isAdmin by app.isAdmin.collectAsState()
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var adminRows by remember { mutableStateOf<List<AdminMailboxRow>>(emptyList()) }
    var loadingAdmin by remember { mutableStateOf(false) }
    var assigningId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(isAdmin) {
        if (!isAdmin) return@LaunchedEffect
        loadingAdmin = true
        adminRows = runCatching { ApiClient.shared.listAdminMailboxes() }.getOrDefault(emptyList())
        loadingAdmin = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
    ) {
        TextButton(onClick = { auth.signOut() }) {
            Text("Sign out", color = colors.deepDarkRed, fontFamily = InterFontFamily)
        }
        Spacer(Modifier.height(24.dp))
        if (isAdmin) {
            Text(
                "Domain Admin",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = colors.ink,
            )
            Text(
                if (adminRows.isEmpty()) {
                    "No mailboxes assigned to you yet. Assign an existing domain mailbox, or create one on the web Admin console."
                } else {
                    "Assign a domain mailbox to yourself to start using Inboxies."
                },
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                color = colors.muted,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
            )
            if (loadingAdmin) {
                CircularProgressIndicator()
            } else {
                adminRows.forEach { row ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                    ) {
                        Column(Modifier = Modifier.weight(1f)) {
                            Text(row.email, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, color = colors.ink)
                            Text(
                                if (row.claimed) "Claimed" else "Unclaimed",
                                color = colors.muted,
                                fontSize = 12.sp,
                            )
                        }
                        TextButton(
                            onClick = {
                                scope.launch {
                                    assigningId = row.id
                                    runCatching {
                                        ApiClient.shared.assignAdminMailboxToSelf(row.id)
                                        app.refreshMailboxes(showLoading = true)
                                    }
                                    assigningId = null
                                }
                            },
                            enabled = assigningId == null,
                        ) {
                            Text("Assign to me", color = colors.accent, fontFamily = InterFontFamily)
                        }
                    }
                }
            }
        } else {
            Text(
                "Welcome to Inboxies",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 24.sp,
                color = colors.ink,
            )
            Text(
                "Create your first email address to start using the platform.",
                fontFamily = InterFontFamily,
                fontSize = 15.sp,
                color = colors.muted,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Full Name") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            Spacer(Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it.substringBefore('@') },
                    label = { Text("Username") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                Text(
                    "@inboxies.email",
                    color = colors.muted,
                    modifier = Modifier.padding(start = 8.dp, top = 20.dp),
                )
            }
            Text(
                "This will be your primary email address.",
                color = colors.muted,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 8.dp),
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    scope.launch {
                        creating = true
                        app.createMailbox(name, "$username@inboxies.email")
                        creating = false
                    }
                },
                enabled = name.isNotBlank() && username.isNotBlank() && !creating,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (creating) CircularProgressIndicator()
                else Text("Create Email", fontFamily = InterFontFamily)
            }
        }
    }
}

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
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun MailboxOnboardingView() {
    val app = LocalAppModel.current
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }

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
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            if (creating) CircularProgressIndicator()
            else Text("Create Email", fontFamily = InterFontFamily)
        }
    }
}

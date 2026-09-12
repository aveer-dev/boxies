package co.inboxies.app.ui.auth

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.config.AppConfig
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

@Composable
fun SignInView() {
    val auth = LocalAuthStore.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val isBusy by auth.isBusy.collectAsState()
    val error by auth.errorMessage.collectAsState()
    var apiBase by remember { mutableStateOf(AppConfig.apiBaseURL) }
    val showDevLogin = BuildConfig.DEBUG && AppConfig.isLocalDevelopmentAPI

    fun commitApiBase() {
        val parsed = AppConfig.parseAPIBaseURL(apiBase.trim())
        if (parsed != null) {
            apiBase = parsed
            AppConfig.apiBaseURL = parsed
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.linearGradient(listOf(Color(0xFFF5F7FC), Color(0xFFEBEFF6))))
            .statusBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Outlined.Email,
                contentDescription = null,
                tint = colors.ink,
                modifier = Modifier.height(48.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                "Inboxies",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 34.sp,
                color = colors.ink,
            )
            Text(
                "Your email, with an AI agent that drafts — you send.",
                fontFamily = InterFontFamily,
                fontSize = 16.sp,
                color = colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp, bottom = 28.dp),
            )

            Button(
                onClick = {
                    scope.launch {
                        commitApiBase()
                        try {
                            val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
                            if (webClientId.isBlank()) {
                                auth.clearError()
                                return@launch
                            }
                            val googleIdOption = GetGoogleIdOption.Builder()
                                .setFilterByAuthorizedAccounts(false)
                                .setServerClientId(webClientId)
                                .build()
                            val request = GetCredentialRequest.Builder()
                                .addCredentialOption(googleIdOption)
                                .build()
                            val activity = context as Activity
                            val result = CredentialManager.create(context)
                                .getCredential(activity, request)
                            val credential = result.credential
                            if (credential is CustomCredential &&
                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                            ) {
                                val google = GoogleIdTokenCredential.createFrom(credential.data)
                                auth.signInWithGoogle(google.idToken)
                            }
                        } catch (_: Exception) {
                            // AuthStore surfaces API errors; Dev Login remains available locally.
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = colors.ink, contentColor = Color.White),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Continue with Google", fontFamily = InterFontFamily, fontWeight = FontWeight.Medium)
            }

            if (showDevLogin) {
                Spacer(Modifier.height(12.dp))
                TextButton(
                    onClick = {
                        scope.launch {
                            commitApiBase()
                            auth.signInDev()
                        }
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .background(colors.pillFill, RoundedCornerShape(12.dp)),
                ) {
                    Text("Continue with Dev Login", fontFamily = InterFontFamily, color = colors.ink)
                }
            }

            if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank() && !showDevLogin) {
                Text(
                    "Set GOOGLE_WEB_CLIENT_ID in local.properties, or point API base to 10.0.2.2:5173 for Dev Login.",
                    color = colors.muted,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }

            if (isBusy) {
                Spacer(Modifier.height(16.dp))
                CircularProgressIndicator(color = colors.ink)
            }
            error?.let {
                Text(it, color = Color.Red, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp))
            }

            Spacer(Modifier.weight(1f))

            Text(
                "API base URL",
                color = colors.muted,
                fontSize = 12.sp,
                fontFamily = InterFontFamily,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = apiBase,
                onValueChange = {
                    apiBase = it
                    AppConfig.parseAPIBaseURL(it)?.let { parsed -> AppConfig.apiBaseURL = parsed }
                },
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 6.dp),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp),
            )
            Text(
                "Emulator → http://10.0.2.2:5173 · bare domains get https://",
                color = colors.muted,
                fontSize = 11.sp,
                modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp),
            )
        }
    }
}

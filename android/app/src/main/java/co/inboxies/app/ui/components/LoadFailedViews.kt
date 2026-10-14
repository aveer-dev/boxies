package co.inboxies.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

/** Default copy when a load failed without a useful message. */
const val LOAD_FAILED_FALLBACK_MESSAGE = "Check your connection and try again."

/**
 * Calm error with Retry, shared by the mailbox gate and empty email lists (iOS
 * `LoadFailedContent`): muted offline icon, title, message, ink pill Retry, then [extra].
 */
@Composable
fun LoadFailedContent(
    title: String,
    message: String?,
    isRetrying: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    extra: @Composable ColumnScope.() -> Unit = {},
) {
    val colors = inboxiesColors()
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Outlined.WifiOff,
            contentDescription = null,
            tint = colors.muted,
            modifier = Modifier.size(40.dp),
        )
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 17.sp,
            color = colors.ink,
            textAlign = TextAlign.Center,
        )
        Text(
            message?.takeIf { it.isNotBlank() } ?: LOAD_FAILED_FALLBACK_MESSAGE,
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        Button(
            onClick = onRetry,
            enabled = !isRetrying,
            shape = RoundedCornerShape(50),
            contentPadding = PaddingValues(horizontal = 24.dp, vertical = 10.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = colors.ink,
                contentColor = colors.background,
                disabledContainerColor = colors.ink.copy(alpha = 0.6f),
                disabledContentColor = colors.background,
            ),
            modifier = Modifier.widthIn(min = 96.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isRetrying) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp,
                        color = colors.background,
                    )
                    Spacer(Modifier.size(6.dp))
                }
                Text("Retry", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            }
        }
        extra()
    }
}

/**
 * Signed in, but the first mailbox request failed and nothing is cached. Never
 * onboarding: the account may well have mailboxes we just couldn't reach.
 */
@Composable
fun MailboxLoadFailedView(appModel: AppModel, auth: AuthStore) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val errorMessage by appModel.errorMessage.collectAsState()
    var isRetrying by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.Center,
    ) {
        LoadFailedContent(
            title = "Couldn’t load your mailboxes",
            message = errorMessage,
            isRetrying = isRetrying,
            onRetry = {
                if (!isRetrying) {
                    isRetrying = true
                    scope.launch {
                        try {
                            appModel.refreshMailboxes(showLoading = true)
                        } finally {
                            isRetrying = false
                        }
                    }
                }
            },
        ) {
            TextButton(onClick = { appModel.signOut(auth) }) {
                Text(
                    "Sign out",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = colors.muted,
                )
            }
        }
    }
}

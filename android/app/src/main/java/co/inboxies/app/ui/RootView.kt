package co.inboxies.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.auth.MailboxOnboardingView
import co.inboxies.app.ui.auth.SignInView
import co.inboxies.app.ui.home.HomeShellView

@Composable
fun RootView(
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    val token by auth.token.collectAsState()
    val isAuthenticated = !token.isNullOrBlank()
    val mailboxes by appModel.mailboxes.collectAsState()
    val isMailboxLoading by appModel.isMailboxLoading.collectAsState()
    val colors = inboxiesColors()

    LaunchedEffect(token) {
        if (!token.isNullOrBlank()) {
            appModel.bootstrap(token)
        } else {
            appModel.reset()
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
        AnimatedContent(
            targetState = when {
                !isAuthenticated -> "sign_in"
                !isMailboxLoading && mailboxes.isEmpty() -> "onboarding"
                else -> "home"
            },
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "root",
        ) { state ->
            when (state) {
                "sign_in" -> SignInView()
                "onboarding" -> MailboxOnboardingView()
                else -> HomeShellView(
                    auth = auth,
                    appModel = appModel,
                    themeMode = themeMode,
                    onThemeModeChange = onThemeModeChange,
                )
            }
        }
    }
}

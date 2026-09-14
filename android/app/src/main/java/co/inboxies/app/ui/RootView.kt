package co.inboxies.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import co.inboxies.app.LocalAppModel
import co.inboxies.app.LocalAuthStore
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.PushNotificationManager
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InboxiesTheme
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

    LaunchedEffect(token) {
        if (!token.isNullOrBlank()) {
            appModel.bootstrap(token)
        } else {
            appModel.reset()
        }
    }

    val pendingDeepLink by PushNotificationManager.shared.pendingDeepLink.collectAsState()
    LaunchedEffect(pendingDeepLink, isAuthenticated, isMailboxLoading, mailboxes) {
        val link = pendingDeepLink ?: return@LaunchedEffect
        if (!isAuthenticated || isMailboxLoading || mailboxes.isEmpty()) return@LaunchedEffect
        PushNotificationManager.shared.clearPendingDeepLink()
        appModel.openEmailFromNotification(link.mailboxId, link.emailId, link.folderId)
    }

    RootViewContent(
        isAuthenticated = isAuthenticated,
        isMailboxLoading = isMailboxLoading,
        hasMailboxes = mailboxes.isNotEmpty(),
        auth = auth,
        appModel = appModel,
        themeMode = themeMode,
        onThemeModeChange = onThemeModeChange,
    )
}

@Composable
private fun RootViewContent(
    isAuthenticated: Boolean,
    isMailboxLoading: Boolean,
    hasMailboxes: Boolean,
    auth: AuthStore,
    appModel: AppModel,
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
) {
    val colors = inboxiesColors()

    Surface(modifier = Modifier.fillMaxSize(), color = colors.background) {
        AnimatedContent(
            targetState = when {
                !isAuthenticated -> "sign_in"
                !isMailboxLoading && !hasMailboxes -> "onboarding"
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

@Preview(showBackground = true, name = "Sign In")
@Composable
fun RootViewSignInPreview() {
    val context = LocalContext.current
    val auth = remember { AuthStore(context) }
    val model = remember { AppModel() }
    InboxiesTheme {
        CompositionLocalProvider(
            LocalAuthStore provides auth,
            LocalAppModel provides model,
        ) {
            RootViewContent(
                isAuthenticated = false,
                isMailboxLoading = false,
                hasMailboxes = false,
                auth = auth,
                appModel = model,
                themeMode = ThemeMode.LIGHT,
                onThemeModeChange = {},
            )
        }
    }
}

@Preview(showBackground = true, name = "Onboarding")
@Composable
fun RootViewOnboardingPreview() {
    val context = LocalContext.current
    val auth = remember { AuthStore(context) }
    val model = remember { AppModel() }
    InboxiesTheme {
        CompositionLocalProvider(
            LocalAuthStore provides auth,
            LocalAppModel provides model,
        ) {
            RootViewContent(
                isAuthenticated = true,
                isMailboxLoading = false,
                hasMailboxes = false,
                auth = auth,
                appModel = model,
                themeMode = ThemeMode.LIGHT,
                onThemeModeChange = {},
            )
        }
    }
}

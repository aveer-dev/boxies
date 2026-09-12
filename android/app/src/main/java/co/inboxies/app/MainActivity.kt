package co.inboxies.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.view.WindowCompat
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.ui.RootView

val LocalAuthStore = staticCompositionLocalOf<AuthStore> { error("AuthStore missing") }
val LocalAppModel = staticCompositionLocalOf<AppModel> { error("AppModel missing") }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val auth = (application as InboxiesApplication).authStore
        val model = AppModel()
        setContent {
            var themeMode by remember {
                mutableStateOf(
                    ThemeMode.fromStorage(
                        getSharedPreferences("inboxies_prefs", MODE_PRIVATE)
                            .getString("app_theme", null),
                    ),
                )
            }
            InboxiesTheme(themeMode = themeMode) {
                CompositionLocalProvider(
                    LocalAuthStore provides auth,
                    LocalAppModel provides model,
                ) {
                    RootView(
                        auth = auth,
                        appModel = model,
                        themeMode = themeMode,
                        onThemeModeChange = { mode ->
                            themeMode = mode
                            getSharedPreferences("inboxies_prefs", MODE_PRIVATE)
                                .edit()
                                .putString("app_theme", mode.name)
                                .apply()
                        },
                    )
                }
            }
        }
    }
}

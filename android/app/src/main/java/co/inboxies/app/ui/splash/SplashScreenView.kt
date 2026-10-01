package co.inboxies.app.ui.splash

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.R
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors

/**
 * App splash screen displaying only the app logo.
 * Design twin of iOS SplashScreenView.
 */
@Composable
fun SplashScreenView(
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(id = R.drawable.ic_inboxies_logo),
            contentDescription = "Inboxies Logo",
            tint = colors.ink,
            modifier = Modifier.size(72.dp),
        )
    }
}

@Preview(name = "Splash Screen - Light", showBackground = true)
@Composable
fun SplashScreenPreviewLight() {
    InboxiesTheme(themeMode = ThemeMode.LIGHT) {
        SplashScreenView()
    }
}

@Preview(name = "Splash Screen - Dark", showBackground = true)
@Composable
fun SplashScreenPreviewDark() {
    InboxiesTheme(themeMode = ThemeMode.DARK) {
        SplashScreenView()
    }
}

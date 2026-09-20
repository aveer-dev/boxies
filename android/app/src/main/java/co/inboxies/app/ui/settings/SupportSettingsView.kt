package co.inboxies.app.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.BuildConfig
import co.inboxies.app.LocalAppModel
import co.inboxies.app.config.AppConfig
import co.inboxies.app.models.ComposeMode
import co.inboxies.app.models.MailAddress
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

@Composable
fun SupportSettingsView(
    onBack: () -> Unit,
    onCloseSettings: () -> Unit,
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val mailDomain by app.mailDomain.collectAsState()
    val versionLabel = "Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    fun openUrl(url: String) {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }

    fun openPlayStore() {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=co.inboxies.app"))
        val web = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://play.google.com/store/apps/details?id=co.inboxies.app"),
        )
        runCatching { context.startActivity(market) }.onFailure {
            runCatching { context.startActivity(web) }
        }
    }

    fun composeToSupport(name: String) {
        onCloseSettings()
        scope.launch {
            app.startCompose(
                mode = ComposeMode.New,
                initialTo = listOf(MailAddress(name = name, email = "support@$mailDomain")),
            )
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.toolbarControlSpacing),
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Text(
                "Support & feedback",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
        ) {
            SettingsSectionHeader("Help & Support")
            SettingsActionRow(
                title = "Help Center",
                icon = Icons.AutoMirrored.Outlined.MenuBook,
                onClick = { openUrl("${AppConfig.apiBaseURL.trimEnd('/')}/help") },
            )
            SettingsActionRow(
                title = "Contact Support",
                icon = Icons.Outlined.Email,
                onClick = { composeToSupport("Inboxies Support") },
            )
            SettingsActionRow(
                title = "Send Feedback",
                icon = Icons.Outlined.Lightbulb,
                onClick = { composeToSupport("Inboxies Feedback") },
            )

            SettingsSectionHeader("Community")
            SettingsActionRow(
                title = "Rate on Play Store",
                icon = Icons.Outlined.Star,
                onClick = { openPlayStore() },
            )
            SettingsActionRow(
                title = "Follow @inboxies_app",
                icon = Icons.Outlined.AlternateEmail,
                onClick = { openUrl("https://x.com/inboxies_app") },
            )

            Text(
                versionLabel,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 28.dp, bottom = 40.dp),
            )
        }
    }
}

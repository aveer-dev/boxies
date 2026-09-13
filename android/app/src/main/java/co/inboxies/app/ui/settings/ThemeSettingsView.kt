package co.inboxies.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors

@Composable
fun ThemeSettingsView(
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
    onBack: () -> Unit,
) {
    val colors = inboxiesColors()
    var selected by remember(themeMode) { mutableStateOf(themeMode) }

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
                "Theme",
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
                .padding(horizontal = 16.dp)
                .padding(top = 8.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(colors.surface),
        ) {
            ThemeMode.entries.forEachIndexed { index, mode ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            selected = mode
                            onThemeModeChange(mode)
                        }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        mode.label,
                        fontFamily = InterFontFamily,
                        fontSize = 15.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    if (selected == mode) {
                        Icon(
                            Icons.Outlined.Check,
                            contentDescription = null,
                            tint = colors.accent,
                        )
                    }
                }
                if (index < ThemeMode.entries.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(start = 16.dp),
                        color = colors.line,
                    )
                }
            }
        }

        Text(
            "Select System to automatically switch between Light and Dark mode based on your device settings.",
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
        )
        Spacer(Modifier.height(24.dp))
    }
}

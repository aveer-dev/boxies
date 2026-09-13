package co.inboxies.app.ui.settings

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.homeChromeToolbarSurface
import co.inboxies.app.theme.inboxiesColors

internal fun <T> settingsNavSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

@Composable
internal fun SettingsSectionHeader(title: String) {
    val colors = inboxiesColors()
    Text(
        title.uppercase(),
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        color = colors.muted,
        letterSpacing = 0.4.sp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 20.dp, bottom = 8.dp),
    )
}

@Composable
internal fun SettingsNavRow(
    title: String,
    icon: ImageVector,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = colors.ink,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            title,
            fontFamily = InterFontFamily,
            fontSize = 16.sp,
            color = colors.ink,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.muted.copy(alpha = 0.55f),
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
internal fun SettingsToggleRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = colors.ink,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, fontFamily = InterFontFamily, fontSize = 16.sp, color = colors.ink)
            Text(
                subtitle,
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = colors.accent,
                checkedThumbColor = Color.White,
            ),
        )
    }
}

@Composable
internal fun SettingsActionRow(
    title: String,
    icon: ImageVector,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = colors.ink,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            title,
            fontFamily = InterFontFamily,
            fontSize = 16.sp,
            color = colors.ink,
            modifier = Modifier.weight(1f),
        )
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = colors.muted.copy(alpha = 0.55f),
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
internal fun SettingsChromeTextButton(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .height(HomeChromeMetrics.toolbarControlSize)
            .graphicsLayer { alpha = if (enabled) 1f else 0.45f }
            .homeChromeToolbarSurface(
                RoundedCornerShape(HomeChromeMetrics.toolbarControlCornerRadius),
            )
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            color = colors.ink,
        )
    }
}

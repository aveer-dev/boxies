package co.inboxies.app.ui.widget

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.homeChromeToolbarSurface
import co.inboxies.app.theme.inboxiesColors

/**
 * DEBUG gallery of every widget mock state at real size (AVE-138 design review).
 * `./scripts/run-debug-preview.sh widgets`. The Light / Dark pill flips only this
 * screen (the saved app theme is untouched). iOS twin: `-previewWidgets`.
 */
@Composable
fun InboxWidgetGallery() {
    val startsDark = inboxiesColors().isDark
    var dark by remember { mutableStateOf(startsDark) }
    InboxiesTheme(themeMode = if (dark) ThemeMode.DARK else ThemeMode.LIGHT) {
        val colors = inboxiesColors()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.background)
                .statusBarsPadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        "Today's inbox",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        fontSize = 22.sp,
                        color = colors.ink,
                    )
                    Text(
                        "Widget design mocks · 2×2 and 4×2",
                        fontFamily = InterFontFamily,
                        fontSize = AppThemeDims.FontSize.homeSubtitle,
                        color = colors.muted,
                    )
                }
                Box(
                    modifier = Modifier
                        .homeChromeToolbarSurface(RoundedCornerShape(50))
                        .clickable { dark = !dark }
                        .padding(horizontal = 14.dp)
                        .height(34.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (dark) "Dark" else "Light",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = colors.ink,
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Labeled("2×2 · new mail") {
                    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleHasMail, Modifier.galleryLift())
                }
                Labeled("2×2 · inbox zero") {
                    InboxWidgetMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleInboxZero, Modifier.galleryLift())
                }
            }
            Labeled("4×2 · new mail") {
                InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleHasMail, Modifier.galleryLift())
            }
            Labeled("4×2 · inbox zero") {
                InboxWidgetMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleInboxZero, Modifier.galleryLift())
            }
        }
    }
}

private fun Modifier.galleryLift(): Modifier = shadow(
    elevation = 10.dp,
    shape = RoundedCornerShape(InboxWidgetMetrics.cornerRadius),
    ambientColor = Color.Black.copy(alpha = 0.06f),
    spotColor = Color.Black.copy(alpha = 0.08f),
)

@Composable
private fun Labeled(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = AppThemeDims.List.sectionHeader,
            letterSpacing = AppThemeDims.List.tracking,
            color = inboxiesColors().muted,
        )
        content()
    }
}

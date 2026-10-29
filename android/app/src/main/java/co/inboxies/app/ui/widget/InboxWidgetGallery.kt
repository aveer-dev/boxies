package co.inboxies.app.ui.widget

import androidx.compose.foundation.background
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.launch
import kotlin.math.sqrt
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
    var smallFront by remember { mutableIntStateOf(0) }
    var mediumFront by remember { mutableIntStateOf(0) }
    var inspectorFront by remember { mutableIntStateOf(1) }
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
                        "Widget design mocks · round 2: depth",
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
            SectionTitle("Depth", "Tap › to flip through New mail. Works on the home screen: a Glance action callback swaps the front card.")
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Labeled("2×2 · new mail") {
                    InboxWidgetDepthMock(
                        InboxWidgetFamily.Small,
                        InboxWidgetSnapshot.SampleHasMail,
                        Modifier.galleryLift(),
                        front = smallFront,
                        onNext = { smallFront = nextFront(smallFront) },
                    )
                }
                Labeled("2×2 · inbox zero") {
                    InboxWidgetDepthMock(InboxWidgetFamily.Small, InboxWidgetSnapshot.SampleInboxZero, Modifier.galleryLift())
                }
            }
            Labeled("4×2 · new mail") {
                InboxWidgetDepthMock(
                    InboxWidgetFamily.Medium,
                    InboxWidgetSnapshot.SampleHasMail,
                    Modifier.galleryLift(),
                    front = mediumFront,
                    onNext = { mediumFront = nextFront(mediumFront) },
                )
            }
            Labeled("4×2 · inbox zero") {
                InboxWidgetDepthMock(InboxWidgetFamily.Medium, InboxWidgetSnapshot.SampleInboxZero, Modifier.galleryLift())
            }

            SectionTitle("Depth inspector", null, Modifier.padding(top = 6.dp))
            TiltInspector { spread ->
                InboxWidgetDepthMock(
                    InboxWidgetFamily.Medium,
                    InboxWidgetSnapshot.SampleHasMail,
                    Modifier.galleryLift(),
                    front = inspectorFront,
                    spread = spread,
                    onNext = { inspectorFront = nextFront(inspectorFront) },
                )
            }

            SectionTitle("Calm · round 1", null, Modifier.padding(top = 6.dp))
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

private fun nextFront(front: Int): Int =
    (front + 1) % InboxWidgetSnapshot.SampleHasMail.threads.size.coerceAtLeast(1)

@Composable
private fun SectionTitle(title: String, note: String?, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = colors.ink)
        if (note != null) {
            Text(note, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
        }
    }
}

/**
 * Drag to tilt the widget in 3D and fan its layers apart, to inspect the depth recipe.
 * PREVIEW ONLY: a home-screen widget (RemoteViews) can't track a finger, tilt, or read
 * the gyroscope.
 */
@Composable
private fun TiltInspector(content: @Composable (spread: Float) -> Unit) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val tiltX = remember { Animatable(0f) }
    val tiltY = remember { Animatable(0f) }
    val maxTilt = 14f
    val amount = (sqrt(tiltX.value * tiltX.value + tiltY.value * tiltY.value) / maxTilt).coerceAtMost(1f)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(
                Modifier
                    .background(colors.pillActive, RoundedCornerShape(50))
                    .padding(horizontal = 7.dp)
                    .height(18.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Preview only", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 10.sp, color = colors.ink)
            }
            Text(
                "Not possible in a home-screen widget",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
        Text(
            "Drag the widget to tilt it and fan the layers apart. Widgets can't track touch, tilt or motion, so this only exists here to review the depth.",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp)
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragEnd = {
                            val back = spring<Float>(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow)
                            scope.launch { tiltX.animateTo(0f, back) }
                            scope.launch { tiltY.animateTo(0f, back) }
                        },
                    ) { change, drag ->
                        change.consume()
                        scope.launch {
                            tiltY.snapTo((tiltY.value + drag.x / 8f / density).coerceIn(-maxTilt, maxTilt))
                            tiltX.snapTo((tiltX.value - drag.y / 8f / density).coerceIn(-maxTilt, maxTilt))
                        }
                    }
                }
                .graphicsLayer {
                    rotationX = tiltX.value
                    rotationY = tiltY.value
                    cameraDistance = 10f * density
                },
            contentAlignment = Alignment.Center,
        ) {
            content(1f + 1.4f * amount)
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

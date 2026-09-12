package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

@Composable
fun ComposeActionListOverlay(onSelect: (String) -> Unit, onDismiss: () -> Unit) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.35f))
            .clickable(onClick = onDismiss),
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 100.dp, start = 24.dp, end = 24.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .padding(vertical = 8.dp),
        ) {
            listOf(
                "new" to "New Message",
                "reply" to "Reply",
                "forward" to "Forward",
            ).forEach { (id, label) ->
                Text(
                    label,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 16.sp,
                    color = colors.ink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(id) }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                )
            }
        }
    }
}

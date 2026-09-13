package co.inboxies.app.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Error
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.AppToast
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

@Composable
fun UndoToastBanner(
    message: String,
    isError: Boolean = false,
    isLoading: Boolean = false,
    isUndo: Boolean = false,
    onUndo: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(50),
        color = colors.surface,
        tonalElevation = 4.dp,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when {
                isLoading -> CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                isError -> Icon(Icons.Outlined.Error, null, tint = colors.deepDarkRed, modifier = Modifier.size(16.dp))
                else -> Icon(Icons.Outlined.CheckCircle, null, tint = colors.ink, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text(
                message,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            if (isUndo) {
                TextButton(onClick = onUndo) {
                    Text("Undo", color = colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
fun UndoToastBanner(
    toast: AppToast,
    onDismiss: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val app = LocalAppModel.current
    UndoToastBanner(
        message = toast.message,
        isError = toast.isError,
        isLoading = toast.isLoading,
        isUndo = toast.isUndo,
        onUndo = {
            app.undoPendingAction()
            onDismiss()
        },
        modifier = modifier,
    )
}

package co.inboxies.app.ui.components

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/** iOS `Menu` surface: app surface fill, 14.dp corners, no Material tonal tint. */
@Composable
fun InboxiesDropdownMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = inboxiesColors()
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.widthIn(min = HomeChromeMetrics.menuMinWidth),
        shape = RoundedCornerShape(HomeChromeMetrics.menuCornerRadius),
        containerColor = colors.surface,
        tonalElevation = 0.dp,
        shadowElevation = HomeChromeMetrics.menuShadowElevation,
        content = content,
    )
}

@Composable
fun InboxiesMenuDivider() {
    val colors = inboxiesColors()
    HorizontalDivider(
        modifier = Modifier.padding(horizontal = HomeChromeMetrics.menuDividerInset),
        thickness = 0.5.dp,
        color = colors.line.copy(alpha = 0.65f),
    )
}

@Composable
fun InboxiesMenuItem(
    text: String,
    onClick: () -> Unit,
    icon: ImageVector? = null,
    destructive: Boolean = false,
) {
    val colors = inboxiesColors()
    val contentColor = if (destructive) colors.deepDarkRed else colors.ink
    DropdownMenuItem(
        text = {
            Text(
                text,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Normal,
                fontSize = 16.sp,
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        onClick = onClick,
        leadingIcon = icon?.let {
            {
                Icon(
                    it,
                    contentDescription = null,
                    tint = contentColor,
                    modifier = Modifier.size(HomeChromeMetrics.menuIconSize),
                )
            }
        },
        colors = MenuDefaults.itemColors(
            textColor = contentColor,
            trailingIconColor = contentColor,
        ),
        contentPadding = PaddingValues(horizontal = HomeChromeMetrics.menuItemHorizontalPadding),
    )
}

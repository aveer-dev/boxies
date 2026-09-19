package co.inboxies.app.ui.compose

import android.view.Gravity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FormatAlignCenter
import androidx.compose.material.icons.outlined.FormatAlignLeft
import androidx.compose.material.icons.outlined.FormatAlignRight
import androidx.compose.material.icons.outlined.FormatBold
import androidx.compose.material.icons.outlined.FormatIndentDecrease
import androidx.compose.material.icons.outlined.FormatIndentIncrease
import androidx.compose.material.icons.outlined.FormatItalic
import androidx.compose.material.icons.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.FormatListNumbered
import androidx.compose.material.icons.outlined.FormatSize
import androidx.compose.material.icons.outlined.FormatStrikethrough
import androidx.compose.material.icons.outlined.FormatUnderlined
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.liquidGlass
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.util.ComposePendingAttachment
import kotlin.math.roundToInt

@Composable
fun ComposeFormatSheet(
    state: ComposeFormatState,
    controller: ComposeRichTextController,
    onClose: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .padding(horizontal = 12.dp)
            .padding(bottom = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(colors.surface)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Format",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(colors.pillFill)
                    .clickable(role = Role.Button, onClick = onClose),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Close, contentDescription = "Close format", tint = colors.ink)
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StyleChip("Title", FontWeight.Bold, 14.sp, state.paragraph == ComposeParagraphStyle.Title) {
                controller.applyParagraph(ComposeParagraphStyle.Title)
            }
            StyleChip("Subtitle", FontWeight.SemiBold, 14.sp, state.paragraph == ComposeParagraphStyle.Subtitle) {
                controller.applyParagraph(ComposeParagraphStyle.Subtitle)
            }
            StyleChip("Body", FontWeight.Medium, 14.sp, state.paragraph == ComposeParagraphStyle.Body) {
                controller.applyParagraph(ComposeParagraphStyle.Body)
            }
            StyleChip("Caption", FontWeight.Medium, 11.sp, state.paragraph == ComposeParagraphStyle.Caption) {
                controller.applyParagraph(ComposeParagraphStyle.Caption)
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FormatIcon(Icons.Outlined.FormatBold, "Bold", state.bold, Modifier.weight(1f)) { controller.toggleBold() }
            FormatIcon(Icons.Outlined.FormatItalic, "Italic", state.italic, Modifier.weight(1f)) { controller.toggleItalic() }
            FormatIcon(Icons.Outlined.FormatUnderlined, "Underline", state.underline, Modifier.weight(1f)) { controller.toggleUnderline() }
            FormatIcon(Icons.Outlined.FormatStrikethrough, "Strikethrough", state.strikethrough, Modifier.weight(1f)) { controller.toggleStrike() }
            ColorDot(colors.ink) { controller.setColor(colors.ink.toArgb()) }
            ColorDot(colors.accent) { controller.setColor(colors.accent.toArgb()) }
            ColorDot(colors.deepDarkRed) { controller.setColor(colors.deepDarkRed.toArgb()) }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Default Font",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                color = colors.ink,
                modifier = Modifier
                    .weight(1f)
                    .height(44.dp)
                    .clip(RoundedCornerShape(50))
                    .background(colors.pillFill)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(colors.pillFill),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("−", modifier = Modifier.clickable { controller.bumpFontSize(-1) }.padding(12.dp), color = colors.ink)
                Text("${state.fontSizeSp}", fontFamily = InterFontFamily, fontSize = 14.sp, color = colors.ink)
                Text("+", modifier = Modifier.clickable { controller.bumpFontSize(1) }.padding(12.dp), color = colors.ink)
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FormatIcon(Icons.Outlined.FormatListBulleted, "Bulleted list", state.bullet, Modifier.weight(1f)) { controller.toggleBullet() }
            FormatIcon(Icons.Outlined.FormatListNumbered, "Numbered list", state.numbered, Modifier.weight(1f)) { controller.toggleNumbered() }
            FormatIcon(Icons.Outlined.FormatAlignLeft, "Align left", state.alignment == Gravity.START, Modifier.weight(1f)) { controller.setAlignment(Gravity.START) }
            FormatIcon(Icons.Outlined.FormatAlignCenter, "Align center", state.alignment == Gravity.CENTER_HORIZONTAL, Modifier.weight(1f)) { controller.setAlignment(Gravity.CENTER_HORIZONTAL) }
            FormatIcon(Icons.Outlined.FormatAlignRight, "Align right", state.alignment == Gravity.END, Modifier.weight(1f)) { controller.setAlignment(Gravity.END) }
            FormatIcon(Icons.Outlined.FormatIndentDecrease, "Outdent", false, Modifier.weight(1f)) { controller.indent(-24) }
            FormatIcon(Icons.Outlined.FormatIndentIncrease, "Indent", false, Modifier.weight(1f)) { controller.indent(24) }
        }
    }
}

@Composable
private fun StyleChip(label: String, weight: FontWeight, size: androidx.compose.ui.unit.TextUnit, active: Boolean, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Text(
        label,
        fontFamily = InterFontFamily,
        fontWeight = weight,
        fontSize = size,
        color = if (active) Color.White else colors.ink,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (active) colors.accent else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 10.dp),
    )
}

@Composable
private fun FormatIcon(icon: ImageVector, label: String, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Box(
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(50))
            .background(if (active) colors.pillActive else colors.pillFill)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = colors.ink, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun ColorDot(color: Color, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(CircleShape)
            .background(color)
            .border(1.dp, Color.White.copy(alpha = 0.4f), CircleShape)
            .clickable(onClick = onClick),
    )
}

@Composable
fun ComposeFormatAttachBar(
    onFormat: () -> Unit,
    onAttach: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.End,
    ) {
        Row(
            modifier = Modifier
                .liquidGlass(RoundedCornerShape(HomeChromeMetrics.toolbarControlCornerRadius))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            DockIconButton(icon = Icons.Outlined.FormatSize, label = "Format", onClick = onFormat, tint = colors.ink)
            DockIconButton(icon = Icons.Outlined.AttachFile, label = "Attach", onClick = onAttach, tint = colors.ink)
        }
    }
}

@Composable
private fun DockIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    tint: Color,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        modifier = Modifier
            .size(40.dp)
            .graphicsLayer { alpha = if (pressed) 0.55f else 1f }
            .clip(CircleShape)
            .clickable(
                role = Role.Button,
                interactionSource = interaction,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(18.dp))
    }
}

@Composable
fun ComposeAttachChips(
    attachments: List<ComposePendingAttachment>,
    onRemove: (String) -> Unit,
) {
    val colors = inboxiesColors()
    if (attachments.isEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        attachments.forEach { attachment ->
            Row(
                modifier = Modifier
                    .widthIn(max = 180.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.pillFill)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f, fill = false)) {
                    Text(
                        attachment.filename,
                        fontFamily = InterFontFamily,
                        fontSize = 11.sp,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        formatBytes(attachment.size),
                        fontFamily = InterFontFamily,
                        fontSize = 9.sp,
                        color = colors.muted,
                    )
                }
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = "Remove ${attachment.filename}",
                    tint = colors.muted,
                    modifier = Modifier
                        .size(14.dp)
                        .clickable { onRemove(attachment.id) },
                )
            }
        }
    }
}

private fun formatBytes(bytes: Int): String {
    if (bytes < 1024) return "$bytes B"
    if (bytes < 1024 * 1024) {
        val kb = bytes / 1024.0
        return if (kb >= 10) "${kb.roundToInt()} KB" else "${"%.1f".format(kb)} KB"
    }
    val mb = bytes / (1024.0 * 1024.0)
    return if (mb >= 10) "${mb.roundToInt()} MB" else "${"%.1f".format(mb)} MB"
}

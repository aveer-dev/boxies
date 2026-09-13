package co.inboxies.app.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.HapticFeedbackConstants
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.MailAddress
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuDivider
import co.inboxies.app.ui.components.InboxiesMenuHeader
import co.inboxies.app.ui.components.InboxiesMenuItem

/** Interactive inline contact pill for AI chat — mirrors iOS `ContactPillMenu`. */
@Composable
fun ContactPillMenu(
    address: MailAddress,
    trailingPunctuation: String? = null,
    onCompose: ((MailAddress) -> Unit)? = null,
    onSearch: ((String) -> Unit)? = null,
    onAskAI: ((String) -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val context = LocalContext.current
    val view = LocalView.current
    var expanded by remember { mutableStateOf(false) }

    fun haptic() {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    fun copy(text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("contact", text))
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(colors.pillFill)
                    .border(0.5.dp, colors.line.copy(alpha = 0.6f), RoundedCornerShape(50))
                    .clickable { expanded = true }
                    .padding(start = 7.dp, end = 6.dp, top = 3.dp, bottom = 3.dp),
            ) {
                Icon(
                    if (address.name != null) Icons.Filled.Person else Icons.Filled.Email,
                    contentDescription = null,
                    tint = colors.accent,
                    modifier = Modifier.size(10.dp),
                )
                Text(
                    address.tokenLabel,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 11.5.sp,
                    letterSpacing = AppThemeDims.Chat.tracking,
                    color = colors.ink,
                    maxLines = 1,
                )
                Icon(
                    Icons.Outlined.KeyboardArrowDown,
                    contentDescription = null,
                    tint = colors.muted.copy(alpha = 0.8f),
                    modifier = Modifier.size(8.dp),
                )
            }

            InboxiesDropdownMenu(
                expanded = expanded,
                onDismiss = { expanded = false },
            ) {
                InboxiesMenuHeader(
                    title = address.name?.takeIf { it.isNotEmpty() } ?: address.email,
                    subtitle = if (!address.name.isNullOrEmpty()) address.email else null,
                )
                InboxiesMenuDivider()

                if (onCompose != null) {
                    InboxiesMenuItem(
                        text = "New Message",
                        icon = Icons.Outlined.Edit,
                        onClick = {
                            expanded = false
                            haptic()
                            onCompose(address)
                        },
                    )
                }
                if (onAskAI != null) {
                    InboxiesMenuItem(
                        text = "Ask AI about this contact",
                        icon = Icons.Filled.AutoAwesome,
                        onClick = {
                            expanded = false
                            haptic()
                            val prompt = if (address.name != null) {
                                "Find emails involving ${address.name} (${address.email})"
                            } else {
                                "Find emails from ${address.email}"
                            }
                            onAskAI(prompt)
                        },
                    )
                }
                if (onSearch != null) {
                    InboxiesMenuItem(
                        text = "Search in Mailbox",
                        icon = Icons.Outlined.Search,
                        onClick = {
                            expanded = false
                            haptic()
                            onSearch(address.searchQuery)
                        },
                    )
                }

                InboxiesMenuDivider()
                InboxiesMenuItem(
                    text = "Copy Email Address",
                    icon = Icons.Outlined.ContentCopy,
                    onClick = {
                        expanded = false
                        haptic()
                        copy(address.email)
                    },
                )
                if (!address.name.isNullOrEmpty()) {
                    InboxiesMenuItem(
                        text = "Copy Name",
                        icon = Icons.Outlined.Person,
                        onClick = {
                            expanded = false
                            haptic()
                            copy(address.name)
                        },
                    )
                    InboxiesMenuItem(
                        text = "Copy Full Contact",
                        icon = Icons.Outlined.Person,
                        onClick = {
                            expanded = false
                            haptic()
                            copy("${address.name} <${address.email}>")
                        },
                    )
                }
            }
        }

        if (!trailingPunctuation.isNullOrEmpty()) {
            Text(
                trailingPunctuation,
                fontFamily = InterFontFamily,
                fontSize = AppThemeDims.Chat.body,
                letterSpacing = AppThemeDims.Chat.tracking,
                color = colors.ink,
            )
        }
    }
}

package co.inboxies.app.ui.email

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.Email
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun EmailListView(
    emails: List<Email>,
    isLoading: Boolean,
    onOpen: (Email) -> Unit,
    onRefresh: (suspend () -> Unit)? = null,
    userEmail: String? = null,
    onStar: ((Email) -> Unit)? = null,
    onToggleRead: ((Email) -> Unit)? = null,
    onArchive: ((Email) -> Unit)? = null,
    onDelete: ((Email) -> Unit)? = null,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    @Suppress("UNUSED_VARIABLE")
    val ignoredUser = userEmail

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            isLoading && emails.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = colors.ink)
            }
            emails.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No emails", color = colors.muted, fontFamily = InterFontFamily)
                    if (onRefresh != null) {
                        TextButton(onClick = { scope.launch { onRefresh() } }) {
                            Text("Refresh", color = colors.accent)
                        }
                    }
                }
            }
            else -> LazyColumn(
                contentPadding = PaddingValues(bottom = 120.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (onRefresh != null) {
                    item {
                        TextButton(onClick = { scope.launch { onRefresh() } }) {
                            Text("Refresh", color = colors.accent)
                        }
                    }
                }
                items(emails, key = { it.id }) { email ->
                    EmailRow(
                        email = email,
                        onClick = { onOpen(email) },
                        onStar = onStar,
                        onToggleRead = onToggleRead,
                        onArchive = onArchive,
                        onDelete = onDelete,
                    )
                    HorizontalDivider(
                        color = colors.line.copy(alpha = 0.65f),
                        thickness = 0.5.dp,
                        modifier = Modifier.padding(start = 42.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun EmailRow(
    email: Email,
    onClick: () -> Unit,
    onStar: ((Email) -> Unit)?,
    onToggleRead: ((Email) -> Unit)?,
    onArchive: ((Email) -> Unit)?,
    onDelete: ((Email) -> Unit)?,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .padding(top = 6.dp)
                .size(8.dp)
                .clip(CircleShape)
                .background(if (email.isUnread) colors.unread else colors.background),
        )
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    email.displaySender,
                    fontFamily = InterFontFamily,
                    fontWeight = if (email.isUnread) FontWeight.SemiBold else FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(email.date.take(10), fontSize = 10.sp, color = colors.muted)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                email.subject.ifBlank { "(no subject)" },
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                email.previewText,
                fontSize = 12.sp,
                color = colors.muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (onStar != null || onArchive != null || onDelete != null || onToggleRead != null) {
                Row {
                    onToggleRead?.let {
                        TextButton(onClick = { it(email) }) {
                            Text(if (email.read) "Unread" else "Read", fontSize = 11.sp)
                        }
                    }
                    onStar?.let {
                        TextButton(onClick = { it(email) }) {
                            Text(if (email.starred) "Unstar" else "Star", fontSize = 11.sp)
                        }
                    }
                    onArchive?.let {
                        TextButton(onClick = { it(email) }) { Text("Archive", fontSize = 11.sp) }
                    }
                    onDelete?.let {
                        TextButton(onClick = { it(email) }) {
                            Text("Delete", fontSize = 11.sp, color = colors.deepDarkRed)
                        }
                    }
                }
            }
        }
    }
}

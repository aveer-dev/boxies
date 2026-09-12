package co.inboxies.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

@Composable
fun InboxDigestView(
    onRefresh: suspend () -> Unit = {},
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val digest by app.inboxDigest.collectAsState()
    val loading by app.isDigestLoading.collectAsState()
    val scope = rememberCoroutineScope()

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            loading && digest == null -> {
                CircularProgressIndicator(
                    color = colors.ink,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            digest == null -> {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("No digest yet", color = colors.muted, fontFamily = InterFontFamily)
                    TextButton(onClick = { scope.launch { onRefresh() } }) {
                        Text("Refresh", color = colors.accent, fontFamily = InterFontFamily)
                    }
                }
            }
            else -> {
                val d = digest!!
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Text(
                            "Hi ${d.greetingName.ifBlank { "there" }}",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 20.sp,
                            color = colors.ink,
                            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                        )
                        Text("${d.unreadCount} unread", fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.muted)
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                    if (d.todos.isNotEmpty()) {
                        item {
                            Text("To-dos", fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, color = colors.ink)
                        }
                        items(d.todos, key = { it.id }) { todo ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(colors.surface, RoundedCornerShape(12.dp))
                                    .clickable {
                                        scope.launch {
                                            app.emails.value.firstOrNull { it.id == todo.emailId }
                                                ?.let { app.openEmail(it) }
                                        }
                                    }
                                    .padding(14.dp),
                            ) {
                                Text(todo.title, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium, color = colors.ink)
                                Text(todo.summary, fontFamily = InterFontFamily, fontSize = 13.sp, color = colors.muted)
                                TextButton(onClick = { scope.launch { app.completeDigestTodo(todo.id) } }) {
                                    Text("Complete", color = colors.accent, fontFamily = InterFontFamily)
                                }
                            }
                        }
                    }
                    items(d.topics, key = { it.id }) { topic ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(colors.surface, RoundedCornerShape(12.dp))
                                .padding(14.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    "${topic.emoji} ${topic.title}",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    color = colors.ink,
                                )
                                if (!topic.caughtUp) {
                                    TextButton(onClick = {
                                        scope.launch {
                                            app.markDigestTopicRead(topic.id, topic.items.map { it.emailId })
                                        }
                                    }) {
                                        Text("Mark read", color = colors.accent, fontSize = 12.sp)
                                    }
                                }
                            }
                            topic.items.take(3).forEach { item ->
                                Text(
                                    item.subject,
                                    fontFamily = InterFontFamily,
                                    fontSize = 13.sp,
                                    color = if (item.unread) colors.ink else colors.muted,
                                    modifier = Modifier
                                        .padding(top = 6.dp)
                                        .clickable {
                                            scope.launch {
                                                app.emails.value.firstOrNull { it.id == item.emailId }
                                                    ?.let { app.openEmail(it) }
                                            }
                                        },
                                )
                                Text(item.summary, fontSize = 12.sp, color = colors.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

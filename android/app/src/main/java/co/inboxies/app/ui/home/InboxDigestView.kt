package co.inboxies.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.InboxDigest
import co.inboxies.app.models.InboxDigestTodo
import co.inboxies.app.models.InboxDigestTopic
import co.inboxies.app.models.InboxDigestTopicItem
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.launch
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxDigestView(
    bottomInset: Dp = HomeChromeMetrics.listBottomInset(false),
    onRefresh: suspend () -> Unit = {},
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val digest by app.inboxDigest.collectAsState()
    val loading by app.isDigestLoading.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAllTodos by remember { mutableStateOf(false) }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try {
                    onRefresh()
                } finally {
                    refreshing = false
                }
            }
        },
        modifier = Modifier.fillMaxSize().background(colors.background),
    ) {
        when {
            loading && digest == null -> {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = colors.ink)
                }
            }
            digest == null -> {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Icon(
                        Icons.Filled.AutoAwesome,
                        contentDescription = null,
                        tint = colors.muted,
                        modifier = Modifier.size(40.dp),
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "For you",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                    )
                    Text(
                        "Pull to refresh suggested to-dos and topics.",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                        modifier = Modifier.padding(top = 4.dp, start = 32.dp, end = 32.dp),
                    )
                }
            }
            else -> {
                val d = digest!!
                val visibleTodos = if (showAllTodos || d.todos.size <= 3) {
                    d.todos
                } else {
                    d.todos.take(3)
                }
                val hiddenTodoCount = maxOf(0, d.todos.size - 3)

                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        top = 4.dp,
                        bottom = bottomInset + 24.dp,
                    ),
                ) {
                    if (d.todos.isNotEmpty()) {
                        items(visibleTodos, key = { it.id }) { todo ->
                            TodoRow(
                                todo = todo,
                                showSeparator = true,
                                onComplete = { scope.launch { app.completeDigestTodo(todo.id) } },
                                onOpen = {
                                    scope.launch {
                                        app.emails.value.firstOrNull { it.id == todo.emailId }
                                            ?.let { app.openEmail(it) }
                                    }
                                },
                            )
                        }
                        if (!showAllTodos && hiddenTodoCount > 0) {
                            item {
                                Text(
                                    "Show $hiddenTodoCount more",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.Medium,
                                    fontSize = 13.sp,
                                    color = colors.muted,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { showAllTodos = true }
                                        .padding(vertical = 14.dp)
                                        .padding(start = 54.dp, end = 20.dp),
                                )
                            }
                        }
                    }

                    item {
                        TopicsSection(
                            digest = d,
                            onMarkTopicRead = { topic ->
                                scope.launch {
                                    app.markDigestTopicRead(topic.id, topic.items.map { it.emailId })
                                }
                            },
                            onOpenItem = { item ->
                                scope.launch {
                                    app.emails.value.firstOrNull { it.id == item.emailId }
                                        ?.let { app.openEmail(it) }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TodoRow(
    todo: InboxDigestTodo,
    showSeparator: Boolean,
    onComplete: () -> Unit,
    onOpen: () -> Unit,
) {
    val colors = inboxiesColors()
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalAlignment = Alignment.Top,
        ) {
            IconButton(
                onClick = onComplete,
                modifier = Modifier.size(20.dp).padding(top = 1.dp),
            ) {
                Icon(
                    Icons.Outlined.Circle,
                    contentDescription = "Mark to-do done",
                    tint = colors.muted.copy(alpha = 0.85f),
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable(onClick = onOpen),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    todo.title.ifBlank { "(no subject)" },
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 15.sp,
                    color = colors.ink,
                    maxLines = 2,
                )
                if (todo.summary.isNotBlank()) {
                    Text(
                        todo.summary,
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                        maxLines = 2,
                    )
                }
            }
        }
        if (showSeparator) {
            HorizontalDivider(
                color = colors.line.copy(alpha = 0.65f),
                thickness = 0.5.dp,
                modifier = Modifier.padding(start = 54.dp, end = 20.dp),
            )
        }
    }
}

@Composable
private fun TopicsSection(
    digest: InboxDigest,
    onMarkTopicRead: (InboxDigestTopic) -> Unit,
    onOpenItem: (InboxDigestTopicItem) -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = if (digest.todos.isEmpty()) 8.dp else 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "Topics to catch up on",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = colors.ink,
            )
            Text(
                topicsSubtitle(digest.unreadCount),
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
            )
        }

        if (digest.topics.isEmpty()) {
            Text(
                "No topics yet. New mail will show up here.",
                fontFamily = InterFontFamily,
                fontSize = 14.sp,
                color = colors.muted,
                modifier = Modifier.padding(vertical = 8.dp),
            )
        } else {
            digest.topics.forEach { topic ->
                TopicCard(
                    topic = topic,
                    onMarkRead = { onMarkTopicRead(topic) },
                    onOpenItem = onOpenItem,
                )
            }
        }
    }
}

@Composable
private fun TopicCard(
    topic: InboxDigestTopic,
    onMarkRead: () -> Unit,
    onOpenItem: (InboxDigestTopicItem) -> Unit,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.surface, shape)
            .border(0.5.dp, colors.line.copy(alpha = 0.7f), shape),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 14.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(topic.emoji, fontSize = 18.sp)
            Spacer(Modifier.width(8.dp))
            Text(
                topic.title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (!topic.caughtUp) {
                IconButton(onClick = onMarkRead) {
                    Icon(
                        Icons.Outlined.Drafts,
                        contentDescription = "Mark topic read",
                        tint = colors.muted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }

        when {
            topic.caughtUp -> {
                Text(
                    "You are caught up on emails!",
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 0.dp).padding(bottom = 14.dp),
                )
            }
            topic.items.isNotEmpty() -> {
                val featured = topic.items.first()
                TopicItemRow(item = featured, onOpen = { onOpenItem(featured) })
                if (topic.remainingSummary != null && topic.items.size > 1) {
                    HorizontalDivider(
                        color = colors.line.copy(alpha = 0.65f),
                        thickness = 0.5.dp,
                        modifier = Modifier.padding(start = 16.dp),
                    )
                    Text(
                        topic.remainingSummary,
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TopicItemRow(
    item: InboxDigestTopicItem,
    onOpen: () -> Unit,
) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .padding(horizontal = 16.dp)
            .padding(bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(
                item.subject.ifBlank { "(no subject)" },
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                color = colors.ink,
                maxLines = 2,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                DateUtils.formatEmailDate(item.date),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                color = colors.muted,
            )
        }
        if (item.summary.isNotBlank()) {
            Text(
                item.summary,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
                maxLines = 3,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (item.attachmentCount > 0) {
                Icon(
                    Icons.Outlined.AttachFile,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(12.dp),
                )
                Text(
                    "${item.attachmentCount}",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 11.sp,
                    color = colors.muted,
                    modifier = Modifier.padding(start = 2.dp),
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            if (item.unread) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(colors.accent),
                )
            }
        }
    }
}

private fun topicsSubtitle(unread: Int): String = when {
    unread == 0 -> "You're caught up on unread email"
    unread == 1 -> "Your latest updates from 1 unread email"
    else -> "Your latest updates from $unread unread emails"
}

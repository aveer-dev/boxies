package co.inboxies.app.ui.email

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.models.FolderIds
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.DatabaseService
import co.inboxies.app.services.EmailListScope
import co.inboxies.app.services.EmailPagingState
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

/**
 * Every New Inbox conversation (AVE-23). The Inbox list caps New at
 * `EmailPaging.INBOX_NEW_PREVIEW_LIMIT` rows so Seen always stays in view; its
 * "Show N more new" row replaces the home list with this screen (back returns).
 */
@Composable
fun InboxNewListView(
    onClose: () -> Unit,
    bottomInset: Dp = HomeChromeMetrics.listBottomInset(false),
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val mailboxId by app.selectedMailboxId.collectAsState()

    var emails by remember { mutableStateOf<List<Email>>(emptyList()) }
    var paging by remember { mutableStateOf(EmailPagingState()) }
    var totalCount by remember { mutableStateOf<Int?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }

    BackHandler(onBack = onClose)

    val listScope = mailboxId?.let { EmailListScope(it, folderId = LIST_ID) }

    suspend fun loadFirstPage() {
        val id = mailboxId ?: return
        val pageScope = listScope ?: return
        if (app.isDebugPreview) {
            emails = app.emails.value.filter { it.isUnread }
            totalCount = emails.size
            paging = EmailPagingState()
            isLoading = false
            return
        }
        runCatching {
            ApiClient.shared.listEmails(id, folder = FolderIds.INBOX, page = 1, section = "new")
        }.onSuccess { response ->
            if (app.selectedMailboxId.value != id) return
            // Cache the rows so opening one reads locally; no pruning — this is a filtered view.
            DatabaseService.shared.upsertEmails(id, response.emails, defaultFolder = FolderIds.INBOX)
            emails = response.emails
            totalCount = response.newCount ?: response.totalCount
            paging = paging.restarted(
                pageScope,
                received = response.emails.size,
                totalCount = response.totalCount,
                loadedCount = response.emails.size,
            )
            loadError = null
        }.onFailure { error ->
            if (emails.isEmpty()) loadError = error.message ?: "Check your connection and try again."
        }
        isLoading = false
    }

    suspend fun loadMore() {
        val id = mailboxId ?: return
        val pageScope = listScope ?: return
        val next = paging.nextPage(pageScope) ?: return
        val generation = paging.generation
        paging = paging.beginLoadMore()
        runCatching {
            ApiClient.shared.listEmails(id, folder = FolderIds.INBOX, page = next, section = "new")
        }.onSuccess { response ->
            if (!paging.accepts(pageScope, generation)) return
            DatabaseService.shared.upsertEmails(id, response.emails, defaultFolder = FolderIds.INBOX)
            val known = emails.map { it.id }.toSet()
            emails = emails + response.emails.filterNot { it.id in known }
            paging = paging.afterPage(next, response.emails.size, response.totalCount, emails.size)
        }.onFailure {
            if (paging.accepts(pageScope, generation)) paging = paging.failLoad()
        }
    }

    LaunchedEffect(mailboxId) {
        isLoading = emails.isEmpty()
        loadFirstPage()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back to Inbox",
                onClick = onClose,
            )
        }
        Column(
            modifier = Modifier.padding(horizontal = 20.dp).padding(top = 4.dp, bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = "New",
                color = colors.ink,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 34.sp,
            )
            Text(
                text = when (val count = totalCount) {
                    null -> "Inbox"
                    1 -> "1 new conversation"
                    else -> "$count new conversations"
                },
                color = colors.muted,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
            )
        }
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            EmailListView(
                emails = emails,
                isLoading = isLoading,
                bottomInset = bottomInset,
                fallbackFolderId = null,
                showsTags = true,
                loadError = loadError,
                paging = paging,
                onLoadMore = { loadMore() },
                onRefresh = { loadFirstPage() },
                onOpen = { email ->
                    // Opening marks it read; the row stays put (read dot) until refresh.
                    if (email.isUnread) {
                        emails = emails.map {
                            if (it.id == email.id) it.copy(read = true, threadUnreadCount = 0, listSection = "seen") else it
                        }
                    }
                    scope.launch { app.openEmail(email) }
                },
            )
        }
    }
}

private const val LIST_ID = "inbox_new"

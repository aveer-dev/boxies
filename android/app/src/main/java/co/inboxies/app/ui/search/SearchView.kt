package co.inboxies.app.ui.search

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.services.ApiClient
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.homeChromeToolbarSurface
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.chat.ChatSheetView
import co.inboxies.app.ui.email.EmailListView
import co.inboxies.app.util.SearchQueryParser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SearchView(
    onClose: () -> Unit,
    onAskAi: (() -> Unit)? = null,
    onOpenEmail: ((Email) -> Unit)? = null,
    initialQuery: String = "",
) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var query by remember { mutableStateOf(initialQuery) }
    var results by remember { mutableStateOf<List<Email>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var searchJob by remember { mutableStateOf<Job?>(null) }
    var showChat by remember { mutableStateOf(false) }
    val trimmed = query.trim()
    val parsed = remember(trimmed) { SearchQueryParser.parse(trimmed) }
    val highlightText = parsed.query
    val shouldSearch = parsed.hasStructuredFilters || trimmed.length >= 2
    val shouldShowEmptyResults = shouldSearch && !loading && results.isEmpty()

    fun runSearch(value: String) {
        searchJob?.cancel()
        searchJob = scope.launch {
            delay(if (value == initialQuery && initialQuery.isNotBlank()) 0 else 300)
            val mailboxId = app.selectedMailboxId.value ?: return@launch
            val parsedQuery = SearchQueryParser.parse(value.trim())
            val canSearch = parsedQuery.hasStructuredFilters || value.trim().length >= 2
            if (!canSearch) {
                results = emptyList()
                loading = false
                return@launch
            }
            loading = true
            results = runCatching {
                ApiClient.shared.searchEmails(mailboxId, parsedQuery).emails
            }.getOrElse { emptyList() }
            loading = false
        }
    }

    LaunchedEffect(initialQuery) {
        if (initialQuery.isNotBlank()) {
            query = initialQuery
            runSearch(initialQuery)
        }
    }

    LaunchedEffect(Unit) {
        if (initialQuery.isBlank()) {
            delay(280)
            runCatching { focusRequester.requestFocus() }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.background)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
                if (trimmed.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp)
                            .padding(top = 8.dp, bottom = 20.dp)
                            .height(52.dp)
                            .shadow(
                                elevation = 10.dp,
                                shape = CircleShape,
                                clip = false,
                                ambientColor = Color.Black.copy(alpha = 0.08f),
                                spotColor = Color.Black.copy(alpha = 0.08f),
                            )
                            .clip(CircleShape)
                            .background(colors.surface)
                            .clickable(role = Role.Button) {
                                keyboard?.hide()
                                app.openChatSession(forceNew = true)
                                showChat = true
                            }
                            .padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Filled.AutoAwesome,
                            contentDescription = null,
                            tint = colors.ink,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            "Ask AI “$trimmed”",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 16.sp,
                            color = colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                when {
                    loading || results.isNotEmpty() -> {
                        Text(
                            "Results",
                            fontFamily = InterFontFamily,
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier
                                .padding(horizontal = 16.dp)
                                .padding(bottom = 8.dp)
                                .alpha(if (results.isNotEmpty() && !loading) 1f else 0f),
                        )
                        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                            EmailListView(
                                emails = results,
                                isLoading = loading,
                                highlightQuery = highlightText,
                                bottomInset = 0.dp,
                                onOpen = { email ->
                                    scope.launch {
                                        if (onOpenEmail != null) onOpenEmail(email)
                                        else app.openEmail(email)
                                        onClose()
                                    }
                                },
                            )
                        }
                    }
                    shouldShowEmptyResults -> {
                        Text(
                            "No matching emails",
                            fontFamily = InterFontFamily,
                            fontSize = 15.sp,
                            color = colors.muted,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 24.dp),
                        )
                        Spacer(modifier = Modifier.weight(1f))
                    }
                    else -> {
                        Text(
                            "Tip: Use operators like from:name, is:unread, has:attachment, before:2025-01-01",
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.muted,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp)
                                .padding(top = 24.dp),
                        )
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(HomeChromeMetrics.chromeSpacing),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .padding(top = 8.dp, bottom = 10.dp),
            ) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .height(HomeChromeMetrics.actionBarHeight)
                        .homeChromeToolbarSurface(RoundedCornerShape(50))
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.Outlined.Search,
                        contentDescription = null,
                        tint = colors.muted,
                        modifier = Modifier.size(18.dp),
                    )
                    BasicTextField(
                        value = query,
                        onValueChange = { value ->
                            query = value
                            runSearch(value)
                        },
                        modifier = Modifier
                            .weight(1f)
                            .focusRequester(focusRequester),
                        textStyle = TextStyle(
                            fontFamily = InterFontFamily,
                            fontSize = 16.sp,
                            color = colors.ink,
                        ),
                        cursorBrush = SolidColor(colors.ink),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        decorationBox = { inner ->
                            Box {
                                if (query.isEmpty()) {
                                    Text(
                                        "Search mail (try from:, is:unread)",
                                        fontFamily = InterFontFamily,
                                        fontSize = 16.sp,
                                        color = colors.muted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                inner()
                            }
                        },
                    )
                    if (query.isNotEmpty()) {
                        Icon(
                            Icons.Filled.Cancel,
                            contentDescription = "Clear",
                            tint = colors.muted,
                            modifier = Modifier
                                .size(18.dp)
                                .clickable {
                                    query = ""
                                    results = emptyList()
                                    loading = false
                                    searchJob?.cancel()
                                },
                        )
                    }
                }
                HomeChromeToolbarButton(
                    icon = Icons.Outlined.Close,
                    contentDescription = "Cancel",
                    onClick = onClose,
                    size = HomeChromeMetrics.actionBarHeight,
                )
            }
        }

        if (showChat) {
            ChatSheetView(
                seedPrompt = trimmed,
                forceNewChat = true,
                onClose = {
                    showChat = false
                    app.dismissChatSession()
                },
            )
        }
    }
}

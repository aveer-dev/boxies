package co.inboxies.app.ui.settings

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.BounceSuppression
import co.inboxies.app.services.SuppressedRecipient
import co.inboxies.app.services.SuppressionList
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.LoadFailedContent
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Settings → Outgoing mail → Bounced addresses (AVE-157): recipients the sending domain
 * no longer mails after a hard bounce or a spam complaint. Members see the ones their
 * mailbox caused; domain admins see the whole domain's. Un-suppress lets mail go to them
 * again. Web: `app/components/settings/SuppressionsSettings.tsx`; iOS twin:
 * `SuppressionsSettingsView.swift`.
 */
@Composable
fun SuppressionsSettingsView(onBack: () -> Unit) {
    val app = LocalAppModel.current
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()

    var list by remember { mutableStateOf<SuppressionList?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf<SuppressedRecipient?>(null) }
    var busyAddress by remember { mutableStateOf<String?>(null) }

    fun reload() {
        if (app.isDebugPreview) {
            list = previewSuppressionList()
            isLoading = false
            return
        }
        val mailboxId = app.selectedMailboxId.value ?: run {
            isLoading = false
            return
        }
        scope.launch {
            isLoading = true
            runCatching { ApiClient.shared.listSuppressions(mailboxId) }
                .onSuccess {
                    list = it
                    loadError = null
                }
                .onFailure { loadError = it.message }
            isLoading = false
        }
    }

    fun removeRow(row: SuppressedRecipient) {
        list = list?.let { current ->
            current.copy(suppressions = current.suppressions.filterNot { it.address == row.address })
        }
    }

    fun unsuppress(row: SuppressedRecipient) {
        confirming = null
        scope.launch {
            busyAddress = row.address
            val result = runCatching {
                if (!app.isDebugPreview) {
                    val mailboxId = app.selectedMailboxId.value ?: return@runCatching
                    ApiClient.shared.unsuppress(mailboxId, row.address)
                }
            }
            result.onSuccess {
                removeRow(row)
                app.showToast(BounceSuppression.unsuppressedToast(row.address))
            }.onFailure { error ->
                if (BounceSuppression.isAlreadyLifted(error)) {
                    // Already lifted elsewhere: drop the row quietly.
                    removeRow(row)
                } else {
                    app.showToast(
                        error.message?.takeIf { it.isNotBlank() } ?: "Couldn’t un-suppress the address",
                        isError = true,
                    )
                }
            }
            busyAddress = null
            if (!app.isDebugPreview) reload()
        }
    }

    LaunchedEffect(Unit) { reload() }

    val rows = list?.suppressions.orEmpty()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(bottom = 32.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = onBack,
            )
            Text(
                BounceSuppression.PAGE_TITLE,
                modifier = Modifier.padding(start = 4.dp),
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 17.sp,
                color = colors.ink,
            )
        }

        Text(
            BounceSuppression.introText(list),
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
        )

        when {
            isLoading && list == null -> Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), color = colors.muted, strokeWidth = 2.dp)
            }
            loadError != null && list == null -> LoadFailedContent(
                title = BounceSuppression.LOAD_FAILED_TITLE,
                message = loadError,
                isRetrying = isLoading,
                onRetry = { reload() },
                modifier = Modifier.padding(top = 24.dp),
            )
            rows.isEmpty() -> Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    BounceSuppression.EMPTY_TITLE,
                    fontFamily = InterFontFamily,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = colors.ink,
                )
                Text(
                    BounceSuppression.EMPTY_MESSAGE,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
            }
            else -> Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.surface)
                    .animateContentSize(spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)),
            ) {
                rows.forEachIndexed { index, row ->
                    SuppressionRow(
                        row = row,
                        busy = busyAddress == row.address,
                        enabled = busyAddress == null,
                        onUnsuppress = { confirming = row },
                    )
                    if (index < rows.lastIndex) {
                        HorizontalDivider(color = colors.line, thickness = 0.5.dp)
                    }
                }
            }
        }
    }

    confirming?.let { row ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            containerColor = colors.surface,
            title = { Text(BounceSuppression.CONFIRM_TITLE, fontFamily = InterFontFamily, fontSize = 17.sp) },
            text = {
                Text(
                    BounceSuppression.confirmMessage(row),
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = { unsuppress(row) }) {
                    Text("Un-suppress", fontFamily = InterFontFamily, color = colors.accent)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirming = null }) {
                    Text("Cancel", fontFamily = InterFontFamily, color = colors.muted)
                }
            },
        )
    }
}

@Composable
private fun SuppressionRow(
    row: SuppressedRecipient,
    busy: Boolean,
    enabled: Boolean,
    onUnsuppress: () -> Unit,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                row.address,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                BounceSuppression.metaLine(row),
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
                maxLines = 1,
            )
            row.detail?.let {
                Text(
                    it,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        when {
            busy -> Box(modifier = Modifier.widthIn(min = 44.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), color = colors.muted, strokeWidth = 2.dp)
            }
            row.canUnsuppress -> Text(
                "Un-suppress",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 13.sp,
                color = colors.accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(colors.pillFill)
                    .clickable(enabled = enabled, onClick = onUnsuppress)
                    .semantics { contentDescription = "Un-suppress ${row.address}" }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
            else -> Text(
                BounceSuppression.ADMIN_ONLY_TEXT,
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.muted,
            )
        }
    }
}

/** DEBUG preview fixtures (`suppressions` preview mode); no server. Same rows as iOS. */
internal fun previewSuppressionList(now: Instant = Instant.now()): SuppressionList {
    fun ago(days: Long) = now.minus(days, ChronoUnit.DAYS).toString()
    return SuppressionList(
        domain = "inboxies.email",
        scope = SuppressionList.Scope.Mailbox,
        suppressions = listOf(
            SuppressedRecipient(
                address = "old.contact@example.com",
                domain = "inboxies.email",
                reason = SuppressedRecipient.Reason.HardBounce,
                source = "dsn",
                detail = "550 5.1.1 The email account that you tried to reach does not exist",
                suppressedAt = ago(2),
                canUnsuppress = true,
            ),
            SuppressedRecipient(
                address = "newsletter-replies@acme.co",
                domain = "inboxies.email",
                reason = SuppressedRecipient.Reason.Complaint,
                source = "event",
                detail = null,
                suppressedAt = ago(9),
                canUnsuppress = true,
            ),
            SuppressedRecipient(
                address = "billing@typo-domain.io",
                domain = "inboxies.email",
                reason = SuppressedRecipient.Reason.HardBounce,
                source = "dsn",
                detail = "Host or domain name not found",
                suppressedAt = ago(21),
                canUnsuppress = false,
            ),
        ),
    )
}

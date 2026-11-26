package co.inboxies.app.ui.email

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Refresh
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.AiSummary
import co.inboxies.app.models.AiSummaryQuota
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Summaries already fetched this session, so reopening a thread or paging back doesn't
 * flash the skeleton. The server caches too; this only saves the round trip.
 */
internal object AiSummaryMemoryCache {
    private val entries = HashMap<String, AiSummary>()

    fun key(mailboxId: String, threadId: String) = "$mailboxId|$threadId"

    @Synchronized fun get(key: String): AiSummary? = entries[key]

    @Synchronized fun put(key: String, summary: AiSummary) {
        if (entries.size > 200) entries.clear()
        entries[key] = summary
    }
}

/** DEBUG preview fixture (`summary` / `summaryQuota` modes): no API. */
object ThreadSummaryDebug {
    @Volatile var mode: String? = null

    val fixture = AiSummary(
        targetId = "preview-thread",
        summary = "Dana shared the Q3 planning notes and wants owners for the three launch workstreams by Friday. " +
            "Marcus already took onboarding; pricing and the partner pilot are still open.",
        keyPoints = listOf("Pick an owner for pricing or the partner pilot", "Reply to Dana by Friday"),
        model = "preview",
        messageCount = 2,
    )
}

private sealed interface SummaryPhase {
    data object Idle : SummaryPhase
    data object Loading : SummaryPhase
    data class Ready(val summary: AiSummary) : SummaryPhase
    data object Hidden : SummaryPhase
    data class Failed(val quota: Boolean) : SummaryPhase
}

private fun <T> summarySpring() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

private fun previewPhase(): SummaryPhase? = when (ThreadSummaryDebug.mode) {
    null -> null
    "quota" -> SummaryPhase.Failed(quota = true)
    "loading" -> SummaryPhase.Loading
    else -> SummaryPhase.Ready(ThreadSummaryDebug.fixture)
}

/**
 * AI summary at the top of the reader (AVE-218), twin of web `AISummaryCard` and the iOS
 * `ThreadSummaryCard`. Loads lazily when a qualifying thread opens, renders nothing while
 * the mail isn't eligible, and shows a calm note at the daily AI limit.
 */
@Composable
fun ThreadSummaryCard(
    mailboxId: String?,
    threadId: String,
    /** `AiSummaryEligibility.isEnabled`; false skips the request entirely. */
    enabled: Boolean,
    isDebugPreview: Boolean,
    modifier: Modifier = Modifier,
) {
    var phase by remember(mailboxId, threadId) { mutableStateOf<SummaryPhase>(SummaryPhase.Idle) }
    var regenerating by remember(mailboxId, threadId) { mutableStateOf(false) }
    var regenerateError by remember(mailboxId, threadId) { mutableStateOf<String?>(null) }
    var expanded by remember(mailboxId, threadId) { mutableStateOf(false) }
    var reloadToken by remember { mutableStateOf(0) }
    var force by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(mailboxId, threadId, enabled, reloadToken) {
        expanded = false
        regenerateError = null
        previewPhase()?.let {
            phase = it
            return@LaunchedEffect
        }
        if (!enabled || mailboxId == null || isDebugPreview) {
            phase = SummaryPhase.Hidden
            return@LaunchedEffect
        }
        val key = AiSummaryMemoryCache.key(mailboxId, threadId)
        val cached = if (force) null else AiSummaryMemoryCache.get(key)
        force = false
        if (cached != null) {
            phase = SummaryPhase.Ready(cached)
            return@LaunchedEffect
        }
        phase = SummaryPhase.Loading
        // One quiet retry for a model failure, none at the quota limit (web `retrySummaryOnce`).
        for (attempt in 0..1) {
            try {
                val summary = ApiClient.shared.getThreadSummary(mailboxId, threadId).readySummary
                phase = if (summary != null) {
                    AiSummaryMemoryCache.put(key, summary)
                    SummaryPhase.Ready(summary)
                } else {
                    SummaryPhase.Hidden
                }
                return@LaunchedEffect
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (AiSummaryQuota.isQuotaError(e)) {
                    phase = SummaryPhase.Failed(quota = true)
                    return@LaunchedEffect
                }
                if ((e as? ApiException.Http)?.code == 404) {
                    phase = SummaryPhase.Hidden
                    return@LaunchedEffect
                }
                if (attempt == 1) phase = SummaryPhase.Failed(quota = false)
            }
        }
    }

    fun regenerate() {
        if (regenerating || mailboxId == null) return
        regenerateError = null
        regenerating = true
        scope.launch {
            try {
                if (previewPhase() != null) {
                    kotlinx.coroutines.delay(900)
                    return@launch
                }
                val summary = ApiClient.shared.regenerateThreadSummary(mailboxId, threadId).readySummary
                if (summary != null) {
                    AiSummaryMemoryCache.put(AiSummaryMemoryCache.key(mailboxId, threadId), summary)
                    expanded = false
                    phase = SummaryPhase.Ready(summary)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                regenerateError = if (AiSummaryQuota.isQuotaError(e)) AiSummaryQuota.text() else "Couldn’t regenerate."
            } finally {
                regenerating = false
            }
        }
    }

    val visible = phase is SummaryPhase.Loading || phase is SummaryPhase.Ready || phase is SummaryPhase.Failed
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(summarySpring()),
        exit = fadeOut(summarySpring()),
        modifier = modifier,
    ) {
        SummaryCardBody(
            phase = phase,
            regenerating = regenerating,
            regenerateError = regenerateError,
            expanded = expanded,
            onToggleExpanded = { expanded = !expanded },
            onRegenerate = ::regenerate,
            onRetry = {
                force = true
                reloadToken++
            },
        )
    }
}

@Composable
private fun SummaryCardBody(
    phase: SummaryPhase,
    regenerating: Boolean,
    regenerateError: String?,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
    onRegenerate: () -> Unit,
    onRetry: () -> Unit,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = Modifier
            .padding(start = 16.dp, end = 16.dp, bottom = 12.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(colors.surface)
            .border(0.5.dp, colors.line, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .animateContentSize(summarySpring())
            .semantics { contentDescription = "AI summary" },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            Icons.Outlined.AutoAwesome,
            contentDescription = null,
            tint = colors.muted,
            modifier = Modifier
                .padding(top = 2.dp)
                .size(15.dp),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            when {
                phase is SummaryPhase.Ready && !regenerating -> {
                    SummaryText(phase.summary, expanded, onToggleExpanded)
                    if (regenerateError != null) {
                        Text(
                            "$regenerateError The previous summary is shown.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )
                    }
                }
                phase is SummaryPhase.Failed -> FailedText(phase.quota, onRetry)
                else -> SummarySkeleton()
            }
        }
        if (phase is SummaryPhase.Ready) {
            val rotation = if (regenerating) {
                val transition = rememberInfiniteTransition(label = "summaryRegenerate")
                transition.animateFloat(
                    initialValue = 0f,
                    targetValue = 360f,
                    animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing)),
                    label = "summaryRegenerateSpin",
                ).value
            } else {
                0f
            }
            Box(
                modifier = Modifier
                    .offset(x = 6.dp, y = (-5).dp)
                    .size(28.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable(enabled = !regenerating, onClick = onRegenerate)
                    .semantics { contentDescription = "Regenerate summary" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.Refresh,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier
                        .size(16.dp)
                        .rotate(rotation),
                )
            }
        }
    }
}

@Composable
private fun SummaryText(summary: AiSummary, expanded: Boolean, onToggleExpanded: () -> Unit) {
    val colors = inboxiesColors()
    var overflows by remember(summary.summary) { mutableStateOf(false) }
    val hasMore = overflows || summary.keyPoints.isNotEmpty()
    Text(
        summary.summary,
        fontFamily = InterFontFamily,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        color = colors.ink,
        maxLines = if (expanded) Int.MAX_VALUE else 2,
        overflow = TextOverflow.Ellipsis,
        onTextLayout = { if (!expanded) overflows = it.hasVisualOverflow },
    )
    if (expanded && summary.keyPoints.isNotEmpty()) {
        Column(
            modifier = Modifier.padding(top = 2.dp),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            summary.keyPoints.forEach { point ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("•", fontFamily = InterFontFamily, fontSize = 13.sp, lineHeight = 19.sp, color = colors.ink)
                    Text(point, fontFamily = InterFontFamily, fontSize = 13.sp, lineHeight = 19.sp, color = colors.ink)
                }
            }
        }
    }
    if (hasMore) {
        Text(
            if (expanded) "Show less" else "Show more",
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = colors.muted,
            modifier = Modifier.clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onToggleExpanded,
            ),
        )
    }
}

@Composable
private fun FailedText(quota: Boolean, onRetry: () -> Unit) {
    val colors = inboxiesColors()
    if (quota) {
        Text(
            AiSummaryQuota.text(),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
    } else {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Couldn’t summarize this email.", fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
            Text(
                "Try again",
                fontFamily = InterFontFamily,
                fontSize = 12.sp,
                color = colors.accent,
                modifier = Modifier.clickable(onClick = onRetry),
            )
        }
    }
}

/** Two muted bars, the height of the clamped text, while the model works. */
@Composable
private fun SummarySkeleton() {
    val colors = inboxiesColors()
    val pulse by rememberInfiniteTransition(label = "summarySkeleton").animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(950), RepeatMode.Reverse),
        label = "summarySkeletonAlpha",
    )
    Column(
        modifier = Modifier
            .height(34.dp)
            .fillMaxWidth()
            .alpha(pulse)
            .semantics { contentDescription = "Summarizing…" },
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(colors.pillActive),
        )
        Box(
            Modifier
                .fillMaxWidth(0.6f)
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(colors.pillActive),
        )
    }
}

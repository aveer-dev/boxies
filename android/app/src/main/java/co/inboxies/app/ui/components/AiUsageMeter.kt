package co.inboxies.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.AiUsageCounter
import co.inboxies.app.models.AiUsageFormat
import co.inboxies.app.models.AiUsageLevel
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.danger
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.warning
import java.time.Instant

private fun <T> meterSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

/**
 * Thin usage bar with "12 / 50 AI chats today" and the reset time (AVE-45).
 * Calm accent under 80%, warning tint from 80%, red at the limit. Twin of web
 * `AiUsageMeter` and iOS `AiUsageMeter`.
 */
@Composable
fun AiUsageMeter(
    counter: AiUsageCounter,
    /** Plural noun, e.g. "AI chats". */
    noun: String,
    resetsAt: Instant?,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val level = counter.level
    val fill by animateColorAsState(
        targetValue = when (level) {
            AiUsageLevel.Normal -> colors.accent
            AiUsageLevel.Warning -> colors.warning
            AiUsageLevel.Exhausted -> colors.danger
        },
        animationSpec = meterSpring(),
        label = "aiUsageFill",
    )
    val fraction by animateFloatAsState(
        targetValue = counter.fraction,
        animationSpec = meterSpring(),
        label = "aiUsageFraction",
    )
    val emphasized = level != AiUsageLevel.Normal

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "${counter.used} / ${counter.limit} $noun today",
                fontFamily = InterFontFamily,
                fontWeight = if (emphasized) FontWeight.Medium else FontWeight.Normal,
                fontSize = 11.sp,
                lineHeight = 16.sp,
                style = TextStyle(fontFeatureSettings = "tnum"),
                color = if (emphasized) colors.ink else colors.muted,
                maxLines = 1,
                modifier = Modifier.weight(1f),
            )
            Text(
                AiUsageFormat.resetText(resetsAt),
                fontFamily = InterFontFamily,
                fontSize = 11.sp,
                lineHeight = 16.sp,
                style = TextStyle(fontFeatureSettings = "tnum"),
                color = colors.muted,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(4.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(50))
                .background(colors.pillFill)
                .semantics {
                    contentDescription = "$noun used today"
                    progressBarRangeInfo = ProgressBarRangeInfo(
                        current = counter.used.toFloat(),
                        range = 0f..counter.limit.coerceAtLeast(1).toFloat(),
                    )
                },
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fraction)
                    .clip(RoundedCornerShape(50))
                    .background(fill),
            )
        }
    }
}

/**
 * Red-tinted notice shown above the chat composer once the daily chat limit is hit:
 * "**Daily AI chat limit reached.** You can chat again at 12:00 AM (in 5h)."
 */
@Composable
fun AiChatLimitNotice(resetsAt: Instant?, modifier: Modifier = Modifier) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.danger.copy(alpha = if (colors.isDark) 0.16f else 0.08f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            Icons.Outlined.WarningAmber,
            contentDescription = null,
            tint = colors.danger,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                    append("Daily AI chat limit reached.")
                }
                append(AiUsageFormat.chatAgainText(resetsAt))
            },
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = colors.ink,
            modifier = Modifier.weight(1f),
        )
    }
}

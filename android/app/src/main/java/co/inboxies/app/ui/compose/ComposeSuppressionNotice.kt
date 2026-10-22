package co.inboxies.app.ui.compose

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.services.BounceSuppression
import co.inboxies.app.services.SuppressedRecipient
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors

/**
 * Inline notice for a send the server refused because a recipient is on the bounce /
 * complaint suppression list (409 `recipient_suppressed`). Lists each address with its
 * reason and offers Un-suppress, which lifts them and sends again. iOS twin:
 * `ComposeSuppressionNotice.swift`.
 */
@Composable
fun ComposeSuppressionNotice(
    suppressed: List<SuppressedRecipient>,
    busy: Boolean,
    disabled: Boolean,
    onUnsuppressAndSend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (suppressed.isEmpty()) return
    val colors = inboxiesColors()
    val canLiftAll = suppressed.all { it.canUnsuppress }
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(colors.surface, shape)
            .border(0.5.dp, colors.line, shape)
            .padding(12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            "Not sent",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            color = colors.deepDarkRed,
        )
        suppressed.forEach { recipient ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    recipient.address,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val reason = BounceSuppression.reasonText(recipient) + "."
                Text(
                    recipient.detail?.let { "$reason $it" } ?: reason,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )
                if (!recipient.canUnsuppress) {
                    Text(
                        BounceSuppression.ASK_ADMIN_TEXT,
                        fontFamily = InterFontFamily,
                        fontSize = 12.sp,
                        color = colors.muted,
                    )
                }
            }
        }
        if (canLiftAll) {
            Button(
                onClick = onUnsuppressAndSend,
                enabled = !busy && !disabled,
                shape = RoundedCornerShape(50),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = colors.ink,
                    contentColor = colors.background,
                    disabledContainerColor = colors.ink.copy(alpha = 0.6f),
                    disabledContentColor = colors.background,
                ),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(14.dp),
                            strokeWidth = 2.dp,
                            color = colors.background,
                        )
                        Spacer(Modifier.size(6.dp))
                    }
                    Text(
                        BounceSuppression.buttonTitle(suppressed.size),
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                    )
                }
            }
        }
        Text(
            BounceSuppression.footerText(canLiftAll),
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            color = colors.muted,
        )
    }
}

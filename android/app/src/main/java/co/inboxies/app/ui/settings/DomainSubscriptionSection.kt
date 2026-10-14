package co.inboxies.app.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.models.DomainService
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.DomainRenewal
import co.inboxies.app.ui.components.formatServiceDate
import co.inboxies.app.ui.components.renewByLine

/**
 * Domain admin "Subscription" card: where the domain's service stands, the renewal
 * deadline for domains Inboxies registered, and Renew / Keep. Hidden for domains
 * without Inboxies billing (or before the service has loaded).
 */
@Composable
internal fun DomainSubscriptionSection(
    domain: String,
    service: DomainService?,
    renewal: DomainRenewal,
    title: String = "Subscription",
    /** Inside a container that already pads horizontally (the admin console). */
    nested: Boolean = false,
) {
    if (service == null || service.billed == false || domain.isBlank()) return
    val groupInset = if (nested) 0.dp else 16.dp
    val textInset = if (nested) 4.dp else 20.dp
    val colors = inboxiesColors()
    val divider = colors.line.copy(alpha = 0.65f)
    // Same status hues as the zone pill above.
    val (statusLabel, statusColor) = when {
        service.isEnded -> "Ended" to colors.deepDarkRed
        service.isEnding -> (formatServiceDate(service.endsAt)?.let { "Ends $it" } ?: "Ending") to Color(0xFFEA580C)
        else -> "Active" to Color(0xFF16A34A)
    }
    val canAct = service.canManage != false && service.canRenew
    val isWorking = renewal.workingDomain == domain

    SettingsFormSectionHeader(title, horizontalInset = textInset)
    SettingsFormGroup(horizontalInset = groupInset) {
        SubscriptionInfoRow("Status") {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(statusColor.copy(alpha = 0.12f))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Text(
                    statusLabel,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 12.sp,
                    color = statusColor,
                )
            }
        }
        formatServiceDate(service.registrationExpiresAt)?.let { expires ->
            HorizontalDivider(thickness = 0.5.dp, color = divider)
            SubscriptionInfoRow("Registration expires") { SubscriptionValue(expires) }
        }
        if (service.isEnded && service.registrarManaged) {
            formatServiceDate(service.renewBy)?.let { renewBy ->
                HorizontalDivider(thickness = 0.5.dp, color = divider)
                SubscriptionInfoRow("Renew by") {
                    val days = service.daysLeftToRenew
                    SubscriptionValue(
                        when (days) {
                            null -> renewBy
                            0 -> "$renewBy · last day"
                            1 -> "$renewBy · 1 day left"
                            else -> "$renewBy · $days days left"
                        },
                    )
                }
            }
        }
        if (canAct && (service.isEnded || service.isEnding)) {
            HorizontalDivider(thickness = 0.5.dp, color = divider)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !isWorking) { renewal.renew(domain) }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (isWorking) {
                    CircularProgressIndicator(
                        color = colors.accent,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(16.dp),
                    )
                } else {
                    Icon(
                        Icons.Outlined.Autorenew,
                        contentDescription = null,
                        tint = colors.accent,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    if (service.isEnded) "Renew subscription" else "Keep subscription",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = colors.accent,
                )
            }
        }
    }
    val footer = when {
        service.isEnded && !service.canRenew ->
            "This domain can no longer be renewed. You can still export your mail or move the domain."
        service.isEnded -> listOfNotNull(
            "Mail on $domain is read-only, and DNS, aliases and users can't be changed until it's renewed. " +
                "Export and transfer still work.",
            renewByLine(service).takeIf { !canAct },
            "Ask an admin of $domain to renew.".takeIf { service.canManage == false },
        ).joinToString(" ")
        service.isEnding -> "Mail keeps working until then. Keep the subscription to stay in service."
        else -> null
    }
    footer?.let { SettingsFormFooter(it, horizontalInset = textInset) }
    renewal.errorMessage?.takeIf { renewal.workingDomain == null }?.let {
        Text(
            it,
            color = colors.deepDarkRed,
            fontFamily = InterFontFamily,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = textInset, vertical = 4.dp),
        )
    }
}

@Composable
private fun SubscriptionInfoRow(label: String, value: @Composable () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = colors.muted,
            modifier = Modifier.weight(1f),
        )
        value()
    }
}

@Composable
private fun SubscriptionValue(text: String) {
    Text(
        text,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        color = inboxiesColors().ink,
    )
}

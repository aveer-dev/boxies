package co.inboxies.app.ui.components

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.DomainService
import co.inboxies.app.services.AppModel
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.utils.DateUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What to tell someone about a domain whose subscription ended (read-only) or is set to
 * end. Shared by the home banner and the admin "Subscription" sections.
 */
data class DomainServiceCopy(
    val title: String,
    val detail: String?,
    /** "Renew" / "Keep subscription"; null when this viewer can't act. */
    val actionLabel: String?,
    val isEnded: Boolean,
)

/**
 * [readOnly] is the mailbox flag (it may arrive before [service] does). Admins get the
 * action; everyone else is pointed at an admin. "Ending" notices are for admins only.
 */
fun domainServiceCopy(
    domain: String,
    service: DomainService?,
    readOnly: Boolean,
    isAdmin: Boolean,
): DomainServiceCopy? {
    if (readOnly || service?.isEnded == true) {
        val title = "Your subscription for $domain ended. Mail is read-only."
        if (service == null) return DomainServiceCopy(title, null, null, isEnded = true)
        if (!service.canRenew) {
            return DomainServiceCopy(
                title,
                "This domain can no longer be renewed. You can still read and export your mail.",
                null,
                isEnded = true,
            )
        }
        val detail = listOfNotNull(
            renewByLine(service),
            if (!isAdmin) "Ask an admin of $domain to renew." else null,
        ).joinToString(" ").ifBlank { null }
        return DomainServiceCopy(title, detail, if (isAdmin) "Renew" else null, isEnded = true)
    }
    if (service?.isEnding == true && isAdmin) {
        val title = formatServiceDate(service.endsAt)
            ?.let { "Service for $domain ends on $it." }
            ?: "Service for $domain is set to end."
        return DomainServiceCopy(
            title,
            null,
            if (service.canRenew) "Keep subscription" else null,
            isEnded = false,
        )
    }
    return null
}

/** "Renew by Nov 23, 2026 (12 days left)." for domains Inboxies registered. */
fun renewByLine(service: DomainService): String? {
    if (!service.registrarManaged) return null
    val date = formatServiceDate(service.renewBy) ?: return null
    val left = when (val days = service.daysLeftToRenew) {
        null -> null
        0 -> "last day"
        1 -> "1 day left"
        else -> "$days days left"
    }
    return if (left != null) "Renew by $date ($left)." else "Renew by $date."
}

fun formatServiceDate(iso: String?): String? {
    val instant = iso?.let { DateUtils.parseIso(it) } ?: return null
    return DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.getDefault())
        .withZone(ZoneId.systemDefault())
        .format(instant)
}

/**
 * Starts a renewal (or "keep") and opens Stripe Checkout in the browser when one comes
 * back; the checkout returns through `inboxies://billing/renewed|renew-cancelled`.
 */
@Stable
class DomainRenewal internal constructor(
    private val app: AppModel,
    private val context: Context,
    private val scope: CoroutineScope,
) {
    var workingDomain by mutableStateOf<String?>(null)
        private set
    var errorMessage by mutableStateOf<String?>(null)

    fun renew(domain: String) {
        if (workingDomain != null) return
        workingDomain = domain
        errorMessage = null
        scope.launch {
            when (val outcome = app.renewDomain(domain)) {
                is AppModel.RenewOutcome.Checkout -> openCheckout(outcome.url)
                is AppModel.RenewOutcome.Failed -> {
                    errorMessage = outcome.message
                    app.showToast(outcome.message, isError = true)
                }
                else -> Unit
            }
            workingDomain = null
        }
    }

    private fun openCheckout(url: String) {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onFailure {
            val message = "Couldn't open the checkout page."
            errorMessage = message
            app.showToast(message, isError = true)
        }
    }
}

@Composable
fun rememberDomainRenewal(): DomainRenewal {
    val app = LocalAppModel.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    return remember(app, context, scope) { DomainRenewal(app, context, scope) }
}

/**
 * Calm, persistent home-shell notice: neutral card for a read-only (ended) mailbox, a
 * subtle accent row for an admin whose subscription is set to end.
 */
@Composable
fun DomainServiceBanner(
    copy: DomainServiceCopy,
    isWorking: Boolean,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(12.dp)
    val tint = if (copy.isEnded) colors.ink else colors.accent
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (copy.isEnded) colors.surface else colors.accent.copy(alpha = 0.08f))
            .border(
                BorderStroke(
                    0.5.dp,
                    if (copy.isEnded) colors.line else colors.accent.copy(alpha = 0.25f),
                ),
                shape,
            )
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (copy.isEnded) colors.pillFill else colors.accent.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (copy.isEnded) Icons.Outlined.Lock else Icons.Outlined.Schedule,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(18.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                copy.title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = colors.ink,
            )
            copy.detail?.let {
                Text(
                    it,
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.muted,
                )
            }
        }
        copy.actionLabel?.let { label ->
            Spacer(Modifier.width(10.dp))
            DomainServiceActionPill(
                label = label,
                isWorking = isWorking,
                prominent = copy.isEnded,
                onClick = onAction,
            )
        }
    }
}

/** Ink-on-surface pill for Renew (white on ink); accent text for the quieter Keep. */
@Composable
fun DomainServiceActionPill(
    label: String,
    isWorking: Boolean,
    prominent: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = inboxiesColors()
    val fill = if (prominent) colors.ink else colors.surface
    val content = if (prominent) colors.surface else colors.accent
    Box(
        modifier = modifier
            .height(32.dp)
            .clip(RoundedCornerShape(50))
            .background(fill)
            .then(
                if (prominent) Modifier else Modifier.border(0.5.dp, colors.accent.copy(alpha = 0.35f), RoundedCornerShape(50)),
            )
            .clickable(enabled = !isWorking, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (isWorking) {
            CircularProgressIndicator(
                color = content,
                strokeWidth = 2.dp,
                modifier = Modifier.size(14.dp),
            )
        } else {
            Text(
                label,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = content,
                maxLines = 1,
            )
        }
    }
}

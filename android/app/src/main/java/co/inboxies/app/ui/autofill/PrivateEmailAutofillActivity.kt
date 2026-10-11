package co.inboxies.app.ui.autofill

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import co.inboxies.app.InboxiesApplication
import co.inboxies.app.R
import co.inboxies.app.models.Mailbox
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import kotlinx.coroutines.launch

/**
 * Opened from the Private email AutoFill suggestion. The user confirms a label and
 * the mailbox it forwards to; the server creates the address, and it is returned
 * to the system as the dataset to fill.
 */
class PrivateEmailAutofillActivity : ComponentActivity() {

    companion object {
        private const val EXTRA_FIELD_ID = "co.inboxies.app.autofill.FIELD_ID"
        private const val EXTRA_LABEL = "co.inboxies.app.autofill.LABEL"

        fun intent(context: Context, fieldId: AutofillId, label: String): Intent =
            Intent(context, PrivateEmailAutofillActivity::class.java)
                .putExtra(EXTRA_FIELD_ID, fieldId)
                .putExtra(EXTRA_LABEL, label)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val fieldId = intent.getParcelableExtra(EXTRA_FIELD_ID, AutofillId::class.java)
        if (fieldId == null) {
            setResult(RESULT_CANCELED)
            finish()
            return
        }
        val auth = (application as InboxiesApplication).authStore
        val themeMode = ThemeMode.fromStorage(
            getSharedPreferences("inboxies_prefs", MODE_PRIVATE).getString("app_theme", null),
        )
        setContent {
            InboxiesTheme(themeMode = themeMode) {
                PrivateEmailAutofillDialog(
                    suggestedLabel = intent.getStringExtra(EXTRA_LABEL),
                    rememberedMailboxId = auth.autofillMailboxId(),
                    onCreated = { address -> fill(fieldId, address) },
                    onDismiss = {
                        setResult(RESULT_CANCELED)
                        finish()
                    },
                )
            }
        }
    }

    private fun fill(fieldId: AutofillId, address: String) {
        val presentation = RemoteViews(packageName, R.layout.autofill_inline_suggestion).apply {
            setTextViewText(R.id.autofill_title, "Private email")
            setTextViewText(R.id.autofill_subtitle, address)
        }
        @Suppress("DEPRECATION") // Matches the auth dataset built in InboxiesAutofillService.
        val dataset = Dataset.Builder(presentation)
            .setValue(fieldId, AutofillValue.forText(address))
            .build()
        setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
        finish()
    }
}

private sealed interface MailboxesState {
    data object Loading : MailboxesState
    data object SignedOut : MailboxesState
    data class Failed(val message: String) : MailboxesState
    data class Ready(val mailboxes: List<Mailbox>) : MailboxesState
}

/** Same signal iOS uses: a dead bearer is 401, or 403 with this text. */
private fun Exception.isExpiredSession(): Boolean =
    this is ApiException.Http && (
        code == 401 ||
            (code == 403 && message.orEmpty().contains("invalid or expired mobile session token", ignoreCase = true))
        )

@Composable
private fun PrivateEmailAutofillDialog(
    suggestedLabel: String?,
    rememberedMailboxId: String?,
    onCreated: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<MailboxesState>(MailboxesState.Loading) }
    var loadAttempt by remember { mutableIntStateOf(0) }
    var label by rememberSaveable { mutableStateOf(suggestedLabel.orEmpty()) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var isCreating by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(loadAttempt) {
        state = MailboxesState.Loading
        state = try {
            val list = ApiClient.shared.listMailboxes()
            if (list.none { it.id == selectedId }) {
                selectedId = (list.firstOrNull { it.id == rememberedMailboxId } ?: list.firstOrNull())?.id
            }
            if (list.isEmpty()) MailboxesState.Failed("Add a mailbox in Inboxies first.") else MailboxesState.Ready(list)
        } catch (e: Exception) {
            if (e.isExpiredSession()) {
                MailboxesState.SignedOut
            } else {
                MailboxesState.Failed("Couldn't load your mailboxes. Check your connection and try again.")
            }
        }
    }

    fun create() {
        val mailboxId = selectedId ?: return
        scope.launch {
            isCreating = true
            errorMessage = null
            try {
                val created = ApiClient.shared.createAlias(
                    mailboxId = mailboxId,
                    label = label.trim().takeIf { it.isNotEmpty() },
                )
                onCreated(created.alias.aliasEmail)
            } catch (e: Exception) {
                if (e.isExpiredSession()) {
                    state = MailboxesState.SignedOut
                } else {
                    errorMessage = (e as? ApiException.Http)?.message ?: "Failed to create private email"
                }
            } finally {
                isCreating = false
            }
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(colors.surface)
                .border(0.5.dp, colors.line, RoundedCornerShape(16.dp))
                .padding(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "New Private Email",
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 17.sp,
                        color = colors.ink,
                    )
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = "Close",
                        tint = colors.ink,
                        modifier = Modifier
                            .size(24.dp)
                            .clickable(onClick = onDismiss),
                    )
                }

                when (val current = state) {
                    MailboxesState.Loading -> Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(96.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(
                            color = colors.accent,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(24.dp),
                        )
                    }

                    MailboxesState.SignedOut -> Text(
                        "Open the Inboxies app and sign in, then come back to create a private email.",
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                    )

                    is MailboxesState.Failed -> {
                        Text(
                            current.message,
                            fontFamily = InterFontFamily,
                            fontSize = 13.sp,
                            color = colors.deepDarkRed,
                        )
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { loadAttempt++ }) {
                                Text(
                                    "Try Again",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    color = colors.accent,
                                )
                            }
                        }
                    }

                    is MailboxesState.Ready -> {
                        Text(
                            "Inboxies creates a new private address and fills it in. Mail sent to it forwards to your mailbox. Pause or delete it any time in Settings → Private email.",
                            fontFamily = InterFontFamily,
                            fontSize = 12.sp,
                            color = colors.muted,
                        )

                        OutlinedTextField(
                            value = label,
                            onValueChange = { label = it },
                            label = { Text("Label", fontFamily = InterFontFamily) },
                            placeholder = { Text("e.g., Online Store, Newsletter", fontFamily = InterFontFamily) },
                            singleLine = true,
                            enabled = !isCreating,
                            modifier = Modifier.fillMaxWidth(),
                        )

                        ForwardsToRow(
                            mailboxes = current.mailboxes,
                            selectedId = selectedId,
                            enabled = !isCreating,
                            onSelect = { selectedId = it },
                        )

                        errorMessage?.let { message ->
                            Text(
                                message,
                                fontFamily = InterFontFamily,
                                fontSize = 12.sp,
                                color = colors.deepDarkRed,
                            )
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(
                                onClick = ::create,
                                enabled = !isCreating && selectedId != null,
                            ) {
                                if (isCreating) {
                                    CircularProgressIndicator(
                                        color = colors.accent,
                                        strokeWidth = 2.dp,
                                        modifier = Modifier.size(16.dp),
                                    )
                                } else {
                                    Text(
                                        "Create Address",
                                        fontFamily = InterFontFamily,
                                        fontWeight = FontWeight.SemiBold,
                                        color = colors.accent,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "Forwards to" with the mailbox email; a menu when there is more than one. */
@Composable
private fun ForwardsToRow(
    mailboxes: List<Mailbox>,
    selectedId: String?,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    val colors = inboxiesColors()
    val selected = mailboxes.firstOrNull { it.id == selectedId } ?: return
    var expanded by remember { mutableStateOf(false) }
    val canPick = mailboxes.size > 1 && enabled

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Forwards to",
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = colors.ink,
        )
        Spacer(Modifier.width(12.dp))
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            Row(
                modifier = Modifier.clickable(enabled = canPick) { expanded = true },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    selected.email,
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (mailboxes.size > 1) {
                    Icon(
                        Icons.Outlined.UnfoldMore,
                        contentDescription = null,
                        tint = colors.muted,
                        modifier = Modifier
                            .padding(start = 4.dp)
                            .size(16.dp),
                    )
                }
            }
            InboxiesDropdownMenu(expanded = expanded, onDismiss = { expanded = false }) {
                mailboxes.forEach { mailbox ->
                    InboxiesMenuItem(
                        text = mailbox.email,
                        onClick = {
                            onSelect(mailbox.id)
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

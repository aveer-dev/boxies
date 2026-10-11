package co.inboxies.app.autofill

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.view.HapticFeedbackConstants
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import co.inboxies.app.InboxiesApplication
import co.inboxies.app.MainActivity
import co.inboxies.app.R
import co.inboxies.app.models.MaskedAlias
import co.inboxies.app.services.ApiClient
import co.inboxies.app.services.ApiException
import co.inboxies.app.services.AutofillMailboxPreference
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import co.inboxies.app.ui.components.PrivateEmailLogoView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Autofill dataset authentication for "Create private email". Creates the alias in the
 * autofill mailbox through the API, then returns the filled dataset to the framework.
 * Signed out (or no mailbox yet): opens Inboxies and cancels, so the suggestion stays.
 */
class PrivateEmailAutofillActivity : ComponentActivity() {

    private class SignInRequired : Exception()

    /** Null while creating; the reason once creation failed. */
    private var failureMessage by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(Activity.RESULT_CANCELED)

        // Recreated after process death: the original request may already have run.
        if (savedInstanceState != null) {
            finish()
            return
        }

        val fieldIds = intent.getParcelableArrayListExtra(EXTRA_FIELD_IDS, AutofillId::class.java).orEmpty()
        val label = intent.getStringExtra(EXTRA_LABEL)
        if (fieldIds.isEmpty()) {
            finish()
            return
        }

        val auth = (application as InboxiesApplication).authStore
        if (auth.currentToken().isNullOrEmpty()) {
            openInboxies()
            return
        }

        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        val themeMode = ThemeMode.fromStorage(
            getSharedPreferences("inboxies_prefs", MODE_PRIVATE).getString("app_theme", null),
        )
        setContent {
            InboxiesTheme(themeMode = themeMode) {
                PrivateEmailAutofillCard(
                    failureMessage = failureMessage,
                    label = label,
                    onDismiss = { finish() },
                )
            }
        }

        lifecycleScope.launch {
            try {
                val aliasEmail = createAlias(label)
                setResult(
                    Activity.RESULT_OK,
                    Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, filledDataset(fieldIds, aliasEmail)),
                )
                window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                finish()
            } catch (e: CancellationException) {
                throw e
            } catch (_: SignInRequired) {
                openInboxies()
            } catch (e: Exception) {
                failureMessage = (e as? ApiException.Http)?.message?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.autofill_create_failed)
            }
        }
    }

    /** Remembered mailbox first; falls back to the account's first mailbox if it's gone. */
    private suspend fun createAlias(label: String?): String {
        val api = ApiClient.shared
        AutofillMailboxPreference.mailboxId()?.let { mailboxId ->
            try {
                return api.createAlias(mailboxId, label = label, pausedAction = MaskedAlias.PAUSED_DROP).alias.aliasEmail
            } catch (e: ApiException.Http) {
                when (e.code) {
                    401 -> throw SignInRequired()
                    403, 404 -> AutofillMailboxPreference.clear()
                    else -> throw e
                }
            }
        }
        val mailboxId = try {
            api.listMailboxes().firstOrNull()?.id
        } catch (e: ApiException.Http) {
            if (e.code == 401) throw SignInRequired() else throw e
        } ?: throw SignInRequired()
        AutofillMailboxPreference.save(mailboxId)
        return api.createAlias(mailboxId, label = label, pausedAction = MaskedAlias.PAUSED_DROP).alias.aliasEmail
    }

    /** Same address in every email field (e.g. "Email" + "Confirm email"). */
    private fun filledDataset(fieldIds: List<AutofillId>, aliasEmail: String): Dataset =
        Dataset.Builder()
            .apply {
                fieldIds.forEach { id ->
                    setField(id, Field.Builder().setValue(AutofillValue.forText(aliasEmail)).build())
                }
            }
            .build()

    /** Sign in / finish onboarding in the app; the suggestion stays for the next try. */
    private fun openInboxies() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    companion object {
        private const val EXTRA_FIELD_IDS = "co.inboxies.app.autofill.FIELD_IDS"
        private const val EXTRA_LABEL = "co.inboxies.app.autofill.LABEL"

        fun intent(context: Context, fieldIds: List<AutofillId>, label: String?): Intent =
            Intent(context, PrivateEmailAutofillActivity::class.java)
                .putParcelableArrayListExtra(EXTRA_FIELD_IDS, ArrayList(fieldIds))
                .putExtra(EXTRA_LABEL, label)
    }
}

/** Bottom card over a light scrim while the address is created (usually well under a second). */
@Composable
private fun PrivateEmailAutofillCard(
    failureMessage: String?,
    label: String?,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(HomeChromeMetrics.modalScrim)
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() },
                onClick = onDismiss,
            ),
    ) {
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .navigationBarsPadding()
                .padding(horizontal = HomeChromeMetrics.chromeHorizontalPadding)
                .padding(bottom = HomeChromeMetrics.chromeBottomPadding)
                .fillMaxWidth()
                .liquidGlass(RoundedCornerShape(HomeChromeMetrics.menuCornerRadius))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                    onClick = {},
                )
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            PrivateEmailLogoView(size = 28.dp)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    failureMessage ?: stringResource(R.string.autofill_creating),
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = if (failureMessage != null) colors.deepDarkRed else colors.ink,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                if (label != null) {
                    Text(
                        stringResource(R.string.autofill_creating_for, label),
                        fontFamily = InterFontFamily,
                        fontSize = 13.sp,
                        color = colors.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (failureMessage != null) {
                IconButton(
                    onClick = {
                        view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                        onDismiss()
                    },
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = stringResource(R.string.autofill_close),
                        tint = colors.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
            } else {
                CircularProgressIndicator(
                    color = colors.muted,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

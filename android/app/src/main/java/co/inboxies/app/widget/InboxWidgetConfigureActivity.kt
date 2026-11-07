package co.inboxies.app.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.datastore.preferences.core.Preferences
import androidx.lifecycle.lifecycleScope
import co.inboxies.app.theme.AppThemeDims
import co.inboxies.app.theme.InboxiesTheme
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.ThemeMode
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch

/**
 * Picks the mailbox a "Today's inbox" widget shows (AVE-150). Optional at placement
 * (`configuration_optional`) and reachable later from the launcher's widget settings
 * (`reconfigurable`). "Last active mailbox" (the default) follows whichever mailbox the
 * app last opened (AVE-90). iOS twin: the widget's `AppIntentConfiguration` picker.
 */
class InboxWidgetConfigureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        val manager = AppWidgetManager.getInstance(this)
        // Only our own widgets (the activity is exported for the launcher).
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID ||
            manager.getAppWidgetInfo(appWidgetId)?.provider?.packageName != packageName
        ) {
            finish()
            return
        }
        // Closing keeps the widget, following the last active mailbox.
        setResult(RESULT_OK, resultIntent(appWidgetId))
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT),
        )
        val store = InboxWidgetStore.from(this)
        val themeMode = ThemeMode.fromStorage(
            getSharedPreferences("inboxies_prefs", MODE_PRIVATE).getString("app_theme", null),
        )
        lifecycleScope.launch {
            val glanceId = runCatching { GlanceAppWidgetManager(this@InboxWidgetConfigureActivity).getGlanceIdBy(appWidgetId) }
                .getOrNull()
            val current = glanceId?.let {
                runCatching {
                    getAppWidgetState<Preferences>(this@InboxWidgetConfigureActivity, PreferencesGlanceStateDefinition, it)
                }.getOrNull()?.let(InboxWidgetDeckState::configuredMailboxId)
            }
            setContent {
                InboxiesTheme(themeMode = themeMode) {
                    MailboxPicker(
                        mailboxes = store.mailboxes(),
                        selected = current,
                        onClose = { finish() },
                        onPick = { mailboxId ->
                            lifecycleScope.launch {
                                if (glanceId != null) {
                                    updateAppWidgetState(this@InboxWidgetConfigureActivity, glanceId) { prefs ->
                                        if (mailboxId == null) prefs.remove(InboxWidgetDeckState.mailboxIdKey)
                                        else prefs[InboxWidgetDeckState.mailboxIdKey] = mailboxId
                                    }
                                    TodayInboxWidget().update(this@InboxWidgetConfigureActivity, glanceId)
                                }
                                finish()
                            }
                        },
                    )
                }
            }
        }
    }

    private fun resultIntent(appWidgetId: Int) =
        Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
}

@Composable
private fun MailboxPicker(
    mailboxes: List<InboxWidgetStore.MailboxRef>,
    selected: String?,
    onClose: () -> Unit,
    onPick: (String?) -> Unit,
) {
    val colors = inboxiesColors()
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Text(
                "Today's inbox",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 22.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Outlined.Close, contentDescription = "Close", tint = colors.ink)
            }
        }
        Text(
            "Choose the mailbox this widget shows.",
            fontFamily = InterFontFamily,
            fontSize = 13.sp,
            color = colors.muted,
            modifier = Modifier.padding(top = 2.dp, bottom = 16.dp),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.surface, shape)
                .border(0.5.dp, colors.line, shape),
        ) {
            PickerRow(
                title = "Last active mailbox",
                subtitle = "Follows the mailbox you last opened",
                isSelected = selected == null || mailboxes.none { it.id == selected },
                onClick = { onPick(null) },
            )
            mailboxes.forEach { mailbox ->
                Box(
                    Modifier.padding(start = 16.dp).fillMaxWidth().height(AppThemeDims.List.separatorHeight)
                        .background(colors.line),
                )
                PickerRow(
                    title = mailbox.address,
                    subtitle = null,
                    isSelected = mailbox.id == selected,
                    onClick = { onPick(mailbox.id) },
                )
            }
        }
        if (mailboxes.isEmpty()) {
            Text(
                "Sign in to Inboxies to pick a mailbox.",
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
                modifier = Modifier.padding(top = 12.dp),
            )
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PickerRow(title: String, subtitle: String?, isSelected: Boolean, onClick: () -> Unit) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(subtitle, fontFamily = InterFontFamily, fontSize = 12.sp, color = colors.muted)
            }
        }
        if (isSelected) {
            Icon(Icons.Rounded.Check, contentDescription = "Selected", tint = colors.ink, modifier = Modifier.size(18.dp))
        }
    }
}

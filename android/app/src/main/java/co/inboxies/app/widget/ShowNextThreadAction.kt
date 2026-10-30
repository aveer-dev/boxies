package co.inboxies.app.widget

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.state.updateAppWidgetState

/**
 * The deck's › on the "Today's inbox" widget (AVE-150): brings the next New thread to
 * the front of this widget's deck, wrapping after the last. RemoteViews can't animate,
 * so the cards swap instantly. iOS twin: `ShowNextThreadIntent`.
 */
class ShowNextThreadAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val mailboxId = parameters[TodayInboxWidget.mailboxParam] ?: return
        val snapshot = InboxWidgetStore.from(context).snapshot(mailboxId)
        var moved = false
        updateAppWidgetState(context, glanceId) { prefs ->
            moved = InboxWidgetDeckState.advance(prefs, snapshot) != null
        }
        if (moved) TodayInboxWidget().update(context, glanceId)
    }
}

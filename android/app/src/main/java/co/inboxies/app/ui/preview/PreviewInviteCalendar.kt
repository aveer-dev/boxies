package co.inboxies.app.ui.preview

import android.content.Context
import co.inboxies.app.models.CalendarBusyEvent
import co.inboxies.app.models.EmailInvite
import co.inboxies.app.services.InviteCalendarAccess
import co.inboxies.app.services.InviteCalendarChoice
import co.inboxies.app.services.InviteCalendarStore

/**
 * DEBUG fixture calendars for the Invite card (AVE-206), so free/busy can be
 * screenshotted without a real calendar or the permission dialog. Peer of iOS
 * `PreviewInviteCalendar` (`-previewInviteFreeBusy free|conflict|added|ask`).
 */
class PreviewInviteCalendar(private val scenario: Scenario) : InviteCalendarStore {
    enum class Scenario { Free, Conflict, Added, Ask }

    private var granted = scenario != Scenario.Ask
    private var nextId = 1L

    override val usesSystemPermission: Boolean get() = false
    override val autoAdds: Boolean get() = scenario == Scenario.Added

    override fun access(context: Context) =
        if (granted) InviteCalendarAccess.Full else InviteCalendarAccess.Askable

    override fun recordRequestResult(context: Context, granted: Boolean) {
        this.granted = granted
    }

    override fun writableCalendars(context: Context): List<InviteCalendarChoice> =
        if (!granted) {
            emptyList()
        } else {
            listOf(
                InviteCalendarChoice(1, "Family", 0xFF34C759.toInt(), isPrimary = false),
                InviteCalendarChoice(2, "Personal", 0xFFFF9500.toInt(), isPrimary = false),
                InviteCalendarChoice(3, "Work", 0xFF007AFF.toInt(), isPrimary = true),
            )
        }

    override fun events(context: Context, beginMillis: Long, endMillis: Long): List<CalendarBusyEvent> {
        val minute = 60_000L
        val events = mutableListOf<CalendarBusyEvent>()
        if (scenario == Scenario.Conflict) {
            events += CalendarBusyEvent("Team sync", beginMillis + 30 * minute, beginMillis + 60 * minute)
            events += CalendarBusyEvent("1:1 with Sam", beginMillis + 45 * minute, beginMillis + 75 * minute)
        }
        // A free (transparent) block that must not count.
        events += CalendarBusyEvent("Focus time", beginMillis, endMillis, showsAsFree = true)
        return events
    }

    override fun add(context: Context, invite: EmailInvite, calendarId: Long): Long = nextId++

    override fun remove(context: Context, eventId: Long): Boolean = true
}

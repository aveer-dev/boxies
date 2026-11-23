package co.inboxies.app.services

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import co.inboxies.app.models.CalendarBusyEvent
import co.inboxies.app.models.CalendarEventValues
import co.inboxies.app.models.EmailInvite

// The phone's own calendars for the Invite card (AVE-206). CalendarContract already
// holds the Google, Outlook and other accounts synced to the device, so there are no
// server tokens. iOS twin: `InviteCalendarStore` / `EventKitInviteCalendar`.

/**
 * Calendar access as the Invite card sees it. Only [Full] reads free/busy and adds in
 * one tap; everything else falls back to the system add-event screen.
 */
enum class InviteCalendarAccess { Full, Askable, Denied }

/** A calendar the event can be written to. */
data class InviteCalendarChoice(
    val id: Long,
    val title: String,
    /** The calendar's own ARGB colour, shown as a dot. */
    val color: Int?,
    val isPrimary: Boolean,
)

interface InviteCalendarStore {
    /** False for the DEBUG fake: it is granted without the system dialog. */
    val usesSystemPermission: Boolean get() = true
    /** DEBUG `inviteCardAdded`: tap Add once on appear so the Undo toast shows. */
    val autoAdds: Boolean get() = false
    /**
     * [showsRationale] is `shouldShowRequestPermissionRationale` for the calendar
     * permissions (needs the activity, so the card reads it): true means the system
     * will show the dialog again.
     */
    fun access(context: Context, showsRationale: Boolean): InviteCalendarAccess
    /** The system dialog answered: remember a refusal only once the system won't ask again (AVE-236). */
    fun recordRequestResult(context: Context, granted: Boolean, showsRationale: Boolean)
    fun writableCalendars(context: Context): List<InviteCalendarChoice>
    fun events(context: Context, beginMillis: Long, endMillis: Long): List<CalendarBusyEvent>
    /** Writes the invite to [calendarId] and returns the new event's id. */
    fun add(context: Context, invite: EmailInvite, calendarId: Long): Long?
    fun remove(context: Context, eventId: Long): Boolean
}

object InviteCalendar {
    val permissions = arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

    /** The calendar picked last on the card (`inboxies_prefs`). */
    const val CHOSEN_CALENDAR_KEY = "invite_calendar_id"
    /** Before AVE-236 any refusal (even a dismissed dialog) set this; no longer trusted. */
    private const val LEGACY_DENIED_KEY = "invite_calendar_denied"
    /** The system won't show the dialog again: only Settings can grant. */
    private const val BLOCKED_KEY = "invite_calendar_blocked"
    /** "Don't allow" was tapped at least once (the rationale flag was seen). */
    private const val REFUSED_KEY = "invite_calendar_refused"
    /** The last request came back refused with no rationale (dismissed, or never shown). */
    private const val UNANSWERED_KEY = "invite_calendar_unanswered"
    private const val PREFS = "inboxies_prefs"

    /** DEBUG previews swap in a fake (`PreviewInviteCalendar`). */
    @Volatile var override: InviteCalendarStore? = null

    val current: InviteCalendarStore get() = override ?: PhoneInviteCalendar

    fun chosenCalendarId(context: Context): Long? =
        prefs(context).getLong(CHOSEN_CALENDAR_KEY, -1L).takeIf { it >= 0 }

    fun setChosenCalendarId(context: Context, id: Long) {
        prefs(context).edit().putLong(CHOSEN_CALENDAR_KEY, id).apply()
    }

    /** The remembered calendar while it is still writable, else the primary one. */
    fun pick(calendars: List<InviteCalendarChoice>, chosen: Long?): InviteCalendarChoice? =
        calendars.firstOrNull { it.id == chosen }
            ?: calendars.firstOrNull { it.isPrimary }
            ?: calendars.firstOrNull()

    internal fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Android shows the dialog again after a dismissal or a first "Don't allow", so
     * only a refusal the system will not re-ask counts as [InviteCalendarAccess.Denied].
     * A stored block is ignored while the rationale says the dialog can show again
     * (e.g. permissions reset), and the pre-AVE-236 flag is ignored entirely.
     */
    internal fun accessFor(granted: Boolean, showsRationale: Boolean, blocked: Boolean): InviteCalendarAccess = when {
        granted -> InviteCalendarAccess.Full
        showsRationale -> InviteCalendarAccess.Askable
        blocked -> InviteCalendarAccess.Denied
        else -> InviteCalendarAccess.Askable
    }

    /**
     * After a refusal: final when the system no longer offers a rationale and either
     * "Don't allow" was seen before (second refusal / "Don't ask again") or the last
     * request also came back unanswered. A first dismissal (no rationale yet, nothing
     * before) stays askable; a second one in a row, which is also what a silent
     * system refusal looks like, falls back to the Settings link.
     */
    internal fun refusalIsFinal(showsRationale: Boolean, refusedBefore: Boolean, unansweredBefore: Boolean): Boolean =
        !showsRationale && (refusedBefore || unansweredBefore)

    internal fun isBlocked(context: Context) = prefs(context).getBoolean(BLOCKED_KEY, false)

    internal fun record(context: Context, granted: Boolean, showsRationale: Boolean) {
        val p = prefs(context)
        val edit = p.edit().remove(LEGACY_DENIED_KEY)
        when {
            granted -> edit.remove(BLOCKED_KEY).remove(REFUSED_KEY).remove(UNANSWERED_KEY)
            showsRationale -> edit.putBoolean(REFUSED_KEY, true).remove(UNANSWERED_KEY).remove(BLOCKED_KEY)
            refusalIsFinal(
                showsRationale = false,
                refusedBefore = p.getBoolean(REFUSED_KEY, false),
                unansweredBefore = p.getBoolean(UNANSWERED_KEY, false),
            ) -> edit.putBoolean(BLOCKED_KEY, true).remove(UNANSWERED_KEY)
            else -> edit.putBoolean(UNANSWERED_KEY, true)
        }
        edit.apply()
    }
}

/** CalendarContract with READ_CALENDAR + WRITE_CALENDAR. Call off the main thread. */
object PhoneInviteCalendar : InviteCalendarStore {
    private fun granted(context: Context) = InviteCalendar.permissions.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    override fun access(context: Context, showsRationale: Boolean): InviteCalendarAccess =
        InviteCalendar.accessFor(granted(context), showsRationale, InviteCalendar.isBlocked(context))

    override fun recordRequestResult(context: Context, granted: Boolean, showsRationale: Boolean) {
        InviteCalendar.record(context, granted, showsRationale)
    }

    override fun writableCalendars(context: Context): List<InviteCalendarChoice> {
        if (!granted(context)) return emptyList()
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.CALENDAR_COLOR,
            CalendarContract.Calendars.IS_PRIMARY,
        )
        val selection = "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND " +
            "${CalendarContract.Calendars.VISIBLE} = 1 AND ${CalendarContract.Calendars.SYNC_EVENTS} = 1"
        val args = arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString())
        val result = mutableListOf<InviteCalendarChoice>()
        runCatching {
            context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, projection, selection, args, null)?.use { c ->
                while (c.moveToNext()) {
                    result += InviteCalendarChoice(
                        id = c.getLong(0),
                        title = c.getString(1)?.takeIf { it.isNotBlank() } ?: "Calendar",
                        color = if (c.isNull(2)) null else c.getInt(2),
                        isPrimary = !c.isNull(3) && c.getInt(3) == 1,
                    )
                }
            }
        }
        return result.sortedBy { it.title.lowercase() }
    }

    override fun events(context: Context, beginMillis: Long, endMillis: Long): List<CalendarBusyEvent> {
        if (!granted(context)) return emptyList()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, beginMillis)
            ContentUris.appendId(it, endMillis)
        }.build()
        val projection = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.AVAILABILITY,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS,
            CalendarContract.Instances.STATUS,
        )
        val result = mutableListOf<CalendarBusyEvent>()
        runCatching {
            context.contentResolver.query(uri, projection, "${CalendarContract.Instances.VISIBLE} = 1", null, null)?.use { c ->
                while (c.moveToNext()) {
                    result += CalendarBusyEvent(
                        title = c.getString(0).orEmpty(),
                        beginMillis = c.getLong(1),
                        endMillis = c.getLong(2),
                        allDay = c.getInt(3) == 1,
                        showsAsFree = !c.isNull(4) && c.getInt(4) == CalendarContract.Events.AVAILABILITY_FREE,
                        declined = !c.isNull(5) && c.getInt(5) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED,
                        cancelled = !c.isNull(6) && c.getInt(6) == CalendarContract.Events.STATUS_CANCELED,
                    )
                }
            }
        }
        return result
    }

    override fun add(context: Context, invite: EmailInvite, calendarId: Long): Long? {
        val event = CalendarEventValues.of(invite) ?: return null
        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, event.title)
            put(CalendarContract.Events.DTSTART, event.dtStart)
            event.dtEnd?.let { put(CalendarContract.Events.DTEND, it) }
            event.duration?.let { put(CalendarContract.Events.DURATION, it) }
            put(CalendarContract.Events.ALL_DAY, if (event.allDay) 1 else 0)
            put(CalendarContract.Events.EVENT_TIMEZONE, event.timezone)
            event.location?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
            event.description?.let { put(CalendarContract.Events.DESCRIPTION, it) }
            event.rrule?.let { put(CalendarContract.Events.RRULE, it) }
            put(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_BUSY)
        }
        return runCatching {
            context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)?.let(ContentUris::parseId)
        }.getOrNull()
    }

    override fun remove(context: Context, eventId: Long): Boolean = runCatching {
        context.contentResolver.delete(
            ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId),
            null,
            null,
        ) > 0
    }.getOrDefault(false)
}

package co.inboxies.app.ui.email

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PersistableBundle
import android.provider.CalendarContract
import android.text.format.DateFormat
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Directions
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import co.inboxies.app.models.CalendarInsert
import co.inboxies.app.models.InviteAvailability
import co.inboxies.app.models.ToastAction
import co.inboxies.app.services.InviteCalendar
import co.inboxies.app.services.InviteCalendarAccess
import co.inboxies.app.services.InviteCalendarChoice
import co.inboxies.app.ui.components.AnimatedToast
import co.inboxies.app.ui.components.InboxiesDropdownMenu
import co.inboxies.app.ui.components.InboxiesMenuItem
import co.inboxies.app.ui.components.InboxiesToast
import co.inboxies.app.ui.components.ToastIcon
import co.inboxies.app.theme.ToastMetrics
import co.inboxies.app.models.EmailInvite
import co.inboxies.app.models.InviteOrganizerLine
import co.inboxies.app.models.InviteRecurrence
import co.inboxies.app.models.InviteTime
import co.inboxies.app.models.InviteVenue
import co.inboxies.app.models.MailCards
import co.inboxies.app.LocalAppModel
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.MailCardMetrics
import co.inboxies.app.theme.inboxiesColors
import co.inboxies.app.theme.liquidGlass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

// Reader Code card / Invite card, pinned above the bottom bar (AVE-177). Design
// twin of iOS `MailCardsView.swift` (AVE-176). Contract: `shared/mail-cards.ts`.

/** Default chrome spring — iOS `.spring(response: 0.32, dampingFraction: 0.86)`. */
private fun <T> mailCardSpring() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)

/** DEBUG previews open the invite details for screenshots (`inviteCardExpanded`). */
object MailCardDebug {
    @Volatile var startsExpanded: Boolean = false
}

/** A toast raised by a card ("Added to Work · Undo"), shown with the app's one `InboxiesToast`. */
data class MailCardToast(
    val message: String,
    val icon: ToastIcon = ToastIcon.None,
    val action: ToastAction? = null,
    /** Null pins it (DEBUG previews). */
    val durationMs: Long? = 4_000L,
    val id: String = UUID.randomUUID().toString(),
)

@Composable
fun MailCardView(card: MailCards.Card, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(MailCardMetrics.cornerRadius)
    // The reader is a sheet over the home chrome, so `AppModel`'s toast would sit
    // behind it; the card's own toast floats just above the card (AVE-206).
    var toast by remember { mutableStateOf<MailCardToast?>(null) }
    LaunchedEffect(toast?.id) {
        val current = toast ?: return@LaunchedEffect
        val duration = current.durationMs ?: return@LaunchedEffect
        delay(duration)
        if (toast?.id == current.id) toast = null
    }

    Column(modifier = modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        AnimatedToast(toast) { current ->
            InboxiesToast(
                message = current.message,
                icon = current.icon,
                action = current.action,
                onDismiss = { toast = null },
                modifier = Modifier
                    .padding(horizontal = ToastMetrics.screenInset)
                    .padding(bottom = ToastMetrics.barGap),
            )
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = MailCardMetrics.horizontalInset)
                .padding(bottom = MailCardMetrics.bottomInset)
                .liquidGlass(shape)
                .padding(MailCardMetrics.padding),
        ) {
            when (card) {
                is MailCards.Card.Code -> CodeCard(code = card.otp.code)
                is MailCards.Card.Invite -> InviteCard(invite = card.invite, showToast = { toast = it })
            }
        }
    }
}

// region Code card

@Composable
private fun CodeCard(code: String) {
    val colors = inboxiesColors()
    val context = LocalContext.current
    val view = LocalView.current
    var copied by remember { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(MailCardMetrics.copiedFeedbackMs)
            copied = false
        }
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            AnimatedContent(
                targetState = copied,
                transitionSpec = { fadeIn(mailCardSpring()) togetherWith fadeOut(mailCardSpring()) },
                label = "codeEyebrow",
            ) { isCopied ->
                Text(
                    if (isCopied) "Copied" else "Verification code",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = MailCardMetrics.eyebrow,
                    color = colors.muted,
                )
            }
            Text(
                code,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                fontSize = MailCardMetrics.code,
                letterSpacing = MailCardMetrics.codeTracking,
                color = colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                // Read digit by digit.
                modifier = Modifier.semantics { contentDescription = code.toCharArray().joinToString(" ") },
            )
        }
        MailCardButton(
            title = if (copied) "Copied" else "Copy",
            icon = if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy,
            prominent = true,
            onClick = {
                MailCardClipboard.copyCode(context, code)
                view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                copied = true
            },
        )
    }
}

/**
 * Copies a code as a sensitive clip, so the system clipboard preview masks it, and
 * clears it again after [MailCardMetrics.clipboardExpiryMs] if it is still ours.
 * iOS sets a 90 s pasteboard expiry; Android has no expiry, so this is best effort.
 */
object MailCardClipboard {
    private const val LABEL = "Verification code"
    /** `ClipDescription.EXTRA_IS_SENSITIVE`; the literal is what pre-33 keyboards read. */
    private const val LEGACY_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var clearJob: Job? = null

    fun copyCode(context: Context, code: String) {
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        val clip = ClipData.newPlainText(LABEL, code)
        clip.description.extras = PersistableBundle().apply {
            putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            putBoolean(LEGACY_IS_SENSITIVE, true)
        }
        clipboard.setPrimaryClip(clip)

        val appContext = context.applicationContext
        clearJob?.cancel()
        clearJob = scope.launch {
            delay(MailCardMetrics.clipboardExpiryMs)
            val manager = appContext.getSystemService(ClipboardManager::class.java) ?: return@launch
            // Reading the clip needs focus; when it can't be read (or the user copied
            // something else since), leave the clipboard alone.
            val current = runCatching { manager.primaryClip }.getOrNull() ?: return@launch
            val ours = current.description?.label == LABEL &&
                current.itemCount == 1 &&
                current.getItemAt(0)?.text?.toString() == code
            if (ours) runCatching { manager.clearPrimaryClip() }
        }
    }
}

// endregion

// region Invite card

/**
 * Collapsed: one line (icon, title, muted compact time, chevron) and one row of
 * actions. Tapping the line expands the details in place (time, repeat, location,
 * organizer) with the default spring; the reader is already a sheet, so a second
 * sheet would stack a modal on a modal.
 */
@Composable
private fun InviteCard(invite: EmailInvite, showToast: (MailCardToast?) -> Unit) {
    val colors = inboxiesColors()
    val context = LocalContext.current
    val app = LocalAppModel.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var expanded by rememberSaveable(invite.uid, invite.start) { mutableStateOf(MailCardDebug.startsExpanded) }
    val chevron by animateFloatAsState(if (expanded) 180f else 0f, mailCardSpring(), label = "inviteChevron")

    val is24Hour = remember(context) { DateFormat.is24HourFormat(context) }
    val patterns = remember { InviteTime.Patterns { skeleton, locale -> DateFormat.getBestDateTimePattern(locale, skeleton) } }
    val summary = remember(invite, is24Hour) { InviteTime.summary(invite, is24Hour = is24Hour, patterns = patterns) }
    val compact = remember(invite, is24Hour) { InviteTime.compact(invite, is24Hour = is24Hour, patterns = patterns) }
    val repeats = remember(invite.recurrence) { InviteRecurrence.label(invite.recurrence) }
    val calendarInsert = remember(invite) { CalendarInsert.of(invite) }
    val venue = invite.venue

    // region Free/busy + one-tap add (AVE-206). Nothing reads the calendar until access
    // is already granted or the person taps Check availability / Add.
    val store = InviteCalendar.current
    var access by remember { mutableStateOf(InviteCalendarAccess.Denied) }
    var availability by remember(invite) { mutableStateOf<InviteAvailability?>(null) }
    var calendars by remember { mutableStateOf(emptyList<InviteCalendarChoice>()) }
    var chosenCalendarId by remember { mutableStateOf(InviteCalendar.chosenCalendarId(context)) }
    var added by remember(invite) { mutableStateOf<AddedEvent?>(null) }
    var refreshTick by remember { mutableIntStateOf(0) }
    var pendingAdd by remember { mutableStateOf(false) }
    var didAutoAdd by remember { mutableStateOf(false) }
    val window = remember(invite) { InviteAvailability.window(invite) }
    val selectedCalendar = InviteCalendar.pick(calendars, chosenCalendarId)
    val isInCalendar = added != null || availability == InviteAvailability.InCalendar

    /** Reads access, calendars and free/busy. Never prompts. */
    suspend fun refresh() {
        val appContext = context.applicationContext
        val result = withContext(Dispatchers.IO) {
            val nextAccess = store.access(appContext)
            if (nextAccess == InviteCalendarAccess.Full) {
                Triple(
                    nextAccess,
                    store.writableCalendars(appContext),
                    window?.let { InviteAvailability.check(invite, store.events(appContext, it.beginMillis, it.endMillis)) },
                )
            } else {
                Triple(nextAccess, emptyList(), null)
            }
        }
        access = result.first
        calendars = result.second
        availability = result.third
    }

    fun openInsertScreen() {
        val insert = calendarInsert ?: return
        try {
            context.startActivity(insert.toIntent())
        } catch (_: ActivityNotFoundException) {
            app.showToast("No calendar app to add this to", isError = true)
        }
    }

    fun undoAdd(eventId: Long) {
        showToast(null)
        scope.launch {
            val removed = withContext(Dispatchers.IO) { store.remove(context.applicationContext, eventId) }
            if (removed) {
                added = null
                refresh()
            } else {
                showToast(MailCardToast("Couldn\u2019t remove the event", icon = ToastIcon.Error))
            }
        }
    }

    fun addDirectly(pinToast: Boolean = false) {
        scope.launch {
            // Read the state now, not from this composition: access may have just been granted.
            val calendar = InviteCalendar.pick(calendars, chosenCalendarId)
            val eventId = calendar?.let {
                withContext(Dispatchers.IO) { store.add(context.applicationContext, invite, it.id) }
            }
            if (calendar == null || eventId == null) {
                // Couldn't write (no writable calendar, provider refused): the calendar app tries.
                openInsertScreen()
                return@launch
            }
            added = AddedEvent(eventId, calendar.title)
            view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
            showToast(
                MailCardToast(
                    message = "Added to ${calendar.title}",
                    icon = ToastIcon.Success,
                    action = ToastAction("Undo") { undoAdd(eventId) },
                    durationMs = if (pinToast) null else 5_000L,
                ),
            )
            refresh()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result.isNotEmpty() && result.values.all { it }
        store.recordRequestResult(context.applicationContext, granted)
        val thenAdd = pendingAdd
        pendingAdd = false
        scope.launch {
            refresh()
            if (thenAdd) {
                if (granted) addDirectly() else openInsertScreen()
            }
        }
    }

    fun requestAccess(thenAdd: Boolean) {
        if (!store.usesSystemPermission) {
            store.recordRequestResult(context.applicationContext, true)
            scope.launch {
                refresh()
                if (thenAdd) addDirectly()
            }
            return
        }
        pendingAdd = thenAdd
        permissionLauncher.launch(InviteCalendar.permissions)
    }

    /** Full access: one tap writes the event. Not asked yet: ask, then add. Denied: the insert screen. */
    fun addTapped() {
        when (access) {
            InviteCalendarAccess.Full -> addDirectly()
            InviteCalendarAccess.Askable -> requestAccess(thenAdd = true)
            InviteCalendarAccess.Denied -> openInsertScreen()
        }
    }

    LaunchedEffect(invite, refreshTick) {
        refresh()
        if (store.autoAdds && !didAutoAdd && access == InviteCalendarAccess.Full) {
            didAutoAdd = true
            addDirectly(pinToast = true)
        }
    }
    // Access may change in Settings while we are away.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshTick++
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    // endregion

    fun open(uri: String, failure: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
        } catch (_: ActivityNotFoundException) {
            app.showToast(failure, isError = true)
        }
    }

    fun directions(address: String) = open(InviteVenue.directionsUri(address), "No maps app to open this address")

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // One line: the whole row toggles the details.
        val rowInteraction = remember { MutableInteractionSource() }
        val rowPressed by rowInteraction.collectIsPressedAsState()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .graphicsLayer { alpha = if (rowPressed) 0.55f else 1f }
                .clickable(
                    interactionSource = rowInteraction,
                    indication = null,
                    role = Role.Button,
                    onClickLabel = if (expanded) "Hide event details" else "Show event details",
                ) { expanded = !expanded }
                .semantics(mergeDescendants = true) {
                    contentDescription = listOfNotNull(
                        if (invite.cancelled) "Cancelled event" else "Invitation",
                        invite.displayTitle,
                        summary,
                    ).joinToString(", ")
                    stateDescription = if (expanded) "Expanded" else "Collapsed"
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                if (invite.cancelled) Icons.Outlined.EventBusy else Icons.Outlined.Event,
                contentDescription = null,
                tint = if (invite.cancelled) colors.deepDarkRed else colors.accent,
                modifier = Modifier
                    .width(MailCardMetrics.titleIconColumn)
                    .size(MailCardMetrics.titleIconSize),
            )
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    invite.displayTitle,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = MailCardMetrics.title,
                    color = if (invite.cancelled) colors.muted else colors.ink,
                    textDecoration = if (invite.cancelled) TextDecoration.LineThrough else null,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                val suffix = if (invite.cancelled) "Cancelled" else compact
                if (suffix != null) {
                    Text(
                        suffix,
                        fontFamily = InterFontFamily,
                        fontSize = MailCardMetrics.detail,
                        color = if (invite.cancelled) colors.deepDarkRed else colors.muted,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }
            Icon(
                Icons.Outlined.KeyboardArrowDown,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier
                    .size(18.dp)
                    .rotate(chevron),
            )
        }

        if (!invite.cancelled) {
            AvailabilityRow(
                access = access,
                availability = if (added != null) InviteAvailability.InCalendar else availability,
                checksAvailability = window != null,
                calendars = calendars,
                selectedCalendar = selectedCalendar,
                showsCalendarPicker = calendarInsert != null && !isInCalendar,
                onCheckAvailability = { requestAccess(thenAdd = false) },
                onChooseCalendar = {
                    chosenCalendarId = it.id
                    InviteCalendar.setChosenCalendarId(context, it.id)
                },
            )
        }

        AnimatedVisibility(
            visible = expanded,
            enter = expandVertically(mailCardSpring()) + fadeIn(mailCardSpring()),
            exit = shrinkVertically(mailCardSpring()) + fadeOut(mailCardSpring()),
        ) {
            Column(
                modifier = Modifier.padding(start = MailCardMetrics.detailIndent),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                summary?.let { DetailRow(Icons.Outlined.Schedule, it) }
                repeats?.let { DetailRow(Icons.Outlined.Repeat, it) }
                invite.displayLocation?.let { location ->
                    val address = invite.address
                    if (address != null && !invite.cancelled) {
                        // With a meeting link Join is the primary action; the address
                        // still gets directions from here.
                        DetailRow(
                            Icons.Outlined.Place,
                            location,
                            tint = colors.accent,
                            onClickLabel = "Get directions",
                            onClick = { directions(address) },
                        )
                    } else {
                        DetailRow(Icons.Outlined.Place, location)
                    }
                }
                when (val organizer = invite.organizerLine) {
                    InviteOrganizerLine.None -> Unit
                    is InviteOrganizerLine.Organizer -> DetailRow(Icons.Outlined.Person, organizer.label)
                    // AVE-220: the organizer doesn't match the From, so the real
                    // sender leads and the organizer is only what the invite claims.
                    is InviteOrganizerLine.Claimed -> Column(
                        modifier = Modifier.semantics(mergeDescendants = true) {},
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        organizer.sender?.let { DetailRow(Icons.Outlined.Person, "From $it", tint = colors.ink) }
                        Text(
                            "Claims organizer: ${organizer.claimed}",
                            fontFamily = InterFontFamily,
                            fontSize = MailCardMetrics.detail,
                            color = colors.muted,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = if (organizer.sender != null) {
                                Modifier.padding(start = MailCardMetrics.detailIconColumn + 8.dp)
                            } else {
                                Modifier
                            },
                        )
                    }
                }
            }
        }

        val showsVenueButton = venue !is InviteVenue.None
        if (!invite.cancelled && (showsVenueButton || calendarInsert != null)) {
            Row(horizontalArrangement = Arrangement.spacedBy(MailCardMetrics.buttonSpacing)) {
                when (venue) {
                    // An https link: the Meet / Zoom / Teams app takes it when installed, else the browser.
                    is InviteVenue.Link -> MailCardButton(
                        title = "Join",
                        icon = Icons.Filled.Videocam,
                        prominent = false,
                        onClick = { open(venue.url, "No app to open this link") },
                    )
                    is InviteVenue.Address -> MailCardButton(
                        title = "Directions",
                        icon = Icons.Filled.Directions,
                        prominent = false,
                        onClick = { directions(venue.address) },
                    )
                    InviteVenue.None -> Unit
                }
                if (calendarInsert != null) {
                    if (isInCalendar) {
                        MailCardButton(
                            title = "Added",
                            icon = Icons.Outlined.Check,
                            prominent = true,
                            enabled = false,
                            onClick = {},
                        )
                    } else {
                        MailCardButton(
                            title = "Add to calendar",
                            icon = Icons.Outlined.EditCalendar,
                            prominent = true,
                            onClick = { addTapped() },
                        )
                    }
                }
            }
        }
    }
}

/** `Intent.ACTION_INSERT` on `CalendarContract.Events`: the calendar app saves it, no permission needed. */
private fun CalendarInsert.toIntent(): Intent =
    Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
        putExtra(CalendarContract.Events.TITLE, title)
        putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMillis)
        putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMillis)
        putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
        location?.let { putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
        description?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
        rrule?.let { putExtra(CalendarContract.Events.RRULE, it) }
    }

private data class AddedEvent(val eventId: Long, val calendarTitle: String)

/**
 * "You're free" / "Conflicts with Team sync" and the calendar Add writes to. Before
 * access: a "Check availability" link that asks. Denied: nothing.
 */
@Composable
private fun AvailabilityRow(
    access: InviteCalendarAccess,
    availability: InviteAvailability?,
    checksAvailability: Boolean,
    calendars: List<InviteCalendarChoice>,
    selectedCalendar: InviteCalendarChoice?,
    showsCalendarPicker: Boolean,
    onCheckAvailability: () -> Unit,
    onChooseCalendar: (InviteCalendarChoice) -> Unit,
) {
    val colors = inboxiesColors()
    when (access) {
        InviteCalendarAccess.Full -> {
            val picker = showsCalendarPicker && calendars.isNotEmpty()
            if (availability == null && !picker) return
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = MailCardMetrics.detailIndent),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    when (availability) {
                        InviteAvailability.Free -> StatusLine(Icons.Outlined.CheckCircle, colors.accent, availability.label)
                        InviteAvailability.InCalendar -> StatusLine(Icons.Outlined.EventAvailable, colors.accent, availability.label)
                        is InviteAvailability.Conflict -> StatusLine(
                            Icons.Outlined.ErrorOutline,
                            colors.deepDarkRed,
                            availability.label,
                            styled = buildAnnotatedString {
                                append("Conflicts with ")
                                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(availability.title) }
                                if (availability.others > 0) {
                                    withStyle(SpanStyle(color = colors.muted)) { append(" +${availability.others} more") }
                                }
                            },
                        )
                        // All-day invites skip free/busy; only the calendar picker shows.
                        null -> Text(
                            "Add to",
                            fontFamily = InterFontFamily,
                            fontSize = MailCardMetrics.detail,
                            color = colors.muted,
                        )
                    }
                }
                if (picker) CalendarPicker(calendars, selectedCalendar, onChooseCalendar)
            }
        }
        InviteCalendarAccess.Askable -> {
            if (!checksAvailability) return
            DetailRow(
                Icons.Outlined.EventAvailable,
                "Check availability",
                tint = colors.accent,
                onClickLabel = "Read your calendar to see if you\u2019re free",
                onClick = onCheckAvailability,
                medium = true,
            )
        }
        InviteCalendarAccess.Denied -> Unit
    }
}

@Composable
private fun StatusLine(
    icon: ImageVector,
    tint: Color,
    label: String,
    styled: androidx.compose.ui.text.AnnotatedString? = null,
) {
    val colors = inboxiesColors()
    Row(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier
                .width(MailCardMetrics.detailIconColumn)
                .size(MailCardMetrics.detailIconSize),
        )
        Text(
            styled ?: androidx.compose.ui.text.AnnotatedString(label),
            fontFamily = InterFontFamily,
            fontSize = MailCardMetrics.detail,
            color = colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The calendar Add writes to; the choice is remembered on this device. */
@Composable
private fun CalendarPicker(
    calendars: List<InviteCalendarChoice>,
    selected: InviteCalendarChoice?,
    onChoose: (InviteCalendarChoice) -> Unit,
) {
    val colors = inboxiesColors()
    var open by remember { mutableStateOf(false) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box {
        Row(
            modifier = Modifier
                .graphicsLayer { alpha = if (pressed) 0.55f else 1f }
                .clickable(
                    interactionSource = interaction,
                    indication = null,
                    role = Role.Button,
                    onClickLabel = "Choose the calendar Add writes to",
                ) { open = true }
                .semantics(mergeDescendants = true) {
                    contentDescription = "Calendar, ${selected?.title ?: "default"}"
                },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            CalendarDot(selected?.color)
            Text(
                selected?.title ?: "Calendar",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                fontSize = MailCardMetrics.detail,
                color = colors.muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = MailCardMetrics.calendarNameMaxWidth),
            )
            Icon(
                Icons.Outlined.UnfoldMore,
                contentDescription = null,
                tint = colors.muted,
                modifier = Modifier.size(14.dp),
            )
        }
        InboxiesDropdownMenu(expanded = open, onDismiss = { open = false }) {
            calendars.forEach { calendar ->
                InboxiesMenuItem(
                    text = calendar.title,
                    icon = if (calendar.id == selected?.id) Icons.Outlined.Check else null,
                    onClick = {
                        open = false
                        onChoose(calendar)
                    },
                )
            }
        }
    }
}

@Composable
private fun CalendarDot(argb: Int?) {
    val colors = inboxiesColors()
    Box(
        modifier = Modifier
            .size(8.dp)
            .background(argb?.let { Color(it) } ?: colors.muted, CircleShape),
    )
}

@Composable
private fun DetailRow(
    icon: ImageVector,
    text: String,
    tint: Color = inboxiesColors().muted,
    onClickLabel: String? = null,
    onClick: (() -> Unit)? = null,
    medium: Boolean = false,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val base = if (onClick != null) {
        Modifier
            .graphicsLayer { alpha = if (pressed) 0.55f else 1f }
            .clickable(
                interactionSource = interaction,
                indication = null,
                role = Role.Button,
                onClickLabel = onClickLabel,
                onClick = onClick,
            )
    } else {
        Modifier
    }
    Row(
        modifier = base,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier
                .padding(top = 1.dp)
                .width(MailCardMetrics.detailIconColumn)
                .size(MailCardMetrics.detailIconSize),
        )
        Text(
            text,
            fontFamily = InterFontFamily,
            fontWeight = if (medium) FontWeight.Medium else FontWeight.Normal,
            fontSize = MailCardMetrics.detail,
            color = tint,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// endregion

// region Button

/**
 * Capsule buttons: primary is an accent fill with white text (Copy, Add to calendar),
 * secondary a tonal `pillFill` capsule with `ink` text (Join, Directions).
 */
@Composable
private fun MailCardButton(
    title: String,
    icon: ImageVector,
    prominent: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val container = if (prominent) colors.accent else colors.pillFill
    val content = if (prominent) Color.White else colors.ink
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = container,
            contentColor = content,
            // "Added": the same capsule, quieter, not Material's grey.
            disabledContainerColor = container.copy(alpha = 0.55f),
            disabledContentColor = content,
        ),
        elevation = null,
        contentPadding = PaddingValues(horizontal = MailCardMetrics.buttonHorizontalPadding, vertical = 0.dp),
        modifier = Modifier.heightIn(min = MailCardMetrics.buttonMinHeight),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(MailCardMetrics.buttonIconSize))
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = MailCardMetrics.buttonFont,
            maxLines = 1,
        )
    }
}

// endregion

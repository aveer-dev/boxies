package co.inboxies.app.ui.email

import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AlarmOff
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TimeInput
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.inboxies.app.LocalAppModel
import co.inboxies.app.models.Email
import co.inboxies.app.services.ReplyLaterReminderPresets
import co.inboxies.app.theme.HomeChromeMetrics
import co.inboxies.app.theme.HomeChromeToolbarButton
import co.inboxies.app.theme.InterFontFamily
import co.inboxies.app.theme.inboxiesColors
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime

private enum class ReminderScreen { Presets, Custom }

/**
 * "Remind me" picker for a Reply Later reminder (AVE-86). Same bottom-card host as
 * [EmailActionsSheetModal]: presets with their resolved local time, a custom date + time
 * page, and "Remove reminder" when one is pending. Twin of iOS `ReplyLaterReminderSheet`.
 */
@Composable
fun ReplyLaterReminderSheetModal(
    email: Email,
    onDismiss: () -> Unit,
) {
    val colors = inboxiesColors()
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(HomeChromeMetrics.modalScrim)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = onDismiss,
                    ),
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(colors.background)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                        onClick = {},
                    )
                    .navigationBarsPadding()
                    .padding(top = 20.dp, bottom = 20.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        modifier = Modifier
                            .width(36.dp)
                            .height(5.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colors.muted.copy(alpha = 0.45f)),
                    )
                }
                ReplyLaterReminderSheet(email = email, onDismiss = onDismiss)
            }
        }
    }
}

@Composable
fun ReplyLaterReminderSheet(
    email: Email,
    onDismiss: () -> Unit,
) {
    val app = LocalAppModel.current
    val scope = rememberCoroutineScope()
    var screen by remember { mutableStateOf(ReminderScreen.Presets) }
    // Resolve presets once per open so the times don't tick while the sheet is up.
    val now = remember { ZonedDateTime.now() }

    fun choose(time: ZonedDateTime?) {
        onDismiss()
        scope.launch { app.setReplyLaterReminder(email, time) }
    }

    AnimatedContent(
        targetState = screen,
        modifier = Modifier.fillMaxWidth(),
        transitionSpec = {
            val forward = initialState == ReminderScreen.Presets
            (
                slideInHorizontally(reminderSpring()) { full -> if (forward) full / 4 else -full / 4 } +
                    fadeIn(reminderSpring())
                ) togetherWith (
                slideOutHorizontally(reminderSpring()) { full -> if (forward) -full / 6 else full / 6 } +
                    fadeOut(reminderSpring())
                ) using SizeTransform(clip = true) { _, _ -> reminderSpring() }
        },
        contentAlignment = Alignment.TopCenter,
        label = "reminderScreen",
    ) { current ->
        when (current) {
            ReminderScreen.Presets -> PresetsScreen(
                email = email,
                now = now,
                onClose = onDismiss,
                onPick = { choose(it) },
                onCustom = { screen = ReminderScreen.Custom },
                onRemove = { choose(null) },
            )
            ReminderScreen.Custom -> CustomScreen(
                email = email,
                now = now,
                onBack = { screen = ReminderScreen.Presets },
                onClose = onDismiss,
                onSet = { choose(it) },
            )
        }
    }
}

@Composable
private fun PresetsScreen(
    email: Email,
    now: ZonedDateTime,
    onClose: () -> Unit,
    onPick: (ZonedDateTime) -> Unit,
    onCustom: () -> Unit,
    onRemove: () -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    val pendingLabel = if (email.hasPendingReplyLaterReminder) {
        ReplyLaterReminderPresets.fullLabel(email.replyLaterRemindAt)
    } else {
        null
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 28.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp)
                .padding(bottom = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Remind me",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 17.sp,
                    color = colors.ink,
                )
                Text(
                    email.subject.ifBlank { "(no subject)" },
                    fontFamily = InterFontFamily,
                    fontSize = 13.sp,
                    color = colors.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            HomeChromeToolbarButton(
                icon = Icons.Outlined.Close,
                contentDescription = "Close",
                onClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    onClose()
                },
                size = 40.dp,
            )
        }

        if (pendingLabel != null) {
            Row(
                modifier = Modifier
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 12.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors.pillFill)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.NotificationsActive,
                    contentDescription = null,
                    tint = colors.muted,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    "Reminder set for $pendingLabel",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Medium,
                    fontSize = 13.sp,
                    color = colors.ink,
                )
            }
        }

        SheetCard {
            ReplyLaterReminderPresets.presets(now).forEachIndexed { index, preset ->
                if (index > 0) RowDivider()
                ReminderRow(
                    label = preset.title,
                    icon = when (preset.id) {
                        co.inboxies.app.services.ReplyLaterReminderPreset.Id.LaterToday -> Icons.Outlined.Schedule
                        co.inboxies.app.services.ReplyLaterReminderPreset.Id.Tomorrow -> Icons.Outlined.WbSunny
                        co.inboxies.app.services.ReplyLaterReminderPreset.Id.NextWeek -> Icons.Outlined.DateRange
                    },
                    trailingText = ReplyLaterReminderPresets.presetLabel(preset.time, now),
                ) { onPick(preset.time) }
            }
            RowDivider()
            ReminderRow(
                label = "Pick date & time…",
                icon = Icons.Outlined.EditCalendar,
                trailingIcon = Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                onClick = onCustom,
            )
        }

        if (pendingLabel != null) {
            Spacer(Modifier.height(12.dp))
            SheetCard {
                ReminderRow(
                    label = "Remove reminder",
                    icon = Icons.Outlined.AlarmOff,
                    onClick = onRemove,
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomScreen(
    email: Email,
    now: ZonedDateTime,
    onBack: () -> Unit,
    onClose: () -> Unit,
    onSet: (ZonedDateTime) -> Unit,
) {
    val colors = inboxiesColors()
    val view = LocalView.current
    val zone: ZoneId = now.zone
    val initial = ReplyLaterReminderPresets.parse(email.replyLaterRemindAt)
        ?.atZone(zone)
        ?.takeIf { it.isAfter(now) }
        ?: ReplyLaterReminderPresets.tomorrow(now)
    val today = now.toLocalDate()
    val lastDay = today.plusDays(ReplyLaterReminderPresets.MAX_DAYS_AHEAD - 1)

    val dateState = rememberDatePickerState(
        initialSelectedDateMillis = initial.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        yearRange = today.year..lastDay.year,
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val day = Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                return !day.isBefore(today) && !day.isAfter(lastDay)
            }

            override fun isSelectableYear(year: Int): Boolean = year in today.year..lastDay.year
        },
    )
    val is24Hour = android.text.format.DateFormat.is24HourFormat(view.context)
    val timeState = rememberTimePickerState(
        initialHour = initial.hour,
        initialMinute = initial.minute,
        is24Hour = is24Hour,
    )

    val pickedDate: LocalDate? = dateState.selectedDateMillis?.let {
        Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
    }
    val picked: ZonedDateTime? = pickedDate?.atTime(LocalTime.of(timeState.hour, timeState.minute))?.atZone(zone)
    val valid = picked != null && ReplyLaterReminderPresets.isValidCustom(picked, ZonedDateTime.now(zone))

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            HomeChromeToolbarButton(
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "Back",
                onClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    onBack()
                },
                size = 40.dp,
            )
            Text(
                "Pick date & time",
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp,
                color = colors.ink,
                modifier = Modifier.weight(1f),
            )
            HomeChromeToolbarButton(
                icon = Icons.Outlined.Close,
                contentDescription = "Close",
                onClick = {
                    view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
                    onClose()
                },
                size = 40.dp,
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.78f).dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 8.dp, bottom = 20.dp),
        ) {
            SheetCard {
                DatePicker(
                    state = dateState,
                    title = null,
                    headline = null,
                    showModeToggle = false,
                    colors = DatePickerDefaults.colors(
                        containerColor = Color.Transparent,
                        weekdayContentColor = colors.muted,
                        navigationContentColor = colors.ink,
                        yearContentColor = colors.ink,
                        currentYearContentColor = colors.ink,
                        selectedYearContainerColor = colors.ink,
                        selectedYearContentColor = colors.background,
                        dayContentColor = colors.ink,
                        disabledDayContentColor = colors.muted.copy(alpha = 0.45f),
                        selectedDayContainerColor = colors.ink,
                        selectedDayContentColor = colors.background,
                        todayContentColor = colors.ink,
                        todayDateBorderColor = colors.ink,
                        subheadContentColor = colors.muted,
                    ),
                )
            }
            Spacer(Modifier.height(12.dp))
            SheetCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Time",
                        fontFamily = InterFontFamily,
                        fontSize = 14.sp,
                        color = colors.ink,
                        modifier = Modifier.weight(1f),
                    )
                    TimeInput(
                        state = timeState,
                        colors = TimePickerDefaults.colors(
                            timeSelectorSelectedContainerColor = colors.ink.copy(alpha = 0.10f),
                            timeSelectorUnselectedContainerColor = colors.pillFill,
                            timeSelectorSelectedContentColor = colors.ink,
                            timeSelectorUnselectedContentColor = colors.ink,
                            periodSelectorBorderColor = colors.line,
                            periodSelectorSelectedContainerColor = colors.ink.copy(alpha = 0.10f),
                            periodSelectorUnselectedContainerColor = Color.Transparent,
                            periodSelectorSelectedContentColor = colors.ink,
                            periodSelectorUnselectedContentColor = colors.muted,
                        ),
                    )
                }
            }
            if (picked != null && !valid) {
                Text(
                    "Pick a time in the future.",
                    fontFamily = InterFontFamily,
                    fontSize = 12.sp,
                    color = colors.deepDarkRed,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Box(
                modifier = Modifier
                    .padding(horizontal = 16.dp)
                    .fillMaxWidth()
                    .height(48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (valid) colors.ink else colors.pillActive)
                    .clickable(enabled = valid) {
                        view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                        picked?.let(onSet)
                    }
                    .semantics { role = Role.Button },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "Set reminder",
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                    color = if (valid) colors.background else colors.muted,
                )
            }
        }
    }
}

@Composable
private fun SheetCard(content: @Composable () -> Unit) {
    val colors = inboxiesColors()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surface),
    ) {
        content()
    }
}

@Composable
private fun RowDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 44.dp),
        thickness = 0.5.dp,
        color = inboxiesColors().line,
    )
}

@Composable
private fun ReminderRow(
    label: String,
    icon: ImageVector,
    trailingText: String? = null,
    trailingIcon: ImageVector? = null,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    val colors = inboxiesColors()
    val contentColor = if (destructive) colors.deepDarkRed else colors.ink
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 13.dp),
    ) {
        Icon(icon, contentDescription = null, tint = contentColor, modifier = Modifier.size(18.dp))
        Text(
            label,
            fontFamily = InterFontFamily,
            fontSize = 14.sp,
            color = contentColor,
            modifier = Modifier.weight(1f),
        )
        if (trailingText != null) {
            Text(
                trailingText,
                fontFamily = InterFontFamily,
                fontSize = 13.sp,
                color = colors.muted,
            )
        }
        if (trailingIcon != null) {
            Icon(trailingIcon, contentDescription = null, tint = colors.muted, modifier = Modifier.size(14.dp))
        }
    }
}

private fun <T> reminderSpring() = spring<T>(
    dampingRatio = 0.86f,
    stiffness = Spring.StiffnessMediumLow,
)

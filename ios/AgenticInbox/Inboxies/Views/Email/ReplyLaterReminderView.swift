import SwiftUI

/// "Remind me" picker for Reply Later (AVE-86): Later today / Tomorrow / Next week with
/// their resolved local times, a custom date + time, and Remove when one is set. Pushed
/// inside the email actions sheet, or presented on its own by `ReplyLaterReminderSheet`.
/// Twins: Android `ReplyLaterReminderSheet`, web reminder menu.
struct ReplyLaterReminderView: View {
    let email: Email
    var onClose: () -> Void
    /// The chosen time, or nil to remove the pending reminder.
    var onPick: (Date?) -> Void
    /// Reports the custom picker opening, so a standalone sheet can grow to fit it.
    var onCustomExpandedChange: ((Bool) -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var now = Date()
    @State private var showsCustom = false
    @State private var customDate = ReplyLaterReminder.tomorrowMorning()

    private var pendingDate: Date? { email.replyLaterRemindDate }

    private var customRange: ClosedRange<Date> {
        now...now.addingTimeInterval(TimeInterval(ReplyLaterReminder.maxDaysAhead) * 24 * 60 * 60)
    }

    var body: some View {
        List {
            if let pendingDate {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "alarm")
                            .font(.inter(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                        Text("Reminder set for \(ReplyLaterReminder.longLabel(pendingDate, now: now))")
                            .font(.inter(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("reminderPending")
                }
            }

            Section {
                ForEach(ReplyLaterReminderPreset.allCases) { preset in
                    presetRow(preset)
                }
                customToggleRow
                if showsCustom {
                    DatePicker(
                        "Remind me at",
                        selection: $customDate,
                        in: customRange,
                        displayedComponents: [.date, .hourAndMinute]
                    )
                    .font(.inter(size: 15))
                    .foregroundStyle(AppTheme.ink)
                    .tint(AppTheme.ink)
                    .accessibilityIdentifier("reminderCustomPicker")

                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        onPick(max(customDate, Date()))
                    } label: {
                        Text("Set reminder")
                            .font(.inter(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.background)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(AppTheme.ink, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .accessibilityIdentifier("reminderSetCustom")
                }
            }

            if pendingDate != nil {
                Section {
                    Button {
                        onPick(nil)
                    } label: {
                        Label("Remove reminder", systemImage: "bell.slash")
                            .font(.inter(size: 15))
                            .foregroundStyle(AppTheme.ink)
                    }
                    .accessibilityIdentifier("reminderRemove")
                }
            }
        }
        .listSectionSpacing(.custom(16))
        .navigationTitle(pendingDate == nil ? "Remind me" : "Change reminder")
        .actionsSheetChrome(onClose: onClose)
        .onAppear {
            now = Date()
            if let pendingDate, pendingDate > now { customDate = pendingDate }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-previewReminderCustom") {
                showsCustom = true
            }
            #endif
        }
        .onChange(of: showsCustom) { _, expanded in
            onCustomExpandedChange?(expanded)
        }
    }

    private func presetRow(_ preset: ReplyLaterReminderPreset) -> some View {
        let date = ReplyLaterReminder.date(for: preset, now: now)
        let label = ReplyLaterReminder.presetLabel(date, now: now)
        return Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onPick(date)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: preset.systemImage)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 22)
                Text(preset.title)
                    .font(.inter(size: 15))
                    .foregroundStyle(AppTheme.ink)
                Spacer(minLength: 8)
                Text(label)
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(preset.title), \(label)")
        .accessibilityIdentifier("reminderPreset-\(preset.rawValue)")
    }

    private var customToggleRow: some View {
        Button {
            let animation: Animation? = reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86)
            withAnimation(animation) { showsCustom.toggle() }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "calendar.badge.clock")
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 22)
                Text("Pick date & time…")
                    .font(.inter(size: 15))
                    .foregroundStyle(AppTheme.ink)
                Spacer(minLength: 8)
                Image(systemName: "chevron.down")
                    .font(.inter(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .rotationEffect(.degrees(showsCustom ? 180 : 0))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(showsCustom ? "Expanded" : "Collapsed")
        .accessibilityIdentifier("reminderCustomToggle")
    }
}

/// The picker presented on its own: from the "Add reminder" toast action or the list's
/// context menu. Sized to its rows like the email actions sheet.
struct ReplyLaterReminderSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    let email: Email
    @State private var customExpanded = false

    private var height: CGFloat {
        var h: CGFloat = 110 // nav bar, paddings, safe area
        h += 4 * 50 // presets + custom toggle
        if email.replyLaterRemindDate != nil { h += 2 * 50 + 32 } // pending + remove
        if customExpanded { h += 50 + 60 }
        return h
    }

    var body: some View {
        NavigationStack {
            ReplyLaterReminderView(
                email: email,
                onClose: { dismiss() },
                onPick: { date in
                    dismiss()
                    Task { await app.setReplyLaterReminder(on: email, at: date) }
                },
                onCustomExpandedChange: { customExpanded = $0 }
            )
            // Root of its own stack: nothing to go back to (the editor role adds a chevron).
            .navigationBarBackButtonHidden(true)
        }
        .padding(.top, 10)
        .tint(AppTheme.ink)
        .presentationDetents([.height(height), .large])
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.resizes)
        .presentationBackground(AppTheme.background)
        .onAppear {
            #if DEBUG
            customExpanded = ProcessInfo.processInfo.arguments.contains("-previewReminderCustom")
            #endif
        }
    }
}

#Preview("Reminder picker") {
    PreviewHost {
        NavigationStack {
            ReplyLaterReminderView(email: PreviewSupport.emails[1], onClose: {}, onPick: { _ in })
        }
    }
}

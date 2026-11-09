import EventKit
import EventKitUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The reader's Code card or Invite card, pinned above the bottom bar (AVE-176).
/// Both sit in the same liquid glass container with system glass buttons.
/// Contract: `shared/mail-cards.ts`. Android twin: AVE-177.
struct MailCardView: View {
    let card: MailCards.Card

    /// The card's own toast ("Added to Work · Undo"). The reader is a sheet over the
    /// home chrome, so `AppModel`'s toast would sit behind it; this one floats just
    /// above the card instead (AVE-206).
    @State private var toast: MailCardToast?

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: AppTheme.MailCard.cornerRadius, style: .continuous)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let toast {
                InboxiesToast(
                    message: toast.message,
                    icon: toast.icon,
                    action: toast.action,
                    onDismiss: { self.toast = nil }
                )
                .padding(.horizontal, ToastMetrics.screenInset)
                .padding(.bottom, ToastMetrics.barGap)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .id(toast.id)
            }

            Group {
                switch card {
                case .code(let otp, _):
                    CodeCard(code: otp.code)
                case .invite(let invite, _):
                    InviteCard(invite: invite, showToast: show)
                }
            }
            .padding(AppTheme.MailCard.padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .liquidGlass(in: shape, interactive: false)
            .liquidGlassContainer(spacing: AppTheme.MailCard.buttonSpacing)
            .padding(.horizontal, AppTheme.MailCard.horizontalInset)
            .padding(.bottom, AppTheme.MailCard.bottomInset)
        }
        .animation(ToastMetrics.animation, value: toast?.id)
        .task(id: toast?.id) {
            guard let toast, let duration = toast.duration else { return }
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled, self.toast?.id == toast.id else { return }
            self.toast = nil
        }
    }

    private func show(_ toast: MailCardToast?) {
        self.toast = toast
    }
}

/// A toast raised by a card, shown with the app's one `InboxiesToast`.
struct MailCardToast: Identifiable {
    let id = UUID()
    let message: String
    var icon: ToastIcon = .none
    var action: ToastAction? = nil
    /// Nil pins it (DEBUG previews).
    var duration: TimeInterval? = 4
}

// MARK: - Code card

private struct CodeCard: View {
    let code: String
    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(copied ? "Copied · clears in \(Int(AppTheme.MailCard.clipboardExpiry)) s" : "Verification code")
                    .font(.inter(size: AppTheme.MailCard.eyebrow, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .contentTransition(.opacity)
                Text(code)
                    .font(.system(size: AppTheme.MailCard.code, weight: .semibold, design: .monospaced))
                    .tracking(AppTheme.MailCard.codeTracking)
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .textSelection(.enabled)
                    .accessibilityLabel(code.map(String.init).joined(separator: " "))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            MailCardButton(
                title: copied ? "Copied" : "Copy",
                systemImage: copied ? "checkmark" : "doc.on.doc",
                prominent: true,
                action: copy
            )
            .accessibilityHint("Copies the code. It clears from the clipboard after \(Int(AppTheme.MailCard.clipboardExpiry)) seconds.")
        }
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .onDisappear { resetTask?.cancel() }
    }

    private func copy() {
        // Local only (no Universal Clipboard) and gone after 90 s.
        UIPasteboard.general.setItems(
            [[UTType.plainText.identifier: code]],
            options: [
                .localOnly: true,
                .expirationDate: Date().addingTimeInterval(AppTheme.MailCard.clipboardExpiry),
            ]
        )
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { copied = true }
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { copied = false }
        }
    }
}

// MARK: - Invite card

/// Collapsed: one line (icon, title, muted compact time, chevron) and one row of
/// actions. Tapping the line expands the details in place (time, repeat, location,
/// organizer) with the default spring; the card is already pinned over the reader
/// sheet, so a second sheet would stack a modal on a modal.
private struct InviteCard: View {
    let invite: EmailInvite
    let showToast: (MailCardToast?) -> Void
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var expanded = Self.startsExpanded
    @State private var calendarEvent: CalendarEventDraft?
    @State private var directionsAddress: String?
    @State private var mapProviders: [MapProvider] = [.apple]

    // Free/busy and one-tap add (AVE-206). Nothing reads the calendar until access
    // is already granted or the person taps Check availability / Add.
    @State private var calendarAccess: InviteCalendarAccess = .denied
    @State private var availability: InviteAvailability?
    @State private var calendars: [InviteCalendarChoice] = []
    @State private var defaultCalendarID: String?
    @State private var addedEvent: AddedEvent?
    @State private var didAutoAdd = false
    @AppStorage(InviteCalendar.chosenCalendarKey) private var chosenCalendarID = ""

    private struct AddedEvent: Equatable {
        let eventID: String
        let calendarTitle: String
    }

    private var store: InviteCalendarStore { InviteCalendar.current }

    /// Timed, not cancelled: there is a window to check.
    private var checksAvailability: Bool { InviteAvailability.window(for: invite) != nil }

    /// The remembered calendar while it is still writable, else the system default.
    private var selectedCalendar: InviteCalendarChoice? {
        calendars.first { $0.id == chosenCalendarID }
            ?? calendars.first { $0.id == defaultCalendarID }
            ?? calendars.first
    }

    /// `selectedCalendar`, read fresh from the store when access was only just granted.
    private func targetCalendar() -> InviteCalendarChoice? {
        let all = calendars.isEmpty ? store.writableCalendars() : calendars
        let fallback = defaultCalendarID ?? store.defaultCalendarID()
        return all.first { $0.id == chosenCalendarID }
            ?? all.first { $0.id == fallback }
            ?? all.first
    }

    private var isInCalendar: Bool { addedEvent != nil || availability == .inCalendar }

    /// DEBUG `-previewInviteExpanded` opens the details for screenshots.
    private static var startsExpanded: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-previewInviteExpanded")
        #else
        false
        #endif
    }

    private var canAddToCalendar: Bool { InviteTime.span(for: invite) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            if !invite.cancelled {
                availabilityRow
            }

            if expanded {
                details
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if !invite.cancelled, invite.venue != .none || canAddToCalendar {
                actions
            }
        }
        .onAppear { mapProviders = Self.installedMapProviders() }
        .task { await refreshCalendar() }
        .onChange(of: scenePhase) { _, phase in
            // Access may have changed in Settings while we were away.
            if phase == .active { Task { await refreshCalendar() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .EKEventStoreChanged)) { _ in
            Task { await refreshCalendar() }
        }
        .sheet(item: $calendarEvent) { draft in
            AddToCalendarSheet(invite: draft.invite) { saved in
                calendarEvent = nil
                if saved { showToast(MailCardToast(message: "Added to Calendar", icon: .success)) }
            }
            .ignoresSafeArea()
        }
        .confirmationDialog(
            "Directions",
            isPresented: Binding(
                get: { directionsAddress != nil },
                set: { if !$0 { directionsAddress = nil } }
            ),
            titleVisibility: .hidden,
            presenting: directionsAddress
        ) { address in
            ForEach(mapProviders) { provider in
                Button(provider.title) { openDirections(to: address, in: provider) }
            }
        }
    }

    // One line: the whole row toggles the details.
    private var header: some View {
        Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { expanded.toggle() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: invite.cancelled ? "calendar.badge.minus" : "calendar")
                    .font(.system(size: AppTheme.MailCard.iconSize + 2, weight: .medium))
                    .foregroundStyle(invite.cancelled ? AppTheme.deepDarkRed : AppTheme.accent)
                    .frame(width: 20)
                    .accessibilityHidden(true)

                Text(invite.displayTitle)
                    .font(.inter(size: AppTheme.MailCard.title, weight: .semibold))
                    .foregroundStyle(invite.cancelled ? AppTheme.muted : AppTheme.ink)
                    .strikethrough(invite.cancelled, color: AppTheme.muted)
                    .lineLimit(1)
                    .layoutPriority(1)

                if let suffix = headerSuffix {
                    Text(suffix)
                        .font(.inter(size: AppTheme.MailCard.detail))
                        .foregroundStyle(invite.cancelled ? AppTheme.deepDarkRed : AppTheme.muted)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(MailCardRowPressStyle())
        .accessibilityLabel(headerAccessibilityLabel)
        .accessibilityHint(expanded ? "Hides the event details" : "Shows the event details")
    }

    private var headerSuffix: String? {
        if invite.cancelled { return "Cancelled" }
        return InviteTime.compact(for: invite)
    }

    private var headerAccessibilityLabel: String {
        let kind = invite.cancelled ? "Cancelled event" : "Invitation"
        return [kind, invite.displayTitle, InviteTime.summary(for: invite)].compactMap { $0 }.joined(separator: ", ")
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let time = InviteTime.summary(for: invite) {
                detailRow("clock", time)
            }
            if let repeats = InviteRecurrence.label(invite.recurrence) {
                detailRow("repeat", repeats)
            }
            if let location = invite.displayLocation {
                if let address = invite.address, !invite.cancelled {
                    // With a meeting link Join is the primary action; the address
                    // still gets directions from here.
                    Button { showDirections(to: address) } label: {
                        detailRow("mappin.and.ellipse", location, tint: AppTheme.accent)
                    }
                    .buttonStyle(MailCardRowPressStyle())
                    .accessibilityHint("Gets directions")
                } else {
                    detailRow("mappin.and.ellipse", location)
                }
            }
            switch invite.organizerLine {
            case .none:
                EmptyView()
            case .organizer(let organizer):
                detailRow("person", organizer)
            case .claimed(let sender, let claimed):
                // AVE-220: the organizer doesn't match the From, so the real
                // sender leads and the organizer is only what the invite claims.
                VStack(alignment: .leading, spacing: 2) {
                    if let sender {
                        detailRow("person", "From \(sender)", tint: AppTheme.ink)
                    }
                    Text("Claims organizer: \(claimed)")
                        .font(.inter(size: AppTheme.MailCard.detail))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .padding(.leading, sender == nil ? 0 : 24)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.leading, 28)
    }

    private var actions: some View {
        HStack(spacing: AppTheme.MailCard.buttonSpacing) {
            switch invite.venue {
            case .link(let link):
                MailCardButton(title: "Join", systemImage: "video.fill", prominent: false) {
                    // Universal links open Zoom / Meet / Teams when installed, else Safari.
                    openURL(link)
                }
                .accessibilityHint(link.host ?? "")
            case .address(let address):
                MailCardButton(title: "Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill", prominent: false) {
                    showDirections(to: address)
                }
            case .none:
                EmptyView()
            }
            if canAddToCalendar {
                if isInCalendar {
                    MailCardButton(title: "Added", systemImage: "checkmark", prominent: true) {}
                        .disabled(true)
                        .accessibilityLabel("Added to Calendar")
                } else {
                    MailCardButton(title: "Add to Calendar", systemImage: "calendar.badge.plus", prominent: true) {
                        Task { await addTapped() }
                    }
                    .accessibilityHint(
                        calendarAccess == .full
                            ? "Adds the event to \(selectedCalendar?.title ?? "your calendar")"
                            : "Opens the add-event sheet"
                    )
                }
            }
        }
        .sensoryFeedback(.success, trigger: addedEvent) { _, new in new != nil }
    }

    // MARK: Free/busy

    /// "You're free" / "Conflicts with Team sync" and the calendar Add writes to. Before
    /// access: a "Check availability" link that asks. Denied: nothing.
    @ViewBuilder
    private var availabilityRow: some View {
        switch calendarAccess {
        case .full:
            if availability != nil || (canAddToCalendar && !calendars.isEmpty) {
                HStack(spacing: 8) {
                    availabilityLabel
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if canAddToCalendar, !isInCalendar, calendars.count > 0 {
                        calendarMenu
                    }
                }
                .padding(.leading, 28)
                .transition(.opacity)
            }
        case .askable:
            if checksAvailability {
                Button {
                    Task { await checkAvailabilityTapped() }
                } label: {
                    Label {
                        Text("Check availability")
                            .font(.inter(size: AppTheme.MailCard.detail, weight: .medium))
                    } icon: {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 12))
                            .frame(width: 16)
                    }
                    .foregroundStyle(AppTheme.accent)
                }
                .buttonStyle(MailCardRowPressStyle())
                .padding(.leading, 28)
                .accessibilityHint("Asks to read your calendar to see if you’re free")
            }
        case .denied:
            EmptyView()
        }
    }

    @ViewBuilder
    private var availabilityLabel: some View {
        let shown: InviteAvailability? = addedEvent != nil ? .inCalendar : availability
        switch shown {
        case .free?:
            statusLine("checkmark.circle", tint: AppTheme.accent, Text(InviteAvailability.free.label).foregroundStyle(AppTheme.ink))
        case .inCalendar?:
            statusLine("checkmark.circle.fill", tint: AppTheme.accent, Text(InviteAvailability.inCalendar.label).foregroundStyle(AppTheme.ink))
        case .conflict(let title, let others)?:
            statusLine(
                "exclamationmark.circle",
                tint: AppTheme.deepDarkRed,
                Text("Conflicts with ").foregroundStyle(AppTheme.ink)
                    + Text(title).font(.inter(size: AppTheme.MailCard.detail, weight: .semibold)).foregroundStyle(AppTheme.ink)
                    + Text(others > 0 ? " +\(others) more" : "").foregroundStyle(AppTheme.muted)
            )
            .accessibilityLabel(InviteAvailability.conflict(title: title, others: others).label)
        case nil:
            // All-day invites skip free/busy; only the calendar picker shows.
            Text("Add to")
                .font(.inter(size: AppTheme.MailCard.detail))
                .foregroundStyle(AppTheme.muted)
        }
    }

    private func statusLine(_ systemImage: String, tint: Color, _ text: Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16)
                .accessibilityHidden(true)
            text
                .font(.inter(size: AppTheme.MailCard.detail))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
    }

    /// The calendar Add writes to; the choice is remembered on this device.
    private var calendarMenu: some View {
        Menu {
            Picker("Calendar", selection: Binding(
                get: { selectedCalendar?.id ?? "" },
                set: { chosenCalendarID = $0 }
            )) {
                ForEach(calendars) { calendar in
                    Text(calendar.title).tag(calendar.id)
                }
            }
        } label: {
            HStack(spacing: 5) {
                Circle()
                    .fill(selectedCalendar?.color ?? AppTheme.muted)
                    .frame(width: 8, height: 8)
                Text(selectedCalendar?.title ?? "Calendar")
                    .font(.inter(size: AppTheme.MailCard.detail, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
            }
            .contentShape(Rectangle())
        }
        .fixedSize()
        .accessibilityLabel("Calendar, \(selectedCalendar?.title ?? "default")")
        .accessibilityHint("Chooses the calendar Add writes to")
    }

    /// Reads access, calendars and free/busy. Never prompts.
    private func refreshCalendar() async {
        let access = store.access
        var nextCalendars: [InviteCalendarChoice] = []
        var nextDefault: String?
        var nextAvailability: InviteAvailability?
        if access == .full {
            nextCalendars = store.writableCalendars()
            nextDefault = store.defaultCalendarID()
            if let window = InviteAvailability.window(for: invite) {
                nextAvailability = InviteAvailability.check(invite, against: store.events(in: window))
            }
        }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            calendarAccess = access
            calendars = nextCalendars
            defaultCalendarID = nextDefault
            availability = nextAvailability
        }
        #if DEBUG
        if let preview = store as? PreviewInviteCalendar, preview.autoAdds, !didAutoAdd, access == .full {
            didAutoAdd = true
            addDirectly(pinToast: true)
        }
        #endif
    }

    private func checkAvailabilityTapped() async {
        _ = await store.requestAccess()
        await refreshCalendar()
    }

    /// Full access: one tap writes the event. Not asked yet: ask, then add. Denied
    /// (or write-only and declined): the system add-event sheet, as before.
    private func addTapped() async {
        switch store.access {
        case .full:
            addDirectly()
        case .askable:
            if await store.requestAccess() {
                await refreshCalendar()
                addDirectly()
            } else {
                await refreshCalendar()
                calendarEvent = CalendarEventDraft(invite: invite)
            }
        case .denied:
            calendarEvent = CalendarEventDraft(invite: invite)
        }
    }

    private func addDirectly(pinToast: Bool = false) {
        let calendar = targetCalendar()
        do {
            let eventID = try store.add(invite, to: calendar?.id)
            let title = calendar?.title ?? "Calendar"
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                addedEvent = AddedEvent(eventID: eventID, calendarTitle: title)
            }
            showToast(MailCardToast(
                message: "Added to \(title)",
                icon: .success,
                action: ToastAction(title: "Undo", accessibilityHint: "Removes the event from \(title)") {
                    undoAdd(eventID: eventID)
                },
                duration: pinToast ? nil : 5
            ))
        } catch {
            // Couldn't write (calendar gone, read-only account): let the system sheet try.
            calendarEvent = CalendarEventDraft(invite: invite)
        }
    }

    private func undoAdd(eventID: String) {
        showToast(nil)
        do {
            try store.remove(eventID: eventID)
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { addedEvent = nil }
            Task { await refreshCalendar() }
        } catch {
            showToast(MailCardToast(message: "Couldn’t remove the event", icon: .error))
        }
    }

    private func detailRow(_ systemImage: String, _ text: String, tint: Color = AppTheme.muted) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12))
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(text)
                .font(.inter(size: AppTheme.MailCard.detail))
                .multilineTextAlignment(.leading)
                .lineLimit(2)
                .truncationMode(.tail)
        }
        .foregroundStyle(tint)
    }

    /// Apple Maps straight away, or a choice when Google Maps / Waze is installed.
    private func showDirections(to address: String) {
        if mapProviders.count > 1 {
            directionsAddress = address
        } else {
            openDirections(to: address, in: .apple)
        }
    }

    private func openDirections(to address: String, in provider: MapProvider) {
        guard let url = provider.directionsURL(to: address) else { return }
        UIApplication.shared.open(url)
    }

    private static func installedMapProviders() -> [MapProvider] {
        MapProvider.allCases.filter { provider in
            guard let probe = provider.probeURL else { return true }
            return UIApplication.shared.canOpenURL(probe)
        }
    }
}

private struct CalendarEventDraft: Identifiable {
    let id = UUID()
    let invite: EmailInvite
}

// MARK: - Button

/// System glass buttons on iOS 26 (`.glassProminent` / `.glass`), bordered
/// capsules tinted with `accent` before. SF Symbols at the system weight.
private struct MailCardButton: View {
    let title: String
    let systemImage: String
    let prominent: Bool
    let action: () -> Void

    var body: some View {
        let button = Button(action: action) {
            Label {
                Text(title)
                    .font(.inter(size: AppTheme.MailCard.buttonFont, weight: .semibold))
            } icon: {
                Image(systemName: systemImage)
                    .font(.system(size: AppTheme.MailCard.iconSize, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
            }
            .labelStyle(.titleAndIcon)
            .lineLimit(1)
            .frame(minHeight: AppTheme.MailCard.buttonMinHeight)
            .padding(.horizontal, 2)
        }
        .buttonBorderShape(.capsule)
        .controlSize(.regular)
        .tint(AppTheme.accent)

        if #available(iOS 26.0, *) {
            if prominent {
                button.buttonStyle(.glassProminent)
            } else {
                button.buttonStyle(.glass).foregroundStyle(AppTheme.ink)
            }
        } else {
            if prominent {
                button.buttonStyle(.borderedProminent)
            } else {
                button.buttonStyle(.bordered).foregroundStyle(AppTheme.ink)
            }
        }
    }
}

private struct MailCardRowPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
    }
}

// MARK: - EventKit sheet

/// EventKit's add-event sheet, prefilled. On iOS 17+ it runs out of process and
/// saves without the app holding calendar access, so there is no permission prompt.
private struct AddToCalendarSheet: UIViewControllerRepresentable {
    let invite: EmailInvite
    let onFinish: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let controller = EKEventEditViewController()
        controller.eventStore = context.coordinator.store
        controller.event = invite.makeEvent(store: context.coordinator.store)
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let store = EKEventStore()
        let onFinish: (Bool) -> Void

        init(onFinish: @escaping (Bool) -> Void) { self.onFinish = onFinish }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onFinish(action == .saved)
        }
    }
}

// MARK: - Phone calendars (AVE-206)

/// Calendar access as the Invite card sees it. Only full access can read free/busy
/// and add in one tap; everything else falls back to the system add-event sheet.
enum InviteCalendarAccess: Equatable {
    case full
    /// Not asked yet, or write-only (iOS 17 can upgrade that to full on request).
    case askable
    case denied
}

/// A calendar the event can be written to.
struct InviteCalendarChoice: Identifiable, Hashable {
    let id: String
    let title: String
    let color: Color
}

/// The phone's calendars (EventKit), which already include the Google, Outlook and
/// iCloud accounts on the device. No server tokens. DEBUG previews swap in a fake.
@MainActor
protocol InviteCalendarStore: AnyObject {
    var access: InviteCalendarAccess { get }
    func requestAccess() async -> Bool
    func writableCalendars() -> [InviteCalendarChoice]
    func defaultCalendarID() -> String?
    func events(in interval: DateInterval) -> [CalendarBusyEvent]
    /// Saves the invite to `calendarID` and returns the new event's identifier.
    func add(_ invite: EmailInvite, to calendarID: String?) throws -> String
    func remove(eventID: String) throws
}

enum InviteCalendar {
    @MainActor static var current: InviteCalendarStore = {
        #if DEBUG
        if let scenario = PreviewInviteCalendar.Scenario.fromLaunchArguments() {
            return PreviewInviteCalendar(scenario: scenario)
        }
        #endif
        return EventKitInviteCalendar()
    }()

    /// The calendar picked last on the card, remembered on this device.
    static let chosenCalendarKey = "invite_calendar_id"
}

enum InviteCalendarError: Error { case noCalendar, noEvent }

@MainActor
final class EventKitInviteCalendar: InviteCalendarStore {
    private let store = EKEventStore()

    var access: InviteCalendarAccess {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess: return .full
        case .notDetermined, .writeOnly: return .askable
        case .denied, .restricted: return .denied
        default: return .denied
        }
    }

    func requestAccess() async -> Bool {
        let granted = (try? await store.requestFullAccessToEvents()) ?? false
        if granted { store.reset() }
        return granted
    }

    func writableCalendars() -> [InviteCalendarChoice] {
        guard access == .full else { return [] }
        return store.calendars(for: .event)
            .filter(\.allowsContentModifications)
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            .map { InviteCalendarChoice(id: $0.calendarIdentifier, title: $0.title, color: Color(cgColor: $0.cgColor)) }
    }

    func defaultCalendarID() -> String? {
        guard access == .full else { return nil }
        return store.defaultCalendarForNewEvents?.calendarIdentifier
    }

    func events(in interval: DateInterval) -> [CalendarBusyEvent] {
        guard access == .full else { return [] }
        let predicate = store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: nil)
        return store.events(matching: predicate).map { event in
            let me = event.attendees?.first(where: \.isCurrentUser)
            return CalendarBusyEvent(
                title: event.title ?? "",
                start: event.startDate,
                end: event.endDate,
                allDay: event.isAllDay,
                showsAsFree: event.availability == .free,
                declined: me?.participantStatus == .declined,
                cancelled: event.status == .canceled
            )
        }
    }

    func add(_ invite: EmailInvite, to calendarID: String?) throws -> String {
        guard let event = invite.makeEvent(store: store) else { throw InviteCalendarError.noEvent }
        guard let calendar = calendarID.flatMap(store.calendar(withIdentifier:))
                ?? store.defaultCalendarForNewEvents else { throw InviteCalendarError.noCalendar }
        event.calendar = calendar
        try store.save(event, span: .thisEvent, commit: true)
        return event.eventIdentifier ?? event.calendarItemIdentifier
    }

    func remove(eventID: String) throws {
        guard let event = store.event(withIdentifier: eventID) else { return }
        // We created the whole series, so Undo removes all of it.
        try store.remove(event, span: .futureEvents, commit: true)
    }
}

#if DEBUG
/// `-previewDetail -previewInvite -previewInviteFreeBusy free|conflict|added|ask`:
/// fixture calendars and events, so the card's free/busy states can be screenshotted
/// without a real calendar. Peer of Android `inviteCardFree` / `inviteCardConflict` /
/// `inviteCardAdded`.
@MainActor
final class PreviewInviteCalendar: InviteCalendarStore {
    enum Scenario: String {
        case free, conflict, added, ask

        static func fromLaunchArguments() -> Scenario? {
            let args = ProcessInfo.processInfo.arguments
            guard let index = args.firstIndex(of: "-previewInviteFreeBusy") else { return nil }
            let value = args.indices.contains(index + 1) ? args[index + 1] : ""
            return Scenario(rawValue: value) ?? .free
        }
    }

    let scenario: Scenario
    private var granted: Bool
    private var added: [String: DateInterval] = [:]

    init(scenario: Scenario) {
        self.scenario = scenario
        granted = scenario != .ask
    }

    /// The `added` scenario taps Add once on appear, so the Undo toast shows.
    var autoAdds: Bool { scenario == .added }

    var access: InviteCalendarAccess { granted ? .full : .askable }

    func requestAccess() async -> Bool {
        granted = true
        return true
    }

    func writableCalendars() -> [InviteCalendarChoice] {
        guard granted else { return [] }
        return [
            InviteCalendarChoice(id: "family", title: "Family", color: Color(uiColor: .systemGreen)),
            InviteCalendarChoice(id: "personal", title: "Personal", color: Color(uiColor: .systemOrange)),
            InviteCalendarChoice(id: "work", title: "Work", color: Color(uiColor: .systemBlue)),
        ]
    }

    func defaultCalendarID() -> String? { granted ? "work" : nil }

    func events(in interval: DateInterval) -> [CalendarBusyEvent] {
        var events: [CalendarBusyEvent] = []
        if scenario == .conflict {
            events.append(CalendarBusyEvent(
                title: "Team sync",
                start: interval.start.addingTimeInterval(30 * 60),
                end: interval.start.addingTimeInterval(60 * 60)
            ))
            events.append(CalendarBusyEvent(
                title: "1:1 with Sam",
                start: interval.start.addingTimeInterval(45 * 60),
                end: interval.start.addingTimeInterval(75 * 60)
            ))
        }
        // A free (transparent) block that must not count.
        events.append(CalendarBusyEvent(title: "Focus time", start: interval.start, end: interval.end, showsAsFree: true))
        return events
    }

    func add(_ invite: EmailInvite, to calendarID: String?) throws -> String {
        let id = UUID().uuidString
        if let window = InviteAvailability.window(for: invite) { added[id] = window }
        return id
    }

    func remove(eventID: String) throws { added[eventID] = nil }
}
#endif

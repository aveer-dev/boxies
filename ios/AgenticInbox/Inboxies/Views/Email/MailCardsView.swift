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

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: AppTheme.MailCard.cornerRadius, style: .continuous)
    }

    var body: some View {
        Group {
            switch card {
            case .code(let otp, _):
                CodeCard(code: otp.code)
            case .invite(let invite, _):
                InviteCard(invite: invite)
            }
        }
        .padding(AppTheme.MailCard.padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .liquidGlass(in: shape, interactive: false)
        .liquidGlassContainer(spacing: AppTheme.MailCard.buttonSpacing)
        .padding(.horizontal, AppTheme.MailCard.horizontalInset)
        .padding(.bottom, AppTheme.MailCard.bottomInset)
    }
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
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var expanded = Self.startsExpanded
    @State private var calendarEvent: CalendarEventDraft?
    @State private var directionsAddress: String?
    @State private var mapProviders: [MapProvider] = [.apple]

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

            if expanded {
                details
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if !invite.cancelled, invite.venue != .none || canAddToCalendar {
                actions
            }
        }
        .onAppear { mapProviders = Self.installedMapProviders() }
        .sheet(item: $calendarEvent) { draft in
            AddToCalendarSheet(invite: draft.invite) { saved in
                calendarEvent = nil
                if saved { app.showToast("Added to Calendar") }
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
            if let organizer = invite.organizer?.label {
                detailRow("person", organizer)
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
                MailCardButton(title: "Add to Calendar", systemImage: "calendar.badge.plus", prominent: true) {
                    calendarEvent = CalendarEventDraft(invite: invite)
                }
            }
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
                    .font(.inter(size: AppTheme.MailCard.buttonFont, weight: .medium))
            } icon: {
                Image(systemName: systemImage)
                    .font(.system(size: AppTheme.MailCard.iconSize, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
            }
            .labelStyle(.titleAndIcon)
            .lineLimit(1)
        }
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .tint(AppTheme.accent)

        styled(button)
            .modifier(MailCardHitArea(action: action))
    }

    @ViewBuilder
    private func styled(_ button: some View) -> some View {
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

/// Grows the tappable area of a small card button to `buttonHitHeight` without
/// changing its layout: taps on the capsule go to the button, taps just above or
/// below it (inside the card padding) run the same action.
private struct MailCardHitArea: ViewModifier {
    let action: () -> Void

    func body(content: Content) -> some View {
        content
            .background(GeometryReader { proxy in
                let slop = max(0, (AppTheme.MailCard.buttonHitHeight - proxy.size.height) / 2)
                Color.clear
                    .contentShape(Rectangle())
                    .padding(.vertical, -slop)
                    .onTapGesture(perform: action)
                    .accessibilityHidden(true)
            })
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

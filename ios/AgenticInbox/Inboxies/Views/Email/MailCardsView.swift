import EventKit
import EventKitUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The reader's Code card or Invite card, pinned above the bottom bar (AVE-176).
/// Contract: `shared/mail-cards.ts`. Android twin: AVE-177.
struct MailCardView: View {
    let card: MailCards.Card

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
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: AppTheme.MailCard.cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: AppTheme.MailCard.cornerRadius, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 0.5)
        }
        .shadow(color: AppTheme.MailCard.shadow, radius: AppTheme.MailCard.shadowRadius, y: AppTheme.MailCard.shadowY)
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
            VStack(alignment: .leading, spacing: 4) {
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
                style: .primary,
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

private struct InviteCard: View {
    let invite: EmailInvite
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var calendarEvent: CalendarEventDraft?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                    .font(.system(size: 12, weight: .medium))
                    .accessibilityHidden(true)
                Text(invite.cancelled ? "Cancelled event" : "Invitation")
                    .font(.inter(size: AppTheme.MailCard.eyebrow, weight: .medium))
            }
            .foregroundStyle(invite.cancelled ? AppTheme.deepDarkRed : AppTheme.muted)

            VStack(alignment: .leading, spacing: 6) {
                Text(invite.displayTitle)
                    .font(.inter(size: AppTheme.MailCard.title, weight: .semibold))
                    .foregroundStyle(invite.cancelled ? AppTheme.muted : AppTheme.ink)
                    .strikethrough(invite.cancelled, color: AppTheme.muted)
                    .lineLimit(2)

                if let time = InviteTime.summary(for: invite) {
                    detailRow("clock", time)
                }
                if let repeats = InviteRecurrence.label(invite.recurrence) {
                    detailRow("repeat", repeats)
                }
                if let location = invite.displayLocation {
                    detailRow("mappin.and.ellipse", location)
                }
                if let organizer = invite.organizer?.label {
                    detailRow("person", organizer)
                }
            }

            if !invite.cancelled, invite.meetingLink != nil || InviteTime.span(for: invite) != nil {
                HStack(spacing: 8) {
                    if let link = invite.meetingLink {
                        MailCardButton(title: "Join", systemImage: "video", style: .secondary) {
                            openURL(link)
                        }
                        .accessibilityHint(link.host ?? "")
                    }
                    if InviteTime.span(for: invite) != nil {
                        MailCardButton(title: "Add to Calendar", systemImage: "calendar.badge.plus", style: .primary) {
                            calendarEvent = CalendarEventDraft(invite: invite)
                        }
                    }
                }
                .padding(.top, 2)
            }
        }
        .sheet(item: $calendarEvent) { draft in
            AddToCalendarSheet(invite: draft.invite) { saved in
                calendarEvent = nil
                if saved { app.showToast("Added to Calendar") }
            }
            .ignoresSafeArea()
        }
    }

    private func detailRow(_ systemImage: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12))
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(text)
                .font(.inter(size: AppTheme.MailCard.detail))
                .lineLimit(2)
                .truncationMode(.tail)
        }
        .foregroundStyle(AppTheme.muted)
    }
}

private struct CalendarEventDraft: Identifiable {
    let id = UUID()
    let invite: EmailInvite
}

// MARK: - Button

private struct MailCardButton: View {
    enum Style { case primary, secondary }

    let title: String
    let systemImage: String
    let style: Style
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.inter(size: 14, weight: .semibold))
                .labelStyle(.titleAndIcon)
                .lineLimit(1)
                .padding(.horizontal, 14)
                .frame(height: AppTheme.MailCard.buttonHeight)
                .foregroundStyle(style == .primary ? AppTheme.background : AppTheme.ink)
                .background(style == .primary ? AppTheme.ink : AppTheme.pillFill, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(MailCardPressStyle())
    }
}

private struct MailCardPressStyle: ButtonStyle {
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

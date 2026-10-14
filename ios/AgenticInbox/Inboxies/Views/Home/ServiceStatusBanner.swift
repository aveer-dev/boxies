import SwiftUI
import UIKit

/// Calm notice above the home bar: the active mailbox's domain service ended (read-only),
/// or — for domain admins — its subscription is set to end.
struct ServiceStatusBanner: View {
    @Environment(AppModel.self) private var app

    let notice: ServiceNotice

    private var isRenewing: Bool {
        app.renewingDomain == notice.domain || app.restoringDomain == notice.domain
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: notice.systemImage)
                .font(.inter(size: 14, weight: .semibold))
                .foregroundStyle(notice.isEnded ? AppTheme.ink : AppTheme.accent)
                .frame(width: 20)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(notice.title)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail = notice.detail {
                    Text(detail)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let actionTitle = notice.actionTitle {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    Task { await app.renewDomain(notice.domain) }
                } label: {
                    ZStack {
                        Text(actionTitle)
                            .opacity(isRenewing ? 0 : 1)
                        if isRenewing {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(AppTheme.pillFill, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isRenewing)
                .accessibilityLabel(actionTitle)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.08), radius: 10, y: 3)
        .accessibilityElement(children: .contain)
    }
}

/// What the banner says. Pure so the copy can be tested and previewed without a server.
struct ServiceNotice: Equatable {
    let domain: String
    let isEnded: Bool
    let title: String
    let detail: String?
    /// "Renew" / "Keep subscription" for admins who can act; nil otherwise.
    let actionTitle: String?

    var systemImage: String { isEnded ? "lock" : "clock" }

    /// Nil when there is nothing to say: the mailbox is in service and either not set
    /// to end, or the viewer can't do anything about it.
    static func make(mailbox: Mailbox?, service: DomainService?, now: Date = Date()) -> ServiceNotice? {
        guard let mailbox else { return nil }
        let domain = mailbox.domain

        if mailbox.isReadOnly || service?.isEnded == true {
            let title = "Your subscription for \(domain) ended. Mail is read-only."
            guard let service else {
                return ServiceNotice(domain: domain, isEnded: true, title: title, detail: nil, actionTitle: nil)
            }
            guard service.canRenew else {
                return ServiceNotice(
                    domain: domain,
                    isEnded: true,
                    title: title,
                    detail: "This domain can no longer be renewed. You can still read and export your mail.",
                    actionTitle: nil
                )
            }
            var lines: [String] = []
            if service.registrarManaged, let renewBy = service.renewByDate {
                let days = service.daysLeftToRenew ?? max(0, Calendar.current.dateComponents([.day], from: now, to: renewBy).day ?? 0)
                lines.append("Renew by \(DomainService.displayDate(renewBy)) (\(days) \(days == 1 ? "day" : "days") left).")
            }
            if !service.canAdminRenew {
                lines.append("Ask an admin of \(domain) to renew.")
            }
            return ServiceNotice(
                domain: domain,
                isEnded: true,
                title: title,
                detail: lines.isEmpty ? nil : lines.joined(separator: " "),
                actionTitle: service.canAdminRenew ? "Renew" : nil
            )
        }

        // Still running but set to end: admins only, so members aren't alarmed by
        // something only an admin can change.
        if let service, service.isEnding, service.canAdminRenew {
            let when = service.endsAtDate.map { " on \(DomainService.displayDate($0))" } ?? " soon"
            return ServiceNotice(
                domain: domain,
                isEnded: false,
                title: "Service for \(domain) ends\(when).",
                detail: nil,
                actionTitle: "Keep subscription"
            )
        }
        return nil
    }
}

extension View {
    /// Disables a control that would change a read-only mailbox or domain, dimmed so
    /// it reads as unavailable rather than broken.
    func lockedWhenReadOnly(_ readOnly: Bool) -> some View {
        disabled(readOnly)
            .opacity(readOnly ? 0.45 : 1)
    }
}

/// Measured banner height so the list can scroll clear of it.
struct ServiceBannerHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

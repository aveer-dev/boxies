import SwiftUI

/// Domain admin "Subscription" section: whether the domain is in service, until when it
/// can be renewed, and Renew / Keep. Hidden for domains without Inboxies billing.
struct DomainSubscriptionSection: View {
    @Environment(AppModel.self) private var app

    let domain: String

    private var service: DomainService? {
        app.domainServices[domain]
    }

    private var isBusy: Bool {
        app.renewingDomain == domain || app.restoringDomain == domain
    }

    var body: some View {
        Group {
            if let service, service.billed != false {
                Section {
                    row("Status", value: statusText(service), tint: statusTint(service))

                    if service.registrarManaged, let renewBy = service.renewByDate, service.status != "active" {
                        row("Renew by", value: renewByText(renewBy, daysLeft: service.daysLeftToRenew))
                    }

                    if service.canAdminRenew {
                        Button {
                            Task { await app.renewDomain(domain) }
                        } label: {
                            HStack(spacing: 8) {
                                if isBusy {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Text(service.isEnded ? "Renew subscription" : "Keep subscription")
                                    .font(.inter(size: 15, weight: .medium))
                                    .foregroundStyle(AppTheme.accent)
                            }
                        }
                        .disabled(isBusy)
                    }
                } header: {
                    Text("Subscription")
                } footer: {
                    if let footer = footerText(service) {
                        Text(footer)
                    }
                }
            }
        }
        .task(id: domain) {
            guard !domain.isEmpty else { return }
            await app.refreshDomainService(domain)
        }
    }

    private func row(_ title: String, value: String, tint: Color = AppTheme.ink) -> some View {
        HStack {
            Text(title)
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.muted)
            Spacer(minLength: 12)
            Text(value)
                .font(.inter(size: 14, weight: .medium))
                .foregroundStyle(tint)
                .multilineTextAlignment(.trailing)
        }
    }

    private func statusText(_ service: DomainService) -> String {
        if service.isEnded { return "Ended · read-only" }
        if service.isEnding {
            return service.endsAtDate.map { "Ends \(DomainService.displayDate($0))" } ?? "Ending"
        }
        return "Active"
    }

    private func statusTint(_ service: DomainService) -> Color {
        if service.isEnded { return AppTheme.deepDarkRed }
        if service.isEnding { return AppTheme.accent }
        return AppTheme.ink
    }

    private func renewByText(_ date: Date, daysLeft: Int?) -> String {
        let day = DomainService.displayDate(date)
        guard let daysLeft else { return day }
        return "\(day) (\(daysLeft) \(daysLeft == 1 ? "day" : "days") left)"
    }

    private func footerText(_ service: DomainService) -> String? {
        if service.isEnded {
            if !service.canRenew {
                return "This domain can no longer be renewed. You can still export your mail or transfer the domain."
            }
            return "Mailboxes on \(domain) are read-only: no mail is sent or received and settings are frozen. Export and transfer stay available."
        }
        if service.isEnding {
            return "Keep the subscription to stay in service. Otherwise mailboxes on \(domain) become read-only when it ends."
        }
        return nil
    }
}

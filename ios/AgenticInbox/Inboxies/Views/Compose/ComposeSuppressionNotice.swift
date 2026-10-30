import SwiftUI

/// Inline notice for a send the server refused because a recipient is on the bounce /
/// complaint suppression list (409 `recipient_suppressed`). Lists each address with its
/// reason and offers Un-suppress, which lifts them and sends again. Android twin:
/// `ComposeSuppressionNotice` in `ui/compose/ComposeSuppressionNotice.kt`.
struct ComposeSuppressionNotice: View {
    let suppressed: [SuppressedRecipient]
    var isBusy: Bool
    var isDisabled: Bool = false
    let onUnsuppressAndSend: () -> Void

    private var canLiftAll: Bool { suppressed.allSatisfy(\.canUnsuppress) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Not sent")
                .font(.inter(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.deepDarkRed)

            ForEach(suppressed) { recipient in
                VStack(alignment: .leading, spacing: 2) {
                    Text(recipient.address)
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(reasonLine(recipient))
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if !recipient.canUnsuppress {
                        Text(BounceSuppression.askAdminText)
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            if canLiftAll {
                Button(action: onUnsuppressAndSend) {
                    HStack(spacing: 6) {
                        if isBusy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(AppTheme.background)
                        }
                        Text(BounceSuppression.buttonTitle(count: suppressed.count))
                    }
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.background)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(AppTheme.ink)
                .disabled(isBusy || isDisabled)
                .padding(.top, 2)
            }

            Text(BounceSuppression.footerText(canLiftAll: canLiftAll))
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 0.5)
        }
    }

    private func reasonLine(_ recipient: SuppressedRecipient) -> String {
        let reason = BounceSuppression.reasonText(recipient) + "."
        guard let detail = recipient.detail else { return reason }
        return "\(reason) \(detail)"
    }
}

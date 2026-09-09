import SwiftUI

/// An interactive inline pill that represents an email contact or bare email address in AI chat.
/// Tapping the pill opens a menu with actions (Compose, Ask AI, Search, Copy).
struct ContactPillMenu: View {
    let address: MailAddress
    var trailingPunctuation: String? = nil
    var onCompose: ((MailAddress) -> Void)? = nil
    var onSearch: ((String) -> Void)? = nil
    var onAskAI: ((String) -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Menu {
                // Header preview
                Section {
                    if let name = address.name, !name.isEmpty {
                        Label(name, systemImage: "person.crop.circle")
                    }
                    Label(address.email, systemImage: "envelope")
                }

                // Primary actions
                Section {
                    Button {
                        triggerHaptic()
                        onCompose?(address)
                    } label: {
                        Label("New Message", systemImage: "square.and.pencil")
                    }

                    if let onAskAI {
                        Button {
                            triggerHaptic()
                            let prompt = address.name != nil
                                ? "Find emails involving \(address.name!) (\(address.email))"
                                : "Find emails from \(address.email)"
                            onAskAI(prompt)
                        } label: {
                            Label("Ask AI about this contact", systemImage: "sparkles")
                        }
                    }

                    if let onSearch {
                        Button {
                            triggerHaptic()
                            onSearch(address.searchQuery)
                        } label: {
                            Label("Search in Mailbox", systemImage: "magnifyingglass")
                        }
                    }
                }

                // Copy options
                Section {
                    Button {
                        triggerHaptic()
                        UIPasteboard.general.string = address.email
                    } label: {
                        Label("Copy Email Address", systemImage: "doc.on.doc")
                    }

                    if let name = address.name, !name.isEmpty {
                        Button {
                            triggerHaptic()
                            UIPasteboard.general.string = name
                        } label: {
                            Label("Copy Name", systemImage: "person")
                        }

                        Button {
                            triggerHaptic()
                            UIPasteboard.general.string = "\(name) <\(address.email)>"
                        } label: {
                            Label("Copy Full Contact", systemImage: "person.text.rectangle")
                        }
                    }
                }
            } label: {
                pillLabel
            }
            .menuIndicator(.hidden)
            .buttonStyle(.plain)

            if let trailingPunctuation, !trailingPunctuation.isEmpty {
                Text(trailingPunctuation)
                    .font(.inter(size: AppTheme.Chat.body))
                    .tracking(AppTheme.Chat.tracking)
                    .foregroundStyle(AppTheme.ink)
            }
        }
    }

    private var pillLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: address.name != nil ? "person.crop.circle.fill" : "envelope.fill")
                .font(.inter(size: 9.5, weight: .semibold))
                .foregroundStyle(AppTheme.accent)

            Text(address.tokenLabel)
                .font(.inter(size: 11.5, weight: .medium))
                .tracking(AppTheme.Chat.tracking)
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)

            Image(systemName: "chevron.down")
                .font(.inter(size: 7.5, weight: .bold))
                .foregroundStyle(AppTheme.muted.opacity(0.8))
        }
        .padding(.leading, 7)
        .padding(.trailing, 6)
        .padding(.vertical, 3)
        .background(AppTheme.pillFill)
        .clipShape(Capsule())
        .overlay(
            Capsule()
                .stroke(AppTheme.line.opacity(0.6), lineWidth: 0.5)
        )
        .contentShape(Capsule())
        .accessibilityLabel(address.name != nil ? "\(address.name!), \(address.email)" : address.email)
        .accessibilityHint("Shows actions for this contact")
    }

    private func triggerHaptic() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }
}

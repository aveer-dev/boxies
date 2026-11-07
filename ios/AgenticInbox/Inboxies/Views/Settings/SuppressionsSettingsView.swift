import SwiftUI

/// Settings → Outgoing mail → Bounced addresses (AVE-157): recipients the sending
/// domain no longer mails after a hard bounce or a spam complaint. Members see the
/// ones their mailbox caused; domain admins see the whole domain's. Un-suppress lets
/// mail go to them again. Web: `app/components/settings/SuppressionsSettings.tsx`;
/// Android twin: `SuppressionsSettingsView.kt`.
struct SuppressionsSettingsView: View {
    @Environment(AppModel.self) private var app

    @State private var list: SuppressionList?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var confirming: SuppressedRecipient?
    @State private var busyAddress: String?

    private var rows: [SuppressedRecipient] { list?.suppressions ?? [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(BounceSuppression.introText(list))
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 20)

                if isLoading && list == nil {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else if let loadError, list == nil {
                    LoadFailedContent(
                        title: BounceSuppression.loadFailedTitle,
                        message: loadError,
                        isRetrying: isLoading
                    ) { Task { await load() } }
                } else if rows.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(BounceSuppression.emptyTitle)
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text(BounceSuppression.emptyMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(rows) { row in
                            suppressionRow(row)
                            if row.id != rows.last?.id {
                                Divider().overlay(AppTheme.line)
                            }
                        }
                    }
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
            .padding(.top, 8)
        }
        .background(AppTheme.background)
        .navigationTitle(BounceSuppression.pageTitle)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            BounceSuppression.confirmTitle,
            isPresented: Binding(
                get: { confirming != nil },
                set: { if !$0 { confirming = nil } }
            ),
            titleVisibility: .visible,
            presenting: confirming
        ) { row in
            Button("Un-suppress") {
                Task { await unsuppress(row) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { row in
            Text(BounceSuppression.confirmMessage(row))
        }
    }

    private func suppressionRow(_ row: SuppressedRecipient) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.address)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(BounceSuppression.metaLine(row))
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                if let detail = row.detail {
                    Text(detail)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if busyAddress == row.address {
                ProgressView()
                    .controlSize(.small)
                    .frame(minWidth: 44)
            } else if row.canUnsuppress {
                Button {
                    confirming = row
                } label: {
                    Text("Un-suppress")
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(AppTheme.pillFill, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busyAddress != nil)
                .accessibilityLabel("Un-suppress \(row.address)")
            } else {
                Text(BounceSuppression.adminOnlyText)
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: Actions

    private func load() async {
        if app.isDebugPreview {
            list = PreviewSuppressions.list
            isLoading = false
            return
        }
        guard let mailboxId = app.selectedMailboxId else {
            isLoading = false
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            list = try await APIClient.shared.listSuppressions(mailboxId: mailboxId)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func unsuppress(_ row: SuppressedRecipient) async {
        confirming = nil
        busyAddress = row.address
        defer { busyAddress = nil }
        do {
            if !app.isDebugPreview {
                guard let mailboxId = app.selectedMailboxId else { return }
                try await APIClient.shared.unsuppress(mailboxId: mailboxId, address: row.address)
            }
            removeRow(row)
            app.showToast(BounceSuppression.unsuppressedToast(row.address))
        } catch let error where BounceSuppression.isAlreadyLifted(error) {
            // Already lifted elsewhere: drop the row quietly.
            removeRow(row)
        } catch {
            let message = error.localizedDescription
            app.showToast(message.isEmpty ? "Couldn’t un-suppress the address" : message, isError: true)
        }
        if !app.isDebugPreview {
            await load()
        }
    }

    private func removeRow(_ row: SuppressedRecipient) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            list?.suppressions.removeAll { $0.address == row.address }
        }
    }
}

/// DEBUG preview fixtures (`-previewSuppressions`); no server.
enum PreviewSuppressions {
    static var list: SuppressionList {
        let iso = ISO8601DateFormatter()
        let now = Date()
        func ago(days: Double) -> String { iso.string(from: now.addingTimeInterval(-days * 86_400)) }
        return SuppressionList(
            domain: "inboxies.email",
            scope: .mailbox,
            suppressions: [
                SuppressedRecipient(
                    address: "old.contact@example.com", domain: "inboxies.email", reason: .hardBounce,
                    source: "dsn", detail: "550 5.1.1 The email account that you tried to reach does not exist",
                    suppressedAt: ago(days: 2), canUnsuppress: true
                ),
                SuppressedRecipient(
                    address: "newsletter-replies@acme.co", domain: "inboxies.email", reason: .complaint,
                    source: "event", detail: nil, suppressedAt: ago(days: 9), canUnsuppress: true
                ),
                SuppressedRecipient(
                    address: "billing@typo-domain.io", domain: "inboxies.email", reason: .hardBounce,
                    source: "dsn", detail: "Host or domain name not found", suppressedAt: ago(days: 21),
                    canUnsuppress: false
                ),
            ]
        )
    }
}

#Preview("Bounced addresses") {
    PreviewHost {
        NavigationStack {
            SuppressionsSettingsView()
        }
    }
}

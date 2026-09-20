import SwiftUI

/// Per-sender purpose-box defaults (Inbox / Promotions / Updates).
struct SendersSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var preferences: [SenderPreference] = []
    @State private var query = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var busyAddress: String?

    private static let purposeFolders: [(id: String, name: String)] = [
        ("inbox", "Inbox"),
        ("promotions", "Promotions"),
        ("updates", "Updates"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Choose which purpose box each sender goes to. Changing a destination also moves their existing Inbox, Promotions, and Updates mail.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 20)

                TextField("Search senders", text: $query)
                    .font(.inter(size: 15))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.horizontal, 20)
                    .onChange(of: query) { _, _ in
                        Task { await load() }
                    }

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.inter(size: 13))
                        .foregroundStyle(Color.red.opacity(0.85))
                        .padding(.horizontal, 20)
                } else if preferences.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No sender defaults yet")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text("When you move mail into Inbox, Promotions, or Updates, you can set where future mail from that sender goes.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(preferences) { pref in
                            senderRow(pref)
                            if pref.id != preferences.last?.id {
                                Divider().overlay(AppTheme.line)
                            }
                        }
                    }
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                }

                Text("Filters still override these defaults when a rule matches. Spam is never routed by sender preference.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
            .padding(.top, 8)
        }
        .background(AppTheme.background)
        .navigationTitle("Senders")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private func senderRow(_ pref: SenderPreference) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pref.displayName?.isEmpty == false ? pref.displayName! : pref.address)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                if let name = pref.displayName, !name.isEmpty {
                    Text(pref.address)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Menu {
                ForEach(Self.purposeFolders, id: \.id) { folder in
                    Button(folder.name) {
                        Task { await updateFolder(pref, folderId: folder.id) }
                    }
                }
            } label: {
                Text(Self.purposeFolders.first { $0.id == pref.folderId }?.name ?? pref.folderId)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            }
            .disabled(busyAddress == pref.address)

            Button {
                Task { await remove(pref) }
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.muted)
            }
            .disabled(busyAddress == pref.address)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func load() async {
        guard let mailboxId = app.selectedMailboxId else {
            isLoading = false
            return
        }
        isLoading = preferences.isEmpty
        errorMessage = nil
        do {
            preferences = try await APIClient.shared.listSenderPreferences(
                mailboxId: mailboxId,
                q: query.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func updateFolder(_ pref: SenderPreference, folderId: String) async {
        guard let mailboxId = app.selectedMailboxId else { return }
        busyAddress = pref.address
        defer { busyAddress = nil }
        do {
            _ = try await APIClient.shared.upsertSenderPreference(
                mailboxId: mailboxId,
                address: pref.address,
                folderId: folderId,
                displayName: pref.displayName,
                refile: true
            )
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ pref: SenderPreference) async {
        guard let mailboxId = app.selectedMailboxId else { return }
        busyAddress = pref.address
        defer { busyAddress = nil }
        do {
            try await APIClient.shared.deleteSenderPreference(
                mailboxId: mailboxId,
                address: pref.address
            )
            preferences.removeAll { $0.address == pref.address }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

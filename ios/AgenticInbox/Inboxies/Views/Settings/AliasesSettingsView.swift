import SwiftUI
import UIKit

/// Masked email aliases management (Hide My Email).
struct AliasesSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var aliases: [MaskedAlias] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchQuery = ""
    @State private var showCreateSheet = false
    @State private var copiedAliasId: String?
    @State private var editingAlias: MaskedAlias?
    @State private var editLabelDraft = ""
    @State private var showEditLabel = false
    @State private var deletingAlias: MaskedAlias?
    @State private var showDeleteConfirm = false

    private var mailboxId: String? {
        app.selectedMailboxId
    }

    private var filteredAliases: [MaskedAlias] {
        if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return aliases
        }
        let q = searchQuery.lowercased()
        return aliases.filter {
            $0.aliasEmail.lowercased().contains(q) ||
            ($0.label?.lowercased().contains(q) ?? false) ||
            ($0.notes?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "shield.checkered")
                            .font(.inter(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                        Text("Hide My Email")
                            .font(.inter(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                    }
                    Text("Generate private alphanumeric email addresses that forward directly into this mailbox. Keep your primary address private from web trackers, spam lists, and signups.")
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
            }

            Section {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    showCreateSheet = true
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus.circle.fill")
                            .font(.inter(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                        Text("Create new masked email")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            if !aliases.isEmpty {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                        TextField("Search aliases", text: $searchQuery)
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.ink)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if !searchQuery.isEmpty {
                            Button {
                                searchQuery = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.inter(size: 13))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Section {
                if isLoading && aliases.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView()
                            .controlSize(.regular)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .padding(.vertical, 24)
                } else if let errorMessage, aliases.isEmpty {
                    Text(errorMessage)
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.deepDarkRed)
                } else if filteredAliases.isEmpty {
                    ContentUnavailableView(
                        searchQuery.isEmpty ? "No Masked Emails" : "No Matches",
                        systemImage: searchQuery.isEmpty ? "shield.slash" : "magnifyingglass",
                        description: Text(searchQuery.isEmpty ? "Tap 'Create new masked email' to generate your first private address." : "No aliases matched '\(searchQuery)'.")
                    )
                    .listRowBackground(Color.clear)
                    .padding(.vertical, 20)
                } else {
                    ForEach(filteredAliases) { alias in
                        aliasRow(alias)
                    }
                }
            } header: {
                if !filteredAliases.isEmpty {
                    Text("\(filteredAliases.count) \(filteredAliases.count == 1 ? "Address" : "Addresses")")
                }
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Masked emails")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Back")
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateAliasSheet { newAlias in
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    aliases.insert(newAlias, at: 0)
                }
            }
        }
        .alert("Edit label", isPresented: $showEditLabel) {
            TextField("Label", text: $editLabelDraft)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                if let alias = editingAlias {
                    Task { await saveLabel(for: alias, label: editLabelDraft) }
                }
            }
        } message: {
            Text("Provide a recognizable label or purpose for this masked address.")
        }
        .confirmationDialog(
            "Delete Masked Email",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete Address", role: .destructive) {
                if let alias = deletingAlias {
                    Task { await performDelete(alias) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Emails sent to \(deletingAlias?.aliasEmail ?? "this address") will no longer be delivered. This action cannot be undone.")
        }
        .task {
            await loadAliases()
        }
        .refreshable {
            await loadAliases()
        }
        .applyThemeController()
    }

    @ViewBuilder
    private func aliasRow(_ alias: MaskedAlias) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                Text(alias.label?.isEmpty == false ? alias.label! : "Untitled alias")
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)

                Spacer(minLength: 4)

                // Active / Paused Pill
                Text(alias.isActive ? "Active" : "Paused")
                    .font(.inter(size: 11, weight: .semibold))
                    .foregroundStyle(alias.isActive ? AppTheme.accent : AppTheme.muted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(alias.isActive ? AppTheme.accent.opacity(0.12) : AppTheme.pillFill, in: Capsule())

                // Toggle
                Toggle("", isOn: Binding(
                    get: { alias.isActive },
                    set: { newValue in
                        Task { await toggleActive(alias: alias, isActive: newValue) }
                    }
                ))
                .labelsHidden()
                .tint(AppTheme.accent)
                .scaleEffect(0.8)
            }

            // Alias Address Row + Copy
            HStack(spacing: 6) {
                Text(alias.aliasEmail)
                    .font(.system(size: 13, weight: .regular, design: .monospaced))
                    .foregroundStyle(alias.isActive ? AppTheme.ink : AppTheme.muted)
                    .lineLimit(1)

                Button {
                    copyToClipboard(alias.aliasEmail, id: alias.id)
                } label: {
                    Image(systemName: copiedAliasId == alias.id ? "checkmark" : "doc.on.doc")
                        .font(.inter(size: 12))
                        .foregroundStyle(copiedAliasId == alias.id ? AppTheme.accent : AppTheme.muted)
                        .padding(4)
                }
                .buttonStyle(.plain)

                Spacer()

                if let count = alias.forwardedCount, count > 0 {
                    Text("\(count) received")
                        .font(.inter(size: 11))
                        .foregroundStyle(AppTheme.muted)
                }
            }

            // Expiry note or paused drop info
            if let expStr = alias.expiresAt {
                Text("Expires: \(formattedDate(expStr))")
                    .font(.inter(size: 11))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button {
                copyToClipboard(alias.aliasEmail, id: alias.id)
            } label: {
                Label("Copy Address", systemImage: "doc.on.doc")
            }

            Button {
                Task { await toggleActive(alias: alias, isActive: !alias.isActive) }
            } label: {
                Label(alias.isActive ? "Pause Forwarding" : "Resume Forwarding", systemImage: alias.isActive ? "pause.circle" : "play.circle")
            }

            Button {
                editingAlias = alias
                editLabelDraft = alias.label ?? ""
                showEditLabel = true
            } label: {
                Label("Edit Label", systemImage: "pencil")
            }

            Divider()

            Button(role: .destructive) {
                deletingAlias = alias
                showDeleteConfirm = true
            } label: {
                Label("Delete Address", systemImage: "trash")
            }
        }
    }

    private func copyToClipboard(_ text: String, id: String) {
        UIPasteboard.general.string = text
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            copiedAliasId = id
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run {
                if copiedAliasId == id {
                    withAnimation { copiedAliasId = nil }
                }
            }
        }
    }

    private func loadAliases() async {
        guard let mailboxId else { return }
        isLoading = true
        errorMessage = nil
        do {
            aliases = try await APIClient.shared.listAliases(mailboxId: mailboxId)
        } catch {
            errorMessage = "Failed to load masked emails"
        }
        isLoading = false
    }

    private func toggleActive(alias: MaskedAlias, isActive: Bool) async {
        guard let mailboxId else { return }
        do {
            let res = try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, isActive: isActive)
            if let index = aliases.firstIndex(where: { $0.id == alias.id }) {
                aliases[index] = res
            }
        } catch {
            app.showToast("Could not update status", isError: true)
        }
    }

    private func saveLabel(for alias: MaskedAlias, label: String) async {
        guard let mailboxId else { return }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let res = try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, label: trimmed.isEmpty ? nil : trimmed)
            if let index = aliases.firstIndex(where: { $0.id == alias.id }) {
                aliases[index] = res
            }
        } catch {
            app.showToast("Could not save label", isError: true)
        }
    }

    private func performDelete(_ alias: MaskedAlias) async {
        guard let mailboxId else { return }
        do {
            _ = try await APIClient.shared.deleteAlias(mailboxId: mailboxId, aliasId: alias.id)
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                aliases.removeAll { $0.id == alias.id }
            }
            app.showToast("Masked address deleted")
        } catch {
            app.showToast("Could not delete address", isError: true)
        }
    }

    private func formattedDate(_ isoDate: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: isoDate)
        if date == nil {
            formatter.formatOptions = [.withInternetDateTime]
            date = formatter.date(from: isoDate)
        }
        guard let date else { return isoDate }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .short
        return display.string(from: date)
    }
}

// MARK: - Create Alias Sheet

struct CreateAliasSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onCreated: (MaskedAlias) -> Void

    @State private var label = ""
    @State private var notes = ""
    @State private var expiryOption: ExpiryOption = .never
    @State private var pausedAction: String = "drop"
    @State private var isCreating = false
    @State private var errorMessage: String?

    enum ExpiryOption: String, CaseIterable, Identifiable {
        case never = "Never"
        case hours24 = "24 Hours"
        case days7 = "7 Days"
        case days30 = "30 Days"

        var id: String { rawValue }

        var seconds: Int? {
            switch self {
            case .never: return nil
            case .hours24: return 24 * 3600
            case .days7: return 7 * 86400
            case .days30: return 30 * 86400
            }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    SettingsTextFieldRow(
                        title: "Label",
                        text: $label,
                        placeholder: "e.g., Online Store, Newsletter"
                    )
                    SettingsTextFieldRow(
                        title: "Note",
                        text: $notes,
                        placeholder: "Optional notes"
                    )
                } header: {
                    Text("Identity")
                } footer: {
                    SettingsFormFooter(text: "A unique private address like random@private.domain.com will be automatically assigned.")
                }

                Section {
                    SettingsMenuPickerRow(title: "Expiration", selection: $expiryOption) {
                        ForEach(ExpiryOption.allCases) { opt in
                            Text(opt.rawValue).tag(opt)
                        }
                    }

                    SettingsMenuPickerRow(title: "When Paused", selection: $pausedAction) {
                        Text("Drop Silently").tag("drop")
                        Text("Reject (Bounce)").tag("reject")
                    }
                } header: {
                    Text("Rules")
                } footer: {
                    SettingsFormFooter(text: pausedAction == "drop" ? "Incoming messages are silently discarded without notifying the sender." : "Senders receive an SMTP 550 mailbox unavailable bounce.")
                }

                if let errorMessage {
                    Section {
                        SettingsFormErrorBanner(message: errorMessage)
                    }
                }
            }
            .settingsFormListStyle()
            .navigationTitle("New Masked Email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button("Create") {
                        Task { await create() }
                    }
                    .font(.inter(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.accent)
                    .disabled(isCreating)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .applyThemeController()
    }

    private func create() async {
        guard let mailboxId = app.selectedMailboxId else { return }
        isCreating = true
        errorMessage = nil

        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let res = try await APIClient.shared.createAlias(
                mailboxId: mailboxId,
                label: trimmedLabel.isEmpty ? nil : trimmedLabel,
                notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                expiresInSeconds: expiryOption.seconds,
                pausedAction: pausedAction
            )
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onCreated(res)
            dismiss()
        } catch {
            errorMessage = "Failed to create masked address"
        }
        isCreating = false
    }
}

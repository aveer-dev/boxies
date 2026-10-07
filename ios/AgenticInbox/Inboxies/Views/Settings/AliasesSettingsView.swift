import SwiftUI
import UIKit

/// Private email management: random addresses on the mailbox's own domain.
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
    /// Local toast: the app-level toast sits underneath the settings sheet.
    @State private var toast: ComposeToast?
    @State private var toastDismissTask: Task<Void, Never>?

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
            ($0.label?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        PrivateEmailLogoView(size: 20, showTile: false)
                        Text("Private email")
                            .font(.inter(size: 15, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                    }
                    Text("Random addresses on your domain that deliver straight into this mailbox. Replies to mail sent to one go out from that address, so your real address stays private.")
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
                        Text("Create new private email")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(mailboxId == nil)
            }

            if !aliases.isEmpty {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                        TextField("Search private emails", text: $searchQuery)
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
                        searchQuery.isEmpty ? "No Private Emails" : "No Matches",
                        systemImage: searchQuery.isEmpty ? "shield.slash" : "magnifyingglass",
                        description: Text(searchQuery.isEmpty ? "Tap 'Create new private email' to generate your first private address." : "No private emails match '\(searchQuery)'.")
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
            } footer: {
                if !filteredAliases.isEmpty {
                    SettingsFormFooter(text: "Touch and hold an address to pause it, relabel it, or change what happens to its mail.")
                }
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Private email")
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
            Text("Provide a recognizable label or purpose for this private address. Leave it empty to remove the label.")
        }
        .confirmationDialog(
            "Delete Private Email",
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
            Text("Emails sent to \(deletingAlias?.aliasEmail ?? "this address") will no longer be delivered, and you won't be able to reply from it. This action cannot be undone.")
        }
        .overlay(alignment: .bottom) {
            if let toast {
                toastView(toast)
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: toast?.id)
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
        let status = AliasStatus(alias)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                Text(displayLabel(for: alias))
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)

                Spacer(minLength: 4)

                statusPill(status)

                Toggle("", isOn: Binding(
                    get: { alias.isActive },
                    set: { newValue in
                        Task { await setActive(alias, isActive: newValue) }
                    }
                ))
                .labelsHidden()
                .tint(AppTheme.accent)
                .scaleEffect(0.8)
                .accessibilityLabel(alias.isActive ? "Pause \(alias.aliasEmail)" : "Resume \(alias.aliasEmail)")
            }

            HStack(spacing: 6) {
                Text(alias.aliasEmail)
                    .font(.inter(size: 13))
                    .foregroundStyle(status == .active ? AppTheme.ink : AppTheme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Button {
                    copyToClipboard(alias.aliasEmail, id: alias.id)
                } label: {
                    Image(systemName: copiedAliasId == alias.id ? "checkmark" : "doc.on.doc")
                        .font(.inter(size: 12))
                        .foregroundStyle(copiedAliasId == alias.id ? AppTheme.accent : AppTheme.muted)
                        .padding(4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Copy address")

                Spacer(minLength: 0)
            }

            Text(metaLine(for: alias, status: status))
                .font(.inter(size: 11))
                .foregroundStyle(AppTheme.muted)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
        .contextMenu {
            Button {
                copyToClipboard(alias.aliasEmail, id: alias.id)
            } label: {
                Label("Copy Address", systemImage: "doc.on.doc")
            }

            Button {
                Task { await setActive(alias, isActive: !alias.isActive) }
            } label: {
                Label(alias.isActive ? "Pause" : "Resume", systemImage: alias.isActive ? "pause.circle" : "play.circle")
            }

            Button {
                editingAlias = alias
                editLabelDraft = alias.label ?? ""
                showEditLabel = true
            } label: {
                Label("Edit Label", systemImage: "pencil")
            }

            Picker(selection: Binding(
                get: { alias.pausedAction },
                set: { action in
                    Task { await setPausedAction(alias, action: action) }
                }
            )) {
                Text("Drop Silently").tag("drop")
                Text("Reject (Bounce)").tag("reject")
            } label: {
                Label("When Paused", systemImage: "hand.raised")
            }
            .pickerStyle(.menu)

            Menu {
                ForEach(AliasExpiryOption.allCases) { option in
                    Button {
                        Task { await setExpiry(alias, option: option) }
                    } label: {
                        if option == .never && alias.expiresAt == nil {
                            Label(option.editTitle, systemImage: "checkmark")
                        } else {
                            Text(option.editTitle)
                        }
                    }
                }
            } label: {
                Label("Expiration", systemImage: "clock")
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

    private func statusPill(_ status: AliasStatus) -> some View {
        Text(status.title)
            .font(.inter(size: 11, weight: .semibold))
            .foregroundStyle(status.foreground)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(status.background, in: Capsule())
    }

    private func toastView(_ toast: ComposeToast) -> some View {
        HStack(spacing: 8) {
            Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .font(.inter(size: 13, weight: .semibold))
                .foregroundStyle(toast.isError ? .red : AppTheme.ink)

            Text(toast.message)
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func displayLabel(for alias: MaskedAlias) -> String {
        if let label = alias.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            return label
        }
        return "Untitled"
    }

    /// "12 received · 3 blocked · Expires Oct 8, 2026 at 4:00 PM"
    private func metaLine(for alias: MaskedAlias, status: AliasStatus) -> String {
        var parts = ["\(alias.statsReceived) received", "\(alias.statsBlocked) blocked"]
        if let expiry = alias.expiryDate {
            let formatted = expiry.formatted(date: .abbreviated, time: .shortened)
            parts.append(status == .expired ? "Expired \(formatted)" : "Expires \(formatted)")
        }
        return parts.joined(separator: " · ")
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

    private func showToast(_ message: String, isError: Bool = false) {
        toastDismissTask?.cancel()
        toast = ComposeToast(message: message, isError: isError)
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }

    private func loadAliases() async {
        guard let mailboxId else {
            isLoading = false
            errorMessage = "Select a mailbox to manage its private emails."
            return
        }
        isLoading = true
        errorMessage = nil
        do {
            aliases = try await APIClient.shared.listAliases(mailboxId: mailboxId)
        } catch {
            if !Task.isCancelled {
                if aliases.isEmpty {
                    errorMessage = "Couldn’t load private emails"
                } else {
                    showToast("Couldn’t refresh private emails", isError: true)
                }
            }
        }
        isLoading = false
    }

    private func replaceLocal(_ alias: MaskedAlias) {
        guard let index = aliases.firstIndex(where: { $0.id == alias.id }) else { return }
        aliases[index] = alias
    }

    /// Shows the edit right away, then saves; rolls back and toasts on failure.
    private func applyUpdate(
        to alias: MaskedAlias,
        failureMessage: String,
        change: (inout MaskedAlias) -> Void,
        save: (_ mailboxId: String) async throws -> MaskedAlias
    ) async {
        guard let mailboxId else { return }
        var optimistic = alias
        change(&optimistic)
        replaceLocal(optimistic)
        do {
            replaceLocal(try await save(mailboxId))
        } catch {
            replaceLocal(alias)
            showToast(failureMessage, isError: true)
        }
    }

    private func setActive(_ alias: MaskedAlias, isActive: Bool) async {
        await applyUpdate(
            to: alias,
            failureMessage: "Couldn’t update status",
            change: { $0.isActive = isActive }
        ) { mailboxId in
            try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, isActive: isActive)
        }
    }

    private func saveLabel(for alias: MaskedAlias, label: String) async {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        await applyUpdate(
            to: alias,
            failureMessage: "Couldn’t save label",
            change: { $0.label = trimmed.isEmpty ? nil : trimmed }
        ) { mailboxId in
            // Empty clears the label server-side.
            try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, label: trimmed)
        }
    }

    private func setPausedAction(_ alias: MaskedAlias, action: String) async {
        guard action != alias.pausedAction else { return }
        await applyUpdate(
            to: alias,
            failureMessage: "Couldn’t update paused behavior",
            change: { $0.pausedAction = action }
        ) { mailboxId in
            try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, pausedAction: action)
        }
    }

    private func setExpiry(_ alias: MaskedAlias, option: AliasExpiryOption) async {
        let expiry = option.expiry(from: Date())
        await applyUpdate(
            to: alias,
            failureMessage: "Couldn’t update expiration",
            change: { $0.expiresAt = expiry.isoString }
        ) { mailboxId in
            try await APIClient.shared.updateAlias(mailboxId: mailboxId, aliasId: alias.id, expiry: expiry)
        }
    }

    private func performDelete(_ alias: MaskedAlias) async {
        guard let mailboxId else { return }
        do {
            try await APIClient.shared.deleteAlias(mailboxId: mailboxId, aliasId: alias.id)
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                aliases.removeAll { $0.id == alias.id }
            }
            showToast("Private email deleted")
        } catch {
            showToast("Couldn’t delete address", isError: true)
        }
    }
}

/// Row state. Expired wins over paused: resuming alone won't revive it.
private enum AliasStatus {
    case active, paused, expired

    init(_ alias: MaskedAlias, now: Date = Date()) {
        if alias.isExpired(now: now) {
            self = .expired
        } else {
            self = alias.isActive ? .active : .paused
        }
    }

    var title: String {
        switch self {
        case .active: return "Active"
        case .paused: return "Paused"
        case .expired: return "Expired"
        }
    }

    var foreground: Color {
        switch self {
        case .active: return AppTheme.accent
        case .paused: return AppTheme.muted
        case .expired: return AppTheme.deepDarkRed
        }
    }

    var background: Color {
        switch self {
        case .active: return AppTheme.accent.opacity(0.12)
        case .paused: return AppTheme.pillFill
        case .expired: return AppTheme.deepDarkRed.opacity(0.12)
        }
    }
}

/// Expiry presets; relative choices become an absolute date when saved.
enum AliasExpiryOption: String, CaseIterable, Identifiable {
    case never = "Never"
    case hours24 = "24 Hours"
    case days7 = "7 Days"
    case days30 = "30 Days"

    var id: String { rawValue }

    /// Context-menu wording, where the clock starts when you pick it.
    var editTitle: String {
        self == .never ? "Never" : "\(rawValue) from Now"
    }

    private var interval: TimeInterval? {
        switch self {
        case .never: return nil
        case .hours24: return 24 * 3600
        case .days7: return 7 * 86400
        case .days30: return 30 * 86400
        }
    }

    func date(from now: Date) -> Date? {
        interval.map { now.addingTimeInterval($0) }
    }

    func expiry(from now: Date) -> AliasExpiry {
        date(from: now).map(AliasExpiry.at) ?? .never
    }
}

// MARK: - Create Alias Sheet

struct CreateAliasSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onCreated: (MaskedAlias) -> Void

    @State private var label = ""
    @State private var expiryOption: AliasExpiryOption = .never
    @State private var pausedAction: String = "drop"
    @State private var isCreating = false
    @State private var errorMessage: String?

    /// Private emails live on the apex of the mailbox's own domain.
    private var addressFooter: String {
        let mailbox = app.selectedMailbox?.email ?? app.selectedMailboxId ?? ""
        if let at = mailbox.lastIndex(of: "@") {
            let domain = mailbox[mailbox.index(after: at)...]
            if !domain.isEmpty {
                return "A random address like k8m2p9v4@\(domain) will be assigned automatically."
            }
        }
        return "A random address on your mailbox's domain will be assigned automatically."
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
                } header: {
                    Text("Identity")
                } footer: {
                    SettingsFormFooter(text: addressFooter)
                }

                Section {
                    SettingsMenuPickerRow(title: "Expiration", selection: $expiryOption) {
                        ForEach(AliasExpiryOption.allCases) { opt in
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
            .navigationTitle("New Private Email")
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
        guard let mailboxId = app.selectedMailboxId else {
            errorMessage = "Select a mailbox first."
            return
        }
        isCreating = true
        errorMessage = nil

        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            let res = try await APIClient.shared.createAlias(
                mailboxId: mailboxId,
                label: trimmedLabel.isEmpty ? nil : trimmedLabel,
                expiresAt: expiryOption.date(from: Date()),
                pausedAction: pausedAction
            )
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onCreated(res)
            dismiss()
        } catch {
            // Server reasons (e.g. the per-mailbox limit) are worth showing as-is.
            if case APIError.http(_, let message) = error, !message.isEmpty {
                errorMessage = message
            } else {
                errorMessage = "Failed to create private email"
            }
        }
        isCreating = false
    }
}

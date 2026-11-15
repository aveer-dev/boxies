import SwiftUI
import UIKit

/// One alias row in Domain Admin → Aliases (AVE-219): the alias address over its
/// target mailbox, with a trailing menu to delete it. Android twin: `DomainAliasRow`.
struct DomainAliasRow: View {
    let alias: DomainAliasItem
    var busy: Bool = false
    var enabled: Bool = true
    var onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(alias.aliasEmail)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                HStack(spacing: 4) {
                    Image(systemName: "arrow.turn.down.right")
                        .font(.system(size: 10, weight: .semibold))
                    Text(alias.targetMailboxId)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 8)
            if busy {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 32, height: 32)
            } else {
                Menu {
                    Button("Delete alias", systemImage: "trash", role: .destructive, action: onDelete)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel("Actions for \(alias.aliasEmail)")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Add-alias sheet: alias local part on the domain + the mailbox it delivers to.
/// Errors (bad name, target not allowed, address in use) show as a toast in the sheet.
/// Android twin: `DomainAliasAddSheet`.
struct DomainAliasAddSheet: View {
    @Environment(\.dismiss) private var dismiss

    let domain: String
    let targets: [AdminMailboxRow]
    let existing: [DomainAliasItem]
    /// DEBUG fixtures: add in memory, no API.
    var isPreview: Bool = false
    var onAdded: (DomainAliasItem) -> Void

    @State private var draft = ""
    @State private var targetId: String?
    @State private var isSaving = false
    @State private var toast: ComposeToast?
    @State private var toastDismissTask: Task<Void, Never>?
    @FocusState private var fieldFocused: Bool

    private var local: String { DomainAliases.normalizedLocal(draft) }
    private var canAdd: Bool { !isSaving && !local.isEmpty && targetId != nil }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 4) {
                        TextField(text: $draft, prompt: Text(verbatim: "sales").foregroundStyle(AppTheme.muted)) {
                            Text(verbatim: "Alias")
                        }
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                        .submitLabel(.done)
                        .focused($fieldFocused)
                        .onSubmit { Task { await add() } }
                        .accessibilityLabel("Alias")
                        Text("@\(domain)")
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .foregroundStyle(AppTheme.muted)
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                } header: {
                    Text("Alias")
                }

                Section {
                    if targets.isEmpty {
                        Text(DomainAliases.noTargets)
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.muted)
                    }
                    ForEach(targets) { row in
                        Button {
                            targetId = row.id
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.email)
                                        .font(.inter(size: 15, weight: .medium))
                                        .foregroundStyle(AppTheme.ink)
                                        .lineLimit(1)
                                    Text(row.name)
                                        .font(.inter(size: 12))
                                        .foregroundStyle(AppTheme.muted)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                if targetId == row.id {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(AppTheme.accent)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(targetId == row.id ? .isSelected : [])
                    }
                } header: {
                    Text("Delivers to")
                } footer: {
                    SettingsFormFooter(text: footer)
                }
            }
            .settingsFormListStyle()
            .navigationTitle(DomainAliases.addTitle)
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
                    Button {
                        Task { await add() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Add")
                                .font(.inter(size: 15, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }
                    .disabled(!canAdd)
                    .opacity(canAdd || isSaving ? 1 : 0.45)
                }
            }
            .overlay(alignment: .bottom) {
                if let toast {
                    InboxiesToast(
                        message: toast.message,
                        icon: toast.toastIcon,
                        onDismiss: {
                            toastDismissTask?.cancel()
                            self.toast = nil
                        }
                    )
                    .padding(.horizontal, ToastMetrics.screenInset)
                    .padding(.bottom, ToastMetrics.standaloneBottomInset)
                }
            }
            .animation(ToastMetrics.animation, value: toast?.id)
        }
        .presentationDetents([.medium, .large])
        .applyThemeController()
        .onAppear {
            if targetId == nil { targetId = targets.first?.id }
        }
        #if DEBUG
        .task {
            // `-previewDomainAliasConflict`: try an address that's already a mailbox (409 toast).
            guard isPreview, ProcessInfo.processInfo.arguments.contains("-previewDomainAliasConflict"),
                  let taken = targets.dropFirst().first ?? targets.first else { return }
            draft = String(taken.email.prefix { $0 != "@" })
            try? await Task.sleep(nanoseconds: 500_000_000)
            await add()
        }
        #endif
    }

    private var footer: String {
        let address = local.isEmpty ? "the alias" : "\(local)@\(domain)"
        return "Mail sent to \(address) is delivered to this mailbox."
    }

    private func add() async {
        guard !isSaving else { return }
        guard DomainAliases.isValidLocal(local) else {
            showToast(DomainAliases.invalidLocal)
            return
        }
        guard let targetId else {
            showToast(DomainAliases.noTargets)
            return
        }
        if let conflict = DomainAliases.conflict(local: local, domain: domain, aliases: existing, mailboxes: targets) {
            showToast(conflict)
            return
        }
        isSaving = true
        defer { isSaving = false }
        let fallback = DomainAliasItem(
            aliasLocal: local,
            aliasEmail: "\(local)@\(domain.lowercased())",
            targetMailboxId: targetId,
            createdAt: nil
        )
        do {
            let created = isPreview
                ? fallback
                : try await APIClient.shared.createDomainAlias(domain: domain, aliasLocal: local, targetMailboxId: targetId)
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            onAdded(created ?? fallback)
            dismiss()
        } catch {
            showToast(DomainAliases.addErrorMessage(for: error))
        }
    }

    private func showToast(_ message: String) {
        toastDismissTask?.cancel()
        toast = ComposeToast(message: message, isError: true)
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }
}

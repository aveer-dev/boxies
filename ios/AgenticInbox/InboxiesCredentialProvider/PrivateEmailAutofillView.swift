import SwiftUI

/// Confirm sheet for Private email AutoFill: pick the label and the mailbox the
/// new address forwards to, then the server creates it and the system fills it in.
@Observable
@MainActor
final class PrivateEmailAutofillModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case ready
        case failed(String)
    }

    var phase: Phase = .loading
    var mailboxes: [AutofillAPI.Mailbox] = []
    var selectedMailboxId: String?
    var label: String
    var isCreating = false
    var errorMessage: String?

    let complete: (String) -> Void
    let cancel: () -> Void
    private var api: AutofillAPI?

    init(suggestedLabel: String?, complete: @escaping (String) -> Void, cancel: @escaping () -> Void) {
        label = suggestedLabel ?? ""
        self.complete = complete
        self.cancel = cancel
    }

    func load() async {
        guard let api = AutofillAPI.sharedSession() else {
            phase = .signedOut
            return
        }
        self.api = api
        phase = .loading
        do {
            let list = try await api.mailboxes()
            mailboxes = list
            let remembered = KeychainStore.read(KeychainStore.autofillMailboxIdKey)
            selectedMailboxId = list.first { $0.id == remembered }?.id ?? list.first?.id
            phase = list.isEmpty ? .failed("Add a mailbox in Inboxies first.") : .ready
        } catch AutofillAPI.Failure.sessionExpired {
            phase = .signedOut
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func create() async {
        guard let api, let mailboxId = selectedMailboxId, !isCreating else { return }
        isCreating = true
        errorMessage = nil
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let address = try await api.createAlias(mailboxId: mailboxId, label: trimmed.isEmpty ? nil : trimmed)
            complete(address)
        } catch AutofillAPI.Failure.sessionExpired {
            phase = .signedOut
        } catch {
            errorMessage = error.localizedDescription
        }
        isCreating = false
    }
}

struct PrivateEmailAutofillView: View {
    @Bindable var model: PrivateEmailAutofillModel

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("New Private Email")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            model.cancel()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.inter(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.ink)
                                .frame(width: 32, height: 32)
                        }
                        .accessibilityLabel("Close")
                    }

                    if model.phase == .ready {
                        ToolbarItem(placement: .topBarTrailing) {
                            if model.isCreating {
                                ProgressView()
                            } else {
                                Button("Create") {
                                    Task { await model.create() }
                                }
                                .font(.inter(size: 15, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                                .disabled(model.selectedMailboxId == nil)
                            }
                        }
                    }
                }
        }
        .tint(AppTheme.accent)
        .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppTheme.background)
        case .signedOut:
            ContentUnavailableView(
                "Sign in to Inboxies",
                systemImage: "person.crop.circle.badge.exclamationmark",
                description: Text("Open the Inboxies app and sign in, then come back to create a private email.")
            )
            .background(AppTheme.background)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Your Mailboxes", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task { await model.load() }
                }
                .font(.inter(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
            }
            .background(AppTheme.background)
        case .ready:
            form
        }
    }

    private var form: some View {
        List {
            Section {
                SettingsTextFieldRow(
                    title: "Label",
                    text: $model.label,
                    placeholder: "e.g., Online Store, Newsletter"
                )
                forwardsToRow
            } footer: {
                SettingsFormFooter(text: "Inboxies creates a new private address and fills it in. Mail sent to it forwards to your mailbox. Pause or delete it any time in Settings → Private email.")
            }

            if let errorMessage = model.errorMessage {
                Section {
                    SettingsFormErrorBanner(message: errorMessage)
                }
            }
        }
        .settingsFormListStyle()
        .disabled(model.isCreating)
    }

    /// One line, middle-truncated: mailbox addresses are too long for a stock menu picker row.
    private var forwardsToRow: some View {
        HStack(spacing: 12) {
            Text("Forwards to")
                .foregroundStyle(AppTheme.ink)
            Spacer(minLength: 8)
            if model.mailboxes.count > 1 {
                Menu {
                    Picker("Forwards to", selection: $model.selectedMailboxId) {
                        ForEach(model.mailboxes) { mailbox in
                            Text(mailbox.email).tag(Optional(mailbox.id))
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        selectedEmail
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.inter(size: 12, weight: .medium))
                    }
                    .foregroundStyle(AppTheme.muted)
                }
            } else {
                selectedEmail
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .font(.inter(size: SettingsFormChrome.rowFontSize))
    }

    private var selectedEmail: some View {
        Text(model.mailboxes.first { $0.id == model.selectedMailboxId }?.email ?? "")
            .lineLimit(1)
            .truncationMode(.middle)
    }
}

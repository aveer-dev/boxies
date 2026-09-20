import SwiftUI

/// Domain Admin console — list/create/assign/invite/delete mailboxes.
struct DomainAdminSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var showsDismiss: Bool = true
    var onAssigned: (() -> Void)? = nil

    @State private var rows: [AdminMailboxRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var assigningId: String?
    @State private var deletingId: String?
    @State private var showCreate = false
    @State private var inviteForId: String?
    @State private var lastInviteUrl: String?
    @State private var statusMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    if let errorMessage {
                        Section {
                            Text(errorMessage)
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.deepDarkRed)
                        }
                    }
                    if let statusMessage {
                        Section {
                            Text(statusMessage)
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    if let lastInviteUrl {
                        Section("Invite link") {
                            Text(lastInviteUrl)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(AppTheme.muted)
                                .textSelection(.enabled)
                            Button("Copy link") {
                                UIPasteboard.general.string = lastInviteUrl
                                statusMessage = "Invite link copied"
                            }
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                        }
                    }

                    Section {
                        Button {
                            showCreate = true
                        } label: {
                            Label("Create email", systemImage: "plus")
                                .font(.inter(size: 16, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }

                    Section("Domain mailboxes") {
                        if rows.isEmpty {
                            Text("No mailboxes yet. Create the first address.")
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.muted)
                        }
                        ForEach(rows) { row in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(row.email)
                                    .font(.inter(size: 15, weight: .medium))
                                    .foregroundStyle(AppTheme.ink)
                                Text(row.claimed == true ? "Claimed · \(row.name)" : "Unclaimed · \(row.name)")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.muted)
                                HStack(spacing: 16) {
                                    Button("Assign to me") {
                                        Task { await assignSelf(row.id) }
                                    }
                                    .disabled(assigningId != nil)
                                    Button("Invite") {
                                        inviteForId = row.id
                                    }
                                    Button("Delete", role: .destructive) {
                                        Task { await deleteMailbox(row.id) }
                                    }
                                    .disabled(deletingId != nil)
                                }
                                .font(.inter(size: 14, weight: .medium))
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
        }
        .background(AppTheme.background)
        .navigationTitle("Admin")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if showsDismiss {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.inter(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await reload() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .foregroundStyle(AppTheme.ink)
                }
            }
        }
        .task { await reload() }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                DomainAdminCreateView { url in
                    lastInviteUrl = url
                    statusMessage = url == nil ? "Mailbox created" : "Mailbox created — invite ready"
                    Task { await reload() }
                }
            }
        }
        .sheet(item: Binding(
            get: { inviteForId.map { InviteTarget(id: $0) } },
            set: { inviteForId = $0?.id }
        )) { target in
            NavigationStack {
                DomainAdminInviteView(mailboxId: target.id) { url in
                    lastInviteUrl = url
                    statusMessage = "Invite ready"
                }
            }
        }
    }

    private func reload() async {
        isLoading = rows.isEmpty
        errorMessage = nil
        do {
            rows = try await APIClient.shared.listAdminMailboxes()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func assignSelf(_ mailboxId: String) async {
        assigningId = mailboxId
        defer { assigningId = nil }
        do {
            _ = try await APIClient.shared.assignAdminMailboxToSelf(mailboxId: mailboxId)
            await app.refreshMailboxes(showLoading: true)
            statusMessage = "Assigned to you"
            onAssigned?()
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteMailbox(_ mailboxId: String) async {
        deletingId = mailboxId
        defer { deletingId = nil }
        do {
            try await APIClient.shared.deleteAdminMailbox(mailboxId: mailboxId)
            if app.selectedMailboxId == mailboxId {
                await app.refreshMailboxes(showLoading: true)
            }
            statusMessage = "Mailbox deleted"
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct InviteTarget: Identifiable {
    let id: String
}

private struct DomainAdminCreateView: View {
    @Environment(\.dismiss) private var dismiss
    var onDone: (String?) -> Void

    @State private var localPart = ""
    @State private var displayName = ""
    @State private var assignMode = 0 // 0 self, 1 invite
    @State private var inviteEmail = ""
    @State private var inviteName = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let domain = "inboxies.email"

    var body: some View {
        Form {
            Section {
                HStack {
                    TextField("username", text: $localPart)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: localPart) { _, v in
                            if let at = v.firstIndex(of: "@") {
                                localPart = String(v[..<at])
                            }
                        }
                    Text("@\(domain)")
                        .foregroundStyle(AppTheme.muted)
                }
                TextField("Display name (optional)", text: $displayName)
            }
            Section("Assign to") {
                Picker("Assign", selection: $assignMode) {
                    Text("Me").tag(0)
                    Text("Invite someone").tag(1)
                }
                .pickerStyle(.segmented)
                if assignMode == 1 {
                    TextField("Invitee email", text: $inviteEmail)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Invitee name (optional)", text: $inviteName)
                }
            }
            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(AppTheme.deepDarkRed)
                }
            }
        }
        .navigationTitle("Create email")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Create") {
                    Task { await create() }
                }
                .disabled(isSaving || localPart.isEmpty || (assignMode == 1 && inviteEmail.isEmpty))
            }
        }
    }

    private func create() async {
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil
        let email = "\(localPart)@\(domain)"
        do {
            let result = try await APIClient.shared.createAdminMailbox(
                email: email,
                name: displayName.isEmpty ? localPart : displayName,
                assignToSelf: assignMode == 0,
                inviteEmail: assignMode == 1 ? inviteEmail : nil,
                inviteeName: assignMode == 1 ? inviteName : nil
            )
            onDone(result.invite?.inviteUrl)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DomainAdminInviteView: View {
    let mailboxId: String
    var onDone: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var inviteEmail = ""
    @State private var inviteName = ""
    @State private var asOwner = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                Text(mailboxId)
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
                TextField("Invitee email", text: $inviteEmail)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                TextField("Name (optional)", text: $inviteName)
                Toggle("Invite as owner", isOn: $asOwner)
                    .tint(AppTheme.accent)
            }
            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(AppTheme.deepDarkRed)
                }
            }
        }
        .navigationTitle("Invite")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Send") {
                    Task { await send() }
                }
                .disabled(isSaving || inviteEmail.isEmpty)
            }
        }
    }

    private func send() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let result = try await APIClient.shared.createAdminInvite(
                mailboxId: mailboxId,
                inviteEmail: inviteEmail,
                inviteeName: inviteName.isEmpty ? nil : inviteName,
                role: asOwner ? "owner" : "member"
            )
            onDone(result.inviteUrl)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

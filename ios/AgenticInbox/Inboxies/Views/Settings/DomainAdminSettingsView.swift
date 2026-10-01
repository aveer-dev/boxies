import SwiftUI
import UIKit

/// Domain Admin console — list/create/assign/invite/delete mailboxes.
struct DomainAdminSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var showsDismiss: Bool = true
    var onAssigned: (() -> Void)? = nil
    /// DEBUG / Simulator fixture rows — skips the network reload when non-nil.
    var previewRows: [AdminMailboxRow]? = nil

    @State private var rows: [AdminMailboxRow] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showCreate = false
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
                        NavigationLink {
                            DomainAdminDNSView()
                        } label: {
                            Label("DNS & Domain Configuration", systemImage: "globe")
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                        }

                        Button {
                            showCreate = true
                        } label: {
                            Label("Create email", systemImage: "plus")
                                .font(.inter(size: 15, weight: .medium))
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
                            NavigationLink {
                                DomainAdminMailboxDetailView(
                                    mailbox: row,
                                    previewRows: previewRows,
                                    onAssigned: {
                                        Task { await reload() }
                                        onAssigned?()
                                    },
                                    onMailboxUpdated: { updated in
                                        if let idx = rows.firstIndex(where: { $0.id == updated.id }) {
                                            rows[idx] = updated
                                            app.setAdminMailboxes(rows)
                                        }
                                    },
                                    onMailboxDeleted: { deletedId in
                                        rows.removeAll { $0.id == deletedId }
                                        app.setAdminMailboxes(rows)
                                        if app.selectedMailboxId == deletedId {
                                            Task { await app.refreshMailboxes(showLoading: true) }
                                        }
                                    }
                                )
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(row.email)
                                        .font(.inter(size: 15, weight: .medium))
                                        .foregroundStyle(AppTheme.ink)
                                    Text(row.claimed == true ? "Claimed · \(row.name)" : "Unclaimed · \(row.name)")
                                        .font(.inter(size: 12))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.vertical, 4)
                            }
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
        .toolbarRole(.editor)
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
        .onAppear {
            if let previewRows {
                rows = previewRows
                isLoading = false
            } else if let cached = app.adminMailboxes {
                rows = cached
                isLoading = false
            }
        }
        .task {
            if rows.isEmpty {
                await reload()
            }
        }
        .sheet(isPresented: $showCreate) {
            NavigationStack {
                DomainAdminCreateView { url in
                    lastInviteUrl = url
                    statusMessage = url == nil ? "Mailbox created" : "Mailbox created — invite ready"
                    Task { await reload() }
                }
            }
            .environment(app)
        }
    }

    private func reload() async {
        if let previewRows {
            rows = previewRows
            isLoading = false
            return
        }
        isLoading = rows.isEmpty
        errorMessage = nil
        do {
            rows = try await APIClient.shared.listAdminMailboxes()
            app.setAdminMailboxes(rows)
        } catch {
            if rows.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}

/// Extracts valid user email addresses from ACL keys, filtering out OAuth/auth methods, sub:, user:, account: identifiers.
func userEmailsFromAcl(_ keys: [String]?) -> [String] {
    guard let keys else { return [] }
    var emails: [String] = []
    for key in keys {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        if lower.hasPrefix("email:") {
            let email = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
            if email.contains("@") && !emails.contains(where: { $0.caseInsensitiveCompare(email) == .orderedSame }) {
                emails.append(email)
            }
        } else if !lower.hasPrefix("sub:")
            && !lower.hasPrefix("user:")
            && !lower.hasPrefix("account:")
            && trimmed.contains("@") {
            if !emails.contains(where: { $0.caseInsensitiveCompare(trimmed) == .orderedSame }) {
                emails.append(trimmed)
            }
        }
    }
    return emails
}

/// Subpage for an individual domain mailbox displaying details and actions.
struct DomainAdminMailboxDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State var mailbox: AdminMailboxRow
    var previewRows: [AdminMailboxRow]? = nil
    var onAssigned: (() -> Void)? = nil
    var onMailboxUpdated: ((AdminMailboxRow) -> Void)? = nil
    var onMailboxDeleted: ((String) -> Void)? = nil

    @State private var isAssigning = false
    @State private var isDeleting = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var lastInviteUrl: String?
    @State private var showInviteSheet = false
    @State private var showDeleteConfirm = false

    private var isAssignedToCurrentUser: Bool {
        if app.mailboxes.contains(where: {
            $0.id == mailbox.id || $0.email.caseInsensitiveCompare(mailbox.email) == .orderedSame
        }) {
            return true
        }

        if let userEmail = auth.userEmail?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           !userEmail.isEmpty {
            if mailbox.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == userEmail {
                return true
            }
            let owners = userEmailsFromAcl(mailbox.acl?.owners).map { $0.lowercased() }
            if owners.contains(userEmail) {
                return true
            }
            let members = userEmailsFromAcl(mailbox.acl?.members).map { $0.lowercased() }
            if members.contains(userEmail) {
                return true
            }
        }
        return false
    }

    var body: some View {
        List {
            // Status / feedback messages
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.deepDarkRed)
                        .listRowBackground(Color.clear)
                }
            }
            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.muted)
                        .listRowBackground(Color.clear)
                }
            }

            // Invite link (shown after inviting)
            if let lastInviteUrl {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(lastInviteUrl)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(AppTheme.muted)
                            .textSelection(.enabled)
                        Button("Copy link") {
                            UIPasteboard.general.string = lastInviteUrl
                            statusMessage = "Invite link copied"
                        }
                        .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Invite link")
                }
            }

            // Mailbox details
            Section {
                infoRow(title: "Address", value: mailbox.email)
                infoRow(title: "Display name", value: mailbox.name)
                infoRow(title: "Status", value: mailbox.claimed == true ? "Claimed" : "Unclaimed")
                let owners = userEmailsFromAcl(mailbox.acl?.owners)
                infoRow(title: "Owners", value: owners.isEmpty ? "None" : owners.joined(separator: ", "), singleLine: true)
                let members = userEmailsFromAcl(mailbox.acl?.members)
                if !members.isEmpty {
                    infoRow(title: "Members", value: members.joined(separator: ", "), singleLine: true)
                }
            } header: {
                Text("Details")
            }

        }
        .settingsFormListStyle()
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 10) {
                if !isAssignedToCurrentUser {
                    Button {
                        Task { await assignSelf() }
                    } label: {
                        Group {
                            if isAssigning {
                                ProgressView()
                            } else {
                                Label("Assign to me", systemImage: "person.badge.plus")
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(AppTheme.accent)
                    .disabled(isAssigning || isDeleting)
                }

                Button {
                    showInviteSheet = true
                } label: {
                    Label("Invite someone", systemImage: "envelope.badge")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(AppTheme.accent)
                .disabled(isAssigning || isDeleting)

                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Group {
                        if isDeleting {
                            ProgressView()
                        } else {
                            Label("Delete mailbox", systemImage: "trash")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(.red)
                .disabled(isAssigning || isDeleting)
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 16)
            .background(AppTheme.background)
        }

        .navigationTitle(mailbox.email)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarRole(.editor)
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
            }
        }
        .confirmationDialog(
            "Delete mailbox?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await deleteMailbox() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Delete \(mailbox.email)? This cannot be undone.")
        }
        .sheet(isPresented: $showInviteSheet) {
            NavigationStack {
                DomainAdminInviteView(mailboxId: mailbox.id) { url in
                    lastInviteUrl = url
                    statusMessage = "Invite ready"
                }
            }
        }
    }

    private func infoRow(title: String, value: String, singleLine: Bool = false) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .layoutPriority(1)
            Spacer(minLength: 8)
            Text(value)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.muted)
                .multilineTextAlignment(.trailing)
                .lineLimit(singleLine ? 1 : nil)
                .truncationMode(.tail)
        }
    }

    private func assignSelf() async {
        isAssigning = true
        defer { isAssigning = false }
        errorMessage = nil
        do {
            if previewRows == nil {
                _ = try await APIClient.shared.assignAdminMailboxToSelf(mailboxId: mailbox.id)
                await app.refreshMailboxes(showLoading: true)
            }
            statusMessage = "Assigned to you"
            mailbox.claimed = true
            onMailboxUpdated?(mailbox)
            onAssigned?()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteMailbox() async {
        isDeleting = true
        defer { isDeleting = false }
        errorMessage = nil
        do {
            if previewRows == nil {
                try await APIClient.shared.deleteAdminMailbox(mailboxId: mailbox.id)
                if app.selectedMailboxId == mailbox.id {
                    await app.refreshMailboxes(showLoading: true)
                }
            }
            onMailboxDeleted?(mailbox.id)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
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

    @Environment(AppModel.self) private var app

    private var domain: String { app.mailDomain }

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

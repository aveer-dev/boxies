import SwiftUI

/// Per-mailbox owners and members. Owners can edit this list.
struct SharingSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var owners: [String] = []
    @State private var members: [String] = []
    @State private var viewerKeys: Set<String> = []
    @State private var draft = ""
    @State private var addAsOwner = false
    @State private var isSaving = false
    @State private var saveMessage: String?

    private var canManage: Bool {
        owners.contains { viewerKeys.contains($0) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Owners can manage this list. Members can use the mailbox but cannot change who has access.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)

                Text("Add people by the email on their Cloudflare Access or mobile sign-in account. That address may differ from the mailbox address.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)

                section(title: "Owners", keys: owners, role: .owner)
                section(title: "Members", keys: members, role: .member)

                if canManage {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Add person")
                            .font(.inter(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)

                        TextField("ada@example.com", text: $draft)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()
                            .font(.inter(size: 16))
                            .padding(12)
                            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(AppTheme.line, lineWidth: 1)
                            )

                        Toggle("Add as owner", isOn: $addAsOwner)
                            .font(.inter(size: 16))
                            .tint(AppTheme.accent)

                        Button {
                            addPerson()
                        } label: {
                            Text("Add")
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }
                    .padding(14)
                    .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppTheme.line, lineWidth: 1)
                    )
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("Sharing")
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
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") {
                    Task { await save() }
                }
                .disabled(isSaving || !canManage || app.selectedMailbox == nil)
                .fontWeight(.semibold)
            }
        }
        .overlay(alignment: .bottom) {
            if let saveMessage {
                Text(saveMessage)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppTheme.pillFill, in: Capsule())
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            let acl = app.selectedMailbox?.settings?.acl
            owners = acl?.owners ?? []
            members = acl?.members ?? []
            Task { await loadViewer() }
        }
        .applyThemeController()
    }

    private enum Role {
        case owner
        case member
    }

    @ViewBuilder
    private func section(title: String, keys: [String], role: Role) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.inter(size: 14, weight: .semibold))
                .foregroundStyle(AppTheme.ink)

            if keys.isEmpty {
                Text(role == .owner ? "No owners yet." : "No members yet.")
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.vertical, 4)
            }

            ForEach(keys, id: \.self) { key in
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Self.displayKey(key))
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text(key)
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if canManage {
                        Button {
                            remove(key, role: role)
                        } label: {
                            Image(systemName: "trash")
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.muted)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .disabled(role == .owner && owners.count <= 1)
                    }
                }
                .padding(12)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(AppTheme.line, lineWidth: 1)
                )
            }
        }
    }

    private func loadViewer() async {
        if let me = try? await APIClient.shared.getMe() {
            viewerKeys = Set(me.keys)
            return
        }
        if let email = auth.userEmail?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           !email.isEmpty {
            viewerKeys = ["email:\(email)"]
        }
    }

    private func addPerson() {
        guard let key = Self.normalizeKey(draft) else {
            showToast("Enter a valid email address")
            return
        }
        if owners.contains(key) || members.contains(key) {
            showToast("That person is already listed")
            return
        }
        if addAsOwner {
            owners.append(key)
        } else {
            members.append(key)
        }
        draft = ""
    }

    private func remove(_ key: String, role: Role) {
        if role == .owner {
            guard owners.count > 1 else {
                showToast("Mailbox must have at least one owner")
                return
            }
            owners.removeAll { $0 == key }
        } else {
            members.removeAll { $0 == key }
        }
    }

    private func save() async {
        guard canManage else { return }
        if owners.isEmpty {
            showToast("Mailbox must have at least one owner")
            return
        }
        isSaving = true
        defer { isSaving = false }
        let nextOwners = owners
        let nextMembers = members
        let success = await app.updateMailboxSettings { settings in
            settings.acl = MailboxAcl(owners: nextOwners, members: nextMembers)
        }
        showToast(success ? "Sharing saved" : "Failed to save")
    }

    private func showToast(_ message: String) {
        withAnimation { saveMessage = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { saveMessage = nil }
        }
    }

    static func displayKey(_ key: String) -> String {
        if key.hasPrefix("email:") {
            return String(key.dropFirst("email:".count))
        }
        return key
    }

    static func normalizeKey(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.isEmpty { return nil }
        if trimmed.hasPrefix("email:") {
            let email = String(trimmed.dropFirst("email:".count))
            return email.contains("@") ? "email:\(email)" : nil
        }
        if trimmed.hasPrefix("sub:") { return trimmed }
        return trimmed.contains("@") ? "email:\(trimmed)" : nil
    }
}

import SwiftUI

enum SharingRole: String, CaseIterable, Identifiable {
    case member
    case owner

    var id: String { rawValue }
    var label: String {
        switch self {
        case .member: return "Member"
        case .owner: return "Owner"
        }
    }
}

/// Per-mailbox owners and members. Owners can edit this list.
struct SharingSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var owners: [String] = []
    @State private var members: [String] = []
    @State private var viewerKeys: Set<String> = []
    @State private var existingAccounts: [AccountSummary] = []
    @State private var showAddModal = false
    @State private var saveMessage: String?

    private var canManage: Bool {
        if let flag = app.selectedMailbox?.canManage {
            return flag
        }
        return owners.contains { key in
            viewerKeys.contains(key) || viewerKeys.contains(Self.canonicalEmailKey(key) ?? "")
        }
    }

    /// Owners list should only be a list of user accounts, not auth methods and sub ids.
    private var visibleOwners: [String] {
        owners.filter { Self.isUserAccountKey($0) }
    }

    /// Members list should also only display user accounts.
    private var visibleMembers: [String] {
        members.filter { Self.isUserAccountKey($0) }
    }

    private var allAccountKeys: Set<String> {
        Set(owners + members)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("People with access through their Inboxies account. Owners can manage this list. Members can use the mailbox but cannot change who has access.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                // Owners section
                Text("Owners")
                    .font(.inter(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                VStack(spacing: 0) {
                    if visibleOwners.isEmpty {
                        Text("No owners yet.")
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                    } else {
                        ForEach(Array(visibleOwners.enumerated()), id: \.element) { index, key in
                            accountRow(key: key, role: .owner, canDelete: canManage && visibleOwners.count > 1)
                            if index < visibleOwners.count - 1 {
                                Divider()
                                    .overlay(AppTheme.line)
                                    .padding(.leading, 16)
                            }
                        }
                    }
                }
                .background(AppTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.top, 8)

                // Members section
                Text("Members")
                    .font(.inter(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 20)

                VStack(spacing: 0) {
                    if visibleMembers.isEmpty {
                        Text("No members yet.")
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                    } else {
                        ForEach(Array(visibleMembers.enumerated()), id: \.element) { index, key in
                            accountRow(key: key, role: .member, canDelete: canManage)
                            if index < visibleMembers.count - 1 {
                                Divider()
                                    .overlay(AppTheme.line)
                                    .padding(.leading, 16)
                            }
                        }
                    }
                }
                .background(AppTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer(minLength: 32)
            }
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
            if canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAddModal = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Add member")
                }
            }
        }
        .sheet(isPresented: $showAddModal) {
            AddMemberModalView(
                existingAccounts: existingAccounts,
                currentKeys: allAccountKeys,
                mailboxEmails: mailboxEmails,
                onAddExisting: { email, role in
                    await addExistingUser(email: email, role: role)
                },
                onSendInvite: { email, role in
                    await sendInvite(email: email, role: role)
                }
            )
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
            Task {
                await loadViewer()
                await loadAccounts()
            }
        }
        .onChange(of: app.selectedMailbox?.settings?.acl) { _, acl in
            owners = acl?.owners ?? []
            members = acl?.members ?? []
        }
        .applyThemeController()
    }

    @ViewBuilder
    private func accountRow(key: String, role: SharingRole, canDelete: Bool) -> some View {
        let info = displayAccount(key: key, accounts: existingAccounts)
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(info.title)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                if let subtitle = info.subtitle {
                    Text(subtitle)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            Spacer()
            if canDelete {
                Button {
                    Task { await removeUser(key: key, role: role) }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundStyle(.red)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private func loadViewer() async {
        if let me = try? await APIClient.shared.getMe() {
            viewerKeys = Set(me.keys)
            return
        }
        if let email = auth.userEmail?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           !email.isEmpty {
            viewerKeys = Set(Self.keysForEmail(email))
        }
    }

    private var mailboxEmails: Set<String> {
        var set = Set<String>()
        for mb in app.mailboxes {
            set.insert(mb.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        if let adminRows = app.adminMailboxes {
            for row in adminRows {
                set.insert(row.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
            }
        }
        return set
    }

    private func loadAccounts() async {
        var collected: [AccountSummary] = []
        if let accounts = try? await APIClient.shared.listAccounts() {
            collected.append(contentsOf: accounts.filter { !mailboxEmails.contains($0.email.lowercased()) })
        }
        // In debug preview, add fixture accounts if empty
        if app.isDebugPreview && collected.isEmpty {
            collected = [
                AccountSummary(id: "acc-1", email: "admin@example.com", name: "Domain Admin"),
                AccountSummary(id: "acc-2", email: "ada@example.com", name: "Ada Lovelace"),
                AccountSummary(id: "acc-3", email: "jordan@example.com", name: "Jordan Hale"),
                AccountSummary(id: "acc-4", email: "alex@example.com", name: "Alex Rivera"),
                AccountSummary(id: "acc-5", email: "sam@example.com", name: "Sam Chen"),
            ].filter { !mailboxEmails.contains($0.email.lowercased()) }
        }
        existingAccounts = collected
    }

    private func addExistingUser(email: String, role: SharingRole) async {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !mailboxEmails.contains(trimmed) else {
            showToast("Mailboxes cannot be added as members")
            return
        }
        guard Self.isUserAccountKey(trimmed) else {
            showToast("Only user account emails can be added")
            return
        }
        let key = Self.normalizeKey(trimmed) ?? "email:\(trimmed)"
        let matchedId = existingAccounts.first(where: { $0.email.caseInsensitiveCompare(trimmed) == .orderedSame })?.id
        let accountKey = matchedId.map { "account:\($0)" }
        let isAlready = owners.contains(key) || members.contains(key) ||
            (accountKey.map { owners.contains($0) || members.contains($0) } ?? false)
        if isAlready {
            showToast("That person is already listed")
            return
        }
        let keyToAdd = accountKey ?? key
        if role == .owner {
            owners.append(keyToAdd)
        } else {
            members.append(keyToAdd)
        }
        await persistAcl()
        showToast(role == .owner ? "Owner added" : "Member added")
    }

    private func removeUser(key: String, role: SharingRole) async {
        if role == .owner {
            guard visibleOwners.count > 1 else {
                showToast("Mailbox must have at least one owner")
                return
            }
            owners.removeAll { $0 == key }
        } else {
            members.removeAll { $0 == key }
        }
        await persistAcl()
        showToast(role == .owner ? "Owner removed" : "Member removed")
    }

    private func persistAcl() async {
        guard canManage else { return }
        let nextOwners = owners
        let nextMembers = members
        _ = await app.updateMailboxSettings { settings in
            settings.acl = MailboxAcl(owners: nextOwners, members: nextMembers)
        }
    }

    private func sendInvite(email: String, role: SharingRole) async -> Bool {
        guard let mailboxId = app.selectedMailbox?.id else { return false }
        do {
            let result = try await APIClient.shared.createMailboxInvite(
                mailboxId: mailboxId,
                inviteEmail: email.trimmingCharacters(in: .whitespacesAndNewlines),
                role: role.rawValue
            )
            showToast(result.emailSent ? "Invite emailed" : "Invite created")
            return true
        } catch {
            showToast(error.localizedDescription)
            return false
        }
    }

    private func showToast(_ message: String) {
        withAnimation { saveMessage = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { saveMessage = nil }
        }
    }

    /// Checks if a key represents a user account and not an auth method / sub id.
    static func isUserAccountKey(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.hasPrefix("sub:") { return false }
        if trimmed.hasPrefix("user:") { return false }
        return true
    }

    private func displayAccount(key: String, accounts: [AccountSummary]) -> (title: String, subtitle: String?) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("email:") {
            let email = String(trimmed.dropFirst(6))
            if let match = accounts.first(where: { $0.email.caseInsensitiveCompare(email) == .orderedSame }),
               let name = match.name, !name.isEmpty, name != email {
                return (name, email)
            }
            return (email, nil)
        }
        if trimmed.lowercased().hasPrefix("account:") {
            let id = String(trimmed.dropFirst(8))
            if let match = accounts.first(where: { $0.id == id }) {
                if let name = match.name, !name.isEmpty, name != match.email {
                    return (name, match.email)
                }
                return (match.email, nil)
            }
            return ("Account \(id.prefix(8))…", nil)
        }
        if trimmed.contains("@") {
            if let match = accounts.first(where: { $0.email.caseInsensitiveCompare(trimmed) == .orderedSame }),
               let name = match.name, !name.isEmpty, name != trimmed {
                return (name, trimmed)
            }
            return (trimmed, nil)
        }
        return (trimmed, nil)
    }

    static func canonicalEmailKey(_ key: String) -> String? {
        guard key.hasPrefix("email:") else { return nil }
        let email = String(key.dropFirst("email:".count))
        guard let at = email.lastIndex(of: "@"), at > email.startIndex else { return nil }
        let local = email[..<at]
        let domain = email[email.index(after: at)...]
        if let plus = local.firstIndex(of: "+"), plus > local.startIndex {
            return "email:\(local[..<plus])@\(domain)"
        }
        return "email:\(email)"
    }

    static func keysForEmail(_ email: String) -> [String] {
        let tagged = "email:\(email)"
        if let canonical = canonicalEmailKey(tagged), canonical != tagged {
            return [tagged, canonical]
        }
        return [tagged]
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

/// Sheet for adding a new owner or member by selecting an existing account or inviting by email.
struct AddMemberModalView: View {
    @Environment(\.dismiss) private var dismiss
    let existingAccounts: [AccountSummary]
    let currentKeys: Set<String>
    let mailboxEmails: Set<String>
    let onAddExisting: (String, SharingRole) async -> Void
    let onSendInvite: (String, SharingRole) async -> Bool

    @State private var email = ""
    @State private var isOwner = false
    @State private var isSubmitting = false

    private var role: SharingRole {
        isOwner ? .owner : .member
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var isMailboxEmail: Bool {
        mailboxEmails.contains(trimmedEmail)
    }

    private var isSubOrAuthKey: Bool {
        trimmedEmail.hasPrefix("sub:") || trimmedEmail.hasPrefix("user:")
    }

    private var isValidEmail: Bool {
        !isMailboxEmail && !isSubOrAuthKey && trimmedEmail.contains("@") && trimmedEmail.contains(".") && trimmedEmail.count >= 5
    }

    private var matchingAccounts: [AccountSummary] {
        guard !trimmedEmail.isEmpty else { return [] }
        return existingAccounts.filter { acc in
            let emailLower = acc.email.lowercased()
            guard !mailboxEmails.contains(emailLower) else { return false }
            let matches = emailLower.contains(trimmedEmail) || (acc.name?.lowercased().contains(trimmedEmail) ?? false)
            let alreadyAdded = currentKeys.contains("email:\(emailLower)")
                || currentKeys.contains(emailLower)
                || currentKeys.contains("account:\(acc.id)")
            return matches && !alreadyAdded
        }
    }

    private var matchedExistingAccount: AccountSummary? {
        guard !isMailboxEmail && !isSubOrAuthKey else { return nil }
        return existingAccounts.first { $0.email.caseInsensitiveCompare(trimmedEmail) == .orderedSame }
    }

    private var isExistingAccount: Bool {
        matchedExistingAccount != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // Email input
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Email address")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)

                        TextField("person@example.com", text: $email)
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

                        // Dropdown options of existing accounts
                        if !matchingAccounts.isEmpty && matchedExistingAccount?.email != trimmedEmail {
                            VStack(spacing: 0) {
                                ForEach(Array(matchingAccounts.prefix(5).enumerated()), id: \.element.id) { index, acc in
                                    Button {
                                        email = acc.email
                                    } label: {
                                        HStack {
                                            VStack(alignment: .leading, spacing: 2) {
                                                if let name = acc.name, !name.isEmpty, name != acc.email {
                                                    Text(name)
                                                        .font(.inter(size: 14, weight: .medium))
                                                        .foregroundStyle(AppTheme.ink)
                                                    Text(acc.email)
                                                        .font(.inter(size: 12))
                                                        .foregroundStyle(AppTheme.muted)
                                                } else {
                                                    Text(acc.email)
                                                        .font(.inter(size: 14, weight: .medium))
                                                        .foregroundStyle(AppTheme.ink)
                                                }
                                            }
                                            Spacer()
                                            Text("Existing account")
                                                .font(.inter(size: 11, weight: .medium))
                                                .foregroundStyle(AppTheme.accent)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 3)
                                                .background(AppTheme.pillFill, in: Capsule())
                                        }
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 10)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)

                                    if index < min(matchingAccounts.count, 5) - 1 {
                                        Divider()
                                            .overlay(AppTheme.line)
                                            .padding(.leading, 14)
                                    }
                                }
                            }
                            .background(AppTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(AppTheme.line, lineWidth: 1)
                            )
                            .shadow(color: Color.black.opacity(0.04), radius: 6, y: 3)
                        }

                        // Status info text
                        if isMailboxEmail {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 13))
                                    .foregroundStyle(AppTheme.deepDarkRed)
                                Text("Mailboxes cannot be added as members. Only user accounts can be added.")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.deepDarkRed)
                            }
                            .padding(.top, 2)
                        } else if isSubOrAuthKey {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 13))
                                    .foregroundStyle(AppTheme.deepDarkRed)
                                Text("Sub IDs and auth methods cannot be added. Only user account emails can be added.")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.deepDarkRed)
                            }
                            .padding(.top, 2)
                        } else if isValidEmail {
                            if isExistingAccount {
                                HStack(spacing: 6) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 13))
                                        .foregroundStyle(AppTheme.accent)
                                    Text("Existing Inboxies user — will be added directly")
                                        .font(.inter(size: 12))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.top, 2)
                            } else {
                                HStack(spacing: 6) {
                                    Image(systemName: "envelope.badge")
                                        .font(.system(size: 13))
                                        .foregroundStyle(AppTheme.muted)
                                    Text("New user — an email invite link will be sent")
                                        .font(.inter(size: 12))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.top, 2)
                            }
                        }
                    }

                    // Owner Role Toggle
                    Toggle(isOn: $isOwner) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Owner")
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                            Text("Owners can manage mailbox settings, members, and permissions.")
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .tint(AppTheme.accent)
                    .padding(.vertical, 4)

                    // Submit button
                    Button {
                        isSubmitting = true
                        Task {
                            if isExistingAccount {
                                await onAddExisting(trimmedEmail, role)
                                dismiss()
                            } else {
                                let ok = await onSendInvite(trimmedEmail, role)
                                if ok {
                                    dismiss()
                                }
                            }
                            isSubmitting = false
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if isSubmitting {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(.white)
                            } else {
                                Text(isExistingAccount
                                     ? "Add \(role == .owner ? "owner" : "member")"
                                     : "Send invite")
                                    .font(.inter(size: 15, weight: .semibold))
                                    .foregroundStyle(.white)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 14)
                        .background(isValidEmail && !isSubmitting ? AppTheme.accent : AppTheme.accent.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!isValidEmail || isMailboxEmail || isSubOrAuthKey || isSubmitting)
                    .padding(.top, 8)
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Add member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

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

/// Who can use this mailbox. Owners invite people, change roles and remove
/// members; anyone can leave. People join only by accepting an emailed invite.
struct SharingSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var members: [MailboxMember] = []
    @State private var invites: [MailboxInviteRow] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var showAddModal = false
    @State private var showLeaveConfirm = false
    @State private var memberToRemove: MailboxMember?
    @State private var busyUserId: String?
    @State private var isLeaving = false
    @State private var saveMessage: String?

    private var mailboxId: String? { app.selectedMailboxId }

    private var me: MailboxMember? { members.first { $0.you == true } }

    private var canManage: Bool {
        app.selectedMailbox?.canManage == true || me?.isOwner == true
    }

    private var owners: [MailboxMember] { members.filter(\.isOwner) }
    private var plainMembers: [MailboxMember] { members.filter { !$0.isOwner } }
    private var pendingInvites: [MailboxInviteRow] { invites.filter { $0.status == "pending" } }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Text("People who can use this mailbox. Owners invite people and manage who has access. Members can read and send mail but can't change access.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                if isLoading && members.isEmpty {
                    ProgressView()
                        .padding(.top, 40)
                } else if let loadError, members.isEmpty {
                    VStack(spacing: 12) {
                        Text(loadError)
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.muted)
                            .multilineTextAlignment(.center)
                        Button("Try again") {
                            Task { await load() }
                        }
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                    }
                    .padding(.top, 40)
                    .padding(.horizontal, 20)
                } else {
                    sectionHeader("Owners")
                    card {
                        rows(owners, empty: "No owners yet.")
                    }

                    sectionHeader("Members")
                    card {
                        rows(plainMembers, empty: "No members yet.")
                    }

                    if canManage && !pendingInvites.isEmpty {
                        sectionHeader("Pending invites")
                        card {
                            ForEach(Array(pendingInvites.enumerated()), id: \.element.id) { index, invite in
                                inviteRow(invite)
                                if index < pendingInvites.count - 1 { rowDivider }
                            }
                        }
                    }

                    if me != nil {
                        Button(role: .destructive) {
                            showLeaveConfirm = true
                        } label: {
                            HStack(spacing: 8) {
                                if isLeaving {
                                    ProgressView().controlSize(.small)
                                }
                                Text(isLeaving ? "Leaving…" : "Leave mailbox")
                                    .font(.inter(size: 15, weight: .medium))
                                    .foregroundStyle(.red)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(AppTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .disabled(isLeaving)
                        .padding(.horizontal, 16)
                        .padding(.top, 28)
                        .confirmationDialog(
                            "Leave this mailbox?",
                            isPresented: $showLeaveConfirm,
                            titleVisibility: .visible
                        ) {
                            Button("Leave mailbox", role: .destructive) {
                                Task { await leave() }
                            }
                            Button("Cancel", role: .cancel) {}
                        } message: {
                            Text("You'll lose access to \(app.selectedMailbox?.email ?? "this mailbox") until an owner invites you again.")
                        }
                    }
                }

                Spacer(minLength: 32)
            }
        }
        .background(AppTheme.background)
        .refreshable { await load() }
        .navigationTitle("Members")
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
                    .accessibilityLabel("Invite someone")
                }
            }
        }
        .sheet(isPresented: $showAddModal) {
            AddMemberModalView(
                existingEmails: Set(members.map { $0.email.lowercased() } + pendingInvites.map { $0.inviteeEmail.lowercased() }),
                mailboxEmails: mailboxEmails,
                onSendInvite: { email, role in
                    await sendInvite(email: email, role: role)
                }
            )
        }
        .confirmationDialog(
            "Remove \(memberToRemove?.email ?? "member")?",
            isPresented: Binding(
                get: { memberToRemove != nil },
                set: { if !$0 { memberToRemove = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let member = memberToRemove {
                    Task { await remove(member) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("They lose access to this mailbox right away.")
        }
        .overlay(alignment: .bottom) {
            if let saveMessage {
                InboxiesToast(
                    message: saveMessage,
                    onDismiss: { withAnimation(ToastMetrics.animation) { self.saveMessage = nil } }
                )
                .padding(.horizontal, ToastMetrics.screenInset)
                .padding(.bottom, ToastMetrics.standaloneBottomInset)
            }
        }
        .task(id: mailboxId) { await load() }
        .applyThemeController()
    }

    // MARK: Rows

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.inter(size: 14, weight: .semibold))
            .foregroundStyle(AppTheme.ink)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 20)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var rowDivider: some View {
        Divider()
            .overlay(AppTheme.line)
            .padding(.leading, 16)
    }

    @ViewBuilder
    private func rows(_ list: [MailboxMember], empty: String) -> some View {
        if list.isEmpty {
            Text(empty)
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
        } else {
            ForEach(Array(list.enumerated()), id: \.element.id) { index, member in
                memberRow(member)
                if index < list.count - 1 { rowDivider }
            }
        }
    }

    private func memberRow(_ member: MailboxMember) -> some View {
        let name = member.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let showsName = !name.isEmpty && name.caseInsensitiveCompare(member.email) != .orderedSame
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(showsName ? name : member.email)
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    if member.you == true {
                        Text("You")
                            .font(.inter(size: 11, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppTheme.pillFill, in: Capsule())
                    }
                }
                if showsName {
                    Text(member.email)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            Spacer()
            if busyUserId == member.userId {
                ProgressView().controlSize(.small)
            } else if canManage && member.you != true {
                Menu {
                    if member.isOwner {
                        Button {
                            Task { await setRole(member, .member) }
                        } label: {
                            Label("Make member", systemImage: "person")
                        }
                    } else {
                        Button {
                            Task { await setRole(member, .owner) }
                        } label: {
                            Label("Make owner", systemImage: "person.badge.key")
                        }
                    }
                    Button(role: .destructive) {
                        memberToRemove = member
                    } label: {
                        Label("Remove", systemImage: "person.badge.minus")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Manage \(member.email)")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }

    private func inviteRow(_ invite: MailboxInviteRow) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(invite.inviteeEmail)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                Text("\(SharingRole(rawValue: invite.role)?.label ?? invite.role) · expires \(Self.shortDate(invite.expiresAt))")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer()
            if busyUserId == invite.id {
                ProgressView().controlSize(.small)
            } else {
                Button("Revoke") {
                    Task { await revoke(invite) }
                }
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(.red)
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: Actions

    private var mailboxEmails: Set<String> {
        var set = Set(app.mailboxes.map { $0.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        for row in app.adminMailboxes ?? [] {
            set.insert(row.email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        return set
    }

    private func load() async {
        guard let mailboxId else { return }
        if app.isDebugPreview {
            members = Self.previewMembers(mailboxEmail: app.selectedMailbox?.email ?? mailboxId)
            invites = Self.previewInvites(mailboxId: mailboxId)
            isLoading = false
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let list = try await APIClient.shared.listMembers(mailboxId: mailboxId)
            guard mailboxId == self.mailboxId else { return }
            members = list
            loadError = nil
            if list.first(where: { $0.you == true })?.isOwner == true || app.selectedMailbox?.canManage == true {
                invites = (try? await APIClient.shared.listMailboxInvites(mailboxId: mailboxId)) ?? []
            } else {
                invites = []
            }
        } catch {
            loadError = "Couldn't load members. \(error.localizedDescription)"
        }
    }

    private func setRole(_ member: MailboxMember, _ role: SharingRole) async {
        guard let mailboxId else { return }
        busyUserId = member.userId
        defer { busyUserId = nil }
        do {
            try await APIClient.shared.setMemberRole(mailboxId: mailboxId, userId: member.userId, role: role.rawValue)
            await load()
            showToast(role == .owner ? "Now an owner" : "Now a member")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    private func remove(_ member: MailboxMember) async {
        guard let mailboxId else { return }
        busyUserId = member.userId
        defer { busyUserId = nil }
        do {
            try await APIClient.shared.removeMember(mailboxId: mailboxId, userId: member.userId)
            members.removeAll { $0.userId == member.userId }
            showToast("Removed")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    private func revoke(_ invite: MailboxInviteRow) async {
        busyUserId = invite.id
        defer { busyUserId = nil }
        do {
            try await APIClient.shared.revokeInvite(inviteId: invite.id)
            invites.removeAll { $0.id == invite.id }
            showToast("Invite revoked")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    private func leave() async {
        guard let mailboxId, let me else { return }
        isLeaving = true
        defer { isLeaving = false }
        do {
            try await APIClient.shared.removeMember(mailboxId: mailboxId, userId: me.userId)
            dismiss()
            await app.refreshMailboxes(showLoading: true)
            app.showToast("You left \(mailboxId)")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    private func sendInvite(email: String, role: SharingRole) async -> Bool {
        guard let mailboxId else { return false }
        do {
            let result = try await APIClient.shared.createMailboxInvite(
                mailboxId: mailboxId,
                inviteEmail: email.trimmingCharacters(in: .whitespacesAndNewlines),
                role: role.rawValue
            )
            if result.emailSent {
                showToast("Invite emailed")
            } else {
                UIPasteboard.general.string = result.inviteUrl
                showToast("Invite created — link copied")
            }
            await load()
            return true
        } catch {
            showToast(error.localizedDescription)
            return false
        }
    }

    private func showToast(_ message: String) {
        withAnimation(ToastMetrics.animation) { saveMessage = message }
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            // A newer toast keeps its own full timer.
            guard saveMessage == message else { return }
            withAnimation(ToastMetrics.animation) { saveMessage = nil }
        }
    }

    static func shortDate(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.withFractionalSeconds.date(from: iso)
            ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    // MARK: DEBUG preview fixtures

    private static func previewMembers(mailboxEmail: String) -> [MailboxMember] {
        [
            MailboxMember(userId: "u-1", email: mailboxEmail, name: "Alex Rivera", role: "owner", you: true),
            MailboxMember(userId: "u-2", email: "ada@example.com", name: "Ada Lovelace", role: "owner", you: false),
            MailboxMember(userId: "u-3", email: "jordan@example.com", name: nil, role: "member", you: false),
        ]
    }

    private static func previewInvites(mailboxId: String) -> [MailboxInviteRow] {
        [
            MailboxInviteRow(
                id: "inv-1",
                mailboxId: mailboxId,
                role: "member",
                inviteeEmail: "sam@example.com",
                inviteeName: nil,
                expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(6 * 86_400)),
                status: "pending",
                createdAt: nil
            ),
        ]
    }
}

/// Sheet for inviting someone by email as a member or owner.
struct AddMemberModalView: View {
    @Environment(\.dismiss) private var dismiss
    let existingEmails: Set<String>
    let mailboxEmails: Set<String>
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

    private var isAlreadyListed: Bool {
        existingEmails.contains(trimmedEmail)
    }

    private var isValidEmail: Bool {
        !isMailboxEmail && !isAlreadyListed && trimmedEmail.contains("@") && trimmedEmail.contains(".") && trimmedEmail.count >= 5
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Email address")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)

                        TextField("Email address", text: $email, prompt: Text(verbatim: "person@example.com").foregroundStyle(AppTheme.muted))
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .autocorrectionDisabled()
                            .font(.inter(size: 16))
                            .padding(12)
                            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(AppTheme.line, lineWidth: 1)
                            )

                        if isMailboxEmail {
                            hint("Mailboxes can't be members. Invite the person who uses it.", systemImage: "exclamationmark.triangle", warning: true)
                        } else if isAlreadyListed {
                            hint("Already a member or invited.", systemImage: "exclamationmark.triangle", warning: true)
                        } else if isValidEmail {
                            hint("We'll email them an invite. They confirm it with a code sent to this address.", systemImage: "envelope.badge", warning: false)
                        }
                    }

                    Toggle(isOn: $isOwner) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Owner")
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                            Text("Owners can manage mailbox settings and who has access.")
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .tint(AppTheme.accent)
                    .padding(.vertical, 4)

                    Button {
                        isSubmitting = true
                        Task {
                            if await onSendInvite(trimmedEmail, role) {
                                dismiss()
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
                                Text("Send invite")
                                    .font(.inter(size: 15, weight: .semibold))
                                    .foregroundStyle(.white)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 14)
                        .background(isValidEmail && !isSubmitting ? AppTheme.accent : AppTheme.accent.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(!isValidEmail || isSubmitting)
                    .padding(.top, 8)
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("Invite someone")
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

    private func hint(_ text: String, systemImage: String, warning: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 13))
                .foregroundStyle(warning ? AppTheme.deepDarkRed : AppTheme.muted)
            Text(text)
                .font(.inter(size: 12))
                .foregroundStyle(warning ? AppTheme.deepDarkRed : AppTheme.muted)
        }
        .padding(.top, 2)
    }
}

import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @Bindable private var pushManager = PushNotificationManager.shared
    @State private var pendingInviteToken: String?

    var body: some View {
        Group {
            if let token = pendingInviteToken {
                InviteAcceptView(token: token) {
                    pendingInviteToken = nil
                }
            } else if auth.isAuthenticated {
                if !app.isMailboxLoading && app.mailboxes.isEmpty {
                    MailboxOnboardingView()
                } else {
                    HomeShellView()
                        .task(id: auth.token) {
                            #if DEBUG
                            if ProcessInfo.processInfo.arguments.contains("-previewMailbox")
                                || ProcessInfo.processInfo.arguments.contains("-previewDetail")
                                || ProcessInfo.processInfo.arguments.contains("-previewCompose")
                                || ProcessInfo.processInfo.arguments.contains("-previewScreener")
                                || ProcessInfo.processInfo.arguments.contains("-previewReplyLater") {
                                return
                            }
                            #endif
                            await app.bootstrap(authToken: auth.token)
                        }
                        .task(id: pushManager.pendingDeepLink) {
                            await consumePendingDeepLinkIfReady()
                        }
                        .onChange(of: app.isMailboxLoading) { _, loading in
                            if !loading {
                                Task { await consumePendingDeepLinkIfReady() }
                            }
                        }
                }
            } else {
                SignInView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)
        .font(.inter(size: 14))
        .onOpenURL { url in
            if let token = Self.inviteToken(from: url) {
                pendingInviteToken = token
            }
        }
        .onAppear {
            if let stored = UserDefaults.standard.string(forKey: "pendingInviteToken") {
                pendingInviteToken = stored
                UserDefaults.standard.removeObject(forKey: "pendingInviteToken")
            }
        }
        .onChange(of: pendingInviteToken) { _, token in
            if let token {
                UserDefaults.standard.set(token, forKey: "pendingInviteToken")
            } else {
                UserDefaults.standard.removeObject(forKey: "pendingInviteToken")
            }
        }
    }

    @MainActor
    private func consumePendingDeepLinkIfReady() async {
        guard auth.isAuthenticated,
              !app.isMailboxLoading,
              !app.mailboxes.isEmpty,
              let link = pushManager.pendingDeepLink else { return }
        pushManager.pendingDeepLink = nil
        await app.openEmailFromNotification(
            mailboxId: link.mailboxId,
            emailId: link.emailId,
            folderId: link.folderId
        )
    }

    static func inviteToken(from url: URL) -> String? {
        // inboxies://invite/<token> or https://inboxies.email/invite/<token>
        let path = url.path
        if url.host == "invite", let token = url.pathComponents.dropFirst().first, !token.isEmpty {
            return token
        }
        let parts = path.split(separator: "/").map(String.init)
        if let idx = parts.firstIndex(of: "invite"), idx + 1 < parts.count {
            let token = parts[idx + 1]
            return token.isEmpty ? nil : token
        }
        return nil
    }
}

struct InviteAcceptView: View {
    let token: String
    var onDone: () -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    @State private var invite: InvitePublic?
    @State private var loadError: String?
    @State private var password = ""
    @State private var confirm = ""
    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var formError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Accept invite")
                        .font(.inter(size: 24, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                    if let invite {
                        Text("Set a password for \(invite.mailboxId)")
                            .font(.inter(size: 15))
                            .foregroundStyle(AppTheme.muted)
                    } else if let loadError {
                        Text(loadError)
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    } else {
                        ProgressView()
                    }
                }

                if invite != nil {
                    Section {
                        TextField("Display name (optional)", text: $displayName)
                        SecureField("Password", text: $password)
                        SecureField("Confirm password", text: $confirm)
                    }

                    if let formError {
                        Section {
                            Text(formError)
                                .foregroundStyle(AppTheme.deepDarkRed)
                                .font(.inter(size: 13))
                        }
                    }

                    Section {
                        Button {
                            Task { await accept() }
                        } label: {
                            HStack {
                                Spacer()
                                if isSubmitting { ProgressView() }
                                else { Text("Create account").font(.inter(size: 16, weight: .medium)) }
                                Spacer()
                            }
                        }
                        .disabled(isSubmitting || password.count < 10)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onDone() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            invite = try await APIClient.shared.getInvite(token: token)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func accept() async {
        formError = nil
        guard password == confirm else {
            formError = "Passwords do not match"
            return
        }
        guard password.count >= 10 else {
            formError = "Password must be at least 10 characters"
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result = try await APIClient.shared.acceptInvite(
                token: token,
                password: password,
                displayName: displayName.isEmpty ? nil : displayName
            )
            auth.applySession(token: result.token, email: result.mailboxId)
            await app.bootstrap(authToken: result.token)
            onDone()
        } catch {
            formError = error.localizedDescription
        }
    }
}

struct MailboxOnboardingView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth

    @State private var newMailboxName = ""
    @State private var newMailboxEmail = ""
    @State private var isCreating = false
    @State private var adminRows: [AdminMailboxRow] = []
    @State private var isLoadingAdmin = false
    @State private var assigningId: String?
    @FocusState private var isNameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                if app.isAdmin {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Domain Admin")
                                .font(.inter(size: 24, weight: .bold))
                                .foregroundStyle(AppTheme.ink)
                            Text(
                                adminRows.isEmpty
                                    ? "No mailboxes assigned to you yet. Assign an existing domain mailbox to yourself, or create one on the web Admin console."
                                    : "Assign a domain mailbox to yourself to start using Inboxies."
                            )
                            .font(.inter(size: 15))
                            .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 16)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }

                    if isLoadingAdmin {
                        Section { ProgressView() }
                    } else {
                        Section("Domain mailboxes") {
                            if adminRows.isEmpty {
                                Text("None found. Use web Admin to create one.")
                                    .foregroundStyle(AppTheme.muted)
                            }
                            ForEach(adminRows) { row in
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(row.email)
                                            .font(.inter(size: 15, weight: .medium))
                                        Text(row.claimed == true ? "Claimed" : "Unclaimed")
                                            .font(.inter(size: 12))
                                            .foregroundStyle(AppTheme.muted)
                                    }
                                    Spacer()
                                    Button("Assign to me") {
                                        Task { await assignSelf(row.id) }
                                    }
                                    .disabled(assigningId != nil)
                                }
                            }
                        }
                    }
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Welcome to Inboxies")
                                .font(.inter(size: 24, weight: .bold))
                                .foregroundStyle(AppTheme.ink)
                            Text("Create your first email address to start using the platform.")
                                .font(.inter(size: 15))
                                .foregroundStyle(AppTheme.muted)
                        }
                        .padding(.vertical, 16)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                    }

                    Section {
                        TextField("Full Name", text: $newMailboxName)
                            .focused($isNameFocused)
                        HStack {
                            TextField("Username", text: $newMailboxEmail)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .onChange(of: newMailboxEmail) { _, newValue in
                                    if let atIndex = newValue.firstIndex(of: "@") {
                                        newMailboxEmail = String(newValue[..<atIndex])
                                    }
                                }
                            Text("@inboxies.email")
                                .foregroundStyle(AppTheme.muted)
                        }
                    } footer: {
                        Text("This will be your primary email address.")
                    }

                    Section {
                        Button(action: {
                            Task {
                                isCreating = true
                                let fullEmail = "\(newMailboxEmail)@inboxies.email"
                                await app.createMailbox(name: newMailboxName, email: fullEmail)
                                isCreating = false
                            }
                        }) {
                            HStack {
                                Spacer()
                                if isCreating {
                                    ProgressView()
                                } else {
                                    Text("Create Email")
                                        .font(.inter(size: 16, weight: .medium))
                                }
                                Spacer()
                            }
                        }
                        .disabled(newMailboxEmail.isEmpty || newMailboxName.isEmpty || isCreating)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sign out", role: .destructive) {
                        auth.signOut()
                    }
                    .foregroundStyle(.red)
                }
            }
            .onAppear {
                if !app.isAdmin {
                    isNameFocused = true
                }
            }
            .task {
                guard app.isAdmin else { return }
                isLoadingAdmin = true
                defer { isLoadingAdmin = false }
                adminRows = (try? await APIClient.shared.listAdminMailboxes()) ?? []
            }
        }
    }

    private func assignSelf(_ mailboxId: String) async {
        assigningId = mailboxId
        defer { assigningId = nil }
        do {
            _ = try await APIClient.shared.assignAdminMailboxToSelf(mailboxId: mailboxId)
            await app.refreshMailboxes(showLoading: true)
        } catch {
            app.errorMessage = error.localizedDescription
        }
    }
}

import AuthenticationServices
import SwiftUI

/// Account → Sign-in methods: connected methods (disconnect any but the last),
/// add Apple / a password, change password, and the recovery email that
/// password resets go to.
struct SignInMethodsSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var identities: [LinkedIdentity] = []
    @State private var isLoading = true
    @State private var isConnectingApple = false
    @State private var isAddingPassword = false
    @State private var isChangingPassword = false
    @State private var removingType: String?
    @State private var identityToRemove: LinkedIdentity?
    @State private var appleNonce = AppleSignInNonce.make()
    @State private var showPasswordForm = false
    @State private var showChangePassword = false
    @State private var password = ""
    @State private var passwordConfirm = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var newPasswordConfirm = ""
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    private var hasApple: Bool {
        identities.contains { $0.type == "apple" }
    }

    private var hasPassword: Bool {
        identities.contains { $0.type == "password" }
    }

    private var canAddMethod: Bool {
        !hasApple || !hasPassword
    }

    var body: some View {
        List {
            Section {
                Text(
                    "Ways you can sign in to this account. Every method reaches the same mailboxes. Keep at least one."
                )
                .font(.inter(size: SettingsFormChrome.footerFontSize))
                .foregroundStyle(AppTheme.muted)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
            }

            Section {
                if isLoading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                } else if identities.isEmpty {
                    Text("Nothing linked yet.")
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.muted)
                } else {
                    ForEach(identities) { identity in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(identity.label)
                                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                                    .foregroundStyle(AppTheme.ink)
                                Text(identityTypeLabel(identity.type) + (identity.current ? " · this session" : ""))
                                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                            if removingType == identity.type {
                                ProgressView().controlSize(.small)
                            } else if identities.count > 1 {
                                Button("Disconnect") {
                                    identityToRemove = identity
                                }
                                .font(.inter(size: 13, weight: .medium))
                                .foregroundStyle(.red)
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            } header: {
                Text("Connected")
            }

            if hasPassword {
                Section {
                    if !showChangePassword {
                        Button {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                showChangePassword = true
                            }
                        } label: {
                            Text("Change password")
                                .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                    } else {
                        SecureField("Current password", text: $currentPassword)
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .textContentType(.password)
                        SecureField("New password (10+ characters)", text: $newPassword)
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .textContentType(.newPassword)
                        SecureField("Confirm new password", text: $newPasswordConfirm)
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .textContentType(.newPassword)
                        Button {
                            Task { await changePassword() }
                        } label: {
                            Text(isChangingPassword ? "Updating…" : "Update password")
                                .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                        .disabled(
                            isChangingPassword
                                || currentPassword.isEmpty
                                || newPassword.isEmpty
                                || newPasswordConfirm.isEmpty
                        )
                        Button("Cancel") {
                            showChangePassword = false
                            currentPassword = ""
                            newPassword = ""
                            newPasswordConfirm = ""
                        }
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.muted)
                    }
                } header: {
                    Text("Password")
                } footer: {
                    Text("Change the password used to sign in with email.")
                }
            }

            if canAddMethod {
                Section {
                    if !hasApple {
                        SignInWithAppleButton(.continue) { request in
                            request.requestedScopes = [.fullName, .email]
                            request.nonce = AppleSignInNonce.sha256(appleNonce)
                        } onCompletion: { result in
                            Task { await handleConnectApple(result) }
                        }
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 44)
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .disabled(isConnectingApple)
                    }

                    if !hasPassword {
                        if !showPasswordForm {
                            Button {
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                    showPasswordForm = true
                                }
                            } label: {
                                Text("Add password")
                                    .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                                    .foregroundStyle(AppTheme.accent)
                            }
                        } else {
                            SecureField("New password (10+ characters)", text: $password)
                                .font(.inter(size: SettingsFormChrome.rowFontSize))
                                .textContentType(.newPassword)
                            SecureField("Confirm password", text: $passwordConfirm)
                                .font(.inter(size: SettingsFormChrome.rowFontSize))
                                .textContentType(.newPassword)
                            Button {
                                Task { await addPassword() }
                            } label: {
                                Text(isAddingPassword ? "Saving…" : "Save password")
                                    .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                                    .foregroundStyle(AppTheme.accent)
                            }
                            .disabled(isAddingPassword || password.isEmpty || passwordConfirm.isEmpty)
                            Button("Cancel") {
                                showPasswordForm = false
                                password = ""
                                passwordConfirm = ""
                            }
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .foregroundStyle(AppTheme.muted)
                        }
                    }
                } header: {
                    Text("Add a method")
                } footer: {
                    Text("Stay signed in — we attach the new method to this account.")
                }
            }

            RecoveryEmailSection(statusMessage: $statusMessage)

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.accent)
                }
            }
            if let errorMessage {
                Section {
                    SettingsFormErrorBanner(message: errorMessage)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Sign-in & recovery")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if let cached = app.identities {
                identities = cached
                isLoading = false
            }
        }
        .task {
            if identities.isEmpty {
                await reload()
            }
        }
        .confirmationDialog(
            "Disconnect \(identityToRemove.map { identityTypeLabel($0.type) } ?? "this method")?",
            isPresented: Binding(
                get: { identityToRemove != nil },
                set: { if !$0 { identityToRemove = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let identity = identityToRemove {
                    Task { await removeIdentity(identity) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You won't be able to sign in with it until you connect it again.")
        }
    }

    private func identityTypeLabel(_ type: String) -> String {
        switch type {
        case "email": return "Email"
        case "password": return "Password"
        case "apple": return "Apple"
        case "google": return "Google"
        case "sub": return "Sign-in provider"
        default: return type
        }
    }

    private func reload() async {
        // DEBUG previews show the cached fixture identities only.
        guard !app.isDebugPreview else {
            isLoading = false
            return
        }
        if identities.isEmpty {
            isLoading = true
        }
        errorMessage = nil
        defer { isLoading = false }
        do {
            let res = try await APIClient.shared.listIdentities()
            identities = res.identities
            app.setIdentities(res.identities)
        } catch {
            if identities.isEmpty {
                errorMessage = "Could not load sign-in methods"
            }
        }
    }

    private func handleConnectApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let authorization):
            let nonce = appleNonce
            // Each request gets a fresh nonce.
            appleNonce = AppleSignInNonce.make()
            guard let credential = AppleSignInCredential(authorization: authorization, nonce: nonce) else {
                errorMessage = "Apple Sign In failed"
                return
            }
            isConnectingApple = true
            errorMessage = nil
            defer { isConnectingApple = false }
            do {
                let res = try await APIClient.shared.attachAppleIdentity(credential)
                statusMessage = res.isAdmin
                    ? "Apple connected — Domain Admin access restored"
                    : "Apple connected"
                if let next = res.identities {
                    identities = next
                    app.setIdentities(next)
                } else {
                    await reload()
                }
                await app.refreshMailboxes()
            } catch {
                errorMessage = friendlyAttachError(error)
            }
        }
    }

    private func addPassword() async {
        guard password.count >= 10 else {
            errorMessage = "Password must be at least 10 characters"
            return
        }
        guard password == passwordConfirm else {
            errorMessage = "Passwords do not match"
            return
        }
        isAddingPassword = true
        errorMessage = nil
        defer { isAddingPassword = false }
        do {
            let res = try await APIClient.shared.attachPasswordIdentity(password: password)
            password = ""
            passwordConfirm = ""
            showPasswordForm = false
            statusMessage = "Password added"
            if let next = res.identities {
                identities = next
                app.setIdentities(next)
            } else {
                await reload()
            }
        } catch {
            errorMessage = friendlyAttachError(error)
        }
    }

    private func changePassword() async {
        guard !currentPassword.isEmpty else {
            errorMessage = "Enter your current password"
            return
        }
        guard newPassword.count >= 10 else {
            errorMessage = "New password must be at least 10 characters"
            return
        }
        guard newPassword == newPasswordConfirm else {
            errorMessage = "New passwords do not match"
            return
        }
        guard currentPassword != newPassword else {
            errorMessage = "New password must be different from the current password"
            return
        }
        isChangingPassword = true
        errorMessage = nil
        defer { isChangingPassword = false }
        do {
            let res = try await APIClient.shared.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            currentPassword = ""
            newPassword = ""
            newPasswordConfirm = ""
            showChangePassword = false
            statusMessage = "Password updated"
            if let next = res.identities {
                identities = next
            } else {
                await reload()
            }
        } catch {
            errorMessage = friendlyChangePasswordError(error)
        }
    }

    private func removeIdentity(_ identity: LinkedIdentity) async {
        removingType = identity.type
        errorMessage = nil
        defer { removingType = nil }
        do {
            try await APIClient.shared.removeIdentity(type: identity.type)
            statusMessage = "\(identityTypeLabel(identity.type)) disconnected"
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func friendlyAttachError(_ error: Error) -> String {
        let text = error.localizedDescription
        if text.localizedCaseInsensitiveContains("already linked") {
            return "That identity is already linked to another Inboxies account"
        }
        if text.localizedCaseInsensitiveContains("already has a password") {
            return "This account already has a password"
        }
        return "Could not connect sign-in method"
    }

    private func friendlyChangePasswordError(_ error: Error) -> String {
        let text = error.localizedDescription
        if text.localizedCaseInsensitiveContains("incorrect") {
            return "Current password is incorrect"
        }
        if text.localizedCaseInsensitiveContains("no password") {
            return "This account has no password yet — add one first"
        }
        if text.localizedCaseInsensitiveContains("at least 10") {
            return "New password must be at least 10 characters"
        }
        return "Could not change password"
    }
}

/// Recovery email: where password reset codes go. It must be outside Inboxies
/// (other members can read a mailbox) and confirmed with a code before resets use it.
struct RecoveryEmailSection: View {
    @Environment(AppModel.self) private var app
    @Binding var statusMessage: String?

    @State private var status: RecoveryEmailStatus?
    @State private var isLoading = true
    @State private var isEditing = false
    @State private var emailDraft = ""
    @State private var codeDraft = ""
    @State private var isBusy = false
    @State private var errorMessage: String?

    private var hasEmail: Bool { status?.email?.isEmpty == false }
    private var isVerified: Bool { status?.verified == true }

    var body: some View {
        Section {
            if isLoading && status == nil {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowBackground(Color.clear)
            } else if !hasEmail || isEditing {
                TextField("Recovery email", text: $emailDraft, prompt: Text(verbatim: "you@example.com").foregroundStyle(AppTheme.muted))
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.ink)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button {
                    Task { await sendCode() }
                } label: {
                    Text(isBusy ? "Sending…" : "Send code")
                        .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                }
                .disabled(isBusy || !emailDraft.contains("@"))
                if isEditing {
                    Button("Keep \(status?.email ?? "current address")") {
                        isEditing = false
                        emailDraft = ""
                    }
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.muted)
                }
            } else {
                HStack(spacing: 8) {
                    Text(status?.email ?? "")
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    Spacer()
                    if isVerified {
                        Label("Confirmed", systemImage: "checkmark.circle.fill")
                            .labelStyle(.titleAndIcon)
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    } else {
                        Text("Not confirmed")
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                }
                if !isVerified {
                    TextField("Code", text: $codeDraft, prompt: Text("6-digit code").foregroundStyle(AppTheme.muted))
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    Button {
                        Task { await verify() }
                    } label: {
                        Text(isBusy ? "Confirming…" : "Confirm")
                            .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                    .disabled(isBusy || codeDraft.trimmingCharacters(in: .whitespaces).count < 6)
                    Button("Resend code") {
                        emailDraft = status?.email ?? ""
                        Task { await sendCode() }
                    }
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.muted)
                    .disabled(isBusy)
                }
                Button("Change address") {
                    emailDraft = ""
                    isEditing = true
                }
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.accent)
                Button("Remove", role: .destructive) {
                    Task { await remove() }
                }
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .disabled(isBusy)
            }
            if let errorMessage {
                SettingsFormErrorBanner(message: errorMessage)
            }
        } header: {
            Text("Recovery email")
        } footer: {
            Text(footerText)
        }
        .task { await load() }
    }

    private var footerText: String {
        if !hasEmail {
            return "Password reset codes go only to a confirmed recovery email. Without one, you can't reset a forgotten password. Use an address outside Inboxies."
        }
        if !isVerified {
            return "We sent a code to this address. Password resets won't reach it until you confirm."
        }
        return "Password reset codes go to this address."
    }

    private func load() async {
        if app.isDebugPreview {
            status = RecoveryEmailStatus(email: nil, verified: false)
            isLoading = false
            return
        }
        defer { isLoading = false }
        if let loaded = try? await APIClient.shared.getRecoveryEmail() {
            status = loaded
        }
    }

    private func sendCode() async {
        let email = emailDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let next = try await APIClient.shared.setRecoveryEmail(email)
            status = RecoveryEmailStatus(email: next.email, verified: next.verified)
            isEditing = false
            emailDraft = ""
            #if DEBUG
            codeDraft = next.devCode ?? ""
            #endif
            statusMessage = "Code sent to \(next.email ?? email)"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func verify() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            status = try await APIClient.shared.verifyRecoveryEmail(code: codeDraft.trimmingCharacters(in: .whitespaces))
            codeDraft = ""
            statusMessage = "Recovery email confirmed"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            try await APIClient.shared.removeRecoveryEmail()
            status = RecoveryEmailStatus(email: nil, verified: false)
            statusMessage = "Recovery email removed"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview("Sign-in methods") {
    NavigationStack {
        SignInMethodsSettingsView()
            .environment(AppModel())
    }
}

import AuthenticationServices
import SwiftUI

/// Account → Sign-in methods: connected methods, add Connect IdP / password,
/// change password when present, link codes as secondary fallback.
struct SignInMethodsSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var identities: [LinkedIdentity] = []
    @State private var isLoading = true
    @State private var isConnectingApple = false
    @State private var isAddingPassword = false
    @State private var isChangingPassword = false
    @State private var isMinting = false
    @State private var isRedeeming = false
    @State private var showPasswordForm = false
    @State private var showChangePassword = false
    @State private var showAdvanced = false
    @State private var password = ""
    @State private var passwordConfirm = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var newPasswordConfirm = ""
    @State private var linkCode: String?
    @State private var expiresAt: String?
    @State private var redeemDraft = ""
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
                    "Ways you can sign in to this account. Add Apple or a password here; every method reaches the same mailboxes."
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
                        VStack(alignment: .leading, spacing: 2) {
                            Text(identity.label)
                                .font(.inter(size: SettingsFormChrome.rowFontSize))
                                .foregroundStyle(AppTheme.ink)
                            Text(identityTypeLabel(identity.type) + (identity.current ? " · this session" : ""))
                                .font(.inter(size: SettingsFormChrome.footerFontSize))
                                .foregroundStyle(AppTheme.muted)
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

            Section {
                Button {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        showAdvanced.toggle()
                    }
                } label: {
                    Text(showAdvanced ? "Hide · Link another device" : "Link another device")
                        .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }

                if showAdvanced {
                    Text(
                        "Secondary: link across devices when Connect isn’t available. Codes expire in 15 minutes."
                    )
                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                    .foregroundStyle(AppTheme.muted)

                    Button {
                        Task { await createCode() }
                    } label: {
                        Text(isMinting ? "Creating…" : "Generate link code")
                            .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                    .disabled(isMinting)

                    if let linkCode {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(linkCode)
                                .font(.system(.body, design: .monospaced))
                                .foregroundStyle(AppTheme.ink)
                                .textSelection(.enabled)
                            if let expiresAt {
                                Text("Expires \(formatExpiry(expiresAt))")
                                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Button("Copy code") {
                                UIPasteboard.general.string = linkCode
                                statusMessage = "Code copied"
                            }
                            .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                        }
                    }

                    TextField("Paste code", text: $redeemDraft)
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        Task { await redeem() }
                    } label: {
                        Text(isRedeeming ? "Linking…" : "Link to this account")
                            .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                    .disabled(isRedeeming || redeemDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } header: {
                Text("Link another device")
            }

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
        .navigationTitle("Sign-in methods")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private func identityTypeLabel(_ type: String) -> String {
        switch type {
        case "email": return "Email"
        case "password": return "Password"
        case "apple": return "Apple"
        case "google": return "Google"
        case "sub": return "Sign-in provider"
        case "access": return "Access"
        default: return type
        }
    }

    private func formatExpiry(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func reload() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let res = try await APIClient.shared.listIdentities()
            identities = res.identities
        } catch {
            errorMessage = "Could not load sign-in methods"
        }
    }

    private func handleConnectApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            errorMessage = error.localizedDescription
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                errorMessage = "Apple Sign In failed"
                return
            }
            isConnectingApple = true
            errorMessage = nil
            defer { isConnectingApple = false }
            do {
                let res = try await APIClient.shared.attachAppleIdentity(identityToken: token)
                statusMessage = res.isAdmin
                    ? "Apple connected — Domain Admin access restored"
                    : "Apple connected"
                if let next = res.identities {
                    identities = next
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

    private func createCode() async {
        isMinting = true
        errorMessage = nil
        defer { isMinting = false }
        do {
            let res = try await APIClient.shared.createIdentityLinkCode()
            linkCode = res.code
            expiresAt = res.expiresAt
            statusMessage = "Link code created — expires in 15 minutes"
        } catch {
            errorMessage = "Could not create link code"
        }
    }

    private func redeem() async {
        let code = redeemDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { return }
        isRedeeming = true
        errorMessage = nil
        defer { isRedeeming = false }
        do {
            let res = try await APIClient.shared.redeemIdentityLink(code: code)
            redeemDraft = ""
            statusMessage = res.isAdmin
                ? "Linked — Domain Admin access restored"
                : "Sign-in method linked"
            if let next = res.identities {
                identities = next
            } else {
                await reload()
            }
            await app.refreshMailboxes()
        } catch {
            errorMessage = "Invalid or expired code"
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

#Preview("Sign-in methods") {
    NavigationStack {
        SignInMethodsSettingsView()
            .environment(AppModel())
    }
}

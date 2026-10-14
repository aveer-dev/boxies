import SwiftUI

/// Accept a mailbox invite from its link (`inboxies://invite/<token>` or
/// `/invite/<token>`). Either way the invitee first proves the invite reached
/// them with a code mailed to the invited address.
/// - Signed in: the mailbox joins the current account; the session is kept.
/// - Signed out: creates an account with a password (or hands off to sign-in,
///   after which this screen comes back signed in).
struct InviteAcceptView: View {
    let token: String
    /// DEBUG preview: render this invite without the network.
    var previewInvite: InvitePublic?
    var onSignIn: () -> Void
    var onDone: () -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    @State private var invite: InvitePublic?
    @State private var loadError: String?
    @State private var codeSentTo: String?
    @State private var code = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var displayName = ""
    @State private var isSendingCode = false
    @State private var isSubmitting = false
    @State private var formError: String?
    /// The invite targets an address that already has an account.
    @State private var needsSignIn = false

    private var isSignedIn: Bool { auth.isAuthenticated }

    private var canSubmit: Bool {
        guard code.trimmingCharacters(in: .whitespaces).count >= 6, !isSubmitting else { return false }
        return isSignedIn || password.count >= 10
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Accept invite")
                            .font(.inter(size: 24, weight: .bold))
                            .foregroundStyle(AppTheme.ink)
                        if let invite {
                            Text(subtitle(for: invite))
                                .font(.inter(size: 15))
                                .foregroundStyle(AppTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if let loadError {
                            Text(loadError)
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.deepDarkRed)
                        } else {
                            ProgressView()
                        }
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
                }

                if let invite {
                    Section {
                        if let codeSentTo {
                            TextField("6-digit code", text: $code)
                                .font(.inter(size: 16))
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                            Button(isSendingCode ? "Sending…" : "Send a new code") {
                                Task { await sendCode() }
                            }
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.muted)
                            .disabled(isSendingCode)
                            Text("Sent to \(codeSentTo)")
                                .font(.inter(size: 12))
                                .foregroundStyle(AppTheme.muted)
                        } else {
                            Button {
                                Task { await sendCode() }
                            } label: {
                                HStack {
                                    Text(isSendingCode ? "Sending…" : "Email a code to \(invite.inviteeEmail)")
                                        .font(.inter(size: 16, weight: .medium))
                                        .foregroundStyle(AppTheme.accent)
                                    Spacer()
                                    if isSendingCode { ProgressView().controlSize(.small) }
                                }
                            }
                            .disabled(isSendingCode)
                        }
                    } header: {
                        Text("Confirm it's you")
                    } footer: {
                        Text("Invites are confirmed with a code sent to the invited address.")
                    }

                    if codeSentTo != nil && !isSignedIn {
                        Section {
                            TextField("Display name (optional)", text: $displayName)
                                .textContentType(.name)
                            SecureField("Password (10+ characters)", text: $password)
                                .textContentType(.newPassword)
                            SecureField("Confirm password", text: $confirm)
                                .textContentType(.newPassword)
                        } header: {
                            Text("Create your account")
                        }
                    }

                    if let formError {
                        Section {
                            Text(formError)
                                .foregroundStyle(AppTheme.deepDarkRed)
                                .font(.inter(size: 13))
                            if needsSignIn {
                                Button("Sign in to accept") { onSignIn() }
                                    .font(.inter(size: 15, weight: .medium))
                                    .foregroundStyle(AppTheme.accent)
                            }
                        }
                    }

                    if codeSentTo != nil {
                        Section {
                            Button {
                                Task { await accept() }
                            } label: {
                                HStack {
                                    Spacer()
                                    if isSubmitting {
                                        ProgressView()
                                    } else {
                                        Text(isSignedIn ? "Accept invite" : "Create account")
                                            .font(.inter(size: 16, weight: .medium))
                                    }
                                    Spacer()
                                }
                            }
                            .disabled(!canSubmit)
                        }
                    }

                    if !isSignedIn {
                        Section {
                            Button("I already have an account") { onSignIn() }
                                .font(.inter(size: 14))
                                .foregroundStyle(AppTheme.muted)
                        } footer: {
                            Text("Sign in first, then accept the invite into that account.")
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        onDone()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .task { await load() }
        }
    }

    private func subtitle(for invite: InvitePublic) -> String {
        let role = invite.role == "owner" ? "an owner" : "a member"
        if isSignedIn {
            return "Join \(invite.mailboxId) as \(role), signed in as \(auth.userEmail ?? "your account")."
        }
        return "You've been invited to \(invite.mailboxId) as \(role)."
    }

    private func load() async {
        if let previewInvite {
            invite = previewInvite
            return
        }
        do {
            invite = try await APIClient.shared.getInvite(token: token)
        } catch APIError.http(let status, let message) where status == 410 || status == 404 {
            loadError = message.isEmpty ? "This invite is no longer active." : message
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func sendCode() async {
        guard previewInvite == nil else {
            codeSentTo = invite?.inviteeEmail
            return
        }
        isSendingCode = true
        formError = nil
        defer { isSendingCode = false }
        do {
            let result = try await APIClient.shared.sendInviteCode(token: token)
            codeSentTo = result.sentTo
            #if DEBUG
            if let devCode = result.devCode { code = devCode }
            #endif
        } catch {
            formError = error.localizedDescription
        }
    }

    private func accept() async {
        formError = nil
        needsSignIn = false
        if !isSignedIn {
            guard password == confirm else {
                formError = "Passwords do not match"
                return
            }
            guard password.count >= 10 else {
                formError = "Password must be at least 10 characters"
                return
            }
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result = try await APIClient.shared.acceptInvite(
                token: token,
                code: code.trimmingCharacters(in: .whitespaces),
                password: isSignedIn ? nil : password,
                displayName: displayName.isEmpty ? nil : displayName
            )
            if isSignedIn {
                await app.refreshMailboxes(showLoading: false)
                if app.mailboxes.contains(where: { $0.id == result.mailboxId }) {
                    await app.loadMailbox(result.mailboxId)
                }
                app.showToast("You joined \(result.mailboxId)")
            } else if let sessionToken = result.token {
                // RootView's `.task(id: auth.token)` bootstraps the new session.
                auth.applySession(token: sessionToken, email: result.email ?? result.mailboxId)
            }
            onDone()
        } catch APIError.http(409, let message) {
            formError = message
            needsSignIn = true
        } catch {
            formError = error.localizedDescription
        }
    }
}

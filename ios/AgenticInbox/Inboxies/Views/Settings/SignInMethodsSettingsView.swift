import SwiftUI

/// Account → Sign-in methods: list linked identities, mint / redeem link codes.
struct SignInMethodsSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var identities: [LinkedIdentity] = []
    @State private var isLoading = true
    @State private var isMinting = false
    @State private var isRedeeming = false
    @State private var linkCode: String?
    @State private var expiresAt: String?
    @State private var redeemDraft = ""
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Text(
                    "Link Access email, Apple, Google, or password so every sign-in uses the same account and mailbox access."
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
                    Text("No linked identities yet.")
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

            Section {
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
            } header: {
                Text("Connect another method")
            } footer: {
                Text(
                    "On web (email / Access), generate a code, then redeem it here after Sign in with Apple. Codes expire in 15 minutes."
                )
            }

            Section {
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
            } header: {
                Text("Redeem a code")
            } footer: {
                Text("Paste a code from web or another sign-in method while signed in here.")
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
}

#Preview("Sign-in methods") {
    NavigationStack {
        SignInMethodsSettingsView()
            .environment(AppModel())
    }
}

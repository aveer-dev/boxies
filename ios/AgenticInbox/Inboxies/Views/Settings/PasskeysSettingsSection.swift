import SwiftUI

/// Sign-in & recovery → Passkeys: the account's passkeys, add one on this
/// device, remove one. A passkey signs in on its own (no password, no 2FA step).
struct PasskeysSettingsSection: View {
    @Environment(AppModel.self) private var app
    @Binding var statusMessage: String?

    @State private var passkeys: [PasskeyRow] = []
    @State private var isLoading = true
    @State private var isAdding = false
    @State private var removingID: String?
    @State private var passkeyToRemove: PasskeyRow?
    @State private var errorMessage: String?

    var body: some View {
        Section {
            if isLoading && passkeys.isEmpty {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(passkeys) { passkey in
                    HStack(spacing: 12) {
                        Image(systemName: "person.badge.key")
                            .font(.system(size: 15))
                            .foregroundStyle(AppTheme.muted)
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(displayName(passkey))
                                .font(.inter(size: SettingsFormChrome.rowFontSize))
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)
                            Text(detail(passkey))
                                .font(.inter(size: SettingsFormChrome.footerFontSize))
                                .foregroundStyle(AppTheme.muted)
                        }
                        Spacer()
                        if removingID == passkey.id {
                            ProgressView().controlSize(.small)
                        } else {
                            Button("Remove") {
                                passkeyToRemove = passkey
                            }
                            .font(.inter(size: 13, weight: .medium))
                            .foregroundStyle(.red)
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 2)
                }

                Button {
                    Task { await addPasskey() }
                } label: {
                    HStack(spacing: 8) {
                        if isAdding {
                            ProgressView().controlSize(.small)
                        }
                        Text(isAdding ? "Adding…" : "Add a passkey")
                            .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    }
                }
                .disabled(isAdding)
            }
            if let errorMessage {
                SettingsFormErrorBanner(message: errorMessage)
            }
        } header: {
            Text("Passkeys")
        } footer: {
            Text("Sign in with Face ID or Touch ID instead of a password. Passkeys are saved to your password manager, like iCloud Keychain, and work on your other devices too.")
        }
        .task { await load() }
        .confirmationDialog(
            "Remove \(passkeyToRemove.map(displayName) ?? "this passkey")?",
            isPresented: Binding(
                get: { passkeyToRemove != nil },
                set: { if !$0 { passkeyToRemove = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let passkey = passkeyToRemove {
                    Task { await remove(passkey) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You won't be able to sign in with it anymore. Also delete it from your password manager.")
        }
    }

    private func displayName(_ passkey: PasskeyRow) -> String {
        if let name = passkey.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        return "Passkey"
    }

    private func detail(_ passkey: PasskeyRow) -> String {
        var parts: [String] = []
        if let created = Self.parseDate(passkey.createdAt) {
            parts.append("Added \(created.formatted(date: .abbreviated, time: .omitted))")
        }
        if passkey.backedUp == true || passkey.deviceType == "multiDevice" {
            parts.append("Synced")
        } else if passkey.deviceType == "singleDevice" {
            parts.append("This device only")
        }
        return parts.isEmpty ? "Passkey" : parts.joined(separator: " · ")
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func load() async {
        if app.isDebugPreview {
            passkeys = [
                PasskeyRow(
                    id: "preview-passkey",
                    name: "Inboxies on iPhone",
                    createdAt: "2026-10-01T09:00:00.000Z",
                    deviceType: "multiDevice",
                    backedUp: true
                ),
            ]
            isLoading = false
            return
        }
        defer { isLoading = false }
        do {
            passkeys = try await Passkeys.list()
        } catch {
            if passkeys.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func addPasskey() async {
        guard !app.isDebugPreview else { return }
        isAdding = true
        errorMessage = nil
        defer { isAdding = false }
        do {
            try await Passkeys.register(name: Passkeys.deviceName)
            statusMessage = "Passkey added"
            passkeys = (try? await Passkeys.list()) ?? passkeys
        } catch Passkeys.Failure.cancelled {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ passkey: PasskeyRow) async {
        guard !app.isDebugPreview else { return }
        removingID = passkey.id
        errorMessage = nil
        defer { removingID = nil }
        do {
            try await Passkeys.delete(id: passkey.id)
            passkeys.removeAll { $0.id == passkey.id }
            statusMessage = "Passkey removed"
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// Sign-in & recovery → Two-factor authentication: whether TOTP 2FA is on.
/// Turning it on or off and new backup codes live in Inboxies on the web for
/// now; it only ever challenges password sign-in.
struct TwoFactorStatusSection: View {
    @Environment(AppModel.self) private var app

    @State private var isEnabled: Bool?
    @State private var isLoading = true

    var body: some View {
        Section {
            HStack(spacing: 8) {
                Text("Authenticator app")
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                if let isEnabled {
                    if isEnabled {
                        Label("On", systemImage: "checkmark.circle.fill")
                            .labelStyle(.titleAndIcon)
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                    } else {
                        Text("Off")
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                    }
                } else if isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Text("Unknown")
                        .font(.inter(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                }
            }
        } header: {
            Text("Two-factor authentication")
        } footer: {
            Text(footer)
        }
        .task { await load() }
    }

    private var footer: AttributedString {
        let lead = isEnabled == true
            ? "Signing in with your password also asks for a code from your authenticator app, or a backup code. Turn it off or get new backup codes in "
            : "Optional. Ask for a code from an authenticator app after your password. Turn it on in "
        var link = AttributedString("Inboxies on the web")
        link.link = AppConfig.apiBaseURL
        link.foregroundColor = AppTheme.accent
        var text = AttributedString(lead)
        text += link
        text += AttributedString(" → Settings → Sign-in & recovery. Passkeys, Apple and Google don't ask for a code.")
        return text
    }

    private func load() async {
        defer { isLoading = false }
        if app.isDebugPreview {
            isEnabled = false
            return
        }
        if let me = try? await APIClient.shared.getMe() {
            isEnabled = me.twoFactorEnabled ?? false
        }
    }
}

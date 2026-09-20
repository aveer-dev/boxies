import SwiftUI

/// Per-mailbox incoming-mail forwarding.
struct ForwardingSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var enabled = false
    @State private var email = ""
    @State private var isSaving = false
    @State private var saveMessage: String?

    private var mailboxEmail: String {
        app.selectedMailbox?.email ?? ""
    }

    var body: some View {
        List {
            Section {
                SettingsToggleRow(title: "Forward Incoming Mail", isOn: $enabled)
            } footer: {
                SettingsFormFooter(
                    text: "When on, a copy of each incoming message is sent to another address. This mailbox still keeps the original."
                )
            }

            Section {
                SettingsTextFieldRow(
                    title: "Forward To",
                    text: $email,
                    placeholder: "you@example.com",
                    keyboardType: .emailAddress,
                    textContentType: .emailAddress,
                    disabled: !enabled
                )
            } header: {
                Text("Destination")
            } footer: {
                SettingsFormFooter(
                    text: "Must be a verified Email Routing destination in your Cloudflare account. Unverified addresses are skipped. Spam and messages already in a forwarding loop are not forwarded."
                )
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Forwarding")
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
                .disabled(isSaving || app.selectedMailbox == nil)
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
            enabled = app.selectedMailbox?.settings?.forwarding?.enabled ?? false
            email = app.selectedMailbox?.settings?.forwarding?.email ?? ""
        }
        .applyThemeController()
    }

    private func save() async {
        let dest = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if enabled {
            if dest.isEmpty || !dest.contains("@") {
                withAnimation { saveMessage = "Enter a valid forwarding address" }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                withAnimation { saveMessage = nil }
                return
            }
            if dest.lowercased() == mailboxEmail.lowercased() {
                withAnimation { saveMessage = "Cannot forward to this mailbox" }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                withAnimation { saveMessage = nil }
                return
            }
        }

        isSaving = true
        defer { isSaving = false }

        let success = await app.updateMailboxSettings { settings in
            settings.forwarding = ForwardingSettings(enabled: enabled, email: dest)
        }

        withAnimation {
            saveMessage = success ? "Forwarding saved" : "Failed to save"
        }
        try? await Task.sleep(nanoseconds: success ? 1_200_000_000 : 2_000_000_000)
        withAnimation { saveMessage = nil }
    }
}

#Preview("Forwarding") {
    PreviewHost {
        NavigationStack {
            ForwardingSettingsView()
        }
    }
}

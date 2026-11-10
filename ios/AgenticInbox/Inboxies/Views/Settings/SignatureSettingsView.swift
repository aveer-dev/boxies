import SwiftUI

/// Per-mailbox signature (AVE-204). The web writes it with formatting and links;
/// here you switch it on or off and edit its words. Compose adds it to new mail,
/// replies and forwards (`ComposeHTML.signatureText`).
struct SignatureSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var enabled = true
    @State private var text = ""
    /// The words as loaded: unchanged words keep the web's formatting on save.
    @State private var loadedText = ""
    @State private var isSaving = false
    @State private var saveMessage: String?

    private var signature: SignatureSettings? {
        app.selectedMailbox?.settings?.signature
    }

    /// Formatted on the web: editing the words here drops that formatting.
    private var hasWebFormatting: Bool {
        !(signature?.html?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
    }

    private var footerText: String {
        var parts = ["Added under new mail, replies and forwards from this mailbox. Replies from a private email go without it."]
        if hasWebFormatting {
            parts.append(
                text == loadedText
                    ? "This signature has formatting from the web. Changing the words here keeps links as addresses and removes the formatting."
                    : "Saving replaces the web's formatting with these words. Links stay as addresses."
            )
        } else {
            parts.append("Add formatting and links in Settings on the web.")
        }
        return parts.joined(separator: " ")
    }

    var body: some View {
        List {
            Section {
                SettingsToggleRow(title: "Add a Signature", isOn: $enabled)
            }

            Section {
                ZStack(alignment: .topLeading) {
                    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Your name, role, a link…")
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .foregroundStyle(AppTheme.muted.opacity(0.7))
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $text)
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .frame(minHeight: 120)
                        .scrollContentBackground(.hidden)
                        .disabled(!enabled)
                        .opacity(enabled ? 1 : 0.45)
                        .accessibilityLabel("Signature")
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            } header: {
                Text("Signature")
            } footer: {
                SettingsFormFooter(text: footerText)
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Signature")
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
        .onAppear(perform: load)
        .onChange(of: app.selectedMailboxId) { _, _ in load() }
        .applyThemeController()
    }

    private func load() {
        let settings = app.selectedMailbox?.settings
        enabled = ComposeHTML.signatureEnabled(settings)
        let words = ComposeHTML.signatureWords(settings)
        text = words
        loadedText = words
    }

    private func save() async {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if enabled && words.isEmpty {
            await flash("Write a signature or turn it off", seconds: 2)
            return
        }

        isSaving = true
        defer { isSaving = false }

        // Unchanged words keep the web's HTML; new words replace it (the Worker
        // replaces the whole signature object, so leaving `html` out clears it).
        let keepHTML = text == loadedText ? signature?.html : nil
        let success = await app.updateMailboxSettings { settings in
            settings.signature = SignatureSettings(enabled: enabled, text: words, html: keepHTML)
        }
        if success { load() }
        await flash(success ? "Signature saved" : "Failed to save", seconds: success ? 1.2 : 2)
    }

    private func flash(_ message: String, seconds: Double) async {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { saveMessage = message }
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { saveMessage = nil }
    }
}

#Preview("Signature") {
    PreviewHost {
        NavigationStack {
            SignatureSettingsView()
        }
    }
}

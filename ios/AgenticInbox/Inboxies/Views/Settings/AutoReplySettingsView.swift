import SwiftUI

/// Per-mailbox vacation auto-reply.
struct AutoReplySettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var enabled = false
    @State private var subject = ""
    @State private var message = ""
    @State private var isSaving = false
    @State private var saveMessage: String?

    var body: some View {
        List {
            Section {
                SettingsToggleRow(title: "Send Automatic Replies", isOn: $enabled)
            } footer: {
                SettingsFormFooter(
                    text: "When on, people who email this mailbox get one automatic reply. You still receive their message."
                )
            }

            Section {
                SettingsTextFieldRow(
                    title: "Subject",
                    text: $subject,
                    placeholder: "Re: original subject",
                    disabled: !enabled
                )
            } header: {
                Text("Subject")
            } footer: {
                SettingsFormFooter(text: "Leave blank to use Re: followed by the original subject.")
            }

            Section {
                ZStack(alignment: .topLeading) {
                    if message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Write your auto-reply…")
                            .font(.inter(size: SettingsFormChrome.rowFontSize))
                            .foregroundStyle(AppTheme.muted.opacity(0.7))
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $message)
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .frame(minHeight: 140)
                        .scrollContentBackground(.hidden)
                        .disabled(!enabled)
                        .opacity(enabled ? 1 : 0.45)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            } header: {
                Text("Message")
            } footer: {
                SettingsFormFooter(
                    text: "Each sender gets at most one auto-reply every 24 hours. Lists, bulk senders, no-reply addresses, and other automated mail are skipped."
                )
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Auto-Reply")
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
            enabled = app.selectedMailbox?.settings?.autoReply?.enabled ?? false
            subject = app.selectedMailbox?.settings?.autoReply?.subject ?? ""
            message = app.selectedMailbox?.settings?.autoReply?.message ?? ""
        }
        .applyThemeController()
    }

    private func save() async {
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if enabled && trimmedMessage.isEmpty {
            withAnimation { saveMessage = "Enter an auto-reply message" }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            withAnimation { saveMessage = nil }
            return
        }

        isSaving = true
        defer { isSaving = false }

        let trimmedSubject = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        let success = await app.updateMailboxSettings { settings in
            settings.autoReply = AutoReplySettings(
                enabled: enabled,
                subject: trimmedSubject,
                message: trimmedMessage
            )
        }

        withAnimation {
            saveMessage = success ? "Auto-reply saved" : "Failed to save"
        }
        try? await Task.sleep(nanoseconds: success ? 1_200_000_000 : 2_000_000_000)
        withAnimation { saveMessage = nil }
    }
}

#Preview("Auto-reply") {
    PreviewHost {
        NavigationStack {
            AutoReplySettingsView()
        }
    }
}

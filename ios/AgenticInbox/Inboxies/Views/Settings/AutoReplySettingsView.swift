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
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("When this is on, people who email this mailbox get one automatic reply. You still receive their message.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)

                Text("Each sender gets at most one auto-reply every 24 hours. Mail from lists, bulk senders, no-reply addresses, and other automated systems is skipped so this cannot loop.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)

                Toggle("Send automatic replies", isOn: $enabled)
                    .font(.inter(size: 16))
                    .tint(AppTheme.accent)
                    .padding(.vertical, 4)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Subject")
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                    TextField("Leave blank to use Re: original subject", text: $subject)
                        .font(.inter(size: 16))
                        .padding(12)
                        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(AppTheme.line, lineWidth: 1)
                        )
                        .disabled(!enabled)
                        .opacity(enabled ? 1 : 0.5)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Message")
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                    TextEditor(text: $message)
                        .font(.inter(size: 16))
                        .frame(minHeight: 160)
                        .padding(10)
                        .scrollContentBackground(.hidden)
                        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(AppTheme.line, lineWidth: 1)
                        )
                        .disabled(!enabled)
                        .opacity(enabled ? 1 : 0.5)
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("Auto-reply")
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

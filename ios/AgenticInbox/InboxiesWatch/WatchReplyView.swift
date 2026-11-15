import SwiftUI

/// Quick reply: dictation or Scribble through `TextFieldLink`, or a canned reply.
/// The Worker composes the rest (`quick-reply`: To, the thread's From, Re: subject).
struct WatchReplyView: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let email: WatchEmail

    @State private var sending: String?
    @State private var sent = false
    @State private var error: String?
    /// The last failed attempt, so retrying the same text reuses its idempotency key
    /// and can't send twice.
    @State private var lastAttempt: (text: String, key: String)?

    var body: some View {
        List {
            Section {
                TextFieldLink(prompt: Text("Reply to \(email.displaySender)")) {
                    Label("Dictate or Scribble", systemImage: "mic")
                        .font(WatchType.action)
                        .foregroundStyle(WatchPalette.accent)
                } onSubmit: { text in
                    send(text)
                }
                .listRowBackground(Capsule().fill(WatchPalette.accent.opacity(0.16)))
            }
            Section {
                ForEach(WatchMailText.cannedReplies, id: \.self) { reply in
                    Button {
                        send(reply)
                    } label: {
                        Text(reply)
                            .font(WatchType.action)
                            .foregroundStyle(WatchPalette.ink)
                    }
                    .listRowBackground(Capsule().fill(WatchPalette.pillFill))
                }
            } header: {
                Text("Quick replies")
                    .font(WatchType.meta)
                    .foregroundStyle(WatchPalette.muted)
            }
        }
        .scrollContentBackground(.hidden)
        .background(WatchPalette.background.ignoresSafeArea())
        .navigationTitle("Reply")
        .disabled(sending != nil || sent)
        .overlay { statusOverlay }
        .alert("Not sent", isPresented: Binding(
            get: { error != nil },
            set: { if !$0 { error = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    @ViewBuilder
    private var statusOverlay: some View {
        if sent {
            VStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(WatchPalette.accent)
                Text("Sent")
                    .font(WatchType.title)
                    .foregroundStyle(WatchPalette.ink)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(WatchPalette.background.opacity(0.92))
            .transition(.opacity)
        } else if sending != nil {
            ProgressView()
                .tint(WatchPalette.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(WatchPalette.background.opacity(0.7))
        }
    }

    private func send(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, sending == nil else { return }
        let key = lastAttempt?.text == text ? lastAttempt!.key : UUID().uuidString
        lastAttempt = (text, key)
        sending = text
        Task {
            defer { sending = nil }
            do {
                try await store.reply(to: email, text: text, idempotencyKey: key)
                lastAttempt = nil
                withAnimation(.inboxies) { sent = true }
                try? await Task.sleep(for: .milliseconds(900))
                dismiss()
            } catch WatchAPIError.signedOut {
                // The store wiped the session and shows Connect.
            } catch {
                self.error = WatchStore.message(for: error)
            }
        }
    }
}

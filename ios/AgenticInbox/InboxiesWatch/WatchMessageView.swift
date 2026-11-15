import SwiftUI

/// One message as plain text (trimmed to about 2 KB), then the actions: Reply,
/// Archive, Mark read / unread, Reply Later and Report spam. No Trash on the watch.
struct WatchMessageView: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let email: WatchEmail

    @State private var loaded: WatchEmail?
    @State private var loadError: String?
    @State private var isUnread: Bool
    @State private var inReplyLater: Bool
    @State private var busy = false
    @State private var actionError: String?
    @State private var confirmSpam = false

    init(email: WatchEmail) {
        self.email = email
        _isUnread = State(initialValue: email.isUnread)
        _inReplyLater = State(initialValue: email.replyLater == true)
    }

    private var message: WatchEmail { loaded ?? email }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                header
                Rectangle().fill(WatchPalette.line).frame(height: 0.5)
                bodyText
                actions
                    .padding(.top, 6)
            }
            .padding(.horizontal, 4)
        }
        .background(WatchPalette.background.ignoresSafeArea())
        .navigationTitle(message.displaySender)
        .disabled(busy)
        .task { await load() }
        .confirmationDialog(
            "Report spam?",
            isPresented: $confirmSpam,
            titleVisibility: .visible
        ) {
            Button("Report spam", role: .destructive) {
                perform(leaving: true) { try await store.reportSpam(email) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Moves this and \(message.displaySender)'s other mail to Spam. Undo from your iPhone.")
        }
        .alert("Couldn't do that", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(message.displaySender)
                .font(WatchType.sender)
                .foregroundStyle(WatchPalette.ink)
                .lineLimit(2)
            HStack(spacing: 4) {
                Text(WatchDates.short(message.parsedDate))
                if let count = email.threadCount, count > 1 {
                    Text("· \(count) messages")
                }
            }
            .font(WatchType.meta)
            .foregroundStyle(WatchPalette.muted)
            Text(message.displaySubject)
                .font(WatchType.inter(14, .medium))
                .foregroundStyle(WatchPalette.ink)
                .padding(.top, 2)
        }
    }

    @ViewBuilder
    private var bodyText: some View {
        let text = WatchMailText.plainText(from: loaded?.body ?? email.body ?? email.snippet)
        if let loadError, loaded == nil, text.isEmpty {
            Text(loadError)
                .font(WatchType.subject)
                .foregroundStyle(WatchPalette.muted)
        } else if text.isEmpty, loaded == nil {
            ProgressView()
                .tint(WatchPalette.muted)
                .frame(maxWidth: .infinity)
        } else {
            Text(text.isEmpty ? "No text in this message." : text)
                .font(WatchType.body)
                .foregroundStyle(text.isEmpty ? WatchPalette.muted : WatchPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actions: some View {
        VStack(spacing: 6) {
            NavigationLink(value: WatchRoute.reply(message)) {
                Label("Reply", systemImage: "arrowshape.turn.up.left")
                    .font(WatchType.action)
            }
            .buttonStyle(WatchPillButtonStyle(role: .primary))

            Button {
                perform(leaving: true) { try await store.archive(email) }
            } label: {
                Label("Archive", systemImage: "archivebox")
                    .font(WatchType.action)
            }
            .buttonStyle(WatchPillButtonStyle())

            Button {
                let markRead = isUnread
                perform(leaving: false) {
                    try await store.setRead(markRead, for: email)
                    isUnread = !markRead
                }
            } label: {
                Label(
                    isUnread ? "Mark as read" : "Mark as unread",
                    systemImage: isUnread ? "envelope.open" : "envelope.badge"
                )
                .font(WatchType.action)
            }
            .buttonStyle(WatchPillButtonStyle())

            Button {
                perform(leaving: false) {
                    try await store.replyLater(email)
                    inReplyLater = true
                }
            } label: {
                Label(
                    inReplyLater ? "In Reply Later" : "Reply Later",
                    systemImage: inReplyLater ? "checkmark" : "clock"
                )
                .font(WatchType.action)
            }
            .buttonStyle(WatchPillButtonStyle())
            .disabled(inReplyLater)

            Button {
                confirmSpam = true
            } label: {
                Label("Report spam", systemImage: "xmark.octagon")
                    .font(WatchType.action)
            }
            .buttonStyle(WatchPillButtonStyle(role: .destructive))
        }
    }

    /// Loads the full message and marks it read, like opening it on the phone.
    private func load() async {
        guard loaded == nil else { return }
        do {
            loaded = try await store.loadMessage(email)
            loadError = nil
        } catch WatchAPIError.signedOut {
            return
        } catch {
            loadError = WatchStore.message(for: error)
        }
        if isUnread, !store.isPreview {
            try? await store.setRead(true, for: email)
            isUnread = false
        }
    }

    private func perform(leaving: Bool, _ action: @escaping () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do {
                try await action()
                if leaving { dismiss() }
            } catch WatchAPIError.signedOut {
                // The store wiped the session and shows Connect.
            } catch {
                actionError = WatchStore.message(for: error)
            }
        }
    }
}

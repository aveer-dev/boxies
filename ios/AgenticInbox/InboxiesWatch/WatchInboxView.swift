import SwiftUI

enum WatchRoute: Hashable {
    case message(WatchEmail)
    case reply(WatchEmail)
    case mailboxes
}

/// The active mailbox's newest Inbox conversations: flat rows (unread dot, sender,
/// date, subject, one line of preview), hairline dividers, no cards.
struct WatchInboxView: View {
    @Environment(WatchStore.self) private var store
    @State private var path: [WatchRoute] = []
    @State private var actionError: String?

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if store.mailboxes.count > 1, let mailbox = store.activeMailbox {
                    NavigationLink(value: WatchRoute.mailboxes) {
                        HStack(spacing: 6) {
                            Text(mailbox.title)
                                .font(WatchType.meta)
                                .foregroundStyle(WatchPalette.muted)
                                .lineLimit(1)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(WatchPalette.muted)
                        }
                    }
                    .listRowBackground(Color.clear)
                    .accessibilityLabel("Mailbox \(mailbox.title). Switch mailbox")
                }
                content
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(WatchPalette.background.ignoresSafeArea())
            .navigationTitle("Inbox")
            .navigationDestination(for: WatchRoute.self) { route in
                switch route {
                case .message(let email):
                    WatchMessageView(email: email)
                case .reply(let email):
                    WatchReplyView(email: email)
                case .mailboxes:
                    WatchMailboxPicker()
                }
            }
            .refreshable { await store.refresh() }
            .alert("Couldn't do that", isPresented: Binding(
                get: { actionError != nil },
                set: { if !$0 { actionError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(actionError ?? "")
            }
        }
        .task { openPreviewRouteIfNeeded() }
    }

    @ViewBuilder
    private var content: some View {
        switch (store.emails.isEmpty, store.listState) {
        case (true, .idle), (true, .loading):
            ForEach(0..<4, id: \.self) { _ in
                WatchRowSkeleton()
                    .listRowBackground(Color.clear)
            }
        case (true, .failed(let message)):
            VStack(spacing: 8) {
                Text(message)
                    .font(WatchType.subject)
                    .foregroundStyle(WatchPalette.muted)
                    .multilineTextAlignment(.center)
                Button("Retry") { Task { await store.refresh() } }
                    .buttonStyle(WatchPillButtonStyle())
            }
            .listRowBackground(Color.clear)
        default:
            if store.emails.isEmpty {
                ContentUnavailableView("Inbox zero", systemImage: "tray", description: Text("Nothing new."))
                    .font(WatchType.subject)
                    .foregroundStyle(WatchPalette.muted)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(store.emails) { email in
                    NavigationLink(value: WatchRoute.message(email)) {
                        WatchEmailRow(email: email)
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                    .swipeActions(edge: .trailing) {
                        Button {
                            perform { try await store.archive(email) }
                        } label: {
                            Label("Archive", systemImage: "archivebox")
                        }
                        .tint(WatchPalette.archiveSwipe)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            perform { try await store.setRead(email.isUnread, for: email) }
                        } label: {
                            Label(
                                email.isUnread ? "Mark as read" : "Mark as unread",
                                systemImage: email.isUnread ? "envelope.open" : "envelope.badge"
                            )
                        }
                        .tint(WatchPalette.accent)
                    }
                }
            }
        }
    }

    private func perform(_ action: @escaping () async throws -> Void) {
        Task {
            do {
                try await action()
            } catch WatchAPIError.signedOut {
                // The store wiped the session and shows Connect.
            } catch {
                actionError = WatchStore.message(for: error)
            }
        }
    }

    private func openPreviewRouteIfNeeded() {
        #if DEBUG
        guard store.isPreview, path.isEmpty, let fixture = WatchPreviewFixtures.current,
              let first = store.emails.first else { return }
        switch fixture.opened {
        case .none: break
        case .message: path = [.message(first)]
        case .reply: path = [.message(first), .reply(first)]
        }
        #endif
    }
}

struct WatchEmailRow: View {
    let email: WatchEmail

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(email.isUnread ? WatchPalette.accent : Color.clear)
                .frame(width: 7, height: 7)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(email.displaySender)
                        .font(email.isUnread ? WatchType.sender : WatchType.senderRead)
                        .foregroundStyle(WatchPalette.ink)
                        .lineLimit(1)
                    if let count = email.threadCount, count > 1 {
                        Text("\(count)")
                            .font(WatchType.meta)
                            .foregroundStyle(WatchPalette.muted)
                    }
                    Spacer(minLength: 2)
                    if email.replyLater == true {
                        Image(systemName: "clock")
                            .font(.system(size: 9))
                            .foregroundStyle(WatchPalette.muted)
                    }
                    Text(WatchDates.short(email.parsedDate))
                        .font(WatchType.meta)
                        .foregroundStyle(WatchPalette.muted)
                }
                Text(email.displaySubject)
                    .font(WatchType.subject)
                    .foregroundStyle(email.isUnread ? WatchPalette.ink : WatchPalette.muted)
                    .lineLimit(2)
                if let snippet = email.snippet, !snippet.isEmpty {
                    Text(WatchMailText.plainText(from: snippet, limit: 140))
                        .font(WatchType.preview)
                        .foregroundStyle(WatchPalette.muted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WatchPalette.line)
                .frame(height: 0.5)
                .padding(.leading, 15)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(email.isUnread ? "Unread. " : "")\(email.displaySender). \(email.displaySubject)"
        )
    }
}

/// Loading placeholder: the phone's skeleton rows, pulsing.
struct WatchRowSkeleton: View {
    @State private var dim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 4).fill(WatchPalette.pillFill).frame(width: 90, height: 10)
            RoundedRectangle(cornerRadius: 4).fill(WatchPalette.pillFill).frame(height: 9)
            RoundedRectangle(cornerRadius: 4).fill(WatchPalette.pillFill).frame(width: 110, height: 8)
        }
        .padding(.vertical, 10)
        .padding(.leading, 15)
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.95).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityHidden(true)
    }
}

/// Only shown with more than one mailbox. Follows the phone's active mailbox until
/// the person picks another here.
struct WatchMailboxPicker: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List(store.mailboxes) { mailbox in
            Button {
                store.selectMailbox(mailbox.id)
                dismiss()
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mailbox.title)
                            .font(WatchType.senderRead)
                            .foregroundStyle(WatchPalette.ink)
                            .lineLimit(1)
                        Text(mailbox.email)
                            .font(WatchType.meta)
                            .foregroundStyle(WatchPalette.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    if mailbox.id == store.activeMailbox?.id {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(WatchPalette.accent)
                    }
                }
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(WatchPalette.background.ignoresSafeArea())
        .navigationTitle("Mailboxes")
    }
}

enum WatchDates {
    /// "14:05" today, "Tue" this week, "12 Oct" before.
    static func short(_ date: Date?, now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date else { return "" }
        if calendar.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if let days = calendar.dateComponents([.day], from: date, to: now).day, days < 7 {
            return date.formatted(.dateTime.weekday(.abbreviated))
        }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

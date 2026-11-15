import SwiftUI

/// Inboxies for Apple Watch (AVE-144): the active mailbox's Inbox, a plain-text
/// message view, the phone notification actions and quick reply. A companion, not
/// a standalone client: signing in, compose, settings and the rest stay on the phone.
@main
struct InboxiesWatchApp: App {
    @State private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(store)
                .task {
                    store.start()
                    WatchBackgroundRefresh.schedule()
                }
        }
        // The complication (AVE-146): the phone's new-mail push arrives as complication
        // user info, and app refresh is the timeline budget. Both read the Inbox with
        // the watch session and reload the widget if the count changed.
        .backgroundTask(.watchConnectivity) {
            await store.refreshInBackground()
        }
        .backgroundTask(.appRefresh(WatchBackgroundRefresh.identifier)) {
            await store.refreshInBackground()
        }
    }
}

/// House spring (`inboxies-ios-ui`), for the few motions we add ourselves.
extension Animation {
    static let inboxies = Animation.spring(response: 0.32, dampingFraction: 0.86)
}

struct WatchRootView: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch store.connection {
            case .needsPhone(let message):
                WatchConnectView(message: message)
            case .connected, .connecting:
                // Reconnecting quietly after a 401 keeps the Inbox (and the open message) up.
                if store.connection == .connected || !store.mailboxes.isEmpty {
                    WatchInboxView()
                } else {
                    WatchConnectView(message: nil)
                }
            }
        }
        .tint(WatchPalette.accent)
        .animation(.inboxies, value: store.connection)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.retryNowIfDisconnected() }
        }
    }
}

/// No session on the watch: the phone hands one over (the watch asks it quietly, with
/// retries), or, once those have run out, the person taps Connect.
struct WatchConnectView: View {
    @Environment(WatchStore.self) private var store
    let message: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Image(systemName: "iphone")
                    .font(.system(size: 26, weight: .regular))
                    .foregroundStyle(WatchPalette.muted)
                    .padding(.top, 6)
                Text("Inboxies")
                    .font(WatchType.title)
                    .foregroundStyle(WatchPalette.ink)
                if let message {
                    Text(message)
                        .font(WatchType.subject)
                        .foregroundStyle(WatchPalette.muted)
                        .multilineTextAlignment(.center)
                    Button {
                        Task { await store.connect() }
                    } label: {
                        Text("Connect")
                            .font(WatchType.action)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(WatchPillButtonStyle(role: .primary))
                    .padding(.top, 4)
                } else {
                    ProgressView()
                        .tint(WatchPalette.muted)
                    Text("Connecting to your iPhone…")
                        .font(WatchType.subject)
                        .foregroundStyle(WatchPalette.muted)
                }
            }
            .padding(.horizontal, 4)
        }
        .background(WatchPalette.background.ignoresSafeArea())
    }
}

/// Inboxies pills: `pillFill` capsules, the primary action in accent text on a soft
/// accent capsule (the phone's toast action), Report spam in red text.
struct WatchPillButtonStyle: ButtonStyle {
    enum Role {
        case primary
        case standard
        case destructive
    }

    var role: Role = .standard

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(foreground)
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: Capsule())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }

    private var foreground: Color {
        switch role {
        case .primary: return WatchPalette.accent
        case .standard: return WatchPalette.ink
        case .destructive: return WatchPalette.destructive
        }
    }

    private var background: Color {
        switch role {
        case .primary: return WatchPalette.accent.opacity(0.16)
        case .standard, .destructive: return WatchPalette.pillFill
        }
    }
}

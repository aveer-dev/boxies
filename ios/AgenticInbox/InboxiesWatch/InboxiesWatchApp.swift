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
                .task { store.start() }
        }
    }
}

/// Inter on the watch (bundled; the phone's `Font.inter` lives in `AppTheme`, which
/// is UIKit-only). Sizes are the phone list's, nudged for the wrist.
enum WatchType {
    static func inter(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Inter-Bold"
        case .semibold: name = "Inter-SemiBold"
        case .medium: name = "Inter-Medium"
        default: name = "Inter-Regular"
        }
        return .custom(name, size: size)
    }

    static let title = inter(16, .semibold)
    static let sender = inter(15, .semibold)
    static let senderRead = inter(15, .medium)
    static let subject = inter(13)
    static let preview = inter(12)
    static let meta = inter(11)
    static let body = inter(14)
    static let action = inter(14, .medium)
}

/// House spring (`inboxies-ios-ui`), for the few motions we add ourselves.
extension Animation {
    static let inboxies = Animation.spring(response: 0.32, dampingFraction: 0.86)
}

struct WatchRootView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        Group {
            switch store.connection {
            case .connected:
                WatchInboxView()
            case .connecting:
                WatchConnectView(message: nil)
            case .needsPhone(let message):
                WatchConnectView(message: message)
            }
        }
        .tint(WatchPalette.accent)
        .animation(.inboxies, value: store.connection)
    }
}

/// No session on the watch: the phone hands one over, or the person taps Connect.
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

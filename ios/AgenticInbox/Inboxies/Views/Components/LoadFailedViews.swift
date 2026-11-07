import SwiftUI

/// Signed in, but the first mailbox request failed and nothing is cached.
/// Never onboarding: the account may well have mailboxes we just couldn't reach.
struct MailboxLoadFailedView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @State private var isRetrying = false

    var body: some View {
        LoadFailedContent(
            title: "Couldn’t load your mailboxes",
            message: app.errorMessage,
            isRetrying: isRetrying,
            onRetry: retry
        ) {
            Button("Sign out") {
                app.signOut(auth: auth)
            }
            .font(.inter(size: 14, weight: .medium))
            .foregroundStyle(AppTheme.muted)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
    }

    private func retry() {
        guard !isRetrying else { return }
        isRetrying = true
        Task {
            await app.refreshMailboxes(showLoading: true)
            isRetrying = false
        }
    }
}

/// Calm full-screen error with Retry, shared by the mailbox gate and empty lists.
struct LoadFailedContent<Extra: View>: View {
    let title: String
    var message: String?
    var isRetrying = false
    let onRetry: () -> Void
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: "wifi.exclamationmark")
        } description: {
            Text(message ?? "Check your connection and try again.")
        } actions: {
            VStack(spacing: 8) {
                Button(action: onRetry) {
                    HStack(spacing: 6) {
                        if isRetrying {
                            ProgressView()
                                .controlSize(.small)
                                .tint(AppTheme.background)
                        }
                        Text("Retry")
                    }
                    .font(.inter(size: 14, weight: .semibold))
                    // `.borderedProminent` draws its label white, which vanishes on the
                    // near-white dark-mode `ink` fill. Match the spinner: label = background.
                    .foregroundStyle(AppTheme.background)
                    .frame(minWidth: 96)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.ink)
                .disabled(isRetrying)
                extra()
            }
        }
    }
}

extension LoadFailedContent where Extra == EmptyView {
    init(title: String, message: String?, isRetrying: Bool = false, onRetry: @escaping () -> Void) {
        self.init(title: title, message: message, isRetrying: isRetrying, onRetry: onRetry) { EmptyView() }
    }
}

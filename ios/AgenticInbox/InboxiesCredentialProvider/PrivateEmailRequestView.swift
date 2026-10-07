import SwiftUI
import UIKit

/// State for one AutoFill request: create a private email, then insert or copy it.
@Observable
@MainActor
final class PrivateEmailRequest {
    enum Mode {
        /// iOS 18+ text insertion: the address goes straight into the field.
        case insertText
        /// Password-list flow: nothing to insert into, so copy to the pasteboard.
        case copyToPasteboard
    }

    enum Phase: Equatable {
        case ready
        case creating
        case copied(String)
        case failed(String)
        case signedOut
    }

    private(set) var mode: Mode = .copyToPasteboard
    private(set) var host: String?
    private(set) var phase: Phase

    var onInsert: ((String) -> Void)?
    var onCancel: (() -> Void)?

    init() {
        phase = PrivateEmailClient.isSignedIn ? .ready : .signedOut
    }

    func configure(mode: Mode, host: String?) {
        self.mode = mode
        self.host = host
        phase = PrivateEmailClient.isSignedIn ? .ready : .signedOut
    }

    func create() {
        guard phase != .creating else { return }
        phase = .creating
        Task {
            do {
                let address = try await PrivateEmailClient.createAlias(label: host)
                switch mode {
                case .insertText:
                    onInsert?(address)
                case .copyToPasteboard:
                    UIPasteboard.general.string = address
                    phase = .copied(address)
                }
            } catch PrivateEmailClient.Failure.signedOut {
                phase = .signedOut
            } catch {
                phase = .failed(error.localizedDescription)
            }
        }
    }

    func cancel() {
        onCancel?()
    }
}

/// AutoFill sheet in the app's chrome: Inter, AppTheme tokens, xmark close.
struct PrivateEmailRequestView: View {
    let model: PrivateEmailRequest

    private var title: String {
        if let host = model.host {
            return "Create private email for \(host)"
        }
        return "Create private email"
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                header
                content
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(AppTheme.background)
            .navigationTitle("Private email")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        model.cancel()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .font(.inter(size: 14))
        .tint(AppTheme.accent)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.inter(size: 22, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
            Text(title)
                .font(.inter(size: AppTheme.FontSize.largeTitle, weight: .bold))
                .foregroundStyle(AppTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("A random address on your domain that delivers to your Inboxies mailbox. Your real address stays private.")
                .font(.inter(size: 13))
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .signedOut:
            Text("Open Inboxies and sign in first")
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(AppTheme.ink)
            primaryButton("Done") { model.cancel() }
        case .ready:
            primaryButton("Create") { model.create() }
        case .creating:
            primaryButton("Create", isBusy: true) {}
        case .failed(let message):
            Text(message)
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.deepDarkRed)
                .fixedSize(horizontal: false, vertical: true)
            primaryButton("Try Again") { model.create() }
        case .copied(let address):
            copiedCard(address)
            primaryButton("Done") { model.cancel() }
        }
    }

    private func copiedCard(_ address: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Copied", systemImage: "checkmark.circle.fill")
                .font(.inter(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.accent)
            Text(address)
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .textSelection(.enabled)
            Text("Paste it into the email field.")
                .font(.inter(size: 13))
                .foregroundStyle(AppTheme.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(AppTheme.line, lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Copied \(address). Paste it into the email field.")
    }

    private func primaryButton(_ title: String, isBusy: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .opacity(isBusy ? 0 : 1)
                if isBusy {
                    ProgressView()
                        .tint(.white)
                }
            }
            .font(.inter(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(AppTheme.accent, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .accessibilityLabel(isBusy ? "Creating private email" : title)
    }
}

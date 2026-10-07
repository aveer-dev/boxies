import AuthenticationServices
import SwiftUI
import UIKit

/// AutoFill entry point: creates a private email through the Inboxies API.
/// iOS 18+ inserts it into the focused field; the password-list flow copies it.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let model = PrivateEmailRequest()

    override func viewDidLoad() {
        super.viewDidLoad()
        // Registers the bundled Inter fonts (no UIAppFonts here) and Inter nav chrome.
        AppTheme.configureGlobalAppearance()
        view.backgroundColor = AppTheme.uiBackground

        model.onInsert = { [weak self] text in self?.insert(text) }
        model.onCancel = { [weak self] in self?.cancel() }

        let host = UIHostingController(rootView: PrivateEmailRequestView(model: model))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }

    /// Password-list flow (from the QuickType bar). There is no text-insertion
    /// path here and an empty-password credential is not allowed, so the new
    /// address is copied to the pasteboard and the request is cancelled on Done.
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.configure(mode: .copyToPasteboard, host: Self.host(from: serviceIdentifiers))
    }

    /// iOS 18+: AutoFill → Inboxies from a text field's edit menu.
    @available(iOS 18.0, *)
    override func prepareInterfaceForUserChoosingTextToInsert() {
        model.configure(mode: .insertText, host: nil)
    }

    private func insert(_ text: String) {
        if #available(iOS 18.0, *) {
            extensionContext.completeRequest(withTextToInsert: text, completionHandler: nil)
        } else {
            cancel()
        }
    }

    private func cancel() {
        extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
    }

    /// First service identifier as a bare host (`https://www.shop.com/signup` → `shop.com`).
    private static func host(from identifiers: [ASCredentialServiceIdentifier]) -> String? {
        for identifier in identifiers {
            let raw = identifier.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty else { continue }
            var host: String
            switch identifier.type {
            case .URL:
                host = URL(string: raw)?.host ?? raw
            default:
                host = raw
            }
            host = host.lowercased()
            if host.hasPrefix("www.") {
                host.removeFirst(4)
            }
            if !host.isEmpty { return host }
        }
        return nil
    }
}

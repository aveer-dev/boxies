import AuthenticationServices
import SwiftUI
import UIKit

/// AutoFill entry point: pick or create a private email, then type it into
/// the focused field. Both iOS entry points land here: the password list
/// (QuickType bar), which names the site, and iOS 18+'s edit-menu text
/// insertion, which doesn't.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let model = PrivateEmailRequest()

    override func viewDidLoad() {
        super.viewDidLoad()
        // Registers the bundled Inter fonts (no UIAppFonts here) and Inter nav chrome.
        AppTheme.configureGlobalAppearance()
        view.backgroundColor = AppTheme.uiBackground

        model.onFill = { [weak self] address in self?.fill(address) }
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

    /// Password-list flow (QuickType bar → Inboxies): the site is known.
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        model.configure(host: Self.host(from: serviceIdentifiers))
    }

    /// iOS 18+: AutoFill → Passwords → Inboxies from a field's edit menu. iOS
    /// passes no site here, so there are no suggestions, only the full list.
    @available(iOS 18.0, *)
    override func prepareInterfaceForUserChoosingTextToInsert() {
        model.configure(host: nil)
    }

    private func fill(_ address: String) {
        if #available(iOS 18.0, *) {
            // Text insertion works from both flows and types into the focused
            // field. A password credential doesn't: Safari puts its *password*
            // into the focused field and ignores the username.
            extensionContext.completeRequest(withTextToInsert: address, completionHandler: nil)
        } else {
            // iOS 17 has no text insertion, so the address goes on the pasteboard.
            UIPasteboard.general.string = address
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

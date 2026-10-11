import AuthenticationServices
import CoreText
import SwiftUI

/// Private email AutoFill. The user confirms a label and mailbox, the server
/// creates a real forwarding address, and the system fills it in.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private enum Request {
        /// A password form: the address goes in the username field.
        case credential
        /// iOS 18+: AutoFill → Inboxies from a text field's edit menu.
        case text
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        Self.registerInterFromContainingApp
        view.backgroundColor = AppTheme.uiBackground
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        present(.credential, suggestedLabel: serviceIdentifiers.first.map(Self.siteName))
    }

    @available(iOS 18.0, *)
    override func prepareInterfaceForUserChoosingTextToInsert() {
        present(.text, suggestedLabel: nil)
    }

    private func present(_ request: Request, suggestedLabel: String?) {
        let model = PrivateEmailAutofillModel(
            suggestedLabel: suggestedLabel,
            complete: { [weak self] address in self?.finish(request, address: address) },
            cancel: { [weak self] in self?.cancel() }
        )
        let host = UIHostingController(rootView: PrivateEmailAutofillView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    private func finish(_ request: Request, address: String) {
        switch request {
        case .credential:
            // Inboxies only supplies the address; there is no password to fill.
            let credential = ASPasswordCredential(user: address, password: "")
            extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
        case .text:
            if #available(iOS 18.0, *) {
                extensionContext.completeRequest(withTextToInsert: address, completionHandler: nil)
            }
        }
    }

    private func cancel() {
        let error = NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue)
        extensionContext.cancelRequest(withError: error)
    }

    /// `example.com` for both `example.com` and `https://www.example.com/signup`.
    private static func siteName(_ identifier: ASCredentialServiceIdentifier) -> String {
        let raw = identifier.identifier
        let host = identifier.type == .URL ? (URL(string: raw)?.host ?? raw) : raw
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// The extension ships no font files. It registers the Inter files bundled in
    /// Inboxies.app, two levels up from `PlugIns/InboxiesCredentialProvider.appex`.
    private static let registerInterFromContainingApp: Void = {
        let appBundle = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
        for name in ["Inter-Regular", "Inter-Medium", "Inter-SemiBold", "Inter-Bold", "Inter-Italic"] {
            let url = appBundle.appendingPathComponent("\(name).ttf")
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()
}

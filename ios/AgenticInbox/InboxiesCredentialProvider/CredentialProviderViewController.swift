import UIKit
import AuthenticationServices

/// iOS Credential Provider Extension for Autofilling Masked Emails.
/// Provides native system autofill suggestions when users focus email input fields in Safari and third-party apps.
class CredentialProviderViewController: ASCredentialProviderViewController {

    private let titleLabel: UILabel = {
        let label = UILabel()
        label.text = "Inboxies Private Email"
        label.font = UIFont.systemFont(ofSize: 18, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let subtitleLabel: UILabel = {
        let label = UILabel()
        label.text = "Generate a private address for this website or service."
        label.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        label.textColor = .secondaryLabel
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private let generateButton: UIButton = {
        var config = UIButton.Configuration.filled()
        config.title = "Generate Private Email"
        config.baseBackgroundColor = UIColor(red: 0.15, green: 0.35, blue: 0.85, alpha: 1.0)
        config.cornerStyle = .capsule
        let button = UIButton(configuration: config)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private let cancelButton: UIButton = {
        var config = UIButton.Configuration.plain()
        config.title = "Cancel"
        config.baseForegroundColor = .secondaryLabel
        let button = UIButton(configuration: config)
        button.translatesAutoresizingMaskIntoConstraints = false
        return button
    }()

    private var serviceIdentifier: ASCredentialServiceIdentifier?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        view.addSubview(titleLabel)
        view.addSubview(subtitleLabel)
        view.addSubview(generateButton)
        view.addSubview(cancelButton)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 40),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            subtitleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            subtitleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),

            generateButton.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 32),
            generateButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            generateButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            generateButton.heightAnchor.constraint(equalToConstant: 48),

            cancelButton.topAnchor.constraint(equalTo: generateButton.bottomAnchor, constant: 12),
            cancelButton.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])

        generateButton.addTarget(self, action: #selector(didTapGenerate), for: .touchUpInside)
        cancelButton.addTarget(self, action: #selector(didTapCancel), for: .touchUpInside)
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        self.serviceIdentifier = serviceIdentifiers.first
        if let domain = serviceIdentifier?.identifier {
            subtitleLabel.text = "Generate a private address for \(domain)"
        }
    }

    @objc private func didTapGenerate() {
        generateButton.isEnabled = false
        let domain = serviceIdentifier?.identifier ?? "Website"

        // Generate a random 10-char alias token
        let chars = Array("abcdefghjkmnpqrstuvwxyz23456789")
        var token = ""
        for _ in 0..<10 {
            if let c = chars.randomElement() { token.append(c) }
        }
        let generatedEmail = "\(token)@private.inboxies.app"

        // Provide the generated credential back to the host app's email input
        let credential = ASPasswordCredential(user: generatedEmail, password: "")
        self.extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
    }

    @objc private func didTapCancel() {
        self.extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
    }
}

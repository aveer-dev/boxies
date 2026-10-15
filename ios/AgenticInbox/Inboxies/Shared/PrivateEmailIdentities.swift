import AuthenticationServices
import Foundation

/// QuickType suggestions: private emails labelled with a site's host are
/// registered in the AutoFill identity store, so iOS offers them above the
/// keyboard on that site and fills one with a tap, without opening the
/// extension's sheet (compiled into both targets).
///
/// The store holds a snapshot of the active mailbox's usable private emails.
/// The app replaces it whenever it loads or edits them and clears it on
/// sign-out; the extension replaces it after listing and adds what it creates.
enum PrivateEmailIdentities {
    /// One identity per usable private email whose label is a site host.
    /// Newest first in, highest rank out, so the newest wins the bar.
    static func identities(for emails: [PrivateEmail], now: Date = Date()) -> [ASPasswordCredentialIdentity] {
        let usable = emails.filter { $0.isUsable(now: now) }
        return usable.enumerated().compactMap { index, email in
            guard let domain = serviceDomain(forLabel: email.label) else { return nil }
            let identity = ASPasswordCredentialIdentity(
                serviceIdentifier: ASCredentialServiceIdentifier(identifier: domain, type: .domain),
                user: email.address,
                recordIdentifier: email.id
            )
            identity.rank = usable.count - index
            return identity
        }
    }

    /// The registrable domain when a label names a site (`signup.shop.co.uk`,
    /// `https://shop.com/join`); nil for free-form labels like "Netflix".
    static func serviceDomain(forLabel label: String?) -> String? {
        guard var host = label?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !host.isEmpty else { return nil }
        if host.contains("://"), let urlHost = URL(string: host)?.host {
            host = urlHost
        }
        if host.hasSuffix(".") { host.removeLast() }
        let allowed = host.unicodeScalars.allSatisfy {
            ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "." || $0 == "-"
        }
        guard allowed else { return nil }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        // `localhost` is the one bare name; everything else needs a letter TLD (no IPs).
        if parts.count == 1 {
            return host == "localhost" ? host : nil
        }
        guard parts.allSatisfy({ !$0.isEmpty }),
              let tld = parts.last, tld.count >= 2, tld.allSatisfy(\.isLetter) else { return nil }
        return PrivateEmailMatcher(host: host)?.domain
    }

    /// Replaces the whole store. No-op while Inboxies isn't the enabled AutoFill
    /// provider (the store rejects writes then); the next launch or AutoFill
    /// sheet after enabling it fills the store.
    static func replace(with emails: [PrivateEmail]) async {
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }
        try? await store.replaceCredentialIdentities(identities(for: emails))
    }

    /// Adds one new private email without waiting for the next full list.
    static func add(_ email: PrivateEmail) async {
        let entries = identities(for: [email])
        guard !entries.isEmpty else { return }
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }
        try? await store.saveCredentialIdentities(entries)
    }

    /// Sign-out: nothing of this account stays in the keyboard.
    static func removeAll() async {
        let store = ASCredentialIdentityStore.shared
        guard await store.state().isEnabled else { return }
        try? await store.removeAllCredentialIdentities()
    }
}

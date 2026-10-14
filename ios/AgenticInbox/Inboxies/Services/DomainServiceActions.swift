import AuthenticationServices
import Foundation

/// When a custom domain's subscription ends its mailboxes turn read-only. This keeps
/// that state in sync and runs renew / keep for domain admins.
extension AppModel {
    /// After a mailbox GET: fetch the full service summary (with `canManage`) only when
    /// there is something to show — ended (read-only) or set to end.
    func syncDomainService(for mailbox: Mailbox) {
        let domain = mailbox.domain
        guard !domain.isEmpty else { return }
        if mailbox.isReadOnly || mailbox.service?.isEnding == true {
            Task { await refreshDomainService(domain) }
        } else {
            domainServices[domain] = nil
        }
    }

    @discardableResult
    func refreshDomainService(_ domain: String) async -> DomainService? {
        guard !isDebugPreview else { return domainServices[domain] }
        do {
            let service = try await APIClient.shared.getDomainService(domain: domain)
            domainServices[domain] = service
            return service
        } catch {
            // 403 for people without a mailbox on the domain; the banner falls back
            // to the mailbox's own summary.
            return domainServices[domain]
        }
    }

    /// A write came back `service_ended`. Mark the domain's mailboxes read-only and say
    /// so once; repeats for a domain already known to be read-only stay quiet.
    func markServiceEnded(domain: String?, message: String) {
        guard let domain = domain?.lowercased(), !domain.isEmpty else { return }
        var newlyReadOnly = false
        for index in mailboxes.indices where mailboxes[index].domain == domain && !mailboxes[index].isReadOnly {
            mailboxes[index].readOnly = true
            newlyReadOnly = true
        }
        guard newlyReadOnly else { return }
        let text = message.isEmpty
            ? "The subscription for \(domain) has ended. Mail on it is read-only."
            : message
        showToast(text, isError: true, duration: 5)
        Task {
            await refreshDomainService(domain)
            // Undo optimistic moves / deletes the server refused.
            await refreshCurrentTabSilently()
        }
    }

    /// Calm fallback when a blocked action slips past the hidden entry points.
    func showReadOnlyNotice() {
        let domain = selectedMailbox?.domain ?? "this domain"
        showToast("Mail on \(domain) is read-only until the subscription is renewed.", duration: 3.5)
    }

    // MARK: - Renew / keep

    /// Domain admins: keeps a subscription that is set to end, or renews an ended one
    /// through Stripe Checkout in an in-app browser.
    func renewDomain(_ domain: String) async {
        guard renewingDomain == nil else { return }
        if isDebugPreview {
            showToast("Renewal isn't available in previews.")
            return
        }
        renewingDomain = domain
        defer { renewingDomain = nil }
        do {
            let response = try await APIClient.shared.renewDomain(domain: domain)
            if response.resumed == true {
                if let service = response.service {
                    var merged = service
                    merged.canManage = domainServices[domain]?.canManage ?? true
                    domainServices[domain] = merged
                }
                showToast("Subscription kept. Service for \(domain) continues.")
                await refreshDomainService(domain)
                await refreshMailboxes(showLoading: false)
            } else if let raw = response.checkoutUrl, let url = URL(string: raw) {
                startRenewalCheckout(url: url, domain: domain)
            } else if response.renewed == true {
                await completeRenewal(domain: domain)
            } else {
                await refreshDomainService(domain)
            }
        } catch {
            showToast(error.localizedDescription, isError: true, duration: 5)
            await refreshDomainService(domain)
        }
    }

    private func startRenewalCheckout(url: URL, domain: String) {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "inboxies") { [weak self] callbackUrl, error in
            Task { @MainActor in
                guard let self else { return }
                self.renewalAuthSession = nil
                if let callbackUrl {
                    await self.handleRenewalCallback(PaymentCallback.parse(callbackUrl), fallbackDomain: domain)
                } else if let error {
                    let nsError = error as NSError
                    if nsError.code != ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        self.showToast(error.localizedDescription, isError: true, duration: 5)
                    }
                }
            }
        }
        session.presentationContextProvider = WebAuthPresenter.shared
        session.prefersEphemeralWebBrowserSession = false
        renewalAuthSession = session
        session.start()
    }

    /// Billing deep links (`inboxies://billing/…`) from the in-app browser or `onOpenURL`.
    func handleRenewalCallback(_ callback: PaymentCallback, fallbackDomain: String? = nil) async {
        switch callback {
        case .renewed(let domain):
            guard let domain = domain ?? fallbackDomain ?? selectedMailbox?.domain else { return }
            await completeRenewal(domain: domain)
        case .renewCancelled(let domain):
            let name = domain ?? fallbackDomain ?? "the domain"
            showToast("Renewal cancelled. Nothing was charged for \(name).")
        default:
            break
        }
    }

    /// Paid: the webhook restores the domain within seconds. Poll the service briefly,
    /// then reload mailboxes so read-only clears.
    func completeRenewal(domain: String) async {
        guard restoringDomain != domain else { return }
        restoringDomain = domain
        defer { restoringDomain = nil }
        showToast("Payment received. Restoring \(domain)…", isLoading: true, duration: 0)

        var restored = false
        for _ in 0..<10 {
            if let service = try? await APIClient.shared.getDomainService(domain: domain) {
                domainServices[domain] = service
                if !service.isEnded {
                    restored = true
                    break
                }
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }

        await refreshMailboxes(showLoading: false)
        if restored {
            showToast("\(domain) is renewed. Mail is back to normal.")
        } else {
            showToast("Payment received. \(domain) will be back in a moment; pull to refresh.", duration: 5)
        }
    }
}

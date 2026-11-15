import Foundation
import WatchConnectivity

/// iPhone side of the Apple Watch handoff (AVE-144, docs/watch-companion-plan.md
/// phase 2). The watch app talks to the Worker directly with its own `watch`-scoped
/// session; this mints that session from the app's full one and sends it over
/// WatchConnectivity. The app's full session never leaves the phone.
///
/// - After sign-in the watch gets one session without asking (`handOverIfNeeded`).
/// - Afterwards the phone mints only when the watch asks (`requestSession`). The
///   watch asks on its own whenever it has no session (first launch, a 401), with
///   a few retries (`WatchReconnector`), so a replaced or expired token heals
///   without the person doing anything.
/// - A revoke in Devices & sessions on this phone sticks: until the person taps
///   Connect on the watch (a `manual` request), the phone answers `revoked`.
/// - Sign-out cancels any queued token, tells the watch to wipe and hands back the
///   watch session's id so sign-out can end it on the server. The server also ends
///   it with the phone session (`parent_session_id`, AVE-143).
final class WatchSessionBridge: NSObject, WCSessionDelegate {
    static let shared = WatchSessionBridge()

    /// The last watch session minted here, for revoking it and matching it in
    /// Devices & sessions. Not a secret.
    private static let sessionIdKey = "watchSessionId"
    /// Set once the watch was handed a session since this sign-in, so launches don't
    /// re-mint (each mint replaces the watch's token). Cleared on sign-out.
    private static let handedOverKey = "watchSessionHandedOver"
    /// Set when the watch session was ended from this phone (Devices & sessions): the
    /// watch's automatic requests get `revoked` until a Connect tap. Cleared on sign-out.
    private static let revokedKey = "watchSessionRevoked"

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    var storedId: String? {
        UserDefaults.standard.string(forKey: Self.sessionIdKey).flatMap { $0.isEmpty ? nil : $0 }
    }

    private var isSignedIn: Bool {
        APIClient.shared.authToken?.isEmpty == false
    }

    /// App launch.
    func activate() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    // MARK: App hooks

    /// Signed in with a watch that has the app: hand it a session once per sign-in.
    func handOverIfNeeded() async {
        guard isSignedIn,
              !UserDefaults.standard.bool(forKey: Self.handedOverKey),
              let session, session.activationState == .activated,
              session.isPaired, session.isWatchAppInstalled,
              beginHandOver() else { return }
        defer { endHandOver() }
        guard case .grant(let grant) = await mint() else { return }
        send(grant, on: session)
    }

    /// Launch and WatchConnectivity activation both hand over; only one mints.
    private let handOverLock = NSLock()
    private var handingOver = false

    private func beginHandOver() -> Bool {
        handOverLock.withLock {
            if handingOver { return false }
            handingOver = true
            return true
        }
    }

    private func endHandOver() {
        handOverLock.withLock { handingOver = false }
    }

    /// Mirrors the active mailbox and API origin (no token) for the watch.
    func publish(mailboxId: String?, apiBaseURL: URL) {
        updateContext(WatchPhoneContext(signedIn: isSignedIn, mailboxId: mailboxId, apiBaseURL: apiBaseURL))
    }

    /// The watch's Inbox complication (AVE-146): a fresh count for one mailbox. `urgent`
    /// (a new-mail push) uses the complication budget (`transferCurrentComplicationUserInfo`,
    /// which wakes the watch app) when an Inboxies complication is on the face; otherwise
    /// it's queued as ordinary user info. Only the newest count is kept in the queue.
    func pushGlance(_ update: WatchGlanceUpdate, urgent: Bool) {
        guard isSignedIn, !UserDefaults.standard.bool(forKey: Self.revokedKey),
              let session, session.activationState == .activated,
              session.isPaired, session.isWatchAppInstalled else { return }
        for transfer in session.outstandingUserInfoTransfers
        where transfer.isTransferring && WatchHandoff.kind(of: transfer.userInfo) == .glance {
            transfer.cancel()
        }
        if urgent, session.isComplicationEnabled, session.remainingComplicationUserInfoTransfers > 0 {
            session.transferCurrentComplicationUserInfo(update.message)
        } else {
            session.transferUserInfo(update.message)
        }
    }

    /// Every sign-out path: cancels any queued token, tells the watch to wipe and
    /// returns the watch session's id so the caller can end it on the server.
    @discardableResult
    func forget() -> String? {
        let id = storedId
        UserDefaults.standard.removeObject(forKey: Self.sessionIdKey)
        UserDefaults.standard.removeObject(forKey: Self.handedOverKey)
        UserDefaults.standard.removeObject(forKey: Self.revokedKey)
        tellWatchToWipe()
        updateContext(WatchPhoneContext(signedIn: false, mailboxId: nil, apiBaseURL: nil))
        return id
    }

    /// The watch session was ended on the server from this phone (Devices & sessions).
    /// The watch wipes now; it gets a new session only when the person taps Connect
    /// (its automatic requests are answered `revoked`).
    func revokedOnServer() {
        UserDefaults.standard.removeObject(forKey: Self.sessionIdKey)
        UserDefaults.standard.set(true, forKey: Self.revokedKey)
        tellWatchToWipe()
    }

    // MARK: Minting

    private enum MintResult {
        case grant(WatchSessionGrant)
        case signedOut
        case unavailable
    }

    private func mint() async -> MintResult {
        guard isSignedIn else { return .signedOut }
        do {
            let minted = try await APIClient.shared.createWatchSession()
            UserDefaults.standard.set(minted.id, forKey: Self.sessionIdKey)
            UserDefaults.standard.set(true, forKey: Self.handedOverKey)
            return .grant(WatchSessionGrant(
                token: minted.token,
                apiBaseURL: AppConfig.apiBaseURL,
                mailboxId: SharedSession.activeMailboxId
            ))
        } catch APIError.sessionExpired {
            return .signedOut
        } catch APIError.http(let status, _) where status == 401 || status == 403 {
            return .signedOut
        } catch {
            return .unavailable
        }
    }

    // MARK: Sending

    private func send(_ grant: WatchSessionGrant, on session: WCSession) {
        // Only the newest token may be delivered later.
        cancelQueuedTransfers(on: session)
        if session.isReachable {
            session.sendMessage(grant.message, replyHandler: nil) { [weak self] _ in
                self?.queue(grant.message, on: session)
            }
        } else {
            queue(grant.message, on: session)
        }
    }

    private func queue(_ message: [String: Any], on session: WCSession) {
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        session.transferUserInfo(message)
    }

    private func tellWatchToWipe() {
        guard let session, session.activationState == .activated else { return }
        cancelQueuedTransfers(on: session)
        let clear = WatchHandoff.message(.clear)
        if session.isReachable {
            session.sendMessage(clear, replyHandler: nil, errorHandler: nil)
        }
        // Also queued, so a watch out of range wipes when it next connects.
        queue(clear, on: session)
    }

    /// A token still queued for the watch is dropped, so sign-out can't be followed
    /// by a late delivery of an old token.
    private func cancelQueuedTransfers(on session: WCSession) {
        for transfer in session.outstandingUserInfoTransfers where transfer.isTransferring {
            transfer.cancel()
        }
    }

    private func updateContext(_ context: WatchPhoneContext) {
        guard let session, session.activationState == .activated,
              session.isPaired, session.isWatchAppInstalled else { return }
        try? session.updateApplicationContext(context.message)
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        Task { await handOverIfNeeded() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // The person switched to another watch: talk to that one.
        session.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        Task { await handOverIfNeeded() }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        guard WatchHandoff.kind(of: message) == .requestSession else {
            replyHandler(WatchHandoff.message(.unavailable))
            return
        }
        let manual = WatchHandoff.isManualRequest(message)
        if !manual, UserDefaults.standard.bool(forKey: Self.revokedKey) {
            replyHandler(WatchHandoff.message(isSignedIn ? .revoked : .signedOut))
            return
        }
        Task {
            switch await mint() {
            case .grant(let grant):
                UserDefaults.standard.removeObject(forKey: Self.revokedKey)
                // A token from an earlier handoff must not land after this one.
                cancelQueuedTransfers(on: session)
                replyHandler(grant.message)
            case .signedOut:
                replyHandler(WatchHandoff.message(.signedOut))
            case .unavailable:
                replyHandler(WatchHandoff.message(.unavailable))
            }
        }
    }
}

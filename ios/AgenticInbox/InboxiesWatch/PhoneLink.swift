import Foundation
import WatchConnectivity

/// Watch side of the WatchConnectivity handoff (AVE-144). Receives the `watch`
/// session grant, wipe requests and the phone's non-secret context, and asks the
/// phone for a session. Everything is forwarded to `WatchStore` on the main actor.
final class PhoneLink: NSObject, WCSessionDelegate {
    private let onMessage: @MainActor ([String: Any]) -> Void
    private let onReachable: @MainActor () -> Void

    init(
        onMessage: @escaping @MainActor ([String: Any]) -> Void,
        onReachable: @escaping @MainActor () -> Void
    ) {
        self.onMessage = onMessage
        self.onReachable = onReachable
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// The phone's latest context, if one arrived before launch.
    var receivedContext: [String: Any] {
        WCSession.isSupported() ? WCSession.default.receivedApplicationContext : [:]
    }

    /// WatchConnectivity still has messages to hand over (a background wake).
    var hasContentPending: Bool {
        WCSession.isSupported() && WCSession.default.hasContentPending
    }

    /// Asks the iPhone app to mint a watch session (wakes it in the background).
    /// `manual`: the person tapped Connect.
    func requestSession(manual: Bool) async -> WatchSessionRequestResult {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated, session.isReachable else {
            return .unreachable
        }
        return await withCheckedContinuation { continuation in
            session.sendMessage(WatchHandoff.requestSession(manual: manual), replyHandler: { reply in
                if let grant = WatchSessionGrant(message: reply) {
                    continuation.resume(returning: .grant(grant))
                } else {
                    switch WatchHandoff.kind(of: reply) {
                    case .signedOut: continuation.resume(returning: .signedOut)
                    case .revoked: continuation.resume(returning: .revoked)
                    default: continuation.resume(returning: .unavailable)
                    }
                }
            }, errorHandler: { _ in
                continuation.resume(returning: .unreachable)
            })
        }
    }

    private func forward(_ message: [String: Any]) {
        let onMessage = onMessage
        Task { @MainActor in onMessage(message) }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        if !context.isEmpty { forward(context) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        forward(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forward(userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forward(message)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        let onReachable = onReachable
        Task { @MainActor in onReachable() }
    }
}

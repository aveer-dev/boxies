import Foundation

/// What the phone answered when the watch asked it for a session.
enum WatchSessionRequestResult: Equatable {
    case grant(WatchSessionGrant)
    /// No signed-in session on the phone. Retrying won't help.
    case signedOut
    /// The watch session was signed out from this phone (Devices & sessions) and the
    /// request wasn't a Connect tap. Retrying won't help.
    case revoked
    /// The phone isn't reachable right now.
    case unreachable
    /// The phone was reached but couldn't mint one (offline, server error).
    case unavailable
}

/// Silent reconnect for the watch (AVE-144): when the watch has no session (first
/// launch, a 401 after a revoke or a replaced token), it asks the phone for one a few
/// times with growing gaps, without the person doing anything. Stops at the first
/// grant, or as soon as the phone says it's signed out or the watch was revoked from
/// it, so a signed-out phone is never polled in a loop. Only after every attempt has
/// failed does the watch show Connect.
///
/// One run at a time: concurrent callers (launch, a 401 from the list and one from an
/// action, the phone becoming reachable) all await the same run, so the phone is asked
/// at most once per attempt. Compiled into the app too, for `WatchCompanionTests`.
@MainActor
final class WatchReconnector {
    enum Outcome: Equatable {
        case connected(WatchSessionGrant)
        /// The phone answered `signedOut` or `revoked`: stop and show Connect.
        case stopped(WatchSessionRequestResult)
        /// Every attempt came back unreachable / unavailable (the last answer).
        case gaveUp(WatchSessionRequestResult)
    }

    /// Wait before each attempt: now, then 2s, 5s, 10s, 20s, 30s (about a minute in all).
    static let defaultDelays: [Duration] = [.zero, .seconds(2), .seconds(5), .seconds(10), .seconds(20), .seconds(30)]

    typealias Request = @MainActor (_ manual: Bool) async -> WatchSessionRequestResult
    typealias Sleep = @MainActor (Duration) async throws -> Void

    let delays: [Duration]
    private let request: Request
    private let sleep: Sleep

    private var run: Task<Outcome, Never>?
    private var wait: Task<Void, Never>?
    /// `skipWait()` arrived mid-request: don't wait before the next attempt.
    private var skipNextWait = false
    /// A Connect tap joined the run: the remaining attempts are manual.
    private var manual = false

    /// Attempts made by the current or last run (tests).
    private(set) var attempts = 0

    var isRunning: Bool { run != nil }

    init(
        delays: [Duration] = WatchReconnector.defaultDelays,
        sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
        request: @escaping Request
    ) {
        precondition(!delays.isEmpty, "WatchReconnector needs at least one attempt")
        self.delays = delays
        self.sleep = sleep
        self.request = request
    }

    /// Starts a run, or joins the one in flight. `manual` (Connect) skips the current
    /// wait and marks the remaining requests as the person's, which lifts a revoke.
    func reconnect(manual: Bool = false) async -> Outcome {
        if manual {
            self.manual = true
            skipWait()
        }
        if let run { return await run.value }
        attempts = 0
        skipNextWait = false
        let task = Task { await self.attemptAll() }
        run = task
        let outcome = await task.value
        run = nil
        self.manual = false
        return outcome
    }

    /// The phone just became reachable or the app came forward: try now instead of
    /// finishing the current wait.
    func skipWait() {
        guard run != nil else { return }
        if let wait {
            wait.cancel()
        } else {
            skipNextWait = true
        }
    }

    private func attemptAll() async -> Outcome {
        var last = WatchSessionRequestResult.unreachable
        for delay in delays {
            if delay > .zero { await pause(delay) }
            var result: WatchSessionRequestResult
            repeat {
                let asked = manual
                attempts += 1
                result = await request(asked)
                // A Connect tap that joined during an automatic request asks again as the
                // person, which is what lifts a revoke.
                if result == .revoked, !asked, manual { continue }
                break
            } while true
            switch result {
            case .grant(let grant):
                return .connected(grant)
            case .signedOut, .revoked:
                return .stopped(result)
            case .unreachable, .unavailable:
                last = result
            }
        }
        return .gaveUp(last)
    }

    private func pause(_ delay: Duration) async {
        if skipNextWait {
            skipNextWait = false
            return
        }
        let sleep = sleep
        let task = Task { _ = try? await sleep(delay) }
        wait = task
        await task.value
        wait = nil
    }
}

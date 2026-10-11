import Foundation
import UIKit

/// Real-time event streaming and adaptive polling client for Inboxies.
/// Maintains a persistent Server-Sent Events (SSE) stream or low-latency adaptive polling
/// to deliver incoming emails to the device the exact instant they arrive on the server.
final class RealTimeStreamClient: @unchecked Sendable {
    static let shared = RealTimeStreamClient()

    private var activeTask: Task<Void, Never>?
    private var pollingTask: Task<Void, Never>?
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var currentMailboxId: String?

    var onNewEmailReceived: (@Sendable (Email) -> Void)?
    var onSyncRequested: (@Sendable () -> Void)?

    private lazy var streamSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        // Give the SSE stream a 120-second timeout interval for request chunks so that
        // server heartbeats (: ping\n\n every 15s) easily maintain connectivity,
        // and keep resource timeout open for long sessions.
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = TimeInterval(7 * 24 * 60 * 60)
        return URLSession(configuration: configuration)
    }()

    private init() {
        setupLifecycleObservers()
    }

    deinit {
        for observer in lifecycleObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        streamSession.finishTasksAndInvalidate()
    }

    func start(mailboxId: String) {
        if currentMailboxId == mailboxId && activeTask != nil { return }
        stop()
        currentMailboxId = mailboxId

        // 1. Start persistent SSE stream
        activeTask = Task { [weak self, mailboxId] in
            await self?.runEventStream(mailboxId: mailboxId)
        }

        // 2. Adaptive safety-net polling every 20 seconds while app is active
        pollingTask = Task { [weak self, mailboxId] in
            await self?.runAdaptivePolling(mailboxId: mailboxId)
        }
    }

    func stop() {
        activeTask?.cancel()
        activeTask = nil
        pollingTask?.cancel()
        pollingTask = nil
        currentMailboxId = nil
    }

    // MARK: - App Lifecycle Handlers

    private func setupLifecycleObservers() {
        let center = NotificationCenter.default
        let bg = center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pauseForBackground()
        }
        let fg = center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.resumeForForeground()
        }
        lifecycleObservers = [bg, fg]
    }

    private func pauseForBackground() {
        activeTask?.cancel()
        activeTask = nil
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func resumeForForeground() {
        guard let mailboxId = currentMailboxId else { return }
        activeTask?.cancel()
        pollingTask?.cancel()

        activeTask = Task { [weak self, mailboxId] in
            await self?.runEventStream(mailboxId: mailboxId)
        }
        pollingTask = Task { [weak self, mailboxId] in
            await self?.runAdaptivePolling(mailboxId: mailboxId)
        }
        onSyncRequested?()
    }

    // MARK: - Server-Sent Events (SSE) Stream

    private func runEventStream(mailboxId: String) async {
        var backoffSeconds: UInt64 = 2

        while !Task.isCancelled {
            do {
                guard let url = APIClient.makeURL(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/events") else { return }

                var request = URLRequest(url: url)
                request.timeoutInterval = 120
                request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                if let token = APIClient.shared.authToken {
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                }

                let (asyncBytes, response) = try await streamSession.bytes(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    try? await Task.sleep(nanoseconds: backoffSeconds * 1_000_000_000)
                    backoffSeconds = min(backoffSeconds * 2, 30)
                    continue
                }

                // Reset backoff on successful connection
                backoffSeconds = 2

                var eventName = "message"
                for try await line in asyncBytes.lines {
                    guard !Task.isCancelled else { break }

                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty { continue }

                    if trimmed.hasPrefix("event:") {
                        eventName = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                    } else if trimmed.hasPrefix("data:") {
                        let dataStr = String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        handleServerEvent(event: eventName, data: dataStr, mailboxId: mailboxId)
                        eventName = "message"
                    }
                }
            } catch {
                if Task.isCancelled || (error as? URLError)?.code == .cancelled { break }
                let isTimeout = (error as? URLError)?.code == .timedOut
                let sleepSeconds = isTimeout ? 1 : backoffSeconds
                try? await Task.sleep(nanoseconds: sleepSeconds * 1_000_000_000)
                if !isTimeout {
                    backoffSeconds = min(backoffSeconds * 2, 30)
                }
            }
        }
    }

    private func handleServerEvent(event: String, data: String, mailboxId: String) {
        // Heartbeat or connection confirmation: ignore to prevent unnecessary full mailbox fetches
        if event == "ping" || event == "connected" { return }

        guard let jsonData = data.data(using: .utf8) else { return }

        if event == "new_email" || event == "message" {
            if let email = try? JSONDecoder().decode(Email.self, from: jsonData) {
                DatabaseService.shared.upsertEmails(mailboxId: mailboxId, emails: [email], defaultFolder: email.folderId ?? "inbox")
                onNewEmailReceived?(email)
                return
            }
        }

        // Generic update notification: trigger silent re-sync
        onSyncRequested?()
    }

    // MARK: - Adaptive Foreground Polling Fallback

    private func runAdaptivePolling(mailboxId: String) async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 20_000_000_000) // 20s
            guard !Task.isCancelled else { break }
            onSyncRequested?()
        }
    }
}

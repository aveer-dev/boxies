import Foundation
import UIKit
import UserNotifications
import Observation

struct PushDeepLink: Equatable {
    let mailboxId: String
    let emailId: String
    let folderId: String
}

/// A widget tap outside the cards (AVE-149): open this mailbox's Inbox. `id` makes a
/// second tap on the same mailbox a new request.
struct PendingInboxLink: Equatable {
    let id = UUID()
    let mailboxId: String?
}

/// Coordinates Apple Push Notification registration, device token persistence,
/// and synchronization with the Cloudflare backend.
///
/// Policy (same as Android): while notifications are on, the device token is
/// registered for **every** mailbox the signed-in user has, not only the one on
/// screen, and unregistered from all of them when notifications are turned off
/// or the user signs out.
@Observable
@MainActor
final class PushNotificationManager {
    static let shared = PushNotificationManager()

    private let tokenStorageKey = "apns_device_token_hex"
    private(set) var deviceToken: String?
    private(set) var isRegistered = false
    /// The signed-in user's mailboxes (the token is registered for each).
    private var knownMailboxIds: Set<String> = []
    /// Mailboxes `deviceToken` was registered for in this process.
    private var registeredMailboxIds: Set<String> = []
    /// Set when the user taps a push; consumed by RootView once the app is ready.
    var pendingDeepLink: PushDeepLink?
    /// Set by a "Today's inbox" widget tap outside the cards; consumed like `pendingDeepLink`.
    var pendingInboxLink: PendingInboxLink?

    init() {
        self.deviceToken = UserDefaults.standard.string(forKey: tokenStorageKey)
    }

    private var isEnabled: Bool {
        UserDefaults.standard.object(forKey: "push_notifications_enabled") as? Bool ?? true
    }

    /// Remember the user's mailboxes and, when notifications are on, ask for
    /// permission and register the device token for each one not registered yet.
    func requestPermissionAndRegister(mailboxIds: [String]) {
        knownMailboxIds = Set(mailboxIds.filter { !$0.isEmpty })
        guard isEnabled, !knownMailboxIds.isEmpty else { return }

        // If we already have a token, sync it immediately
        if let token = deviceToken {
            syncToken(token)
        }

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            Task { @MainActor in
                print("[PushManager] Notification permission status: \(granted), error: \(String(describing: error))")
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    func handleTokenReceived(data: Data) {
        let hexString = data.map { String(format: "%02.2hhx", $0) }.joined()
        print("[PushManager] Received APNs device token: \(hexString)")
        if hexString != deviceToken {
            // Registrations were for the old token; the server prunes it on APNs' 410.
            registeredMailboxIds.removeAll()
        }
        self.deviceToken = hexString
        self.isRegistered = true
        UserDefaults.standard.set(hexString, forKey: tokenStorageKey)

        guard isEnabled else { return }
        syncToken(hexString)
    }

    func handleRegistrationError(_ error: Error) {
        print("[PushManager] Failed to register for remote notifications: \(error.localizedDescription)")
        self.isRegistered = false
    }

    private func syncToken(_ token: String) {
        for mailboxId in knownMailboxIds.subtracting(registeredMailboxIds) {
            // Claim up front so overlapping calls don't double-POST; release on failure.
            registeredMailboxIds.insert(mailboxId)
            Task {
                do {
                    try await APIClient.shared.registerDeviceToken(mailboxId: mailboxId, token: token)
                    print("[PushManager] ✓ Device token registered for mailbox \(mailboxId)")
                } catch {
                    registeredMailboxIds.remove(mailboxId)
                    print("[PushManager] ✗ Failed to register device token for \(mailboxId): \(error)")
                }
            }
        }
    }

    /// Settings toggle off: unregister this device from every mailbox (not just
    /// the selected one), so no mailbox keeps pushing to it.
    func unregisterToken(mailboxIds: [String]) {
        let targets = knownMailboxIds.union(registeredMailboxIds).union(mailboxIds)
        registeredMailboxIds.removeAll()
        guard let token = deviceToken else { return }
        Task {
            for mailboxId in targets {
                try? await APIClient.shared.unregisterDeviceToken(mailboxId: mailboxId, token: token)
            }
        }
    }

    /// Sign-out: stop pushes for every mailbox this device registered. Fire-and-forget;
    /// `sessionToken` keeps the requests authed after the local session is cleared.
    func unregisterAll(mailboxIds: [String], sessionToken: String?) {
        Task {
            await unregisterAllAndWait(mailboxIds: mailboxIds, sessionToken: sessionToken)
        }
    }

    func unregisterAllAndWait(mailboxIds: [String], sessionToken: String?) async {
        let targets = knownMailboxIds.union(registeredMailboxIds).union(mailboxIds)
        knownMailboxIds.removeAll()
        registeredMailboxIds.removeAll()
        guard let token = deviceToken, !targets.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            for mailboxId in targets {
                group.addTask {
                    try? await APIClient.shared.unregisterDeviceToken(
                        mailboxId: mailboxId,
                        token: token,
                        sessionToken: sessionToken
                    )
                }
            }
        }
    }

    func handleNotificationTap(userInfo: [AnyHashable: Any]) {
        guard let mailboxId = userInfo["mailboxId"] as? String, !mailboxId.isEmpty,
              let emailId = userInfo["emailId"] as? String, !emailId.isEmpty else {
            return
        }
        let folderId = (userInfo["folderId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        pendingDeepLink = PushDeepLink(
            mailboxId: mailboxId,
            emailId: emailId,
            folderId: (folderId?.isEmpty == false ? folderId! : "inbox")
        )
    }
}

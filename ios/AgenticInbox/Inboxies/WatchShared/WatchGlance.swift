import Foundation

/// WidgetKit kind for the watch's Inbox complication / Smart Stack widget (AVE-146).
/// The watch app reloads timelines by this kind.
enum WatchGlanceKind {
    static let inbox = "co.inboxies.watch.inbox-glance"
}

/// What the watch complication shows (AVE-146, docs/watch-companion-plan.md phase 3):
/// the active mailbox's Inbox unread count (the server's New total, the same number
/// as the phone's "Today's inbox" widget) and who sent the newest unread conversation.
struct WatchGlanceSnapshot: Codable, Equatable {
    let mailboxId: String
    let unreadCount: Int
    /// Newest unread conversation's sender; nil at inbox zero.
    let newestSender: String?
    let updatedAt: Date

    init(mailboxId: String, unreadCount: Int, newestSender: String?, updatedAt: Date = Date()) {
        self.mailboxId = mailboxId
        self.unreadCount = max(0, unreadCount)
        let sender = newestSender?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.newestSender = self.unreadCount > 0 && sender?.isEmpty == false ? sender : nil
        self.updatedAt = updatedAt
    }

    /// Same mailbox, count and sender; `updatedAt` is ignored.
    func hasSameContent(as other: WatchGlanceSnapshot) -> Bool {
        mailboxId == other.mailboxId && unreadCount == other.unreadCount && newestSender == other.newestSender
    }

    /// Smart Stack relevance: zero at inbox zero, more with more unread (capped).
    var relevanceScore: Float {
        Float(min(unreadCount, 20))
    }
}

/// The glance snapshot in the watch's App Group (compiled into the watch app, the
/// `InboxiesWatchWidgets` extension and, for tests, the phone app). The watch app
/// writes; the widget only reads. No session token and no network in the widget.
/// App Group containers are per device, so this never leaves the watch.
struct WatchGlanceStore {
    /// Same id as `SharedSession.appGroupId` (the watch doesn't compile `SharedSession`);
    /// `WatchGlanceTests` keeps them equal.
    static let appGroupId = "group.co.inboxies.app"
    static let snapshotKey = "watchGlance.snapshot"

    let defaults: UserDefaults

    /// Nil when the group container isn't available (an unsigned build).
    static var shared: WatchGlanceStore? {
        UserDefaults(suiteName: appGroupId).map(WatchGlanceStore.init(defaults:))
    }

    func read() -> WatchGlanceSnapshot? {
        guard let data = defaults.data(forKey: Self.snapshotKey) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(WatchGlanceSnapshot.self, from: data)
    }

    /// Writes only when the content changed, so refreshes don't spend the widget's
    /// reload budget. Returns true when something was written.
    @discardableResult
    func write(_ snapshot: WatchGlanceSnapshot) -> Bool {
        if let previous = read(), previous.hasSameContent(as: snapshot) { return false }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(snapshot) else { return false }
        defaults.set(data, forKey: Self.snapshotKey)
        return true
    }

    /// Sign-out / wipe: nothing about the account stays on the watch face.
    /// Returns true when there was something to remove.
    @discardableResult
    func clear() -> Bool {
        guard defaults.object(forKey: Self.snapshotKey) != nil else { return false }
        defaults.removeObject(forKey: Self.snapshotKey)
        return true
    }
}

/// Phone → watch after a new-mail push (`transferCurrentComplicationUserInfo`, or
/// `transferUserInfo` when no complication is on the face): the phone's fresh count
/// for one mailbox. The count and sender are optional; without them it's only a hint
/// to refresh. Never carries a token.
struct WatchGlanceUpdate: Equatable {
    static let unreadCountKey = "unreadCount"
    static let newestSenderKey = "newestSender"

    let mailboxId: String
    let unreadCount: Int?
    let newestSender: String?

    var message: [String: Any] {
        var message = WatchHandoff.message(.glance)
        message[WatchSessionGrant.mailboxIdKey] = mailboxId
        if let unreadCount { message[Self.unreadCountKey] = unreadCount }
        if let newestSender, !newestSender.isEmpty { message[Self.newestSenderKey] = newestSender }
        return message
    }

    init(mailboxId: String, unreadCount: Int?, newestSender: String?) {
        self.mailboxId = mailboxId
        self.unreadCount = unreadCount.map { max(0, $0) }
        self.newestSender = newestSender
    }

    init?(message: [String: Any]) {
        guard WatchHandoff.kind(of: message) == .glance,
              let mailboxId = message[WatchSessionGrant.mailboxIdKey] as? String, !mailboxId.isEmpty else { return nil }
        self.mailboxId = mailboxId
        self.unreadCount = (message[Self.unreadCountKey] as? Int).map { max(0, $0) }
        self.newestSender = (message[Self.newestSenderKey] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// The snapshot to write, when the phone sent a count.
    func snapshot(now: Date = Date()) -> WatchGlanceSnapshot? {
        unreadCount.map { WatchGlanceSnapshot(mailboxId: mailboxId, unreadCount: $0, newestSender: newestSender, updatedAt: now) }
    }
}

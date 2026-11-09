import Foundation

/// WidgetKit kind for "Today's inbox" (AVE-149). The app reloads timelines by this kind.
enum InboxWidgetKind {
    static let todayInbox = "co.inboxies.widget.today-inbox"
}

/// "Today's inbox" data in the App Group (AVE-149). Compiled into the app and the
/// `InboxiesWidget` extension. The app writes, the widget reads; the only thing the
/// widget writes is the deck position when › is tapped (`ShowNextThreadIntent`).
///
/// - Snapshots: one JSON file per mailbox under `<group>/InboxWidget/`.
/// - Mailbox list (for the widget's mailbox picker): `mailboxes.json` in the same folder.
/// - Deck position (`frontIndex`) and when New last grew: group `UserDefaults`.
///
/// No session token, no network: the widget only ever draws what the app wrote.
struct InboxWidgetStore {
    /// A mailbox the widget can be pointed at.
    struct MailboxRef: Codable, Equatable, Hashable, Identifiable {
        let id: String
        let address: String
    }

    let defaults: UserDefaults
    let directory: URL

    private static let folderName = "InboxWidget"
    private static let frontIndexPrefix = "inboxWidget.frontIndex."
    private static let newCountRosePrefix = "inboxWidget.newCountRoseAt."

    /// The App Group store; nil when the group container isn't available (unsigned builds).
    static var shared: InboxWidgetStore? {
        guard let defaults = UserDefaults(suiteName: SharedSession.appGroupId),
              let container = FileManager.default.containerURL(
                  forSecurityApplicationGroupIdentifier: SharedSession.appGroupId
              ) else { return nil }
        return InboxWidgetStore(
            defaults: defaults,
            directory: container.appendingPathComponent(folderName, isDirectory: true)
        )
    }

    init(defaults: UserDefaults, directory: URL) {
        self.defaults = defaults
        self.directory = directory
    }

    // MARK: - Snapshots

    func snapshot(mailboxId: String) -> InboxWidgetSnapshot? {
        guard let data = try? Data(contentsOf: snapshotURL(mailboxId: mailboxId)) else { return nil }
        return try? InboxWidgetSnapshot.decode(data)
    }

    /// Writes the snapshot when its content changed (the `updatedAt` stamp alone doesn't
    /// count, so the widget's reload budget isn't spent on no-op refreshes). A change
    /// puts the deck back on its first card and, when New grew, records when for Smart
    /// Stack relevance. Returns true when something was written.
    @discardableResult
    func write(_ snapshot: InboxWidgetSnapshot, now: Date = Date()) -> Bool {
        let previous = self.snapshot(mailboxId: snapshot.mailboxId)
        if let previous, previous.hasSameContent(as: snapshot) { return false }
        guard let data = try? snapshot.encoded() else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            // The widget renders while the phone is locked, after first unlock.
            try data.write(
                to: snapshotURL(mailboxId: snapshot.mailboxId),
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            return false
        }
        defaults.removeObject(forKey: Self.frontIndexPrefix + snapshot.mailboxId)
        if snapshot.newCount > (previous?.newCount ?? 0) {
            defaults.set(now, forKey: Self.newCountRosePrefix + snapshot.mailboxId)
        } else if snapshot.newCount == 0 {
            defaults.removeObject(forKey: Self.newCountRosePrefix + snapshot.mailboxId)
        }
        return true
    }

    // MARK: - Mailboxes

    func mailboxes() -> [MailboxRef] {
        guard let data = try? Data(contentsOf: mailboxesURL) else { return [] }
        return (try? JSONDecoder().decode([MailboxRef].self, from: data)) ?? []
    }

    /// Returns true when the list changed.
    @discardableResult
    func writeMailboxes(_ mailboxes: [MailboxRef]) -> Bool {
        guard mailboxes != self.mailboxes(), let data = try? JSONEncoder().encode(mailboxes) else { return false }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: mailboxesURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return true
        } catch {
            return false
        }
    }

    // MARK: - Deck position

    /// Which thread is on top of the deck, always inside the snapshot's thread list.
    func frontIndex(mailboxId: String, threadCount: Int) -> Int {
        guard threadCount > 0 else { return 0 }
        let stored = defaults.integer(forKey: Self.frontIndexPrefix + mailboxId)
        return ((stored % threadCount) + threadCount) % threadCount
    }

    /// › on the widget: the next thread comes to the front, wrapping after the last.
    /// Returns the new index, or nil when there's no deck to flip.
    @discardableResult
    func advanceFront(mailboxId: String) -> Int? {
        guard let count = snapshot(mailboxId: mailboxId)?.threads.count, count > 1 else { return nil }
        let next = (frontIndex(mailboxId: mailboxId, threadCount: count) + 1) % count
        defaults.set(next, forKey: Self.frontIndexPrefix + mailboxId)
        return next
    }

    /// When the New count last went up (cleared at inbox zero).
    func newCountRoseAt(mailboxId: String) -> Date? {
        defaults.object(forKey: Self.newCountRosePrefix + mailboxId) as? Date
    }

    // MARK: - Sign-out

    /// Sign-out: nothing about the account stays on the home screen.
    func removeAll() {
        try? FileManager.default.removeItem(at: directory)
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix(Self.frontIndexPrefix) || key.hasPrefix(Self.newCountRosePrefix) {
            defaults.removeObject(forKey: key)
        }
    }

    // MARK: - Files

    private var mailboxesURL: URL {
        directory.appendingPathComponent("mailboxes.json")
    }

    func snapshotURL(mailboxId: String) -> URL {
        directory.appendingPathComponent("snapshot-\(Self.fileSafe(mailboxId)).json")
    }

    /// Mailbox ids are server ids; keep the file name to a safe alphabet regardless.
    static func fileSafe(_ id: String) -> String {
        var out = ""
        for scalar in id.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) && scalar.isASCII || scalar == "-" || scalar == "_" {
                out.unicodeScalars.append(scalar)
            } else {
                out += String(format: "%%%02X", scalar.value)
            }
        }
        return out
    }
}

// MARK: - Encoding

extension InboxWidgetSnapshot {
    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    static func decode(_ data: Data) throws -> InboxWidgetSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(InboxWidgetSnapshot.self, from: data)
    }

    /// Same mail, counts and order; `updatedAt` is ignored.
    func hasSameContent(as other: InboxWidgetSnapshot) -> Bool {
        mailboxId == other.mailboxId
            && mailboxAddress == other.mailboxAddress
            && newCount == other.newCount
            && replyLaterCount == other.replyLaterCount
            && threads == other.threads
    }
}

// MARK: - Smart Stack relevance

enum InboxWidgetRelevance {
    /// How long the widget stays boosted after New grows.
    static let boostDuration: TimeInterval = 2 * 60 * 60

    /// Higher with more New mail, and well above that for a while after New grew, so the
    /// Smart Stack rotates to the widget when something arrives. Zero at inbox zero.
    static func score(newCount: Int, roseAt: Date?, now: Date) -> (score: Float, duration: TimeInterval) {
        guard newCount > 0 else { return (0, 0) }
        let base = Float(min(newCount, 20))
        if let roseAt {
            let remaining = boostDuration - now.timeIntervalSince(roseAt)
            if remaining > 0 { return (base + 50, remaining) }
        }
        return (base, 0)
    }
}

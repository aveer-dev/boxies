import Foundation

/// A send waiting out its undo window, persisted so a kill inside the window
/// brings the message back as a draft instead of losing it. Holds the compose
/// fields (what `ComposeFormModel` edits), not the rendered send payload.
struct PendingSendRecord: Codable, Equatable {
    struct Address: Codable, Equatable {
        var name: String?
        var email: String
    }

    struct AttachmentRecord: Codable, Equatable {
        var filename: String
        var mimeType: String
        var size: Int
        var base64: String
    }

    var id: UUID
    /// Signed-in account (AuthStore email). Another account's record waits for that account.
    var accountKey: String
    /// The From mailbox. A record for a mailbox this account can't see is discarded.
    var mailboxId: String
    var mode: String
    var to: [Address]
    var cc: [Address]
    var bcc: [Address]
    var subject: String
    var body: String
    var originalEmailId: String?
    var threadId: String?
    var draftId: String?
    var attachments: [AttachmentRecord]
    var createdAt: Date
    /// The compose's `Idempotency-Key`, so a restored message that is sent again can't
    /// go out twice if the first attempt did reach the server. Nil in older records.
    var idempotencyKey: String?
    /// The commit started before the app died, so it may or may not have gone out.
    /// Stored as a separate marker file, never in the JSON payload.
    var sendStarted = false

    private enum CodingKeys: String, CodingKey {
        case id, accountKey, mailboxId, mode, to, cc, bcc, subject, body
        case originalEmailId, threadId, draftId, attachments, createdAt, idempotencyKey
    }

    /// Records older than this are dropped instead of restored.
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60

    var composeMode: ComposeMode {
        ComposeMode(rawValue: mode) ?? .new
    }

    enum RestoreDecision: Equatable {
        /// Put it back in the compose dock.
        case restore
        /// Stale, or for a mailbox this account can't see.
        case discard
        /// Another account's message, or mailboxes haven't loaded: keep it on disk.
        case keep
    }

    func restoreDecision(accountKey current: String, mailboxIds: [String], now: Date = Date()) -> RestoreDecision {
        if now.timeIntervalSince(createdAt) > Self.maxAge { return .discard }
        guard accountKey == current else { return .keep }
        guard !mailboxIds.isEmpty else { return .keep }
        return mailboxIds.contains(mailboxId) ? .restore : .discard
    }

    var restoreToastMessage: String {
        sendStarted
            ? "Your message may not have been sent. Check Sent before resending."
            : "Your message wasn’t sent"
    }
}

/// One file per pending send (`<id>.json`, plus `<id>.started` once the commit begins),
/// so a new send never overwrites an older record and clearing touches only its own files.
/// Writes go through one serial queue in call order: a clear issued after a save always
/// lands after it, and the JSON encode of large attachments stays off the main thread.
struct PendingSendStore: Sendable {
    let directory: URL
    private let queue: DispatchQueue

    static let shared = PendingSendStore(
        root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    )

    init(root: URL) {
        directory = root.appendingPathComponent("PendingSend", isDirectory: true)
        queue = DispatchQueue(label: "co.inboxies.pending-send", qos: .utility)
    }

    /// Every record on disk, oldest first. Synchronous: call before any send can be scheduled.
    func loadAll() -> [PendingSendRecord] {
        queue.sync {
            let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
            return files
                .filter { $0.pathExtension == "json" }
                .compactMap { url -> PendingSendRecord? in
                    guard let data = try? Data(contentsOf: url),
                          var record = try? Self.decoder.decode(PendingSendRecord.self, from: data) else {
                        try? FileManager.default.removeItem(at: url)
                        return nil
                    }
                    record.sendStarted = FileManager.default.fileExists(atPath: startedURL(record.id).path)
                    return record
                }
                .sorted { $0.createdAt < $1.createdAt }
        }
    }

    func save(_ record: PendingSendRecord) {
        queue.async {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let data = try Self.encoder.encode(record)
                try data.write(to: recordURL(record.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch {
                print("[PendingSendStore] save failed: \(error)")
            }
        }
    }

    /// Marks the commit as started without rewriting the (possibly multi-MB) payload.
    func markSendStarted(id: UUID) {
        queue.async {
            guard FileManager.default.fileExists(atPath: recordURL(id).path) else { return }
            FileManager.default.createFile(
                atPath: startedURL(id).path,
                contents: Data(),
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
            )
        }
    }

    /// The send definitely failed: a restore should say "wasn't sent", not "may not have".
    func clearSendStarted(id: UUID) {
        queue.async {
            try? FileManager.default.removeItem(at: startedURL(id))
        }
    }

    func clear(id: UUID) {
        queue.async {
            try? FileManager.default.removeItem(at: recordURL(id))
            try? FileManager.default.removeItem(at: startedURL(id))
        }
    }

    /// Waits for queued writes (tests, and before reading back in the same process).
    func flush() {
        queue.sync {}
    }

    private func recordURL(_ id: UUID) -> URL {
        directory.appendingPathComponent("\(id.uuidString).json")
    }

    private func startedURL(_ id: UUID) -> URL {
        directory.appendingPathComponent("\(id.uuidString).started")
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

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
    /// Signed-in account (AuthStore email). A record from another account is discarded.
    var accountKey: String
    /// The From mailbox. A record for a mailbox this session can't see is discarded.
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
    /// Set when the commit starts. A kill after this point may or may not have sent it.
    var sendStarted = false

    var composeMode: ComposeMode {
        ComposeMode(rawValue: mode) ?? .new
    }

    enum RestoreDecision: Equatable {
        /// Put it back in the compose dock.
        case restore
        /// Belongs to another account or a mailbox this session can't see.
        case discard
        /// Mailboxes haven't loaded yet; keep the record and try again later.
        case wait
    }

    func restoreDecision(accountKey current: String, mailboxIds: [String]) -> RestoreDecision {
        guard accountKey == current else { return .discard }
        guard !mailboxIds.isEmpty else { return .wait }
        return mailboxIds.contains(mailboxId) ? .restore : .discard
    }

    var restoreToastMessage: String {
        sendStarted
            ? "Your message may not have been sent. Check Sent before resending."
            : "Your message wasn’t sent"
    }
}

/// One JSON file in Application Support. Only one send can be in its undo window
/// at a time (scheduling a second commits the first), so one record is enough.
struct PendingSendStore: Sendable {
    let fileURL: URL

    static let shared = PendingSendStore(
        directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    )

    init(directory: URL) {
        fileURL = directory
            .appendingPathComponent("PendingSend", isDirectory: true)
            .appendingPathComponent("pending-send.json")
    }

    func load() -> PendingSendRecord? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? Self.decoder.decode(PendingSendRecord.self, from: data)
    }

    func save(_ record: PendingSendRecord) {
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try Self.encoder.encode(record)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            print("[PendingSendStore] save failed: \(error)")
        }
    }

    func markSendStarted(id: UUID) {
        guard var record = load(), record.id == id else { return }
        record.sendStarted = true
        save(record)
    }

    /// Clears the record, or only the given one so a newer send's record survives.
    func clear(id: UUID? = nil) {
        if let id, load()?.id != id { return }
        try? FileManager.default.removeItem(at: fileURL)
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

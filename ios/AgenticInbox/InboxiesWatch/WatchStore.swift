import Foundation
import Observation

/// The watch app's state (AVE-144): the handed-over session, the active mailbox and
/// its newest Inbox conversations. Talks to the Worker directly with the `watch`
/// token; the phone is only asked for a token.
@Observable
@MainActor
final class WatchStore {
    enum Connection: Equatable {
        /// No token yet; asking the phone.
        case connecting
        /// No token and the phone can't give one right now.
        case needsPhone(String)
        case connected
    }

    enum ListState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var connection: Connection = .connecting
    private(set) var mailboxes: [WatchMailbox] = []
    private(set) var activeMailboxId: String?
    private(set) var emails: [WatchEmail] = []
    private(set) var listState: ListState = .idle

    @ObservationIgnored private var link: PhoneLink?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var apiBaseURL: URL?
    /// DEBUG fixtures: no phone, no network, actions only change local state.
    @ObservationIgnored private(set) var isPreview = false

    private enum Keys {
        static let apiBaseURL = "watchApiBaseURL"
        static let mailboxId = "watchActiveMailboxId"
        /// Set when the session was wiped (sign-out, revoke): don't ask the phone for a
        /// new one until the person taps Connect.
        static let waitForConnect = "watchWaitForConnect"
    }

    static let defaultAPIBaseURL = URL(string: "https://inboxies.email")!

    var activeMailbox: WatchMailbox? {
        mailboxes.first { $0.id == activeMailboxId } ?? mailboxes.first
    }

    private var api: WatchAPI? {
        guard let token else { return nil }
        return WatchAPI(baseURL: apiBaseURL ?? Self.defaultAPIBaseURL, token: token)
    }

    init() {}

    // MARK: Launch

    func start() {
        #if DEBUG
        if let fixture = WatchPreviewFixtures.fromLaunchArguments() {
            loadPreview(fixture)
            return
        }
        #endif
        let defaults = UserDefaults.standard
        apiBaseURL = WatchHandoff.acceptedOrigin(defaults.string(forKey: Keys.apiBaseURL))
        activeMailboxId = defaults.string(forKey: Keys.mailboxId)
        let link = PhoneLink { [weak self] message in self?.receive(message) }
        self.link = link
        link.activate()
        if let stored = WatchKeychain.token {
            token = stored
            connection = .connected
            Task { await refresh() }
        } else if defaults.bool(forKey: Keys.waitForConnect) {
            connection = .needsPhone(Self.signedOutMessage)
        } else {
            Task { await connect() }
        }
    }

    // MARK: Phone handoff

    /// Asks the phone for a session (first launch, or the Connect button).
    func connect() async {
        guard !isPreview, let link else { return }
        connection = .connecting
        switch await link.requestSession() {
        case .grant(let grant):
            accept(grant)
        case .signedOut:
            connection = .needsPhone("Sign in to Inboxies on your iPhone, then tap Connect.")
        case .unreachable:
            connection = .needsPhone("Open Inboxies on your iPhone, then tap Connect.")
        case .unavailable:
            connection = .needsPhone("Your iPhone couldn't connect to Inboxies. Try again in a moment.")
        }
    }

    private func receive(_ message: [String: Any]) {
        guard !isPreview else { return }
        switch WatchHandoff.kind(of: message) {
        case .session:
            if let grant = WatchSessionGrant(message: message) { accept(grant) }
        case .clear:
            wipe()
        case .context:
            // Hints only (active mailbox, origin); never a token, never a wipe.
            guard let context = WatchPhoneContext(message: message), context.signedIn else { return }
            if let origin = context.apiBaseURL, token == nil { setAPIBaseURL(origin) }
            if activeMailboxId == nil, let mailboxId = context.mailboxId { setActiveMailbox(mailboxId) }
        default:
            break
        }
    }

    private func accept(_ grant: WatchSessionGrant) {
        WatchKeychain.setToken(grant.token)
        UserDefaults.standard.removeObject(forKey: Keys.waitForConnect)
        token = grant.token
        setAPIBaseURL(grant.apiBaseURL)
        if activeMailboxId == nil, let mailboxId = grant.mailboxId {
            setActiveMailbox(mailboxId)
        }
        connection = .connected
        Task { await refresh() }
    }

    private static let signedOutMessage = "Signed out. Open Inboxies on your iPhone, then tap Connect."

    /// Drops the session and everything read with it.
    private func wipe() {
        WatchKeychain.setToken(nil)
        UserDefaults.standard.set(true, forKey: Keys.waitForConnect)
        token = nil
        mailboxes = []
        emails = []
        listState = .idle
        connection = .needsPhone(Self.signedOutMessage)
    }

    private func setAPIBaseURL(_ url: URL) {
        apiBaseURL = url
        UserDefaults.standard.set(url.absoluteString, forKey: Keys.apiBaseURL)
    }

    private func setActiveMailbox(_ id: String) {
        activeMailboxId = id
        UserDefaults.standard.set(id, forKey: Keys.mailboxId)
    }

    // MARK: Inbox

    func refresh() async {
        guard !isPreview, let api else { return }
        if emails.isEmpty { listState = .loading }
        do {
            let mailboxes = try await api.mailboxes()
            self.mailboxes = mailboxes
            if activeMailboxId.map({ id in !mailboxes.contains { $0.id == id } }) ?? true,
               let first = mailboxes.first {
                setActiveMailbox(first.id)
            }
            guard let mailboxId = activeMailbox?.id else {
                emails = []
                listState = .loaded
                return
            }
            emails = try await api.inbox(mailboxId: mailboxId)
            listState = .loaded
        } catch {
            handle(error)
            if emails.isEmpty, token != nil { listState = .failed(Self.message(for: error)) }
        }
    }

    func selectMailbox(_ id: String) {
        guard id != activeMailboxId else { return }
        setActiveMailbox(id)
        emails = []
        if isPreview { return }
        Task { await refresh() }
    }

    // MARK: Message

    func loadMessage(_ email: WatchEmail) async throws -> WatchEmail {
        if isPreview { return email }
        guard let api, let mailboxId = activeMailbox?.id else { throw WatchAPIError.signedOut }
        do {
            return try await api.email(mailboxId: mailboxId, id: email.id)
        } catch {
            handle(error)
            throw error
        }
    }

    // MARK: Actions (phase 1 set: Archive, Mark read/unread, Reply Later, Report spam, Reply)

    func setRead(_ read: Bool, for email: WatchEmail) async throws {
        try await run {
            try await $0.setRead(read, mailboxId: $1, email: email)
        }
        updateRow(email.id) {
            $0.read = read
            if $0.threadUnreadCount != nil { $0.threadUnreadCount = read ? 0 : max(1, $0.threadUnreadCount ?? 0) }
        }
    }

    func replyLater(_ email: WatchEmail) async throws {
        try await run { try await $0.replyLater(mailboxId: $1, id: email.id) }
        updateRow(email.id) { $0.replyLater = true }
    }

    func archive(_ email: WatchEmail) async throws {
        try await run { try await $0.move(mailboxId: $1, id: email.id, to: .archive) }
        emails.removeAll { $0.id == email.id }
    }

    func reportSpam(_ email: WatchEmail) async throws {
        try await run { try await $0.move(mailboxId: $1, id: email.id, to: .spam) }
        emails.removeAll { $0.id == email.id }
    }

    func reply(to email: WatchEmail, text: String, idempotencyKey: String) async throws {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        try await run {
            try await $0.quickReply(mailboxId: $1, id: email.id, text: trimmed, idempotencyKey: idempotencyKey)
        }
    }

    private func run(_ call: (WatchAPI, String) async throws -> Void) async throws {
        if isPreview { return }
        guard let api, let mailboxId = activeMailbox?.id else { throw WatchAPIError.signedOut }
        do {
            try await call(api, mailboxId)
        } catch {
            handle(error)
            throw error
        }
    }

    private func updateRow(_ id: String, _ change: (inout WatchEmail) -> Void) {
        guard let index = emails.firstIndex(where: { $0.id == id }) else { return }
        change(&emails[index])
    }

    /// A 401 means the watch session is gone (phone signed out, revoked in Devices &
    /// sessions, or replaced): wipe, and wait for Connect.
    private func handle(_ error: Error) {
        if case WatchAPIError.signedOut = error { wipe() }
    }

    static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
    }

    // MARK: DEBUG previews

    #if DEBUG
    private func loadPreview(_ fixture: WatchPreviewFixtures) {
        isPreview = true
        mailboxes = fixture.mailboxes
        activeMailboxId = fixture.mailboxes.first?.id
        emails = fixture.emails
        listState = .loaded
        connection = fixture.connection
    }
    #endif
}

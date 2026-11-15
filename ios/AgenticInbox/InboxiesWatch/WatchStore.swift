import Foundation
import Observation

/// The watch app's state (AVE-144): the handed-over session, the active mailbox and
/// its newest Inbox conversations. Talks to the Worker directly with the `watch`
/// token; the phone is only asked for a token.
@Observable
@MainActor
final class WatchStore {
    enum Connection: Equatable {
        /// No token; asking the phone quietly (`WatchReconnector`). The Inbox stays up
        /// if it already has something to show.
        case connecting
        /// No token: the phone is signed out, revoked the watch, or every quiet attempt
        /// failed. Shows Connect.
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
    @ObservationIgnored private var reconnector: WatchReconnector?
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var apiBaseURL: URL?
    /// DEBUG fixtures: no phone, no network, actions only change local state.
    @ObservationIgnored private(set) var isPreview = false

    private enum Keys {
        static let apiBaseURL = "watchApiBaseURL"
        static let mailboxId = "watchActiveMailboxId"
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
        let link = PhoneLink(
            onMessage: { [weak self] message in self?.receive(message) },
            onReachable: { [weak self] in self?.retryNowIfDisconnected() }
        )
        self.link = link
        reconnector = WatchReconnector { [weak link] manual in
            guard let link else { return .unreachable }
            return await link.requestSession(manual: manual)
        }
        link.activate()
        if let stored = WatchKeychain.token {
            token = stored
            connection = .connected
            Task { await refresh() }
        } else {
            Task { await reconnect() }
        }
    }

    // MARK: Phone handoff

    /// The Connect button: try now, and lift a revoke made on the phone.
    func connect() async {
        guard !isPreview else { return }
        connection = .connecting
        await reconnect(manual: true)
    }

    /// The app came forward or the phone became reachable: if the watch still has no
    /// session, ask now (joining a run in flight and skipping its wait).
    func retryNowIfDisconnected() {
        guard !isPreview, token == nil, let reconnector else { return }
        reconnector.skipWait()
        if !reconnector.isRunning { Task { await reconnect() } }
    }

    /// Asks the phone for a session without the person doing anything, retrying with
    /// backoff (`WatchReconnector`); concurrent callers share one run. Shows Connect
    /// only when the phone is signed out, revoked the watch, or never answered.
    @discardableResult
    private func reconnect(manual: Bool = false) async -> Bool {
        guard !isPreview, let reconnector else { return false }
        if token != nil { return true }
        // A quiet retry from the Connect screen keeps the button up.
        if case .needsPhone = connection, !manual {} else { connection = .connecting }
        let outcome = await reconnector.reconnect(manual: manual)
        // A grant pushed by the phone may have landed meanwhile.
        if token != nil { return true }
        switch outcome {
        case .connected(let grant):
            accept(grant)
        case .stopped(.revoked):
            wipe(Self.revokedMessage)
        case .stopped:
            wipe(Self.signedOutMessage)
        case .gaveUp(.unavailable):
            connection = .needsPhone("Your iPhone couldn't connect to Inboxies. Tap Connect to try again.")
        case .gaveUp:
            connection = .needsPhone("Open Inboxies on your iPhone, then tap Connect.")
        }
        return token != nil
    }

    private func receive(_ message: [String: Any]) {
        guard !isPreview else { return }
        switch WatchHandoff.kind(of: message) {
        case .session:
            if let grant = WatchSessionGrant(message: message) { accept(grant) }
        case .clear:
            wipe(Self.clearedMessage)
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
        guard grant.token != token else { return }
        WatchKeychain.setToken(grant.token)
        token = grant.token
        setAPIBaseURL(grant.apiBaseURL)
        if activeMailboxId == nil, let mailboxId = grant.mailboxId {
            setActiveMailbox(mailboxId)
        }
        connection = .connected
        Task { await refresh() }
    }

    private static let signedOutMessage = "Signed out. Sign in to Inboxies on your iPhone, then tap Connect."
    private static let clearedMessage = "Signed out. Open Inboxies on your iPhone, then tap Connect."
    private static let revokedMessage = "This watch was signed out from your iPhone. Tap Connect to sign it back in."

    /// Drops the session and everything read with it (phone sign-out or revoke).
    private func wipe(_ message: String = WatchStore.signedOutMessage) {
        WatchKeychain.setToken(nil)
        token = nil
        mailboxes = []
        emails = []
        listState = .idle
        connection = .needsPhone(message)
    }

    /// A 401: the token is dead (revoked elsewhere, replaced, expired). Drop it and ask
    /// the phone for a new one quietly; what's on screen stays until that settles.
    private func sessionEnded() {
        guard token != nil else { return }
        WatchKeychain.setToken(nil)
        token = nil
        Task { await reconnect() }
    }

    /// How long an action or message waits for a quiet reconnect before giving up.
    private static let actionReconnectWait: Duration = .seconds(6)

    /// The API to use for an action: the current one, or the one a quiet reconnect
    /// brings within `actionReconnectWait`. Throws `signedOut` when the reconnect
    /// stopped (Connect is showing), or `reconnecting` while it's still trying.
    private func connectedAPI() async throws -> WatchAPI {
        if let api { return api }
        retryNowIfDisconnected()
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: Self.actionReconnectWait)
        while api == nil, clock.now < deadline {
            if case .needsPhone = connection { break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        if let api { return api }
        if case .needsPhone = connection { throw WatchAPIError.signedOut }
        throw WatchAPIError.reconnecting
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
        var loaded: WatchEmail?
        try await run { loaded = try await $0.email(mailboxId: $1, id: email.id) }
        guard let loaded else { throw WatchAPIError.decoding }
        return loaded
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

    /// Runs an API call; after a 401 it waits briefly for the quiet reconnect and
    /// tries once more with the new token (replies carry an idempotency key).
    private func run(_ call: (WatchAPI, String) async throws -> Void) async throws {
        if isPreview { return }
        var retried = false
        while true {
            let api = try await connectedAPI()
            guard let mailboxId = activeMailbox?.id else { throw WatchAPIError.signedOut }
            do {
                try await call(api, mailboxId)
                return
            } catch WatchAPIError.signedOut {
                if self.api?.token == api.token { sessionEnded() }
                if retried {
                    if case .needsPhone = connection { throw WatchAPIError.signedOut }
                    throw WatchAPIError.reconnecting
                }
                retried = true
            }
        }
    }

    private func updateRow(_ id: String, _ change: (inout WatchEmail) -> Void) {
        guard let index = emails.firstIndex(where: { $0.id == id }) else { return }
        change(&emails[index])
    }

    /// A 401 means the watch session is gone (phone signed out, revoked, or
    /// replaced): reconnect quietly. A signed-out phone ends that at the first answer.
    private func handle(_ error: Error) {
        if case WatchAPIError.signedOut = error { sessionEnded() }
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

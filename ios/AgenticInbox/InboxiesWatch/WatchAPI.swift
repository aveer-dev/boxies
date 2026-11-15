import Foundation

struct WatchMailbox: Identifiable, Decodable, Hashable {
    let id: String
    let email: String
    let name: String

    var title: String { name.isEmpty ? email : name }
}

/// The fields of a list row / message the watch shows. The Worker sends many more.
struct WatchEmail: Identifiable, Decodable, Hashable {
    let id: String
    var threadId: String?
    var subject: String
    var sender: String
    var senderName: String?
    var date: String
    var read: Bool
    var replyLater: Bool?
    var snippet: String?
    var body: String?
    var threadCount: Int?
    var threadUnreadCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, subject, sender, date, read, snippet, body
        case threadId = "thread_id"
        case senderName = "sender_name"
        case replyLater = "reply_later"
        case threadCount = "thread_count"
        case threadUnreadCount = "thread_unread_count"
    }

    /// Threaded rows: unread while any message in the conversation is.
    var isUnread: Bool {
        if let threadUnreadCount { return threadUnreadCount > 0 }
        return !read
    }

    var displaySender: String {
        WatchMailText.senderName(name: senderName, address: sender)
    }

    var displaySubject: String {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "(No subject)" : trimmed
    }

    var parsedDate: Date? {
        ReplyLaterReminder.parseISO(date)
    }
}

private struct WatchEmailList: Decodable {
    let emails: [WatchEmail]
}

private struct WatchErrorBody: Decodable {
    let error: String?
}

enum WatchAPIError: LocalizedError {
    /// 401: the watch session ended (phone signed out, revoked, or replaced).
    case signedOut
    /// No session yet; the watch is still quietly asking the phone for one.
    case reconnecting
    case http(Int, String)
    case transport(Error)
    case decoding

    var errorDescription: String? {
        switch self {
        case .signedOut: return "Signed out on this watch."
        case .reconnecting: return "Reconnecting to your iPhone. Try again in a moment."
        case .http(_, let message) where !message.isEmpty: return message
        case .http(let status, _): return "Something went wrong (\(status))."
        case .transport: return "Can't reach Inboxies. Check the connection."
        case .decoding: return "Inboxies sent something this watch can't read."
        }
    }
}

/// The handful of Worker calls the watch makes, all inside the `watch` scope's
/// allowlist (`workers/lib/auth-paths.ts`, AVE-143). Bearer token only, no cookies.
struct WatchAPI {
    let baseURL: URL
    let token: String

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    // MARK: Reads

    /// `GET /api/v1/mailboxes`
    func mailboxes() async throws -> [WatchMailbox] {
        try await send("GET", "/api/v1/mailboxes")
    }

    /// `GET .../emails?folder=inbox`: the newest conversations.
    func inbox(mailboxId: String, limit: Int = 20) async throws -> [WatchEmail] {
        let list: WatchEmailList = try await send(
            "GET",
            "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails",
            query: ["folder": "inbox", "threaded": "true", "page": "1", "limit": String(limit)]
        )
        return list.emails
    }

    /// `GET .../emails/:id`
    func email(mailboxId: String, id: String) async throws -> WatchEmail {
        try await send("GET", "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails/\(id.pathSegment)")
    }

    // MARK: Phase 1 actions

    /// `POST .../threads/:threadId/read`, or `PUT .../emails/:id { read }` for one message.
    func setRead(_ read: Bool, mailboxId: String, email: WatchEmail) async throws {
        if read, let threadId = email.threadId, !threadId.isEmpty {
            try await sendIgnoringBody("POST", "/api/v1/mailboxes/\(mailboxId.pathSegment)/threads/\(threadId.pathSegment)/read")
        } else {
            try await sendIgnoringBody(
                "PUT",
                "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails/\(email.id.pathSegment)",
                body: ["read": read]
            )
        }
    }

    /// `PUT .../emails/:id { reply_later, reply_later_remind_at }`: tomorrow 09:00, like
    /// the notification action.
    func replyLater(mailboxId: String, id: String, now: Date = Date()) async throws {
        let remindAt = ReplyLaterReminder.date(for: .tomorrow, now: now)
        try await sendIgnoringBody(
            "PUT",
            "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails/\(id.pathSegment)",
            body: ["reply_later": true, "reply_later_remind_at": ReplyLaterReminder.isoString(remindAt)]
        )
    }

    /// `POST .../emails/:id/move`: Archive, or Report spam (which also teaches the
    /// mailbox about the sender, like the phone's Report spam).
    func move(mailboxId: String, id: String, to folderId: WatchMoveTarget) async throws {
        var body: [String: Any] = ["folderId": folderId.rawValue]
        if folderId == .spam { body["setSenderPreference"] = true }
        try await sendIgnoringBody("POST", "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails/\(id.pathSegment)/move", body: body)
    }

    /// `POST .../emails/:id/quick-reply { text }`. The Worker picks To, From and the
    /// subject. One idempotency key per reply, so a retry can't send twice.
    func quickReply(mailboxId: String, id: String, text: String, idempotencyKey: String) async throws {
        try await sendIgnoringBody(
            "POST",
            "/api/v1/mailboxes/\(mailboxId.pathSegment)/emails/\(id.pathSegment)/quick-reply",
            body: ["text": text, "quote_time_zone": TimeZone.current.identifier],
            headers: ["Idempotency-Key": idempotencyKey]
        )
    }

    // MARK: Transport

    private func send<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        headers: [String: String] = [:]
    ) async throws -> T {
        let data = try await perform(method, path, query: query, body: body, headers: headers)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw WatchAPIError.decoding
        }
    }

    private func sendIgnoringBody(
        _ method: String,
        _ path: String,
        body: [String: Any]? = nil,
        headers: [String: String] = [:]
    ) async throws {
        _ = try await perform(method, path, query: [:], body: body ?? [:], headers: headers)
    }

    private func perform(
        _ method: String,
        _ path: String,
        query: [String: String],
        body: [String: Any]?,
        headers: [String: String]
    ) async throws -> Data {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw WatchAPIError.http(0, "Invalid server address.")
        }
        components.percentEncodedPath = path
        if !query.isEmpty {
            components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw WatchAPIError.http(0, "Invalid server address.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw WatchAPIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw WatchAPIError.http(0, "") }
        if http.statusCode == 401 { throw WatchAPIError.signedOut }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(WatchErrorBody.self, from: data))?.error ?? ""
            throw WatchAPIError.http(http.statusCode, message)
        }
        return data
    }
}

enum WatchMoveTarget: String {
    case archive
    case spam
    case inbox
}

private extension String {
    /// One URL path segment (ids are opaque; escape everything but unreserved characters).
    var pathSegment: String {
        addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? self
    }
}

import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case http(Int, String)
    case decoding(Error)
    case notJSON(String)
    case cloudflareAccess
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid API URL"
        case .http(_, let body) where !body.isEmpty:
            return body
        case .http(let code, _):
            return "HTTP \(code)"
        case .decoding(let err): return "Decode error: \(err.localizedDescription)"
        case .notJSON(let preview):
            return "API returned HTML instead of JSON. \(preview)"
        case .cloudflareAccess:
            return "Cloudflare Access is blocking the API. Add a Bypass policy for <your-api-host>/api/* (and /agents/* for chat) in Zero Trust, or the Worker never sees Sign in with Apple."
        case .transport(let err): return err.localizedDescription
        }
    }
}

/// Thin fetch wrapper — think `app/services/api.ts`.
final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let redirectGuard = SameHostRedirectGuard()

    /// Injected by AuthStore / AppModel when the session token changes.
    var authTokenProvider: @Sendable () -> String? = { nil }

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: redirectGuard, delegateQueue: nil)
        decoder = JSONDecoder()
    }

    func request<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authed: Bool = true
    ) async throws -> T {
        let (data, http) = try await perform(
            path: path,
            method: method,
            query: query,
            body: body,
            authed: authed
        )
        if http.statusCode == 204 {
            if T.self == EmptyResponse.self {
                return EmptyResponse() as! T
            }
        }
        if isCloudflareAccessChallenge(http, data: data) {
            throw APIError.cloudflareAccess
        }
        let contentType = http.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
        if !contentType.contains("json") {
            let preview = String(data: data, encoding: .utf8).map { String($0.prefix(160)) } ?? ""
            throw APIError.notJSON(preview)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    func requestData(
        path: String,
        method: String = "GET",
        query: [String: String] = [:],
        authed: Bool = true
    ) async throws -> (Data, HTTPURLResponse) {
        try await perform(path: path, method: method, query: query, body: nil, authed: authed)
    }

    private func perform(
        path: String,
        method: String,
        query: [String: String],
        body: [String: Any]?,
        authed: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(url: AppConfig.apiBaseURL, resolvingAgainstBaseURL: false),
              components.host != nil else {
            throw APIError.invalidURL
        }
        let cleanPath = path.hasPrefix("/") ? path : "/\(path)"
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = basePath.isEmpty ? cleanPath : "/\(basePath)\(cleanPath)"
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authed, let token = authTokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.http(-1, "No HTTP response")
            }
            if isCloudflareAccessChallenge(http, data: data) {
                throw APIError.cloudflareAccess
            }
            guard (200..<300).contains(http.statusCode) else {
                throw APIError.http(http.statusCode, httpErrorMessage(from: data))
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }

    func listMailboxes() async throws -> [Mailbox] {
        try await request(path: "/api/v1/mailboxes")
    }

    func getConfig() async throws -> AppConfigResponse {
        try await request(path: "/api/v1/config", authed: false)
    }

    func getMe() async throws -> MeResponse {
        try await request(path: "/api/v1/me")
    }

    func listIdentities() async throws -> IdentitiesResponse {
        try await request(path: "/api/v1/me/identities")
    }

    func attachAppleIdentity(identityToken: String) async throws -> AttachIdentityResponse {
        try await request(
            path: "/api/v1/me/identities/attach",
            method: "POST",
            body: ["provider": "apple", "identityToken": identityToken]
        )
    }

    func attachGoogleIdentity(idToken: String) async throws -> AttachIdentityResponse {
        try await request(
            path: "/api/v1/me/identities/attach",
            method: "POST",
            body: ["provider": "google", "idToken": idToken]
        )
    }

    func attachPasswordIdentity(password: String, loginEmail: String? = nil) async throws -> AttachIdentityResponse {
        var body: [String: Any] = ["provider": "password", "password": password]
        if let loginEmail, !loginEmail.isEmpty {
            body["loginEmail"] = loginEmail
        }
        return try await request(
            path: "/api/v1/me/identities/attach",
            method: "POST",
            body: body
        )
    }

    func changePassword(currentPassword: String, newPassword: String) async throws -> ChangePasswordResponse {
        try await request(
            path: "/api/v1/me/identities/password",
            method: "POST",
            body: [
                "currentPassword": currentPassword,
                "newPassword": newPassword,
            ]
        )
    }

    func createIdentityLinkCode() async throws -> IdentityLinkCodeResponse {
        try await request(path: "/api/v1/me/identity-link-codes", method: "POST", body: [:] as [String: Any])
    }

    func redeemIdentityLink(code: String) async throws -> RedeemIdentityLinkResponse {
        try await request(
            path: "/api/v1/auth/redeem-identity-link",
            method: "POST",
            body: ["code": code]
        )
    }

    func createMailbox(name: String, email: String) async throws -> Mailbox {
        try await request(
            path: "/api/v1/mailboxes",
            method: "POST",
            body: ["name": name, "email": email]
        )
    }

    func getMailbox(mailboxId: String) async throws -> Mailbox {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)")
    }

    func updateMailbox(mailboxId: String, settings: MailboxSettings) async throws -> Mailbox {
        let settingsData = try JSONEncoder().encode(settings)
        let settingsObject = try JSONSerialization.jsonObject(with: settingsData) as? [String: Any] ?? [:]
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)",
            method: "PUT",
            body: ["settings": settingsObject]
        )
    }

    func deleteMailbox(mailboxId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func getInvite(token: String) async throws -> InvitePublic {
        try await request(path: "/api/v1/invites/\(token.urlPathEncoded)", authed: false)
    }

    func acceptInvite(token: String, password: String, displayName: String?) async throws -> InviteAcceptResponse {
        var body: [String: Any] = ["password": password]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        return try await request(
            path: "/api/v1/invites/\(token.urlPathEncoded)/accept",
            method: "POST",
            body: body,
            authed: false
        )
    }

    func passwordLogin(email: String, password: String) async throws -> PasswordLoginResponse {
        try await request(
            path: "/api/v1/auth/password",
            method: "POST",
            body: ["email": email, "password": password],
            authed: false
        )
    }

    func listAdminMailboxes() async throws -> [AdminMailboxRow] {
        try await request(path: "/api/v1/admin/mailboxes")
    }

    func assignAdminMailboxToSelf(mailboxId: String) async throws -> Mailbox {
        try await request(
            path: "/api/v1/admin/mailboxes/\(mailboxId.urlPathEncoded)/assign",
            method: "POST",
            body: ["assignTo": "self"]
        )
    }

    func createAdminMailbox(
        email: String,
        name: String?,
        assignToSelf: Bool,
        inviteEmail: String? = nil,
        inviteeName: String? = nil
    ) async throws -> AdminCreateMailboxResponse {
        var body: [String: Any] = ["email": email]
        if let name, !name.isEmpty { body["name"] = name }
        if assignToSelf {
            body["assignTo"] = "self"
        } else if let inviteEmail {
            var invite: [String: Any] = ["inviteEmail": inviteEmail, "role": "owner"]
            if let inviteeName, !inviteeName.isEmpty { invite["inviteeName"] = inviteeName }
            body["assignTo"] = invite
        }
        return try await request(
            path: "/api/v1/admin/mailboxes",
            method: "POST",
            body: body
        )
    }

    func deleteAdminMailbox(mailboxId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/mailboxes/\(mailboxId.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func createAdminInvite(
        mailboxId: String,
        inviteEmail: String,
        inviteeName: String? = nil,
        role: String = "owner"
    ) async throws -> InviteCreateResponse {
        var body: [String: Any] = [
            "mailboxId": mailboxId,
            "inviteEmail": inviteEmail,
            "role": role,
        ]
        if let inviteeName, !inviteeName.isEmpty { body["inviteeName"] = inviteeName }
        return try await request(
            path: "/api/v1/admin/invites",
            method: "POST",
            body: body
        )
    }

    func createMailboxInvite(
        mailboxId: String,
        inviteEmail: String,
        role: String = "member"
    ) async throws -> InviteCreateResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/invites",
            method: "POST",
            body: ["inviteEmail": inviteEmail, "role": role]
        )
    }

    func listFolders(mailboxId: String) async throws -> [Folder] {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/folders")
    }

    func getInboxDigest(mailboxId: String) async throws -> InboxDigest {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/inbox-digest")
    }

    func completeDigestTodo(mailboxId: String, todoId: String) async throws -> DigestStatusResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/inbox-digest/todos/\(todoId.urlPathEncoded)/complete",
            method: "POST"
        )
    }

    func markDigestTopicRead(mailboxId: String, topicId: String, emailIds: [String]) async throws -> DigestStatusResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/inbox-digest/topics/\(topicId.urlPathEncoded)/mark-read",
            method: "POST",
            body: ["emailIds": emailIds]
        )
    }

    func listEmails(mailboxId: String, folder: String, page: Int = 1) async throws -> EmailListResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails",
            query: [
                "folder": folder,
                "threaded": "true",
                "page": String(page),
                "limit": "25",
            ]
        )
    }

    func getEmail(mailboxId: String, id: String) async throws -> Email {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)")
    }

    func getThread(mailboxId: String, threadId: String) async throws -> [Email] {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/threads/\(threadId.urlPathEncoded)")
    }

    func markRead(mailboxId: String, id: String) async throws -> Email {
        try await updateEmail(mailboxId: mailboxId, id: id, read: true)
    }

    func markThreadRead(mailboxId: String, threadId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/threads/\(threadId.urlPathEncoded)/read",
            method: "POST"
        )
    }

    func updateEmail(
        mailboxId: String,
        id: String,
        read: Bool? = nil,
        starred: Bool? = nil,
        replyLater: Bool? = nil
    ) async throws -> Email {
        var body: [String: Any] = [:]
        if let read { body["read"] = read }
        if let starred { body["starred"] = starred }
        if let replyLater { body["reply_later"] = replyLater }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)",
            method: "PUT",
            body: body
        )
    }

    func listReplyLaterEmails(mailboxId: String, page: Int = 1) async throws -> EmailListResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails",
            query: [
                "reply_later": "true",
                "page": String(page),
                "limit": "25",
            ]
        )
    }

    func listWorkflowPiles(mailboxId: String) async throws -> WorkflowPilesResponse {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/workflow-piles")
    }

    func moveEmail(
        mailboxId: String,
        id: String,
        folderId: String,
        setSenderPreference: Bool = false
    ) async throws {
        var body: [String: Any] = ["folderId": folderId]
        if setSenderPreference {
            body["setSenderPreference"] = true
        }
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)/move",
            method: "POST",
            body: body
        )
    }

    func listSenderPreferences(
        mailboxId: String,
        q: String = "",
        folder: String? = nil
    ) async throws -> [SenderPreference] {
        var query: [String: String] = ["limit": "200"]
        if !q.isEmpty { query["q"] = q }
        if let folder, !folder.isEmpty { query["folder"] = folder }
        let response: SenderPreferencesResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-preferences",
            query: query
        )
        return response.preferences
    }

    func upsertSenderPreference(
        mailboxId: String,
        address: String,
        folderId: String,
        displayName: String? = nil,
        refile: Bool = true
    ) async throws -> UpsertSenderPreferenceResponse {
        var body: [String: Any] = [
            "folderId": folderId,
            "refile": refile,
        ]
        if let displayName { body["displayName"] = displayName }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-preferences/\(address.urlPathEncoded)",
            method: "PUT",
            body: body
        )
    }

    func deleteSenderPreference(mailboxId: String, address: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-preferences/\(address.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func approveSender(
        mailboxId: String,
        sender: String,
        destinationFolderId: String,
        emailId: String? = nil,
        displayName: String? = nil
    ) async throws {
        var body: [String: Any] = [
            "sender": sender,
            "destinationFolderId": destinationFolderId,
        ]
        if let emailId { body["emailId"] = emailId }
        if let displayName { body["displayName"] = displayName }
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-triage/approve",
            method: "POST",
            body: body
        )
    }

    func rejectSender(
        mailboxId: String,
        sender: String,
        emailId: String? = nil,
        displayName: String? = nil
    ) async throws {
        var body: [String: Any] = ["sender": sender]
        if let emailId { body["emailId"] = emailId }
        if let displayName { body["displayName"] = displayName }
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-triage/reject",
            method: "POST",
            body: body
        )
    }

    func deleteEmail(mailboxId: String, id: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func searchEmails(mailboxId: String, query: String, page: Int = 1) async throws -> EmailListResponse {
        try await searchEmails(
            mailboxId: mailboxId,
            parsed: SearchQueryParser.parse(query),
            page: page
        )
    }

    func searchEmails(
        mailboxId: String,
        parsed: ParsedSearch,
        page: Int = 1
    ) async throws -> EmailListResponse {
        var params = parsed.apiQueryItems
        params["page"] = String(page)
        params["limit"] = "25"
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/search",
            query: params
        )
    }

    func listRecipients(mailboxId: String, q: String = "", limit: Int = 20) async throws -> [RecentRecipient] {
        let response: RecentRecipientsResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/recipients",
            query: [
                "q": q,
                "limit": String(limit),
            ]
        )
        return response.recipients
    }

    func sendEmail(mailboxId: String, payload: [String: Any]) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails",
            method: "POST",
            body: payload
        )
    }

    func replyToEmail(mailboxId: String, emailId: String, payload: [String: Any]) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(emailId.urlPathEncoded)/reply",
            method: "POST",
            body: payload
        )
    }

    func forwardEmail(mailboxId: String, emailId: String, payload: [String: Any]) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(emailId.urlPathEncoded)/forward",
            method: "POST",
            body: payload
        )
    }

    func saveDraft(mailboxId: String, draft: [String: Any]) async throws -> DraftSaveResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/drafts",
            method: "POST",
            body: draft
        )
    }

    func getAttachment(mailboxId: String, emailId: String, attachmentId: String) async throws -> Data {
        let (data, _) = try await requestData(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(emailId.urlPathEncoded)/attachments/\(attachmentId.urlPathEncoded)"
        )
        return data
    }

    func listConversations(mailboxId: String) async throws -> [AgentConversation] {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/agent/conversations")
    }

    func createConversation(mailboxId: String, id: String? = nil, title: String? = nil, lastMessagePreview: String? = nil) async throws -> AgentConversation {
        var body: [String: Any] = [:]
        if let id { body["id"] = id }
        if let title { body["title"] = title }
        if let lastMessagePreview { body["lastMessagePreview"] = lastMessagePreview }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/agent/conversations",
            method: "POST",
            body: body
        )
    }

    func updateConversation(mailboxId: String, id: String, title: String? = nil, lastMessagePreview: String? = nil) async throws -> AgentConversation {
        var body: [String: Any] = [:]
        if let title { body["title"] = title }
        if let lastMessagePreview { body["lastMessagePreview"] = lastMessagePreview }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/agent/conversations/\(id.urlPathEncoded)",
            method: "PATCH",
            body: body
        )
    }

    func deleteConversation(mailboxId: String, id: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/agent/conversations/\(id.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func registerDeviceToken(mailboxId: String, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/device-token",
            method: "POST",
            body: ["token": token, "platform": "ios"]
        )
    }

    func unregisterDeviceToken(mailboxId: String, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/device-token/\(token.urlPathEncoded)",
            method: "DELETE"
        )
    }
}

struct EmptyResponse: Decodable {}

struct WorkflowPile: Decodable {
    let id: String
    let count: Int
}

struct WorkflowPilesResponse: Decodable {
    let piles: [WorkflowPile]
}

/// Do not follow Cloudflare Access's 302 to the login HTML page — that body is
/// not JSON and surfaces as a confusing decode error.
private final class SameHostRedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        guard let fromHost = task.originalRequest?.url?.host,
              let toHost = request.url?.host,
              fromHost.caseInsensitiveCompare(toHost) == .orderedSame else {
            return nil
        }
        return request
    }
}

private func httpErrorMessage(from data: Data) -> String {
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let error = obj["error"] as? String, !error.isEmpty {
        return error
    }
    return String(data: data, encoding: .utf8) ?? ""
}

private func isCloudflareAccessChallenge(_ http: HTTPURLResponse, data: Data) -> Bool {
    if let auth = http.value(forHTTPHeaderField: "WWW-Authenticate")?.lowercased(),
       auth.contains("cloudflare-access") {
        return true
    }
    if let location = http.value(forHTTPHeaderField: "Location")?.lowercased(),
       location.contains("cloudflareaccess.com") || location.contains("cdn-cgi/access/login") {
        return true
    }
    let preview = String(data: data, encoding: .utf8)?.prefix(400).lowercased() ?? ""
    return preview.contains("cloudflareaccess.com") || preview.contains("cloudflare access")
}

extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}

import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case http(Int, String)
    case decoding(Error)
    case notJSON(String)
    case cloudflareAccess
    case transport(Error)
    /// The bearer token was rejected as invalid or expired; the app signs out globally.
    case sessionExpired

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
        case .sessionExpired: return "Your session has expired. Please sign in again."
        }
    }
}

/// Thin fetch wrapper — think `app/services/api.ts`.
final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let redirectGuard = SameHostRedirectGuard()

    private let authLock = NSLock()
    private var storedAuthToken: String?

    /// Bearer token for authed requests. AuthStore writes it whenever the session
    /// changes; it is seeded from the Keychain so cold launches (background push
    /// sync before any view appears) are authenticated too. Read from any thread.
    var authToken: String? {
        get { authLock.withLock { storedAuthToken } }
        set { authLock.withLock { storedAuthToken = newValue } }
    }

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: redirectGuard, delegateQueue: nil)
        decoder = JSONDecoder()
        storedAuthToken = KeychainStore.read(KeychainStore.sessionTokenKey)
    }

    func request<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authed: Bool = true,
        bearerToken: String? = nil
    ) async throws -> T {
        let (data, http) = try await perform(
            path: path,
            method: method,
            query: query,
            body: body,
            authed: authed,
            bearerToken: bearerToken
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
        try await perform(path: path, method: method, query: query, body: nil, authed: authed, bearerToken: nil)
    }

    /// Builds an API URL. `path` segments must already be escaped with
    /// `urlPathEncoded`; they are written via `percentEncodedPath` so `%` is not
    /// escaped a second time. Query values go through `URLQueryItem`.
    static func makeURL(
        base: URL = AppConfig.apiBaseURL,
        path: String,
        query: [String: String] = [:]
    ) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false),
              components.host != nil else {
            return nil
        }
        let cleanPath = path.hasPrefix("/") ? path : "/\(path)"
        // Re-escape anything not legal in a path, leaving existing %XX escapes intact.
        var escapedPath = cleanPath.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.urlPathAllowed.union(CharacterSet(charactersIn: "%"))
        ) ?? cleanPath
        if escapedPath.removingPercentEncoding == nil {
            // A stray `%` that is not an escape: encode it too rather than hand
            // URLComponents a malformed percent-encoded path.
            escapedPath = cleanPath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? cleanPath
        }
        let basePath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedPath = basePath.isEmpty ? escapedPath : "/\(basePath)\(escapedPath)"
        if !query.isEmpty {
            components.queryItems = query
                .sorted { $0.key < $1.key }
                .map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url
    }

    private func perform(
        path: String,
        method: String,
        query: [String: String],
        body: [String: Any]?,
        authed: Bool,
        bearerToken: String?
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = Self.makeURL(path: path, query: query) else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // `bearerToken` pins a request to a session that is being torn down (sign-out cleanup).
        let sentToken = authed ? (bearerToken ?? authToken) : nil
        if let sentToken {
            request.setValue("Bearer \(sentToken)", forHTTPHeaderField: "Authorization")
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
                let message = httpErrorMessage(from: data)
                if let sentToken, bearerToken == nil,
                   Self.isExpiredSessionResponse(statusCode: http.statusCode, message: message) {
                    Self.postSessionExpired(token: sentToken)
                    throw APIError.sessionExpired
                }
                throw APIError.http(http.statusCode, message)
            }
            return (data, http)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }

    /// The Worker answers a bad or expired bearer with 403 "Invalid or expired mobile
    /// session token". Per-mailbox ACL denials are also 403 but carry other text,
    /// so they keep their local handling (drop just that mailbox).
    static func isExpiredSessionResponse(statusCode: Int, message: String) -> Bool {
        guard statusCode == 401 || statusCode == 403 else { return false }
        return message.localizedCaseInsensitiveContains("invalid or expired mobile session token")
    }

    private static func postSessionExpired(token: String) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .inboxiesSessionExpired,
                object: nil,
                userInfo: ["token": token]
            )
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

    /// Deletes the signed-in account (App Store 5.1.1(v)). Solely owned mailboxes are
    /// purged; shared ones only drop this user.
    func deleteAccount() async throws -> DeleteAccountResponse {
        try await request(
            path: "/api/v1/me",
            method: "DELETE",
            body: ["confirm": "DELETE"]
        )
    }

    func listIdentities() async throws -> IdentitiesResponse {
        try await request(path: "/api/v1/me/identities")
    }

    func listAccounts() async throws -> [AccountSummary] {
        try await request(path: "/api/v1/accounts")
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

    func forgotPassword(email: String) async throws -> ForgotPasswordResponse {
        try await request(
            path: "/api/v1/auth/password/forgot",
            method: "POST",
            body: ["email": email],
            authed: false
        )
    }

    func resetPassword(token: String? = nil, code: String? = nil, email: String? = nil, newPassword: String) async throws -> PasswordLoginResponse {
        var body: [String: Any] = ["newPassword": newPassword]
        if let token, !token.isEmpty { body["token"] = token }
        if let code, !code.isEmpty { body["code"] = code }
        // The server only checks a 6-digit code against this account's reset.
        if let email, !email.isEmpty { body["email"] = email }
        return try await request(
            path: "/api/v1/auth/password/reset",
            method: "POST",
            body: body,
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

    // MARK: - Onboarding & Custom Domains

    func signupPersonal(
        username: String,
        password: String,
        displayName: String? = nil,
        backupEmail: String? = nil
    ) async throws -> OnboardingPersonalResponse {
        var body: [String: Any] = [
            "username": username,
            "password": password,
        ]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        if let backupEmail, !backupEmail.isEmpty { body["backupEmail"] = backupEmail }
        return try await request(
            path: "/api/v1/auth/signup-personal",
            method: "POST",
            body: body,
            authed: false
        )
    }

    func signupDomain(
        domain: String,
        username: String,
        password: String,
        displayName: String? = nil,
        backupEmail: String? = nil
    ) async throws -> OnboardingDomainResponse {
        var body: [String: Any] = [
            "domain": domain,
            "username": username,
            "password": password,
        ]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        if let backupEmail, !backupEmail.isEmpty { body["backupEmail"] = backupEmail }
        return try await request(
            path: "/api/v1/auth/signup-domain",
            method: "POST",
            body: body,
            authed: false
        )
    }

    func listDomainAliases(domain: String) async throws -> [DomainAliasItem] {
        let res: DomainAliasesResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/aliases"
        )
        return res.aliases
    }

    func createDomainAlias(domain: String, aliasLocal: String, targetMailboxId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/aliases",
            method: "POST",
            body: [
                "aliasLocal": aliasLocal,
                "targetMailboxId": targetMailboxId
            ]
        )
    }

    func deleteDomainAlias(domain: String, aliasLocal: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/aliases/\(aliasLocal.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func setupDomainAliases(domain: String, aliases: [[String: String]]) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/setup-aliases",
            method: "POST",
            body: ["aliases": aliases]
        )
    }

    func setupDomainUsers(domain: String, users: [[String: String]]) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/setup-users",
            method: "POST",
            body: ["users": users]
        )
    }

    // MARK: - Admin DNS Suite

    func listAdminDomains() async throws -> [AdminDomainInfo] {
        let res: AdminDomainsResponse = try await request(path: "/api/v1/admin/domains")
        return res.domains
    }

    func connectAdminDomain(domain: String) async throws -> AdminDomainConnectResponse {
        try await request(
            path: "/api/v1/admin/domains",
            method: "POST",
            body: ["domain": domain]
        )
    }

    func getDomainDnsHealth(domain: String) async throws -> DomainHealthResponse {
        try await request(path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/health")
    }

    func fixDomainEmailDns(domain: String) async throws -> FixEmailDnsResponse {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/fix-email",
            method: "POST",
            body: [:] as [String: Any]
        )
    }

    func listDomainDnsRecords(domain: String, type: String? = nil, name: String? = nil) async throws -> [CloudflareDnsRecord] {
        var query: [String: String] = [:]
        if let type, !type.isEmpty { query["type"] = type }
        if let name, !name.isEmpty { query["name"] = name }
        let res: DnsRecordsListResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/records",
            query: query
        )
        return res.records
    }

    func createDomainDnsRecord(domain: String, type: String, name: String, content: String, ttl: Int = 1, proxied: Bool = false, priority: Int? = nil, comment: String? = nil) async throws -> CloudflareDnsRecord {
        var body: [String: Any] = [
            "type": type,
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
        ]
        if let priority { body["priority"] = priority }
        if let comment, !comment.isEmpty { body["comment"] = comment }
        let res: DnsRecordMutationResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/records",
            method: "POST",
            body: body
        )
        return res.record
    }

    func updateDomainDnsRecord(domain: String, recordId: String, type: String, name: String, content: String, ttl: Int = 1, proxied: Bool = false, priority: Int? = nil, comment: String? = nil) async throws -> CloudflareDnsRecord {
        var body: [String: Any] = [
            "type": type,
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": proxied,
        ]
        if let priority { body["priority"] = priority }
        if let comment, !comment.isEmpty { body["comment"] = comment }
        let res: DnsRecordMutationResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/records/\(recordId.urlPathEncoded)",
            method: "PUT",
            body: body
        )
        return res.record
    }

    func deleteDomainDnsRecord(domain: String, recordId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/dns/records/\(recordId.urlPathEncoded)",
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

    /// `sessionToken` lets sign-out unregister with the outgoing session after the
    /// shared token has already been cleared.
    func unregisterDeviceToken(mailboxId: String, token: String, sessionToken: String? = nil) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/device-token/\(token.urlPathEncoded)",
            method: "DELETE",
            bearerToken: sessionToken
        )
    }

    // MARK: - Registrar & Billing

    func checkDomainAvailability(domain: String) async throws -> DomainAvailabilityResponse {
        try await request(
            path: "/api/v1/auth/domains/check",
            query: ["domain": domain]
        )
    }

    func createDomainCheckout(
        domain: String,
        username: String? = nil,
        password: String? = nil,
        displayName: String? = nil,
        returnUrl: String? = nil,
        client: String? = "ios"
    ) async throws -> DomainCheckoutResponse {
        var body: [String: Any] = ["domain": domain]
        if let username { body["username"] = username }
        if let password { body["password"] = password }
        if let displayName { body["displayName"] = displayName }
        if let returnUrl { body["returnUrl"] = returnUrl }
        if let client { body["client"] = client }
        return try await request(
            path: "/api/v1/billing/create-domain-checkout",
            method: "POST",
            body: body
        )
    }

    // MARK: - Email Export Engine

    func exportDomain(domain: String) async throws -> ExportJob {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/export",
            method: "POST"
        )
    }

    func getExportJob(exportId: String) async throws -> ExportJob {
        try await request(path: "/api/v1/exports/\(exportId.urlPathEncoded)")
    }

    /// Streams the finished .mbox through the authenticated session into a temp file
    /// the share sheet can hand to Files / Mail. The download route needs the bearer.
    func downloadExport(jobId: String, suggestedName: String? = nil) async throws -> URL {
        guard let url = Self.makeURL(path: "/api/v1/exports/\(jobId.urlPathEncoded)/download") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (tempURL, response) = try await session.download(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.http(-1, "No HTTP response")
            }
            guard (200..<300).contains(http.statusCode) else {
                let data = (try? Data(contentsOf: tempURL)) ?? Data()
                throw APIError.http(http.statusCode, httpErrorMessage(from: data))
            }
            let filename = Self.exportFilename(
                contentDisposition: http.value(forHTTPHeaderField: "Content-Disposition"),
                fallback: suggestedName ?? "inboxies-export-\(jobId).mbox"
            )
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("exports", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent(filename)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: tempURL, to: destination)
            return destination
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error)
        }
    }

    /// `attachment; filename="x.mbox"` → `x.mbox`, reduced to a safe last path component.
    static func exportFilename(contentDisposition: String?, fallback: String) -> String {
        var name = fallback
        if let header = contentDisposition,
           let range = header.range(of: #"filename="?([^";]+)"?"#, options: .regularExpression) {
            let raw = String(header[range])
                .replacingOccurrences(of: "filename=", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
            if !raw.isEmpty { name = raw }
        }
        let safe = (name as NSString).lastPathComponent
            .replacingOccurrences(of: ":", with: "-")
        return safe.isEmpty || safe == "." || safe == ".." ? fallback : safe
    }

    // MARK: - DNS Offboarding & Decommission

    func getDecommissionPreflight(domain: String) async throws -> DecommissionPreflightResponse {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/decommission-preflight",
            method: "POST"
        )
    }

    func decommissionDomain(
        domain: String,
        confirmDomain: String,
        skipExportAcknowledged: Bool = false
    ) async throws -> DecommissionResponse {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/decommission",
            method: "POST",
            body: [
                "confirmDomain": confirmDomain,
                "skipExportAcknowledged": skipExportAcknowledged
            ]
        )
    }

    func getDomainEppCode(domain: String) async throws -> DomainEppCodeResponse {
        try await request(path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/epp-code")
    }

    func setDomainTransferLock(domain: String, locked: Bool) async throws -> DomainTransferLockResponse {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/transfer-lock",
            method: "POST",
            body: ["locked": locked]
        )
    }

    // MARK: - Masked Email Aliases

    func listAliases(mailboxId: String) async throws -> [MaskedAlias] {
        let response: AliasesResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases"
        )
        return response.aliases
    }

    func createAlias(
        mailboxId: String,
        label: String? = nil,
        notes: String? = nil,
        expiresInSeconds: Int? = nil,
        expiresAt: String? = nil,
        pausedAction: String = "drop"
    ) async throws -> MaskedAlias {
        // camelCase like web; the Worker also folds snake_case for older builds.
        var body: [String: Any] = [
            "pausedAction": pausedAction
        ]
        if let label, !label.isEmpty { body["label"] = label }
        if let notes, !notes.isEmpty { body["notes"] = notes }
        if let expiresAt {
            body["expiresAt"] = expiresAt
        } else if let expiresInSeconds, expiresInSeconds > 0 {
            body["expiresAt"] = Self.isoTimestamp(Date().addingTimeInterval(TimeInterval(expiresInSeconds)))
        }

        let response: CreateAliasResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases",
            method: "POST",
            body: body
        )
        return response.alias
    }

    func updateAlias(
        mailboxId: String,
        aliasId: String,
        isActive: Bool? = nil,
        label: String? = nil,
        notes: String? = nil,
        pausedAction: String? = nil,
        expiresAt: String? = nil
    ) async throws -> MaskedAlias {
        var body: [String: Any] = [:]
        if let isActive { body["isActive"] = isActive }
        if let label { body["label"] = label }
        if let notes { body["notes"] = notes }
        if let pausedAction { body["pausedAction"] = pausedAction }
        if let expiresAt { body["expiresAt"] = expiresAt }

        let response: CreateAliasResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases/\(aliasId.urlPathEncoded)",
            method: "PATCH",
            body: body
        )
        return response.alias
    }

    /// ISO-8601 with `Z`, the form zod's `datetime()` accepts.
    static func isoTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    func deleteAlias(mailboxId: String, aliasId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases/\(aliasId.urlPathEncoded)",
            method: "DELETE"
        )
    }
}

struct EmptyResponse: Decodable {}

extension Notification.Name {
    /// Posted on the main queue when the Worker rejects the current bearer token.
    /// `userInfo["token"]` is the rejected token, so a stale request cannot sign out a newer session.
    static let inboxiesSessionExpired = Notification.Name("inboxiesSessionExpired")
}

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

func httpErrorMessage(from data: Data) -> String {
    if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        if let error = obj["error"] as? String, !error.isEmpty {
            return error
        }
        // 428 domain_verification_required: spell out the TXT record if the
        // Worker ever omits the human message.
        if (obj["code"] as? String) == "domain_verification_required",
           let verification = obj["verification"] as? [String: Any],
           let name = verification["recordName"] as? String,
           let value = verification["recordValue"] as? String {
            let type = verification["recordType"] as? String ?? "TXT"
            return "Verify you own this domain: add a \(type) record named \(name) with value \(value), then try again."
        }
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
    /// Percent-encodes one path segment (including `/`, `?`, `#`). Pair with
    /// `APIClient.makeURL`, which writes the path without escaping `%` again.
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathSegmentAllowed) ?? self
    }
}

private extension CharacterSet {
    static let urlPathSegmentAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove(charactersIn: "/")
        return set
    }()
}

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
    /// 403 `code: "service_ended"`: the domain's subscription ended and its mailboxes are
    /// read-only. Access is intact; never treat this as losing the mailbox or the session.
    case serviceEnded(domain: String?, message: String)
    /// 409 `code: "recipient_suppressed"`: a recipient bounced or complained earlier, so the
    /// send was refused before anything went out. `message` is the server's sentence.
    case recipientSuppressed(message: String, suppressed: [SuppressedRecipient])
    /// 401 `code: "TWO_FACTOR_REQUIRED"` from password sign-in: the password was right,
    /// and the account wants an authenticator or backup code before it hands out a session.
    case twoFactorRequired(TwoFactorChallenge)

    /// True for a write refused because the domain's service ended.
    var isServiceEnded: Bool {
        if case .serviceEnded = self { return true }
        return false
    }

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
        case .serviceEnded(let domain, let message):
            if !message.isEmpty { return message }
            return "The subscription for \(domain ?? "this domain") has ended. Mail on it is read-only until it's renewed."
        case .recipientSuppressed(let message, _):
            return message.isEmpty ? "Not sent: a recipient is suppressed." : message
        case .twoFactorRequired:
            return "Enter the code from your authenticator app."
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
        storedAuthToken = KeychainStore.read(AuthStore.tokenKey, in: .app)
    }

    func request<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authed: Bool = true,
        bearerToken: String? = nil,
        headers: [String: String] = [:]
    ) async throws -> T {
        try await requestWithResponse(
            path: path,
            method: method,
            query: query,
            body: body,
            authed: authed,
            bearerToken: bearerToken,
            headers: headers
        ).0
    }

    /// `request`, plus the HTTP response for callers that need its headers
    /// (the passkey challenge cookie, `set-auth-token`).
    func requestWithResponse<T: Decodable>(
        path: String,
        method: String = "GET",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authed: Bool = true,
        bearerToken: String? = nil,
        headers: [String: String] = [:]
    ) async throws -> (T, HTTPURLResponse) {
        let (data, http) = try await perform(
            path: path,
            method: method,
            query: query,
            body: body,
            authed: authed,
            bearerToken: bearerToken,
            headers: headers
        )
        return (try decodeResponse(data: data, http: http), http)
    }

    private func decodeResponse<T: Decodable>(data: Data, http: HTTPURLResponse) throws -> T {
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
        try await perform(path: path, method: method, query: query, body: nil, authed: authed, bearerToken: nil, headers: [:])
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
        bearerToken: String?,
        headers: [String: String]
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = Self.makeURL(path: path, query: query) else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
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
                if let ended = Self.serviceEndedError(statusCode: http.statusCode, data: data) {
                    if case .serviceEnded(let domain, let endedMessage) = ended {
                        Self.postServiceEnded(domain: domain, message: endedMessage)
                    }
                    throw ended
                }
                if let blocked = BounceSuppression.error(statusCode: http.statusCode, data: data) {
                    throw blocked
                }
                if http.statusCode == 401, let challenge = TwoFactorChallenge.parse(data) {
                    throw APIError.twoFactorRequired(challenge)
                }
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

    /// A write blocked because the domain's subscription ended: 403 with
    /// `{ error, code: "service_ended", domain }`. Other 403s keep their meaning.
    static func serviceEndedError(statusCode: Int, data: Data) -> APIError? {
        guard statusCode == 403,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["code"] as? String) == "service_ended" else { return nil }
        let domain = (obj["domain"] as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() }
        return .serviceEnded(domain: domain, message: (obj["error"] as? String) ?? "")
    }

    /// AppModel marks the domain read-only once, whichever request found out first.
    private static func postServiceEnded(domain: String?, message: String) {
        DispatchQueue.main.async {
            var info: [String: String] = ["message": message]
            if let domain { info["domain"] = domain }
            NotificationCenter.default.post(name: .inboxiesServiceEnded, object: nil, userInfo: info)
        }
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

    /// Revokes this session on the server. `sessionToken` pins the outgoing
    /// session during sign-out, after AuthStore has dropped it.
    func logout(sessionToken: String?) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/auth/logout",
            method: "POST",
            body: [:] as [String: Any],
            bearerToken: sessionToken
        )
    }

    func listIdentities() async throws -> IdentitiesResponse {
        try await request(path: "/api/v1/me/identities")
    }

    func attachAppleIdentity(_ credential: AppleSignInCredential) async throws -> AttachIdentityResponse {
        var body = credential.requestBody
        body["provider"] = "apple"
        return try await request(
            path: "/api/v1/me/identities/attach",
            method: "POST",
            body: body
        )
    }

    /// Disconnects a sign-in method (`apple`, `google`, `password`). The server
    /// refuses to remove the last one.
    func removeIdentity(type: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/me/identities/\(type.urlPathEncoded)",
            method: "DELETE"
        )
    }

    // MARK: Sessions

    func listSessions() async throws -> [AccountSession] {
        try await request(path: "/api/v1/me/sessions")
    }

    func revokeSession(id: String, sessionToken: String? = nil) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/me/sessions/\(id.urlPathEncoded)",
            method: "DELETE",
            bearerToken: sessionToken
        )
    }

    func revokeOtherSessions() async throws -> RevokeSessionsResponse {
        try await request(path: "/api/v1/me/sessions/revoke-others", method: "POST", body: [:] as [String: Any])
    }

    // MARK: Connected apps (MCP OAuth grants)

    func listMcpGrants() async throws -> [McpGrant] {
        try await request(path: "/api/v1/me/mcp-grants")
    }

    /// Disconnects the app: the grant and all its tokens are deleted server-side.
    func revokeMcpGrant(id: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/me/mcp-grants/\(id.urlPathEncoded)",
            method: "DELETE"
        )
    }

    /// A scoped, revocable session for the AutoFill extension (private emails only).
    func createAutofillSession() async throws -> ScopedSessionResponse {
        try await request(
            path: "/api/v1/me/extension-session",
            method: "POST",
            body: ["client": "ios-autofill"]
        )
    }

    // MARK: Recovery email

    func getRecoveryEmail() async throws -> RecoveryEmailStatus {
        try await request(path: "/api/v1/me/recovery-email")
    }

    /// Sets (or replaces) the recovery email and mails it a 6-digit code.
    func setRecoveryEmail(_ email: String) async throws -> RecoveryEmailStatus {
        try await request(path: "/api/v1/me/recovery-email", method: "POST", body: ["email": email])
    }

    func verifyRecoveryEmail(code: String) async throws -> RecoveryEmailStatus {
        try await request(path: "/api/v1/me/recovery-email/verify", method: "POST", body: ["code": code])
    }

    func removeRecoveryEmail() async throws {
        let _: EmptyResponse = try await request(path: "/api/v1/me/recovery-email", method: "DELETE")
    }

    func attachGoogleIdentity(_ credential: GoogleSignInCredential) async throws -> AttachIdentityResponse {
        var body = credential.requestBody
        body["provider"] = "google"
        return try await request(
            path: "/api/v1/me/identities/attach",
            method: "POST",
            body: body
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
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)",
            method: "PUT",
            body: ["settings": try Self.settingsPayload(settings)]
        )
    }

    /// The PUT body's `settings`. `acl` is display-only (the server derives it
    /// from members), so it is never sent back.
    static func settingsPayload(_ settings: MailboxSettings) throws -> [String: Any] {
        var settings = settings
        settings.acl = nil
        let data = try JSONEncoder().encode(settings)
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
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

    /// Mails a code to the invited address; accepting with it proves the invite reached them.
    func sendInviteCode(token: String) async throws -> InviteCodeResponse {
        try await request(
            path: "/api/v1/invites/\(token.urlPathEncoded)/otp",
            method: "POST",
            body: [:] as [String: Any],
            authed: false
        )
    }

    /// Signed in (`password` nil): joins the current account; the session is unchanged.
    /// Signed out: creates an account with `password` and returns its session.
    func acceptInvite(token: String, code: String, password: String?, displayName: String?) async throws -> InviteAcceptResponse {
        var body: [String: Any] = ["code": code]
        if let password { body["password"] = password }
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        return try await request(
            path: "/api/v1/invites/\(token.urlPathEncoded)/accept",
            method: "POST",
            body: body,
            authed: password == nil
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

    /// Second step of a password sign-in when the account has two-factor on: the
    /// challenge token from the sign-in reply plus an authenticator code
    /// (`method: "totp"`) or a one-time backup code (`method: "backup_code"`).
    func verifyTwoFactor(challengeToken: String, code: String, method: String) async throws -> PasswordLoginResponse {
        try await request(
            path: "/api/v1/auth/two-factor/verify",
            method: "POST",
            body: ["twoFactorToken": challengeToken, "code": code, "method": method],
            authed: false
        )
    }

    /// Pass `token` (email link), or `email` + `code` (6-digit code).
    func resetPassword(token: String? = nil, email: String? = nil, code: String? = nil, newPassword: String) async throws -> ResetPasswordResponse {
        var body: [String: Any] = ["newPassword": newPassword]
        if let token, !token.isEmpty { body["token"] = token }
        if let email, !email.isEmpty { body["email"] = email }
        if let code, !code.isEmpty { body["code"] = code }
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

    // MARK: Members

    func listMembers(mailboxId: String) async throws -> [MailboxMember] {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/members")
    }

    func setMemberRole(mailboxId: String, userId: String, role: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/members/\(userId.urlPathEncoded)",
            method: "PATCH",
            body: ["role": role]
        )
    }

    /// Owners remove anyone; anyone may remove themselves (leave the mailbox).
    func removeMember(mailboxId: String, userId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/members/\(userId.urlPathEncoded)",
            method: "DELETE"
        )
    }

    /// Owners and domain admins only.
    func listMailboxInvites(mailboxId: String) async throws -> [MailboxInviteRow] {
        try await request(path: "/api/v1/admin/mailboxes/\(mailboxId.urlPathEncoded)/invites")
    }

    /// `inviteId` is the id from `listMailboxInvites`.
    func revokeInvite(inviteId: String) async throws {
        let _: MailboxInviteRow = try await request(
            path: "/api/v1/admin/invites/\(inviteId.urlPathEncoded)/revoke",
            method: "POST",
            body: [:] as [String: Any]
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

    /// Threaded folder page. Inbox only: `newLimit` keeps the newest N New conversations above
    /// every Seen one; `section` (`new` | `seen`) lists one section (AVE-23).
    func listEmails(
        mailboxId: String,
        folder: String,
        page: Int = 1,
        newLimit: Int? = nil,
        section: String? = nil
    ) async throws -> EmailListResponse {
        var query = [
            "folder": folder,
            "threaded": "true",
            "page": String(page),
            "limit": "25",
        ]
        if let newLimit { query["new_limit"] = String(newLimit) }
        if let section { query["section"] = section }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails",
            query: query
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
        replyLater: Bool? = nil,
        replyLaterRemindAt: ReplyLaterRemindAtPatch? = nil
    ) async throws -> Email {
        var body: [String: Any] = [:]
        if let read { body["read"] = read }
        if let starred { body["starred"] = starred }
        if let replyLater { body["reply_later"] = replyLater }
        switch replyLaterRemindAt {
        case .set(let iso): body["reply_later_remind_at"] = iso
        case .clear: body["reply_later_remind_at"] = NSNull()
        case nil: break
        }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)",
            method: "PUT",
            body: body
        )
    }

    // MARK: Notes to self (private to the signed-in user)

    func listThreadNotes(mailboxId: String, threadId: String) async throws -> [ThreadNote] {
        let response: ThreadNotesResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/threads/\(threadId.urlPathEncoded)/notes"
        )
        return response.notes
    }

    func createThreadNote(
        mailboxId: String,
        threadId: String,
        body: String,
        noteType: String,
        emailId: String? = nil,
        position: CGPoint? = nil
    ) async throws -> ThreadNote {
        var payload: [String: Any] = ["body": body, "noteType": noteType]
        if let emailId { payload["emailId"] = emailId }
        if let position {
            payload["posX"] = Double(position.x)
            payload["posY"] = Double(position.y)
        }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/threads/\(threadId.urlPathEncoded)/notes",
            method: "POST",
            body: payload
        )
    }

    /// PATCH a note's body and/or position (at least one).
    func updateThreadNote(
        mailboxId: String,
        noteId: String,
        body: String? = nil,
        position: CGPoint? = nil
    ) async throws -> ThreadNote {
        var payload: [String: Any] = [:]
        if let body { payload["body"] = body }
        if let position {
            payload["posX"] = Double(position.x)
            payload["posY"] = Double(position.y)
        }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/notes/\(noteId.urlPathEncoded)",
            method: "PATCH",
            body: payload
        )
    }

    func deleteThreadNote(mailboxId: String, noteId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/notes/\(noteId.urlPathEncoded)",
            method: "DELETE"
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

    @discardableResult
    func moveEmail(
        mailboxId: String,
        id: String,
        folderId: String,
        setSenderPreference: Bool = false,
        unsubscribe: Bool = false,
        refileSender: Bool = true
    ) async throws -> MoveEmailResponse {
        var body: [String: Any] = ["folderId": folderId]
        if setSenderPreference {
            body["setSenderPreference"] = true
        }
        if unsubscribe {
            body["unsubscribe"] = true
        }
        if !refileSender {
            // Report spam with "Move their other mail to Spam" off (AVE-98).
            body["refileSender"] = false
        }
        return try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)/move",
            method: "POST",
            body: body
        )
    }

    /// Undo a Not spam / Report spam: the sender's rule and every message it moved (AVE-98).
    func undoSenderVerdict(mailboxId: String, undoToken: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-rules/undo",
            method: "POST",
            body: ["undoToken": undoToken]
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

    /// Today's AI chat / inbound AI usage against the mailbox's daily limits (AVE-45).
    func fetchAIUsage(mailboxId: String) async throws -> AIUsage {
        try await request(path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/ai-usage")
    }

    func listSenderRules(mailboxId: String, verdict: String) async throws -> [SenderRule] {
        let response: SenderRulesResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-rules",
            query: ["verdict": verdict, "limit": "500"]
        )
        return response.rules
    }

    /// Creates or updates an allow / block rule from Settings. A refused value
    /// (free-mail provider, public suffix, bad address) throws `.http(400, message)`
    /// with the server's sentence, which the screen shows inline.
    func upsertSenderRule(
        mailboxId: String,
        kind: String,
        value: String,
        verdict: String
    ) async throws -> SenderRule {
        let response: SenderRuleResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-rules",
            method: "PUT",
            body: ["kind": kind, "value": value, "verdict": verdict, "source": "settings"]
        )
        return response.rule
    }

    func deleteSenderRule(mailboxId: String, ruleId: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/sender-rules/\(ruleId.urlPathEncoded)",
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

    func deleteEmail(mailboxId: String, id: String, bearerToken: String? = nil) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(id.urlPathEncoded)",
            method: "DELETE",
            bearerToken: bearerToken
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

    /// Header for send / reply / forward: one key per compose, reused on every retry.
    /// The server answers a repeated key with the original `202 { id, status }`.
    static let idempotencyKeyHeader = "Idempotency-Key"

    static func idempotencyHeaders(_ key: String?) -> [String: String] {
        guard let key, !key.isEmpty else { return [:] }
        return [idempotencyKeyHeader: key]
    }

    func sendEmail(
        mailboxId: String,
        payload: [String: Any],
        bearerToken: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails",
            method: "POST",
            body: payload,
            bearerToken: bearerToken,
            headers: Self.idempotencyHeaders(idempotencyKey)
        )
    }

    func replyToEmail(
        mailboxId: String,
        emailId: String,
        payload: [String: Any],
        bearerToken: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(emailId.urlPathEncoded)/reply",
            method: "POST",
            body: payload,
            bearerToken: bearerToken,
            headers: Self.idempotencyHeaders(idempotencyKey)
        )
    }

    func forwardEmail(
        mailboxId: String,
        emailId: String,
        payload: [String: Any],
        bearerToken: String? = nil,
        idempotencyKey: String? = nil
    ) async throws -> SendEmailResponse {
        try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/emails/\(emailId.urlPathEncoded)/forward",
            method: "POST",
            body: payload,
            bearerToken: bearerToken,
            headers: Self.idempotencyHeaders(idempotencyKey)
        )
    }

    /// The bounce / complaint suppressions this mailbox can see (AVE-37 / AVE-157).
    func listSuppressions(mailboxId: String) async throws -> SuppressionList {
        let (data, _) = try await requestData(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/suppressions"
        )
        guard let list = BounceSuppression.list(data: data) else {
            throw APIError.decoding(
                DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not a suppression list"))
            )
        }
        return list
    }

    /// Lifts a bounce / complaint suppression (AVE-37). 404 means it is already gone;
    /// 403 `suppression_not_manageable` means only a domain admin can lift it.
    func unsuppress(mailboxId: String, address: String) async throws {
        let normalized = address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let _: EmptyResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/suppressions/\(normalized.urlPathEncoded)",
            method: "DELETE"
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
        backupEmail: String? = nil,
        returnUrl: String? = nil,
        client: String? = "ios"
    ) async throws -> DomainCheckoutResponse {
        var body: [String: Any] = ["domain": domain]
        if let username { body["username"] = username }
        if let password { body["password"] = password }
        if let displayName { body["displayName"] = displayName }
        // Domain owners need a recovery email for billing and renewal notices.
        if let backupEmail, !backupEmail.isEmpty { body["backupEmail"] = backupEmail }
        if let returnUrl { body["returnUrl"] = returnUrl }
        if let client { body["client"] = client }
        return try await request(
            path: "/api/v1/billing/create-domain-checkout",
            method: "POST",
            body: body
        )
    }

    /// Where a paid domain's subscription stands. Domain admins, or anyone with a
    /// mailbox on the domain; 403 for anyone else.
    func getDomainService(domain: String) async throws -> DomainService {
        try await request(path: "/api/v1/billing/domains/\(domain.urlPathEncoded)/service")
    }

    /// Domain admins only: keeps an ending subscription, or opens a renewal Checkout.
    func renewDomain(domain: String) async throws -> DomainRenewResponse {
        try await request(
            path: "/api/v1/billing/domains/\(domain.urlPathEncoded)/renew",
            method: "POST",
            body: ["client": "ios"]
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

    /// Decommissioned domains of the caller still waiting to be deleted.
    func listOffboardingDomains() async throws -> [OffboardingDomain] {
        let response: OffboardingDomainsResponse = try await request(path: "/api/v1/admin/offboarding-domains")
        return response.domains
    }

    /// Delete a decommissioned domain's data now. `confirmDomain` must be the domain name (checked server-side).
    func finalizeDomain(domain: String, confirmDomain: String) async throws -> FinalizeDomainResponse {
        try await request(
            path: "/api/v1/admin/domains/\(domain.urlPathEncoded)/finalize",
            method: "POST",
            body: ["confirmDomain": confirmDomain]
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

    // MARK: - Private Emails

    func listAliases(mailboxId: String) async throws -> [MaskedAlias] {
        let response: AliasesResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases"
        )
        return response.aliases
    }

    /// The server picks the address. Body keys are camelCase; the Worker's
    /// schema silently drops anything else.
    func createAlias(
        mailboxId: String,
        label: String? = nil,
        expiresAt: Date? = nil,
        pausedAction: String = "drop"
    ) async throws -> MaskedAlias {
        // camelCase like web; the Worker also folds snake_case for older builds.
        var body: [String: Any] = [
            "pausedAction": pausedAction
        ]
        if let label, !label.isEmpty { body["label"] = label }
        if let expiresAt { body["expiresAt"] = AliasExpiry.at(expiresAt).apiValue }

        let response: CreateAliasResponse = try await request(
            path: "/api/v1/mailboxes/\(mailboxId.urlPathEncoded)/aliases",
            method: "POST",
            body: body
        )
        return response.alias
    }

    /// Nil arguments are left unchanged. An empty `label` clears it (JSON null).
    func updateAlias(
        mailboxId: String,
        aliasId: String,
        isActive: Bool? = nil,
        label: String? = nil,
        pausedAction: String? = nil,
        expiry: AliasExpiry? = nil
    ) async throws -> MaskedAlias {
        var body: [String: Any] = [:]
        if let isActive { body["isActive"] = isActive }
        if let label {
            body["label"] = label.isEmpty ? NSNull() as Any : label as Any
        }
        if let pausedAction { body["pausedAction"] = pausedAction }
        if let expiry { body["expiresAt"] = expiry.apiValue }

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
    /// Posted on the main queue when a write is refused because a domain's subscription
    /// ended. `userInfo["domain"]` (when sent) and `userInfo["message"]` are strings.
    static let inboxiesServiceEnded = Notification.Name("inboxiesServiceEnded")
}

struct WorkflowPile: Decodable {
    let id: String
    let count: Int
    /// Reply Later mails whose reminder fired and are still unread (AVE-86).
    /// Nil on older Workers that don't send it.
    var dueCount: Int? = nil

    enum CodingKeys: String, CodingKey {
        case id, count
        case dueCount = "due_count"
    }
}

/// `reply_later_remind_at` in the email PUT (AVE-86): set a UTC ISO time (also adds the
/// mail to Reply Later) or clear the pending reminder (the mail stays in the pile).
enum ReplyLaterRemindAtPatch: Equatable {
    case set(String)
    case clear
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

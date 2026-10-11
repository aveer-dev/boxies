import Foundation

/// The two calls Private email AutoFill makes, authed with the session the
/// Inboxies app shares through the Keychain.
struct AutofillAPI {
    struct Mailbox: Decodable, Identifiable, Hashable {
        let id: String
        let email: String
    }

    enum Failure: LocalizedError {
        case sessionExpired
        case server(status: Int, message: String)

        var errorDescription: String? {
            switch self {
            case .sessionExpired:
                return "Your session expired. Open Inboxies and sign in again."
            case .server(_, let message):
                return message.isEmpty ? "Couldn't reach Inboxies. Try again." : message
            }
        }
    }

    let baseURL: URL
    let token: String

    /// The app's saved session; nil when signed out, or when the app hasn't
    /// been opened since the update that started sharing it.
    static func sharedSession() -> AutofillAPI? {
        guard let token = KeychainStore.read(KeychainStore.sessionTokenKey), !token.isEmpty else { return nil }
        let baseURL = KeychainStore.read(KeychainStore.apiBaseKey).flatMap(AppConfig.parseAPIBaseURL) ?? AppConfig.apiBaseURL
        return AutofillAPI(baseURL: baseURL, token: token)
    }

    func mailboxes() async throws -> [Mailbox] {
        try await send(path: "/api/v1/mailboxes", method: "GET", body: nil)
    }

    /// Creates a private address on the server and returns it.
    func createAlias(mailboxId: String, label: String?) async throws -> String {
        struct Created: Decodable {
            struct Alias: Decodable {
                let aliasEmail: String
                enum CodingKeys: String, CodingKey { case aliasEmail = "alias_email" }
            }
            let alias: Alias
        }
        var body: [String: Any] = ["pausedAction": "drop"]
        if let label, !label.isEmpty { body["label"] = label }
        let segment = mailboxId.addingPercentEncoding(withAllowedCharacters: Self.pathSegmentAllowed) ?? mailboxId
        let created: Created = try await send(path: "/api/v1/mailboxes/\(segment)/aliases", method: "POST", body: body)
        return created.alias.aliasEmail
    }

    private static let pathSegmentAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove(charactersIn: "/")
        return set
    }()

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    /// `path` is already percent-encoded.
    private func send<T: Decodable>(path: String, method: String, body: [String: Any]?) async throws -> T {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw Failure.server(status: -1, message: "")
        }
        let basePath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedPath = basePath.isEmpty ? path : "/\(basePath)\(path)"
        guard let url = components.url else { throw Failure.server(status: -1, message: "") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await Self.session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? ""
            // Same signal APIClient uses: a dead bearer is 401/403 with this text.
            if status == 401 || (status == 403 && message.localizedCaseInsensitiveContains("invalid or expired mobile session token")) {
                throw Failure.sessionExpired
            }
            throw Failure.server(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

/// The bearer token must never follow a redirect to another host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}

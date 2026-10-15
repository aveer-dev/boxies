import Foundation

/// The extension's API calls, on its own scoped session (private emails only),
/// which the app mints and shares through the keychain group. The server picks
/// new addresses; the extension never invents one.
enum PrivateEmailClient {
    enum Failure: LocalizedError {
        case signedOut
        case server(String)

        var errorDescription: String? {
            switch self {
            case .signedOut: return "Open Inboxies and sign in first"
            case .server(let message): return message
            }
        }
    }

    private struct Session {
        let token: String
        let mailboxId: String
    }

    private struct ListResponse: Decodable {
        let aliases: [PrivateEmail]
    }

    private struct CreateResponse: Decodable {
        let alias: PrivateEmail
    }

    static var isSignedIn: Bool {
        #if DEBUG
        if SharedSession.previewAutofill { return true }
        #endif
        return session != nil
    }

    private static var session: Session? {
        guard let token = SharedSession.token,
              let mailboxId = SharedSession.activeMailboxId else { return nil }
        return Session(token: token, mailboxId: mailboxId)
    }

    /// `GET /api/v1/mailboxes/{id}/aliases`; newest first, as the server sends them.
    static func listAliases() async throws -> [PrivateEmail] {
        #if DEBUG
        if SharedSession.previewAutofill { return PrivateEmail.previewFixtures }
        #endif
        let data = try await send(method: "GET", body: nil)
        guard let list = try? JSONDecoder().decode(ListResponse.self, from: data) else {
            throw Failure.server("Unexpected response from Inboxies.")
        }
        return list.aliases
    }

    /// `POST /api/v1/mailboxes/{id}/aliases`; returns the new private email.
    static func createAlias(label: String?) async throws -> PrivateEmail {
        var body: [String: Any] = ["pausedAction": "drop"]
        let trimmed = label?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            body["label"] = String(trimmed.prefix(100))
        }
        #if DEBUG
        if SharedSession.previewAutofill {
            try? await Task.sleep(nanoseconds: 400_000_000)
            return PrivateEmail(id: UUID().uuidString, address: "k4v9q2@private.inboxies.dev", label: trimmed)
        }
        #endif
        let data = try await send(method: "POST", body: body)
        guard let created = try? JSONDecoder().decode(CreateResponse.self, from: data),
              !created.alias.address.isEmpty else {
            throw Failure.server("Unexpected response from Inboxies.")
        }
        return created.alias
    }

    private static func send(method: String, body: [String: Any]?) async throws -> Data {
        guard let session else { throw Failure.signedOut }

        let base = SharedSession.apiBaseURL
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw Failure.server("Invalid API URL")
        }
        var pathAllowed = CharacterSet.urlPathAllowed
        pathAllowed.remove("/")
        let mailbox = session.mailboxId.addingPercentEncoding(withAllowedCharacters: pathAllowed) ?? session.mailboxId
        let basePath = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.percentEncodedPath = (basePath.isEmpty ? "" : "/\(basePath)") + "/api/v1/mailboxes/\(mailbox)/aliases"
        guard let url = components.url else { throw Failure.server("Invalid API URL") }

        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        // A missing, expired or revoked session: the app mints a new one when opened.
        if status == 401 || (status == 403 && isExpiredSession(data)) { throw Failure.signedOut }
        guard (200..<300).contains(status) else {
            let fallback = method == "GET"
                ? "Couldn’t load your private emails (HTTP \(status))."
                : "Couldn’t create a private email (HTTP \(status))."
            throw Failure.server(serverMessage(from: data) ?? fallback)
        }
        return data
    }

    private static func isExpiredSession(_ data: Data) -> Bool {
        serverMessage(from: data)?.localizedCaseInsensitiveContains("invalid or expired mobile session token") ?? false
    }

    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String, !message.isEmpty else { return nil }
        return message
    }
}

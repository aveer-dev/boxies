import Foundation

/// The one API call the extension makes, on the app's shared session.
/// The server picks the address; the extension never invents one.
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

    private struct CreateResponse: Decodable {
        struct Alias: Decodable {
            let aliasEmail: String

            enum CodingKeys: String, CodingKey {
                case aliasEmail = "alias_email"
            }
        }

        let alias: Alias
    }

    static var isSignedIn: Bool { session != nil }

    private static var session: Session? {
        guard let token = SharedSession.token,
              let mailboxId = SharedSession.activeMailboxId else { return nil }
        return Session(token: token, mailboxId: mailboxId)
    }

    /// `POST /api/v1/mailboxes/{id}/aliases`; returns the new address.
    static func createAlias(label: String?) async throws -> String {
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

        var body: [String: Any] = ["pausedAction": "drop"]
        if let label = label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            body["label"] = String(label.prefix(100))
        }

        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        if status == 401 { throw Failure.signedOut }
        guard (200..<300).contains(status) else {
            throw Failure.server(serverMessage(from: data) ?? "Couldn’t create a private email (HTTP \(status)).")
        }
        guard let created = try? JSONDecoder().decode(CreateResponse.self, from: data),
              !created.alias.aliasEmail.isEmpty else {
            throw Failure.server("Unexpected response from Inboxies.")
        }
        return created.alias.aliasEmail
    }

    private static func serverMessage(from data: Data) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String, !message.isEmpty else { return nil }
        return message
    }
}

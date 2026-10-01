import Foundation

/// Runtime configuration. Change `apiBaseURL` to your Worker URL (or localhost via Mac for simulator).
enum AppConfig {
    /// Production Worker URL, e.g. https://inboxies.email
    /// Simulator tip: use http://127.0.0.1:5173 when running `pnpm dev` on the same Mac.
    static var apiBaseURL: URL {
        #if DEBUG
        if let idx = ProcessInfo.processInfo.arguments.firstIndex(of: "-apiBase"),
           idx + 1 < ProcessInfo.processInfo.arguments.count,
           let url = parseAPIBaseURL(ProcessInfo.processInfo.arguments[idx + 1]) {
            return url
        }
        #endif
        if let override = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = parseAPIBaseURL(override) {
            return url
        }
        return URL(string: "https://inboxies.email")!
    }

    /// Must match APPLE_CLIENT_ID / Xcode bundle identifier.
    static let bundleID = "co.inboxies.app"

    static let agentPathPrefix = "/agents/email-agent"

    /// Dev login (`/api/v1/auth/dev`) is disabled on deployed Workers.
    static var isLocalDevelopmentAPI: Bool {
        guard let host = apiBaseURL.host?.lowercased() else { return false }
        return host == "localhost" || host == "127.0.0.1" || host == "::1"
    }

    /// Accepts a full origin (`https://inboxies.email`) or a bare domain (`inboxies.email`).
    /// `URL(string:)` treats a host-only string as a *path*, so API calls would never hit that domain.
    static func parseAPIBaseURL(_ raw: String) -> URL? {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") {
            trimmed.removeLast()
        }
        guard !trimmed.isEmpty else { return nil }

        if !hasHTTPScheme(trimmed) {
            let hostPart = String(trimmed.split(separator: "/", maxSplits: 1).first ?? Substring(trimmed))
            let isLocal =
                hostPart.hasPrefix("localhost")
                || hostPart.hasPrefix("127.0.0.1")
                || hostPart.hasPrefix("[::1]")
                || hostPart.hasPrefix("0.0.0.0")
            trimmed = (isLocal ? "http://" : "https://") + trimmed
        }

        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else {
            return nil
        }

        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        if components.path == "/" {
            components.path = ""
        }
        return components.url
    }

    private static func hasHTTPScheme(_ value: String) -> Bool {
        let lower = value.lowercased()
        return lower.hasPrefix("https://") || lower.hasPrefix("http://")
    }
}

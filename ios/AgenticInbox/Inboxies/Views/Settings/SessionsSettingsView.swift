import SwiftUI

/// Account → Devices & sessions: every signed-in device, browser, extension and
/// AutoFill session, with sign-out per session or everywhere else; plus the apps
/// connected over MCP OAuth, each with Disconnect (revokes the grant and its tokens).
struct SessionsSettingsView: View {
    @Environment(AppModel.self) private var app

    @State private var sessions: [AccountSession] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var revokingId: String?
    @State private var sessionToRevoke: AccountSession?
    @State private var showRevokeOthers = false
    @State private var isRevokingOthers = false
    @State private var grants: [McpGrant] = []
    @State private var isLoadingGrants = true
    @State private var grantsError: String?
    @State private var revokingGrantId: String?
    @State private var grantToRevoke: McpGrant?

    private var others: [AccountSession] { sessions.filter { !$0.current } }

    var body: some View {
        List {
            Section {
                Text("Where your account is signed in. Sign out anything you don't recognize, then change your password.")
                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                    .foregroundStyle(AppTheme.muted)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 8, trailing: 16))
            }

            Section {
                if isLoading && sessions.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(sessions) { session in
                        sessionRow(session)
                    }
                }
            } header: {
                Text("Signed in")
            }

            if !others.isEmpty {
                Section {
                    Button(role: .destructive) {
                        showRevokeOthers = true
                    } label: {
                        HStack(spacing: 8) {
                            if isRevokingOthers {
                                ProgressView().controlSize(.small)
                            }
                            Text(isRevokingOthers ? "Signing out…" : "Sign out everywhere else")
                                .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                        }
                    }
                    .disabled(isRevokingOthers)
                } footer: {
                    Text("Keeps you signed in on this iPhone. Browser extensions and AutoFill sign out too.")
                }
            }

            Section {
                if isLoadingGrants && grants.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                } else if let grantsError, grants.isEmpty {
                    Text(grantsError)
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.muted)
                } else if grants.isEmpty {
                    Text("No apps connected")
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.muted)
                } else {
                    ForEach(grants) { grant in
                        grantRow(grant)
                    }
                }
            } header: {
                Text("Connected apps")
            } footer: {
                Text("AI assistants and other apps you allowed to use your mail over MCP. Disconnecting cuts off access right away.")
            }

            if let statusMessage {
                Section {
                    Text(statusMessage)
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.accent)
                }
            }
            if let errorMessage {
                Section {
                    SettingsFormErrorBanner(message: errorMessage)
                }
            }
        }
        .settingsFormListStyle()
        .navigationTitle("Devices & sessions")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(
            "Sign out \(sessionToRevoke.map(Self.title) ?? "this session")?",
            isPresented: Binding(
                get: { sessionToRevoke != nil },
                set: { if !$0 { sessionToRevoke = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                if let session = sessionToRevoke {
                    Task { await revoke(session) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Disconnect \(grantToRevoke.map(Self.grantTitle) ?? "this app")?",
            isPresented: Binding(
                get: { grantToRevoke != nil },
                set: { if !$0 { grantToRevoke = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let grant = grantToRevoke {
                    Task { await revokeGrant(grant) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It loses access to your mail immediately. To use it again, connect it again from the app.")
        }
        .confirmationDialog(
            "Sign out everywhere else?",
            isPresented: $showRevokeOthers,
            titleVisibility: .visible
        ) {
            Button("Sign out \(others.count) other session\(others.count == 1 ? "" : "s")", role: .destructive) {
                Task { await revokeOthers() }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func sessionRow(_ session: AccountSession) -> some View {
        HStack(spacing: 12) {
            Image(systemName: Self.symbol(for: session))
                .font(.system(size: 17))
                .foregroundStyle(AppTheme.ink)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(Self.title(session))
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                    if session.current {
                        Text("This device")
                            .font(.inter(size: 11, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppTheme.pillFill, in: Capsule())
                    }
                }
                Text(Self.subtitle(session))
                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            }
            Spacer()
            if revokingId == session.id {
                ProgressView().controlSize(.small)
            } else if !session.current {
                Button("Sign out") {
                    sessionToRevoke = session
                }
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(.red)
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 2)
    }

    private func grantRow(_ grant: McpGrant) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 17))
                .foregroundStyle(AppTheme.ink)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.grantTitle(grant))
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                Text(Self.grantSubtitle(grant))
                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
            }
            Spacer()
            if revokingGrantId == grant.id {
                ProgressView().controlSize(.small)
            } else {
                Button("Disconnect") {
                    grantToRevoke = grant
                }
                .font(.inter(size: 13, weight: .medium))
                .foregroundStyle(.red)
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: Actions

    private func load() async {
        if app.isDebugPreview {
            sessions = Self.previewSessions
            grants = Self.previewGrants
            isLoading = false
            isLoadingGrants = false
            return
        }
        async let grantsLoad: Void = loadGrants()
        await loadSessions()
        await grantsLoad
    }

    private func loadGrants() async {
        isLoadingGrants = true
        defer { isLoadingGrants = false }
        do {
            grants = try await APIClient.shared.listMcpGrants()
            grantsError = nil
        } catch {
            grantsError = "Couldn't load connected apps. \(error.localizedDescription)"
        }
    }

    private func revokeGrant(_ grant: McpGrant) async {
        revokingGrantId = grant.id
        errorMessage = nil
        defer { revokingGrantId = nil }
        do {
            try await APIClient.shared.revokeMcpGrant(id: grant.id)
            grants.removeAll { $0.id == grant.id }
            statusMessage = "Disconnected \(Self.grantTitle(grant))"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadSessions() async {
        isLoading = true
        defer { isLoading = false }
        do {
            sessions = try await APIClient.shared.listSessions()
            errorMessage = nil
        } catch {
            errorMessage = "Couldn't load sessions. \(error.localizedDescription)"
        }
    }

    private func revoke(_ session: AccountSession) async {
        revokingId = session.id
        errorMessage = nil
        defer { revokingId = nil }
        do {
            try await APIClient.shared.revokeSession(id: session.id)
            if session.id == AutofillSession.storedId {
                AutofillSession.forget()
            }
            sessions.removeAll { $0.id == session.id }
            statusMessage = "Signed out \(Self.title(session))"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func revokeOthers() async {
        isRevokingOthers = true
        errorMessage = nil
        defer { isRevokingOthers = false }
        do {
            let result = try await APIClient.shared.revokeOtherSessions()
            AutofillSession.forget()
            await load()
            let count = result.revoked ?? 0
            statusMessage = "Signed out \(count) other session\(count == 1 ? "" : "s")"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Display

    static func title(_ session: AccountSession) -> String {
        if let label = session.label, !label.isEmpty { return label }
        let agent = (session.userAgent ?? "").lowercased()
        if agent.contains("inboxies") && agent.contains("android") { return "Inboxies for Android" }
        if agent.contains("cfnetwork") || (agent.contains("inboxies") && agent.contains("ios")) { return "Inboxies for iPhone" }
        if agent.contains("okhttp") { return "Inboxies for Android" }
        let browser: String? = {
            if agent.contains("edg/") { return "Edge" }
            if agent.contains("firefox/") { return "Firefox" }
            if agent.contains("chrome/") { return "Chrome" }
            if agent.contains("safari/") { return "Safari" }
            return nil
        }()
        let os: String? = {
            if agent.contains("iphone") { return "iPhone" }
            if agent.contains("ipad") { return "iPad" }
            if agent.contains("android") { return "Android" }
            if agent.contains("mac os") { return "Mac" }
            if agent.contains("windows") { return "Windows" }
            if agent.contains("linux") { return "Linux" }
            return nil
        }()
        switch (browser, os) {
        case let (b?, o?): return "\(b) on \(o)"
        case let (b?, nil): return b
        case let (nil, o?): return o
        default: return "Unknown device"
        }
    }

    static func subtitle(_ session: AccountSession) -> String {
        var parts: [String] = []
        if let date = parseDate(session.lastActiveAt) {
            parts.append(session.current ? "Active now" : "Active \(date.formatted(.relative(presentation: .named)))")
        }
        if let ip = session.ipAddress, !ip.isEmpty {
            parts.append(ip)
        }
        if session.scope == "aliases" {
            parts.append("Private emails only")
        }
        return parts.joined(separator: " · ")
    }

    static func symbol(for session: AccountSession) -> String {
        let title = title(session).lowercased()
        if session.scope == "aliases" {
            return title.contains("extension") ? "puzzlepiece.extension" : "key.fill"
        }
        if title.contains("iphone") || title.contains("android") { return "iphone" }
        if title.contains("ipad") { return "ipad" }
        return "laptopcomputer"
    }

    static func grantTitle(_ grant: McpGrant) -> String {
        if let name = grant.clientName?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        return "Unnamed app"
    }

    private static let scopeLabels: [String: String] = [
        "read": "Read", "draft": "Drafts", "send": "Send", "manage": "Organize",
    ]

    /// "Connected 3 days ago · Read, Drafts · All mailboxes"
    static func grantSubtitle(_ grant: McpGrant) -> String {
        var parts: [String] = []
        if let date = parseDate(grant.createdAt) {
            parts.append("Connected \(date.formatted(.relative(presentation: .named)))")
        }
        let scopes = grant.scopes.map { scopeLabels[$0] ?? $0 }.joined(separator: ", ")
        if !scopes.isEmpty { parts.append(scopes) }
        switch grant.mailboxIds {
        case nil: parts.append("All mailboxes")
        case let ids? where ids.count == 1: parts.append(ids[0])
        case let ids?: parts.append("\(ids.count) mailboxes")
        }
        return parts.joined(separator: " · ")
    }

    private static func parseDate(_ iso: String) -> Date? {
        ISO8601DateFormatter.withFractionalSeconds.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    private static var previewGrants: [McpGrant] {
        let iso = ISO8601DateFormatter()
        let now = Date()
        return [
            McpGrant(
                id: "g-1", clientId: "c-1", clientName: "Claude Desktop", clientUri: nil,
                scopes: ["read", "draft", "send", "manage"], mailboxIds: nil,
                createdAt: iso.string(from: now.addingTimeInterval(-3 * 86_400)), expiresAt: nil
            ),
            McpGrant(
                id: "g-2", clientId: "c-2", clientName: nil, clientUri: nil,
                scopes: ["read"], mailboxIds: ["hello@inboxies.email"],
                createdAt: iso.string(from: now.addingTimeInterval(-3_600)), expiresAt: nil
            ),
        ]
    }

    private static var previewSessions: [AccountSession] {
        let now = Date()
        let iso = ISO8601DateFormatter()
        return [
            AccountSession(
                id: "s-1", label: nil, scope: nil, userAgent: "Inboxies/1 CFNetwork Darwin", ipAddress: "203.0.113.4",
                createdAt: iso.string(from: now), lastActiveAt: iso.string(from: now),
                expiresAt: iso.string(from: now.addingTimeInterval(30 * 86_400)), current: true
            ),
            AccountSession(
                id: "s-2", label: nil, scope: nil,
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
                ipAddress: "198.51.100.20", createdAt: iso.string(from: now.addingTimeInterval(-5 * 86_400)),
                lastActiveAt: iso.string(from: now.addingTimeInterval(-3_600)),
                expiresAt: iso.string(from: now.addingTimeInterval(25 * 86_400)), current: false
            ),
            AccountSession(
                id: "s-3", label: "iPhone AutoFill", scope: "aliases", userAgent: nil, ipAddress: nil,
                createdAt: iso.string(from: now.addingTimeInterval(-2 * 86_400)),
                lastActiveAt: iso.string(from: now.addingTimeInterval(-2 * 86_400)),
                expiresAt: iso.string(from: now.addingTimeInterval(28 * 86_400)), current: false
            ),
        ]
    }
}

#Preview("Devices & sessions") {
    PreviewHost {
        NavigationStack {
            SessionsSettingsView()
        }
    }
}

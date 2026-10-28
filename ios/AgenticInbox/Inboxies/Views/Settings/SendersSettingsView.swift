import SwiftUI

/// Settings → Senders: Allowed / Blocked rules and Sorting (per-sender
/// purpose-box defaults). Android twin: `SendersSettingsView.kt`. Web:
/// `app/components/settings/SendersSettings.tsx`.
struct SendersSettingsView: View {
    enum Tab: String, CaseIterable, Identifiable {
        case allowed, blocked, sorting
        var id: String { rawValue }
        var title: String {
            switch self {
            case .allowed: return "Allowed"
            case .blocked: return "Blocked"
            case .sorting: return "Sorting"
            }
        }
    }

    @State private var tab: Tab

    init(initialTab: Tab = .allowed) {
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        VStack(spacing: 0) {
            SendersTabBar(selection: $tab)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 12)
            switch tab {
            case .allowed:
                SenderRulesListView(verdict: "allow")
                    .id(Tab.allowed)
            case .blocked:
                SenderRulesListView(verdict: "block")
                    .id(Tab.blocked)
            case .sorting:
                SenderSortingView()
            }
        }
        .background(AppTheme.background)
        .navigationTitle("Senders")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Pill segmented control (Android twin: `SendersTabBar` in Compose).
private struct SendersTabBar: View {
    @Binding var selection: SendersSettingsView.Tab
    @Namespace private var indicator

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SendersSettingsView.Tab.allCases) { tab in
                let active = tab == selection
                Button {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        selection = tab
                    }
                } label: {
                    Text(tab.title)
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(active ? AppTheme.ink : AppTheme.muted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 30)
                        .background {
                            if active {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(AppTheme.surface)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .stroke(AppTheme.line, lineWidth: 0.5)
                                    }
                                    .matchedGeometryEffect(id: "senders-tab", in: indicator)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(3)
        .background(AppTheme.pillFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Mirrors `shared/sender-rules.ts` (web) and `SenderRuleInput` (Android).
enum SenderRuleInput {
    /// "ada@acme.com" is an address; "@acme.com" or "acme.com" is a domain.
    static func parse(_ raw: String) -> (kind: String, value: String)? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty else { return nil }
        if value.hasPrefix("@") { return ("domain", String(value.dropFirst())) }
        if value.contains("@") { return ("address", value) }
        return ("domain", value)
    }

    static func sourceLabel(_ source: String) -> String {
        switch source {
        case "not_spam": return "Not spam"
        case "report_spam": return "Reported spam"
        case "settings": return "Added in Settings"
        case "screener": return "Screener"
        case "sent": return "You emailed them"
        case "bootstrap": return "Imported"
        default: return "Other"
        }
    }

    static func displayValue(_ rule: SenderRule) -> String {
        rule.kind == "domain" ? "@\(rule.value)" : rule.value
    }

    static func dateLabel(_ iso: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = fractional.date(from: iso) ?? plain.date(from: iso) else { return "" }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }

    static func metaLine(_ rule: SenderRule) -> String {
        [rule.kind == "domain" ? "Domain" : nil, sourceLabel(rule.source), dateLabel(rule.createdAt)]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}

/// Allowed or Blocked list with the Add field.
private struct SenderRulesListView: View {
    let verdict: String

    @Environment(AppModel.self) private var app
    @State private var rules: [SenderRule] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var draft = ""
    @State private var addError: String?
    @State private var isAdding = false
    @State private var busyRuleId: String?
    @FocusState private var fieldFocused: Bool

    private var isAllow: Bool { verdict == "allow" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(isAllow
                     ? "Mail from these senders skips Spam. A domain rule only applies to mail that passes sender verification."
                     : "Mail from these senders goes to Spam (or Screened out when the Screener is on).")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 20)

                addField

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else if let loadError {
                    LoadFailedContent(
                        title: isAllow ? "Couldn’t load allowed senders" : "Couldn’t load blocked senders",
                        message: loadError
                    ) { Task { await load() } }
                } else if rules.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(isAllow ? "No allowed senders yet" : "No blocked senders yet")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text(isAllow
                             ? "Marking mail as Not spam adds the sender here, or add an address or @domain above."
                             : "Reporting spam adds the sender here, or add an address or @domain above.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(rules) { rule in
                            ruleRow(rule)
                            if rule.id != rules.last?.id {
                                Divider().overlay(AppTheme.line)
                            }
                        }
                    }
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .task { await load() }
    }

    private var addField: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("name@example.com or @example.com", text: $draft)
                    .font(.inter(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .submitLabel(.done)
                    .focused($fieldFocused)
                    .onSubmit { Task { await add() } }
                    .onChange(of: draft) { _, _ in addError = nil }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(addError == nil ? AppTheme.line : AppTheme.deepDarkRed, lineWidth: addError == nil ? 0.5 : 1)
                    }
                    .accessibilityLabel(isAllow ? "Allow an address or domain" : "Block an address or domain")

                Button {
                    Task { await add() }
                } label: {
                    Group {
                        if isAdding {
                            ProgressView().tint(.white)
                        } else {
                            Text("Add")
                                .font(.inter(size: 14, weight: .semibold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 64, height: 40)
                    .background(AppTheme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .opacity(canAdd ? 1 : 0.45)
                }
                .buttonStyle(.plain)
                .disabled(!canAdd)
            }
            if let addError {
                Text(addError)
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.deepDarkRed)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 20)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: addError)
    }

    private var canAdd: Bool {
        !isAdding && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder
    private func ruleRow(_ rule: SenderRule) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(SenderRuleInput.displayValue(rule))
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(SenderRuleInput.metaLine(rule))
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                Task { await remove(rule) }
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.muted)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busyRuleId == rule.id)
            .accessibilityLabel("Remove \(SenderRuleInput.displayValue(rule))")
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
    }

    private func load() async {
        if app.isDebugPreview {
            rules = PreviewSenderRules.rules(verdict: verdict)
            isLoading = false
            return
        }
        guard let mailboxId = app.selectedMailboxId else {
            isLoading = false
            return
        }
        isLoading = rules.isEmpty
        loadError = nil
        do {
            rules = try await APIClient.shared.listSenderRules(mailboxId: mailboxId, verdict: verdict)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func add() async {
        guard canAdd else { return }
        guard let parsed = SenderRuleInput.parse(draft) else {
            addError = "Enter an address or @domain"
            return
        }
        addError = nil
        isAdding = true
        defer { isAdding = false }
        do {
            let rule: SenderRule
            if app.isDebugPreview {
                rule = try PreviewSenderRules.add(kind: parsed.kind, value: parsed.value, verdict: verdict)
            } else {
                guard let mailboxId = app.selectedMailboxId else { return }
                rule = try await APIClient.shared.upsertSenderRule(
                    mailboxId: mailboxId,
                    kind: parsed.kind,
                    value: parsed.value,
                    verdict: verdict
                )
            }
            draft = ""
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                rules.removeAll { $0.id == rule.id || ($0.kind == rule.kind && $0.value == rule.value) }
                rules.insert(rule, at: 0)
            }
        } catch APIError.http(400, let message) where !message.isEmpty {
            // Free-mail provider, public suffix or a malformed value: the
            // server's sentence is written for the user.
            addError = message
        } catch {
            addError = "Couldn’t save the rule. Try again."
        }
    }

    private func remove(_ rule: SenderRule) async {
        busyRuleId = rule.id
        defer { busyRuleId = nil }
        do {
            if !app.isDebugPreview {
                guard let mailboxId = app.selectedMailboxId else { return }
                try await APIClient.shared.deleteSenderRule(mailboxId: mailboxId, ruleId: rule.id)
            }
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                rules.removeAll { $0.id == rule.id }
            }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

/// DEBUG preview fixtures (`-previewSenders`); no server.
enum PreviewSenderRules {
    static func rules(verdict: String) -> [SenderRule] {
        verdict == "allow"
            ? [
                rule("r1", kind: "address", value: "ada@lovelace.dev", verdict: "allow", source: "not_spam", date: "2026-10-24T09:12:00.000Z"),
                rule("r2", kind: "domain", value: "acme.com", verdict: "allow", source: "settings", date: "2026-10-20T15:40:00.000Z"),
                rule("r3", kind: "address", value: "billing@stripe.com", verdict: "allow", source: "sent", date: "2026-09-02T11:00:00.000Z"),
            ]
            : [
                rule("r4", kind: "domain", value: "promo-blast.biz", verdict: "block", source: "settings", date: "2026-10-25T08:30:00.000Z"),
                rule("r5", kind: "address", value: "deals@shopnow.example", verdict: "block", source: "report_spam", date: "2026-10-18T19:05:00.000Z"),
                rule("r6", kind: "address", value: "cold@outreach.io", verdict: "block", source: "screener", date: "2026-08-30T13:22:00.000Z"),
            ]
    }

    /// Mimics the server's free-mail refusal so the inline error can be reviewed.
    static func add(kind: String, value: String, verdict: String) throws -> SenderRule {
        let freeMail: Set<String> = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me"]
        if kind == "domain", freeMail.contains(value) {
            throw APIError.http(400, "\(value) is a free email provider; add the sender's address instead")
        }
        let now = ISO8601DateFormatter().string(from: Date())
        return rule(UUID().uuidString, kind: kind, value: value, verdict: verdict, source: "settings", date: now)
    }

    private static func rule(_ id: String, kind: String, value: String, verdict: String, source: String, date: String) -> SenderRule {
        SenderRule(id: id, kind: kind, value: value, verdict: verdict, source: source, createdAt: date, updatedAt: date, lastMatchedAt: nil, matchCount: 0)
    }
}

/// Sorting tab: per-sender purpose-box defaults (Inbox / Promotions / Updates).
private struct SenderSortingView: View {
    @Environment(AppModel.self) private var app

    @State private var preferences: [SenderPreference] = []
    @State private var query = ""
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var busyAddress: String?

    private static let purposeFolders: [(id: String, name: String)] = [
        ("inbox", "Inbox"),
        ("promotions", "Promotions"),
        ("updates", "Updates"),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Choose which purpose box each sender goes to. Changing a destination also moves their existing Inbox, Promotions, and Updates mail.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 20)

                TextField("Search senders", text: $query)
                    .font(.inter(size: 15))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.horizontal, 20)
                    .onChange(of: query) { _, _ in
                        Task { await load() }
                    }

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 24)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.inter(size: 13))
                        .foregroundStyle(Color.red.opacity(0.85))
                        .padding(.horizontal, 20)
                } else if preferences.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No sender defaults yet")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text("When you move mail into Inbox, Promotions, or Updates, you can set where future mail from that sender goes.")
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(preferences) { pref in
                            senderRow(pref)
                            if pref.id != preferences.last?.id {
                                Divider().overlay(AppTheme.line)
                            }
                        }
                    }
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                }

                Text("Filters still override these defaults when a rule matches. Spam is never routed by sender preference.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func senderRow(_ pref: SenderPreference) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pref.displayName?.isEmpty == false ? pref.displayName! : pref.address)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                if let name = pref.displayName, !name.isEmpty {
                    Text(pref.address)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Menu {
                ForEach(Self.purposeFolders, id: \.id) { folder in
                    Button(folder.name) {
                        Task { await updateFolder(pref, folderId: folder.id) }
                    }
                }
            } label: {
                Text(Self.purposeFolders.first { $0.id == pref.folderId }?.name ?? pref.folderId)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            }
            .disabled(busyAddress == pref.address)

            Button {
                Task { await remove(pref) }
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14))
                    .foregroundStyle(AppTheme.muted)
            }
            .disabled(busyAddress == pref.address)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func load() async {
        guard let mailboxId = app.selectedMailboxId else {
            isLoading = false
            return
        }
        isLoading = preferences.isEmpty
        errorMessage = nil
        do {
            preferences = try await APIClient.shared.listSenderPreferences(
                mailboxId: mailboxId,
                q: query.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func updateFolder(_ pref: SenderPreference, folderId: String) async {
        guard let mailboxId = app.selectedMailboxId else { return }
        busyAddress = pref.address
        defer { busyAddress = nil }
        do {
            _ = try await APIClient.shared.upsertSenderPreference(
                mailboxId: mailboxId,
                address: pref.address,
                folderId: folderId,
                displayName: pref.displayName,
                refile: true
            )
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ pref: SenderPreference) async {
        guard let mailboxId = app.selectedMailboxId else { return }
        busyAddress = pref.address
        defer { busyAddress = nil }
        do {
            try await APIClient.shared.deleteSenderPreference(
                mailboxId: mailboxId,
                address: pref.address
            )
            preferences.removeAll { $0.address == pref.address }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

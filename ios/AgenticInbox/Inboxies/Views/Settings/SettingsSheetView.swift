import SwiftUI

/// Mailbox settings sheet: profile, preferences, and account actions.
struct SettingsSheetView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var editNameDraft = ""
    @State private var showEditName = false
    @State private var signatureEnabled = false
    @AppStorage("push_notifications_enabled") private var notificationsEnabled = true
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system

    private var mailbox: Mailbox? {
        app.selectedMailbox
    }

    private var displayName: String {
        if let fromName = mailbox?.settings?.fromName, !fromName.isEmpty {
            return fromName
        }
        if let name = mailbox?.name, !name.isEmpty, name != mailbox?.email {
            return name
        }
        if let local = mailbox?.email.split(separator: "@").first, !local.isEmpty {
            return String(local)
        }
        return mailbox?.name ?? "Mailbox"
    }

    private var emailAddress: String {
        mailbox?.email ?? auth.userEmail ?? ""
    }

    private var initials: String {
        AvatarInitials.from(displayName.isEmpty ? emailAddress : displayName)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    profileHeader
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 16, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                Section {
                    NavigationLink {
                        SwipeSettingsView()
                    } label: {
                        settingsLabel("Swipe settings", systemImage: "arrow.left.arrow.right")
                    }

                    NavigationLink {
                        AgentPromptSettingsView()
                    } label: {
                        settingsLabel("AI prompt", systemImage: "sparkles")
                    }

                    NavigationLink {
                        ForwardingSettingsView()
                    } label: {
                        settingsLabel("Forwarding", systemImage: "arrowshape.turn.up.right")
                    }

                    NavigationLink {
                        AutoReplySettingsView()
                    } label: {
                        settingsLabel("Auto-reply", systemImage: "arrowshape.turn.up.left")
                    }

                    NavigationLink {
                        FiltersSettingsView()
                    } label: {
                        settingsLabel("Filters", systemImage: "line.3.horizontal.decrease.circle")
                    }

                    NavigationLink {
                        SendersSettingsView()
                    } label: {
                        settingsLabel("Senders", systemImage: "person.crop.circle")
                    }

                    NavigationLink {
                        SharingSettingsView()
                    } label: {
                        settingsLabel("Sharing", systemImage: "person.2")
                    }

                    if app.isAdmin {
                        NavigationLink {
                            DomainAdminSettingsView(showsDismiss: false)
                        } label: {
                            settingsLabel("Domain Admin", systemImage: "shield.lefthalf.filled")
                        }
                    }

                    notificationsToggle
                    signatureToggle
                } header: {
                    Text("Preferences")
                }
                .listRowSeparator(.hidden)

                Section {
                    NavigationLink {
                        ThemeSettingsView()
                    } label: {
                        settingsLabel("Theme", systemImage: "circle.lefthalf.filled")
                    }
                } header: {
                    Text("Display")
                }

                Section {
                    NavigationLink {
                        SupportSettingsView()
                    } label: {
                        settingsLabel("Support & feedback", systemImage: "questionmark.circle")
                    }
                } header: {
                    Text("Support")
                }

                Section {
                    Menu {
                        Section("This will permanently delete this email and all its messages.") {
                            Button("Confirm delete", role: .destructive) {
                                deleteSelectedMailbox()
                            }
                            Button("Cancel", role: .cancel) {}
                        }
                    } label: {
                        Text("Delete email")
                            .frame(maxWidth: .infinity)
                            .font(.inter(size: 16, weight: .medium))
                            .foregroundStyle(.red)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
            .alert("Edit name", isPresented: $showEditName) {
                TextField("Display name", text: $editNameDraft)
                Button("Cancel", role: .cancel) {}
                Button("Save") {
                    Task { await saveDisplayName() }
                }
            } message: {
                Text("This name appears when you send email.")
            }
            .onAppear {
                signatureEnabled = mailbox?.settings?.signature?.enabled ?? true
            }
            .onChange(of: app.selectedMailboxId) { _, _ in
                signatureEnabled = mailbox?.settings?.signature?.enabled ?? true
            }
        }
        .applyThemeController()
    }

    private var profileHeader: some View {
        VStack(spacing: 10) {
            Text(initials)
                .font(.inter(size: initials.count > 1 ? 28 : 34, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .frame(width: 70, height: 70)
                .background(AppTheme.pillFill, in: Circle())

            VStack(spacing: 4) {
                Text(displayName)
                    .font(.inter(size: 20, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .multilineTextAlignment(.center)

                Text(emailAddress)
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
                    .multilineTextAlignment(.center)
            }

            Button {
                editNameDraft = mailbox?.settings?.fromName
                    ?? (mailbox?.name != mailbox?.email ? (mailbox?.name ?? "") : "")
                showEditName = true
            } label: {
                Text("Edit")
                    .font(.inter(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(AppTheme.pillFill, in: Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private var signatureBinding: Binding<Bool> {
        Binding(
            get: { signatureEnabled },
            set: { newValue in
                signatureEnabled = newValue
                Task { await saveSignatureEnabled(newValue) }
            }
        )
    }

    private var notificationsToggle: some View {
        Toggle(isOn: $notificationsEnabled) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notifications")
                        .foregroundStyle(AppTheme.ink)
                    Text("Receive alerts for new messages.")
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                }
            } icon: {
                Image(systemName: "bell")
                    .foregroundStyle(AppTheme.ink)
            }
        }
        .tint(AppTheme.accent)
        .onChange(of: notificationsEnabled) { _, newValue in
            if newValue {
                if let mailboxId = app.selectedMailboxId {
                    PushNotificationManager.shared.requestPermissionAndRegister(mailboxId: mailboxId)
                }
            } else {
                if let mailboxId = app.selectedMailboxId {
                    PushNotificationManager.shared.unregisterToken(mailboxId: mailboxId)
                }
            }
        }
    }

    private var signatureToggle: some View {
        Toggle(isOn: signatureBinding) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Default signature")
                        .foregroundStyle(AppTheme.ink)
                    Text("Show 'Sent with Inboxies Email' in emails")
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                }
            } icon: {
                Image(systemName: "pencil")
                    .foregroundStyle(AppTheme.ink)
            }
        }
        .tint(AppTheme.accent)
    }

    private func settingsLabel(_ title: String, systemImage: String) -> some View {
        Label {
            Text(title)
                .foregroundStyle(AppTheme.ink)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(AppTheme.ink)
        }
    }

    private func saveDisplayName() async {
        let trimmed = editNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = await app.updateMailboxSettings { settings in
            settings.fromName = trimmed
        }
    }

    private func saveSignatureEnabled(_ enabled: Bool) async {
        let success = await app.updateMailboxSettings { settings in
            var signature = settings.signature ?? SignatureSettings()
            signature.enabled = enabled
            if signature.text == nil, signature.html == nil, enabled {
                signature.text = "Sent with Inboxies Email"
            }
            settings.signature = signature
        }
        if !success {
            signatureEnabled = mailbox?.settings?.signature?.enabled ?? true
        }
    }

    private func deleteSelectedMailbox() {
        dismiss()
        Task {
            if let id = mailbox?.id {
                await app.deleteMailbox(id: id)
            }
        }
    }
}

/// Placeholder destination for settings rows that are not implemented yet.
struct SettingsComingSoonView: View {
    let title: String

    var body: some View {
        ContentUnavailableView(
            title,
            systemImage: "wrench.and.screwdriver",
            description: Text("Coming soon.")
        )
        .background(AppTheme.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

enum AvatarInitials {
    /// Two letters for a two-character name or first + last; otherwise the first letter.
    static func from(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "A" }

        let source = trimmed.contains("@")
            ? String(trimmed.split(separator: "@").first ?? Substring(trimmed))
            : trimmed
        let parts = source
            .split { $0.isWhitespace || $0 == "." || $0 == "_" }
            .map(String.init)
            .filter { !$0.isEmpty }

        if parts.count >= 2 {
            return String(parts[0].prefix(1) + parts[parts.count - 1].prefix(1)).uppercased()
        }

        let word = parts.first ?? source
        if word.count <= 2 {
            return word.uppercased()
        }
        return String(word.prefix(1)).uppercased()
    }
}

#Preview("Settings") {
    PreviewHost {
        SettingsSheetView()
    }
}
import SwiftUI
import StoreKit

struct SupportSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.requestReview) private var requestReview
    @Environment(\.openURL) private var openURL
    
    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "Version \(version) (\(build))"
    }

    var body: some View {
        List {
            Section {
                Button {
                    let help = AppConfig.apiBaseURL.appendingPathComponent("help")
                    openURL(help)
                } label: {
                    settingsActionLabel("Help Center", systemImage: "book.pages")
                }
                
                Button {
                    Task {
                        await app.startCompose(
                            mode: .new,
                            initialTo: [MailAddress(name: "Inboxies Support", email: "support@\(app.mailDomain)")]
                        )
                    }
                } label: {
                    settingsActionLabel("Contact Support", systemImage: "envelope")
                }
                
                Button {
                    Task {
                        await app.startCompose(
                            mode: .new,
                            initialTo: [MailAddress(name: "Inboxies Feedback", email: "support@\(app.mailDomain)")]
                        )
                    }
                } label: {
                    settingsActionLabel("Send Feedback", systemImage: "lightbulb")
                }
            } header: {
                Text("Help & Support")
            }
            
            Section {
                Button {
                    requestReview()
                } label: {
                    settingsActionLabel("Rate on App Store", systemImage: "star")
                }
                
                Button {
                    if let url = URL(string: "https://x.com/inboxies_app") {
                        openURL(url)
                    }
                } label: {
                    settingsActionLabel("Follow @inboxies_app", systemImage: "at")
                }
            } header: {
                Text("Community")
            } footer: {
                Text(appVersion)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 24)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Support & feedback")
        .navigationBarTitleDisplayMode(.inline)
    }
    
    private func settingsActionLabel(_ title: String, systemImage: String) -> some View {
        HStack {
            Label {
                Text(title)
                    .foregroundStyle(AppTheme.ink)
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(AppTheme.ink)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.inter(size: AppTheme.FontSize.chevron, weight: .semibold))
                .foregroundStyle(AppTheme.muted.opacity(0.5))
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Shared settings form chrome (inset-grouped cards + footers)

enum SettingsFormChrome {
    static let rowHorizontalPadding: CGFloat = 16
    static let footerFontSize: CGFloat = 12
    static let rowFontSize: CGFloat = 16
}

extension View {
    /// Applies the Inboxies settings form surface (inset grouped list on app background).
    func settingsFormListStyle() -> some View {
        self
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .tint(AppTheme.accent)
    }
}

/// Trailing-aligned text field for settings rows (label leading, value trailing).
struct SettingsTextFieldRow: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    var disabled: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .layoutPriority(1)

            TextField(placeholder, text: $text)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(keyboardType)
                .textContentType(textContentType)
                .disabled(disabled)
                .opacity(disabled ? 0.45 : 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Single-line text field that fills the settings row (placeholder as the cue).
struct SettingsPlainTextFieldRow: View {
    @Binding var text: String
    var placeholder: String
    var disabled: Bool = false

    var body: some View {
        TextField(placeholder, text: $text)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .foregroundStyle(AppTheme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .disabled(disabled)
            .opacity(disabled ? 0.45 : 1)
    }
}

/// Label leading, menu picker trailing — matches iOS Settings value rows.
struct SettingsMenuPickerRow<SelectionValue: Hashable, Content: View>: View {
    let title: String
    @Binding var selection: SelectionValue
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)

            Spacer(minLength: 8)

            Picker(title, selection: $selection) {
                content()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(AppTheme.muted)
        }
    }
}

struct SettingsToggleRow: View {
    let title: String
    @Binding var isOn: Bool
    var disabled: Bool = false

    var body: some View {
        Toggle(title, isOn: $isOn)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .foregroundStyle(AppTheme.ink)
            .tint(AppTheme.accent)
            .disabled(disabled)
            .opacity(disabled ? 0.45 : 1)
    }
}

struct SettingsFormFooter: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(size: SettingsFormChrome.footerFontSize))
            .foregroundStyle(AppTheme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingsFormErrorBanner: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.inter(size: 13, weight: .medium))
            .foregroundStyle(AppTheme.deepDarkRed)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    PreviewHost {
        NavigationStack {
            SupportSettingsView()
        }
    }
}

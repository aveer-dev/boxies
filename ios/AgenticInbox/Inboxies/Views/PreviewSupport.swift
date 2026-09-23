import SwiftUI

/// Shared Canvas fixtures. `#Preview` is not invoked in device or App Store runs.
enum PreviewSupport {
    @MainActor
    static func appModel() -> AppModel {
        let app = AppModel()
        app.persistsPreferences = false
        app.mailboxes = [
            Mailbox(
                id: "mb-preview",
                email: "you@inboxies.email",
                name: "Alex Rivera",
                settings: MailboxSettings(
                    fromName: "Alex Rivera",
                    agentSystemPrompt: nil,
                    signature: SignatureSettings(enabled: true, text: "Alex")
                )
            ),
        ]
        app.selectedMailboxId = "mb-preview"
        app.folders = [
            Folder(id: "inbox", name: "Inbox", unreadCount: 3),
            Folder(id: "screener", name: "Screener", unreadCount: 1),
            Folder(id: "promotions", name: "Promotions", unreadCount: 0),
            Folder(id: "updates", name: "Updates", unreadCount: 0),
            Folder(id: "sent", name: "Sent", unreadCount: 0),
            Folder(id: "archive", name: "Archive", unreadCount: 0),
            Folder(id: "screened_out", name: "Screened out", unreadCount: 0),
        ]
        app.emails = emails
        app.replyLaterCount = emails.filter(\.replyLater).count
        app.isLoading = false
        app.isMailboxLoading = false
        return app
    }

    @MainActor
    static func authStore() -> AuthStore {
        let store = AuthStore()
        store.persistsSession = false
        store.token = "preview-token"
        store.userEmail = "you@inboxies.email"
        return store
    }

    static let emails: [Email] = [
        Email(
            id: "preview-1",
            folderId: "inbox",
            subject: "Quarterly planning notes",
            sender: "jordan@example.com",
            senderName: "Jordan Hale",
            recipient: "you@inboxies.email",
            date: "2026-09-03T14:30:00.000Z",
            read: false,
            starred: false,
            body: HTMLHardenFixture.html,
            snippet: "Can we move Thursday's sync to the morning instead?",
            threadCount: 3
        ),
        Email(
            id: "preview-2",
            folderId: "inbox",
            subject: "Re: Invoice for March",
            sender: "alex@example.com",
            senderName: "Alex Rivera",
            recipient: "you@inboxies.email",
            date: "2026-09-02T09:12:00.000Z",
            read: true,
            starred: true,
            replyLater: true,
            replyLaterAt: "2026-09-02T10:00:00.000Z",
            snippet: "Attached is the updated PDF for last month's work.",
            needsReply: true,
            hasAttachment: true
        ),
        Email(
            id: "preview-3",
            folderId: "inbox",
            subject: "Design review tomorrow",
            sender: "sam@example.com",
            senderName: "Sam Chen",
            recipient: "you@inboxies.email",
            date: "2026-08-28T18:04:00.000Z",
            read: false,
            starred: false,
            snippet: "Posting the latest frames in the shared folder now.",
            hasDraft: true
        ),
        Email(
            id: "preview-4",
            folderId: "inbox",
            subject: "Flight confirmation",
            sender: "taylor@example.com",
            senderName: "Taylor Brooks",
            recipient: "you@inboxies.email",
            date: "2026-03-15T11:00:00.000Z",
            read: true,
            starred: false,
            snippet: "Your itinerary for next week's trip is ready to view."
        ),
        Email(
            id: "preview-screener-1",
            folderId: "screener",
            subject: "Quick intro from Acme",
            sender: "hello@acme.example",
            senderName: "Acme Outreach",
            recipient: "you@inboxies.email",
            date: "2026-09-19T12:00:00.000Z",
            read: false,
            starred: false,
            body: "<p>Hi — we'd love to show you Acme. No pressure.</p>",
            snippet: "Hi — we'd love to show you Acme. No pressure.",
            folderName: "Screener"
        ),
        Email(
            id: "preview-rl-2",
            folderId: "inbox",
            subject: "Can you review the contract?",
            sender: "legal@example.com",
            senderName: "Pat Legal",
            recipient: "you@inboxies.email",
            date: "2026-09-10T08:00:00.000Z",
            read: true,
            starred: false,
            replyLater: true,
            replyLaterAt: "2026-09-11T09:00:00.000Z",
            snippet: "Draft is in the shared drive — need a sign-off by Friday.",
            needsReply: true
        ),
    ]

    /// Sent message with bounce — for delivery-badge canvas / Simulator fixtures.
    static let bouncedSentEmail = Email(
        id: "preview-bounced",
        folderId: "sent",
        subject: "Invoice attached",
        sender: "you@inboxies.email",
        senderName: "Alex Rivera",
        recipient: "client@example.com",
        date: "2026-09-18T16:00:00.000Z",
        read: true,
        starred: false,
        body: "<p>Please find the invoice attached.</p>",
        snippet: "Please find the invoice attached.",
        folderName: "Sent",
        deliveryStatus: "bounced",
        deliveryError: "550 5.1.1 The email account that you tried to reach does not exist."
    )

    @MainActor
    static func previewMailboxModel() -> AppModel {
        let app = appModel()
        app.selectedTab = .folder("inbox")
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-previewScreener"),
           let screener = app.emails.first(where: { $0.folderId == "screener" }) {
            app.selectedTab = .folder("screener")
            app.emails = app.emails.filter { $0.folderId == "screener" }
            app.selectedEmail = screener
            app.threadEmails = [screener]
        } else if args.contains("-previewReplyLater") {
            app.selectedTab = .replyLater
            app.emails = app.emails.filter(\.replyLater)
            app.replyLaterCount = app.emails.count
        } else if args.contains("-previewDetail"), let first = app.emails.first(where: { $0.folderId == "inbox" }) ?? app.emails.first {
            app.selectedEmail = first
            app.threadEmails = [first]
        } else {
            // Inbox list must not include Screener / other folders (matches production sync).
            app.emails = app.emails.filter { $0.folderId == "inbox" }
            app.replyLaterCount = emails.filter(\.replyLater).count
        }
        return app
    }

    static let adminRows: [AdminMailboxRow] = [
        AdminMailboxRow(
            id: "you@inboxies.email",
            email: "you@inboxies.email",
            name: "Alex Rivera",
            acl: MailboxAcl(owners: ["email:admin@example.com"], members: []),
            claimed: true,
            fromName: "Alex Rivera"
        ),
        AdminMailboxRow(
            id: "ops@inboxies.email",
            email: "ops@inboxies.email",
            name: "Ops",
            acl: MailboxAcl(owners: ["email:admin@example.com"], members: []),
            claimed: true,
            fromName: "Ops"
        ),
        AdminMailboxRow(
            id: "pending@inboxies.email",
            email: "pending@inboxies.email",
            name: "Pending",
            acl: MailboxAcl(owners: ["email:admin@example.com"], members: []),
            claimed: true,
            fromName: "Pending"
        ),
    ]

    @MainActor
    static func previewAdminModel() -> AppModel {
        let app = appModel()
        app.isAdmin = true
        app.mailboxes = []
        app.selectedMailboxId = nil
        app.isLoading = false
        app.isMailboxLoading = false
        return app
    }
}

#if DEBUG
struct PreviewMailboxRoot: View {
    @State private var auth = PreviewSupport.authStore()
    @State private var app = PreviewSupport.previewMailboxModel()

    var body: some View {
        RootView()
            .environment(auth)
            .environment(app)
            .task {
                if ProcessInfo.processInfo.arguments.contains("-previewCompose") {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    await app.startCompose(mode: .new)
                }
            }
    }
}

struct PreviewAdminAuthRoot: View {
    @State private var auth = PreviewSupport.authStore()
    @State private var app = PreviewSupport.previewAdminModel()

    var body: some View {
        let args = ProcessInfo.processInfo.arguments
        Group {
            if args.contains("-previewPasswordSignIn") {
                SignInView()
            } else if args.contains("-previewInviteAccept") {
                NavigationStack {
                    InviteAcceptPreview()
                }
            } else if args.contains("-previewSignInMethods") {
                NavigationStack {
                    SignInMethodsPreview()
                }
            } else {
                NavigationStack {
                    DomainAdminSettingsView(showsDismiss: false, previewRows: PreviewSupport.adminRows)
                }
            }
        }
        .environment(auth)
        .environment(app)
    }
}

private struct InviteAcceptPreview: View {
    @State private var password = ""
    @State private var confirm = ""
    @State private var displayName = "Alex"

    var body: some View {
        Form {
            Section {
                Text("You've been invited to you@inboxies.email.")
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
            }
            Section("Set password") {
                SecureField("Password (10+ characters)", text: $password)
                SecureField("Confirm password", text: $confirm)
                TextField("Display name (optional)", text: $displayName)
            }
            Section {
                Button("Create account") {}
                    .font(.inter(size: 16, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Accept invite")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") {}
            }
        }
    }
}

/// Static Sign-in methods (Connected + Change password) for Simulator review.
private struct SignInMethodsPreview: View {
    @State private var currentPassword = ""
    @State private var password = ""
    @State private var passwordConfirm = ""

    var body: some View {
        List {
            Section {
                Text(
                    "Connected methods share this account. Connect Apple or Google on this device, add or change your password, or link another device."
                )
                .font(.inter(size: SettingsFormChrome.footerFontSize))
                .foregroundStyle(AppTheme.muted)
                .listRowBackground(Color.clear)
            }

            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text("emmanuel@example.com")
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                    Text("Email · this session")
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.muted)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Password")
                        .font(.inter(size: SettingsFormChrome.rowFontSize))
                        .foregroundStyle(AppTheme.ink)
                    Text("Password")
                        .font(.inter(size: SettingsFormChrome.footerFontSize))
                        .foregroundStyle(AppTheme.muted)
                }
            } header: {
                Text("Connected")
            }

            Section {
                Text("Connect Google isn’t available on iPhone. Use Android, web, or Link another device.")
                    .font(.inter(size: SettingsFormChrome.footerFontSize))
                    .foregroundStyle(AppTheme.muted)
                Text("Change password")
                    .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                SecureField("Current password", text: $currentPassword)
                SecureField("New password (10+ characters)", text: $password)
                SecureField("Confirm new password", text: $passwordConfirm)
                Button("Update password") {}
                    .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            } header: {
                Text("Connect on this device")
            }

            Section {
                Button("Link another device") {}
                    .font(.inter(size: SettingsFormChrome.rowFontSize, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
            } header: {
                Text("Link another device")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Sign-in methods")
        .navigationBarTitleDisplayMode(.inline)
    }
}
#endif

/// Holds preview `AppModel` / `AuthStore` so Canvas interactions don't rebuild them.
struct PreviewHost<Content: View>: View {
    @State private var app = PreviewSupport.appModel()
    @State private var auth = PreviewSupport.authStore()
    var content: () -> Content

    var body: some View {
        content()
            .environment(app)
            .environment(auth)
            .preferredColorScheme(.light)
    }
}

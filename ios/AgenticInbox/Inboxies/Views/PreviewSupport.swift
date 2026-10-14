import SwiftUI

/// Shared Canvas fixtures. `#Preview` is not invoked in device or App Store runs.
enum PreviewSupport {
    @MainActor
    static func appModel() -> AppModel {
        let app = AppModel()
        app.persistsPreferences = false
        app.isDebugPreview = true
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
        DatabaseService.shared.upsertMailboxes(app.mailboxes)
        DatabaseService.shared.upsertFolders(mailboxId: "mb-preview", folders: app.folders)
        DatabaseService.shared.upsertEmails(mailboxId: "mb-preview", emails: emails)
        app.emails = emails
        app.replyLaterCount = emails.filter(\.replyLater).count
        app.isLoading = false
        app.isMailboxLoading = false
        return app
    }

    @MainActor
    static func authStore() -> AuthStore {
        let store = AuthStore(persistsSession: false)
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
        if (args.contains("-previewScreener") || args.contains("-previewScreenerList")),
           let screener = app.emails.first(where: { $0.folderId == "screener" }) {
            app.selectedTab = .folder("screener")
            app.emails = app.emails.filter { $0.folderId == "screener" }
            if !args.contains("-previewScreenerList") {
                app.selectedEmail = screener
                app.threadEmails = [screener]
            }
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
        if let service = previewDomainService(args: args) {
            applyPreviewService(service, to: app)
        }
        return app
    }

    static let previewServiceDomain = "acme.com"

    /// Launch args that open the inbox preview in a service-ended / ending state.
    static let serviceMailboxPreviewArgs = [
        "-previewServiceEnded",
        "-previewServiceEndedMember",
        "-previewServiceEndedClosed",
        "-previewServiceEnding",
    ]

    static var isServiceMailboxPreview: Bool {
        let args = ProcessInfo.processInfo.arguments
        return serviceMailboxPreviewArgs.contains(where: args.contains)
    }

    /// `-previewServiceEnded` (admin can renew), `-previewServiceEndedMember` (ask an admin),
    /// `-previewServiceEndedClosed` (past the deadline), `-previewServiceEnding` (admin keep).
    static func previewDomainService(args: [String] = ProcessInfo.processInfo.arguments) -> DomainService? {
        let iso = ISO8601DateFormatter()
        let day: TimeInterval = 24 * 60 * 60
        let now = Date()
        if args.contains("-previewServiceEnding") {
            return DomainService(
                domain: previewServiceDomain,
                status: "ending",
                endsAt: iso.string(from: now.addingTimeInterval(9 * day)),
                registrarManaged: true,
                canRenew: true,
                canManage: true,
                billed: true
            )
        }
        let closed = args.contains("-previewServiceEndedClosed")
        guard closed
            || args.contains("-previewServiceEnded")
            || args.contains("-previewServiceEndedMember")
            || args.contains("-previewDomainAdminServiceEnded") else { return nil }
        return DomainService(
            domain: previewServiceDomain,
            status: "ended",
            endedAt: iso.string(from: now.addingTimeInterval(-28 * day)),
            registrarManaged: true,
            registrationExpiresAt: iso.string(from: now.addingTimeInterval(-28 * day)),
            renewBy: iso.string(from: now.addingTimeInterval((closed ? -1 : 12) * day)),
            daysLeftToRenew: closed ? 0 : 12,
            canRenew: !closed,
            canManage: !args.contains("-previewServiceEndedMember"),
            billed: true
        )
    }

    /// Moves the preview mailbox onto the custom domain and marks it read-only when ended.
    @MainActor
    static func applyPreviewService(_ service: DomainService, to app: AppModel) {
        let mailbox = Mailbox(
            id: "mb-preview",
            email: "alex@\(previewServiceDomain)",
            name: "Alex Rivera",
            settings: app.mailboxes.first?.settings,
            canManage: true,
            readOnly: service.isEnded,
            service: service
        )
        app.mailboxes = [mailbox]
        app.mailDomain = previewServiceDomain
        app.domainServices[previewServiceDomain] = service
    }

    static let adminRows: [AdminMailboxRow] = [
        AdminMailboxRow(
            id: "you@inboxies.email",
            email: "you@inboxies.email",
            name: "Alex Rivera",
            acl: MailboxAcl(owners: ["email:admin@example.com", "sub:google-oauth2|1029384756"], members: []),
            claimed: true,
            fromName: "Alex Rivera"
        ),
        AdminMailboxRow(
            id: "ops@inboxies.email",
            email: "ops@inboxies.email",
            name: "Ops",
            acl: MailboxAcl(
                owners: [
                    "email:ops-lead@inboxies.email",
                    "email:dev-operations-infrastructure@inboxies.email",
                    "sub:github|998877"
                ],
                members: []
            ),
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
        if let service = previewDomainService() {
            app.mailDomain = previewServiceDomain
            app.domainServices[previewServiceDomain] = service
        }
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
                } else if ProcessInfo.processInfo.arguments.contains("-previewComposeMinimized") {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    await app.startCompose(mode: .new)
                    app.minimizeCompose()
                } else if ProcessInfo.processInfo.arguments.contains("-previewChat") {
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    app.openChatSession(resumeActive: true)
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
                SignInView(expandPasswordForm: true)
                    .environment(auth)
                    .environment(app)
            } else if args.contains("-previewAuthOptions") {
                SignInView(expandPasswordForm: false)
                    .environment(auth)
                    .environment(app)
            } else if args.contains("-previewInviteAccept") {
                InviteAcceptPreview(signedIn: false)
            } else if args.contains("-previewInviteAcceptSignedIn") {
                InviteAcceptPreview(signedIn: true)
            } else if args.contains("-previewSignInMethods") {
                NavigationStack {
                    SignInMethodsPreview()
                }
            } else if args.contains("-previewMembers") {
                NavigationStack {
                    SharingSettingsView()
                }
                .environment(PreviewSupport.appModel())
            } else if args.contains("-previewSessions") {
                NavigationStack {
                    SessionsSettingsView()
                }
            } else if args.contains("-previewDomainAdminDetail") {
                NavigationStack {
                    DomainAdminMailboxDetailView(
                        mailbox: PreviewSupport.adminRows[0],
                        previewRows: PreviewSupport.adminRows
                    )
                }
            } else if args.contains("-previewDomainAdminDetailUnassigned") {
                NavigationStack {
                    DomainAdminMailboxDetailView(
                        mailbox: PreviewSupport.adminRows[1],
                        previewRows: PreviewSupport.adminRows
                    )
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

/// The real invite screen on a fixture invite (no network).
private struct InviteAcceptPreview: View {
    let signedIn: Bool
    @State private var auth = AuthStore(persistsSession: false)

    var body: some View {
        InviteAcceptView(
            token: "preview",
            previewInvite: InvitePublic(
                mailboxId: "team@inboxies.email",
                role: "member",
                inviteeEmail: "alex@example.com",
                inviteeName: "Alex",
                expiresAt: "2026-12-01T00:00:00.000Z",
                status: "pending"
            ),
            onSignIn: {},
            onDone: {}
        )
        .environment(auth)
        .onAppear {
            if signedIn {
                auth.token = "preview-token"
                auth.userEmail = "alex@example.com"
            }
        }
    }
}

/// The real Sign-in & recovery screen on fixture identities (no network).
private struct SignInMethodsPreview: View {
    @Environment(AppModel.self) private var app
    @State private var ready = false

    var body: some View {
        if ready {
            SignInMethodsSettingsView()
        } else {
            Color.clear.onAppear {
                app.setIdentities([
                    LinkedIdentity(type: "password", key: "user:preview", label: "Password (you@inboxies.email)", current: false),
                    LinkedIdentity(type: "apple", key: "sub:preview", label: "Apple", current: false),
                ])
                ready = true
            }
        }
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

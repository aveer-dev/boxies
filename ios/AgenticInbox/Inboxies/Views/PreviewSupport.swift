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
            Folder(id: "spam", name: "Spam", unreadCount: 1),
            Folder(id: "screened_out", name: "Screened out", unreadCount: 0),
            Folder(id: "trash", name: "Trash", unreadCount: 0),
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
            snippet: "Your itinerary for next week's trip is ready to view.",
            // AVE-99: RFC 8058 bulk mail, so Report Spam offers "Unsubscribe".
            oneClickUnsubscribe: true
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
            id: "preview-spam-1",
            folderId: "spam",
            subject: "You've won a $500 gift card",
            sender: "prizes@winner.example",
            senderName: "Rewards Center",
            recipient: "you@inboxies.email",
            date: "2026-09-20T07:15:00.000Z",
            read: false,
            starred: false,
            // Designed mail (own colours): a light paper card in dark mode.
            body: ##"<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#fff4e5"><tr><td style="padding: 16px; color: #7a3e00"><p><b>Claim your reward</b> before it expires.</p></td></tr></table>"##,
            snippet: "Claim your reward before it expires.",
            folderName: "Spam",
            // AVE-94: reason line + "Unverified sender" banner in the reader.
            authTier: "unverified",
            classificationReason: "ai-spam"
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
        } else if args.contains("-previewSpam"),
                  let spam = app.emails.first(where: { $0.folderId == "spam" }) {
            app.selectedTab = .folder("spam")
            app.emails = app.emails.filter { $0.folderId == "spam" }
            app.selectedEmail = spam
            app.threadEmails = [spam]
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
        if args.contains("-previewNotes") {
            applyNotesFixtures(to: app, args: args)
        }
        applyLoadStateFixtures(to: app, args: args)
        if args.contains("-previewManyNew") {
            applyManyNewFixtures(to: app)
        }
        if let service = previewDomainService(args: args) {
            applyPreviewService(service, to: app)
        }
        return app
    }

    // MARK: Notes to self (AVE-61)

    /// In-memory notes per conversation key while a DEBUG preview runs (no server).
    @MainActor static var threadNotes: [String: [ThreadNote]] = [:]

    static let notesThreadKey = "thread-preview-q3"

    static let noteThread: [Email] = [
        Email(
            id: "preview-1a",
            threadId: notesThreadKey,
            folderId: "inbox",
            subject: "Quarterly planning notes",
            sender: "jordan@example.com",
            senderName: "Jordan Hale",
            recipient: "you@inboxies.email",
            date: "2026-09-01T09:05:00.000Z",
            read: true,
            starred: false,
            body: "<p>Hi team — here is the proposal for the Q3 review. Section 3 covers the SLA requirements and the pricing tiers we discussed.</p><p>Let me know what you think.</p>",
            snippet: "Hi team — here is the proposal for the Q3 review."
        ),
        Email(
            id: "preview-1b",
            threadId: notesThreadKey,
            folderId: "inbox",
            subject: "Re: Quarterly planning notes",
            sender: "you@inboxies.email",
            senderName: "Alex Rivera",
            recipient: "jordan@example.com",
            date: "2026-09-02T16:40:00.000Z",
            read: true,
            starred: false,
            body: "<p>Looks solid. Legal is reviewing section 3 now; I'll confirm pricing by Friday.</p>",
            snippet: "Looks solid. Legal is reviewing section 3 now."
        ),
        Email(
            id: "preview-1",
            threadId: notesThreadKey,
            folderId: "inbox",
            subject: "Re: Quarterly planning notes",
            sender: "jordan@example.com",
            senderName: "Jordan Hale",
            recipient: "you@inboxies.email",
            date: "2026-09-03T14:30:00.000Z",
            read: false,
            starred: false,
            body: "<p>Thanks! Can we move Thursday's sync to the morning instead? I have a conflict at 3pm.</p><p>— Jordan</p>",
            snippet: "Can we move Thursday's sync to the morning instead?",
            threadCount: 3
        ),
    ]

    /// Sticky + inline notes for the Q3 thread, and a sticky / note count on two other rows.
    static func noteFixtures(stickyAt position: CGPoint? = nil) -> [String: [ThreadNote]] {
        func note(
            _ id: String,
            thread: String,
            type: String,
            emailId: String? = nil,
            body: String,
            created: String,
            updated: String? = nil,
            position: CGPoint? = nil
        ) -> ThreadNote {
            ThreadNote(
                id: id,
                threadId: thread,
                emailId: emailId,
                noteType: type,
                body: body,
                posX: position.map { Double($0.x) },
                posY: position.map { Double($0.y) },
                createdAt: created,
                updatedAt: updated ?? created
            )
        }
        return [
            notesThreadKey: [
                note(
                    "note-sticky-q3",
                    thread: notesThreadKey,
                    type: ThreadNote.stickyType,
                    body: "**Call Jordan before Thursday** re: pricing — keep it under $15k.\n\n- [x] Loop in Sam\n- [ ] Send the revised deck",
                    created: "2026-09-03T15:02:00.000Z",
                    position: position
                ),
                note(
                    "note-inline-q3-1",
                    thread: notesThreadKey,
                    type: ThreadNote.inlineType,
                    emailId: "preview-1a",
                    body: "Discussed section 3 on SLA requirements; _approved by legal_.",
                    created: "2026-09-01T10:25:00.000Z"
                ),
                note(
                    "note-inline-q3-2",
                    thread: notesThreadKey,
                    type: ThreadNote.inlineType,
                    emailId: "preview-1b",
                    body: "Follow up if Jordan hasn't confirmed by **Friday**. See [the pricing sheet](https://example.com/pricing).",
                    created: "2026-09-02T17:00:00.000Z",
                    updated: "2026-09-02T18:10:00.000Z"
                ),
            ],
            "preview-2": [
                note(
                    "note-sticky-invoice",
                    thread: "preview-2",
                    type: ThreadNote.stickyType,
                    body: "Paid by wire on Sep 4 — ref `INV-2291`",
                    created: "2026-09-04T09:00:00.000Z"
                ),
            ],
            "preview-3": [
                note("note-inline-design-1", thread: "preview-3", type: ThreadNote.inlineType, emailId: "preview-3",
                     body: "Bring the mobile frames.", created: "2026-08-28T19:00:00.000Z"),
                note("note-inline-design-2", thread: "preview-3", type: ThreadNote.inlineType, emailId: "preview-3",
                     body: "Ask about the icon set.", created: "2026-08-28T19:05:00.000Z"),
            ],
        ]
    }

    /// `-previewNotes` (with `-previewMailbox` or `-previewDetail`): seeds notes to self.
    /// `-previewDetail -previewNotes` opens the Q3 thread with a sticky and inline notes;
    /// add `-previewNotesMoved` for a sticky already dragged to the lower left,
    /// `-previewNotesThrow` for a scripted drag-and-throw loop (screen recordings), and
    /// `-previewNoteEditor` / `-previewNoteEditorPreview` to open its editor.
    @MainActor
    private static func applyNotesFixtures(to app: AppModel, args: [String]) {
        let moved = args.contains("-previewNotesMoved") ? CGPoint(x: 16, y: 340) : nil
        threadNotes = noteFixtures(stickyAt: moved)
        for index in app.emails.indices {
            if app.emails[index].id == "preview-1" {
                app.emails[index] = noteThread[2]
            }
            let summary = ThreadNoteSummary(notes: threadNotes[app.emails[index].noteThreadKey] ?? [])
            app.emails[index].hasStickyNote = summary.hasStickyNote
            app.emails[index].stickyNoteText = summary.stickyNoteText
            app.emails[index].inlineNoteCount = summary.inlineNoteCount
        }
        DatabaseService.shared.upsertEmails(mailboxId: "mb-preview", emails: noteThread)
        if args.contains("-previewDetail"), let latest = app.emails.first(where: { $0.id == "preview-1" }) {
            app.selectedEmail = latest
            app.threadEmails = noteThread
        }
    }

    /// One step of the scripted sticky drag (`-previewNotesThrow`).
    enum ScriptedDragStep {
        /// Lift the first sticky where it sits.
        case pickUp
        /// Finger at this translation from the pick-up point, moving at this velocity (pt/s).
        case move(CGSize, CGSize)
        /// Let go at this translation and velocity.
        case release(CGSize, CGSize)
    }

    static let scriptedDragNotification = Notification.Name("InboxiesPreviewScriptedStickyDrag")
    /// Written back by the sticky on pick-up: where it was lifted from, in its view.
    @MainActor static var scriptedStart: CGPoint = .zero
    @MainActor static var scriptedView: CGSize = .zero
    @MainActor private static var scriptedThrowStarted = false

    /// `-previewDetail -previewNotes -previewNotesThrow`: after a beat, the first sticky is
    /// picked up and thrown around the reader by the same code a finger drives (lift,
    /// speed tilt, projected throw, spring settle), so a screen recording shows the
    /// motion without touch injection. Throws: a fast fling to the lower left (lands on
    /// the edge), a slow drag that stops before letting go (the lean eases back), and a
    /// curved toss back up to the top right. Runs twice.
    @MainActor
    static func runScriptedStickyThrow(index: Int) async {
        guard index == 0, !scriptedThrowStarted,
              ProcessInfo.processInfo.arguments.contains("-previewNotesThrow") else { return }
        scriptedThrowStarted = true
        func send(_ step: ScriptedDragStep) {
            NotificationCenter.default.post(name: scriptedDragNotification, object: step)
        }

        /// One drag to `target(view)`: lift, follow a bowed path, optionally rest, let go.
        func gesture(to target: (CGSize) -> CGPoint, seconds: Double, bow: CGFloat, accelerate: Bool, hold: Double) async {
            send(.pickUp)
            let start = scriptedStart
            let end = target(scriptedView)
            try? await Task.sleep(for: .milliseconds(140))
            let delta = CGSize(width: end.x - start.x, height: end.y - start.y)
            let tick = 0.016
            let steps = max(2, Int(seconds / tick))
            var last = CGSize.zero
            var velocity = CGSize.zero
            for step in 1...steps {
                let t = CGFloat(step) / CGFloat(steps)
                // Accelerating fling (t²), or an eased drag that slows to a stop.
                let progress = accelerate ? t * t : t * t * (3 - 2 * t)
                // A sideways bow so the path curves and the lean changes direction.
                let side = sin(.pi * t) * bow
                let translation = CGSize(width: delta.width * progress + side, height: delta.height * progress)
                velocity = CGSize(
                    width: (translation.width - last.width) / tick,
                    height: (translation.height - last.height) / tick
                )
                last = translation
                send(.move(translation, velocity))
                try? await Task.sleep(for: .milliseconds(16))
            }
            if hold > 0 {
                // The finger rests before letting go: no speed left to carry.
                try? await Task.sleep(for: .seconds(hold))
                velocity = .zero
            }
            send(.release(last, velocity))
        }

        let edge = StickyNoteLayout.edge
        try? await Task.sleep(for: .seconds(1.5))
        for _ in 0..<2 {
            await gesture(to: { CGPoint(x: edge + 30, y: $0.height * 0.55) }, seconds: 0.42, bow: -40, accelerate: true, hold: 0)
            try? await Task.sleep(for: .seconds(1.3))
            await gesture(to: { CGPoint(x: $0.width * 0.2, y: $0.height * 0.25) }, seconds: 0.9, bow: 70, accelerate: false, hold: 0.45)
            try? await Task.sleep(for: .seconds(1.1))
            await gesture(to: { CGPoint(x: $0.width - 200, y: edge + 20) }, seconds: 0.5, bow: 50, accelerate: true, hold: 0)
            try? await Task.sleep(for: .seconds(1.6))
        }
    }

    /// Modifiers for `-previewMailbox`: first-load failure, list fetch failure, load-more footer.
    @MainActor
    private static func applyLoadStateFixtures(to app: AppModel, args: [String]) {
        let offline = "The Internet connection appears to be offline."
        if args.contains("-previewLoadFailed") {
            app.mailboxes = []
            app.selectedMailboxId = nil
            app.emails = []
            app.errorMessage = offline
            app.mailboxesLoadFailed = true
        } else if args.contains("-previewListError") {
            app.emails = []
            app.emailListError = offline
        } else if args.contains("-previewLoadMore"), let key = app.currentListKey {
            var paging = EmailListPaging(key: key)
            paging.apply(
                page: 1,
                receivedCount: EmailListPaging.pageSize,
                totalCount: EmailListPaging.pageSize * 4,
                oldestDate: app.emails.last?.date
            )
            paging.isLoadingMore = true
            app.listPaging = paging
        }
    }

    /// `-previewMailbox -previewManyNew`: a dozen New conversations, so Inbox caps New at
    /// `inboxNewPreviewLimit` with "Show N more new" above Seen (AVE-23).
    @MainActor
    private static func applyManyNewFixtures(to app: AppModel) {
        let senders = ["Priya Shah", "Marco Rossi", "Lena Fischer", "Tom Becker", "Ava Chen",
                       "Noah Kim", "Sara Lind", "Omar Haddad", "Ivy Park", "Ben Ortiz"]
        let extra = senders.enumerated().map { index, name in
            Email(
                id: "preview-new-\(index)",
                folderId: "inbox",
                subject: "Follow-up \(index + 1)",
                sender: "\(name.split(separator: " ")[0].lowercased())@example.com",
                senderName: name,
                recipient: "you@inboxies.email",
                date: String(format: "2026-09-%02dT09:00:00.000Z", 2 + index),
                read: false,
                starred: false,
                body: "<p>Checking in.</p>",
                snippet: "Checking in on the thread from last week.",
                folderName: "Inbox"
            )
        }
        DatabaseService.shared.upsertEmails(mailboxId: "mb-preview", emails: extra)
        app.emails = EmailListPaging.inboxOrder(app.emails + extra, sectionFloor: nil)
        if let key = app.currentListKey {
            let unread = app.emails.filter(\.isUnread)
            app.inboxNewWindow = InboxNewWindow(key: key, count: unread.count, ids: unread.map(\.id))
        }
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
            } else if args.contains("-previewSenders") {
                // `-previewSenders` (Allowed); add `-previewSendersBlocked` for the
                // Blocked tab. Fixture rules, no API (Android: `senders` / `sendersBlocked`).
                NavigationStack {
                    SendersSettingsView(initialTab: args.contains("-previewSendersBlocked") ? .blocked : .allowed)
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

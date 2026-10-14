package co.inboxies.app.ui.preview

import co.inboxies.app.BuildConfig
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.DomainService
import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.InvitePublic
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.SignatureSettings
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import co.inboxies.app.services.DatabaseService
import java.net.URI
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Shared DEBUG fixtures for emulator previews and Compose `@Preview`.
 * Parallel to iOS `PreviewSupport.swift`.
 */
object PreviewSupport {
    private const val OFFLINE_MESSAGE = "The Internet connection appears to be offline."

    /** Fixture domain derived from [BuildConfig.DEFAULT_API_BASE]; never hardcodes a product host. */
    fun mailDomain(): String {
        val host = runCatching { URI(BuildConfig.DEFAULT_API_BASE).host }.getOrNull()?.lowercase()
        return when {
            host.isNullOrBlank() -> "preview.local"
            host == "10.0.2.2" || host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" ->
                "preview.local"
            else -> host
        }
    }

    private fun addr(local: String): String = "$local@${mailDomain()}"

    fun applyAuth(auth: AuthStore) {
        auth.applyEphemeralSession(
            token = "preview-token",
            email = addr("you"),
        )
    }

    /**
     * Subscription fixtures for the service-ended previews: ended 9 days ago with a
     * registrar renew-by deadline 21 days out, or (ending) set to cancel in 6 days.
     */
    fun domainServiceFixture(mode: PreviewMode, domain: String = mailDomain()): DomainService? {
        val now = Instant.now()
        fun iso(days: Long) = now.plus(days, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS).toString()
        return when (mode) {
            PreviewMode.ServiceEnded, PreviewMode.ServiceEndedMember, PreviewMode.DomainDnsEnded -> DomainService(
                domain = domain,
                status = DomainService.STATUS_ENDED,
                endedAt = iso(-9),
                registrarManaged = true,
                registrationExpiresAt = iso(-19),
                renewBy = iso(21),
                daysLeftToRenew = 21,
                canRenew = true,
                canManage = mode != PreviewMode.ServiceEndedMember,
                billed = true,
            )
            PreviewMode.ServiceEnding -> DomainService(
                domain = domain,
                status = DomainService.STATUS_ENDING,
                endsAt = iso(6),
                registrarManaged = true,
                registrationExpiresAt = iso(120),
                canRenew = true,
                canManage = true,
                billed = true,
            )
            else -> null
        }
    }

    fun applyMailboxPreview(app: AppModel, mode: PreviewMode) {
        val you = addr("you")
        val service = domainServiceFixture(mode)
        val mailbox = Mailbox(
            id = "mb-preview",
            email = you,
            name = "Alex Rivera",
            settings = MailboxSettings(
                fromName = "Alex Rivera",
                signature = SignatureSettings(enabled = true, text = "Alex"),
            ),
            readOnly = service?.isEnded,
            service = service,
        )
        val serviceAdmin = service?.canManage == true
        val administeredDomains = if (serviceAdmin) listOf(mailbox.domain) else emptyList()
        val domainServices = service?.let { mapOf(mailbox.domain to it) } ?: emptyMap()
        val folders = listOf(
            Folder(id = FolderIds.INBOX, name = "Inbox", unreadCount = 3),
            Folder(id = FolderIds.SCREENER, name = "Screener", unreadCount = 1),
            Folder(id = FolderIds.PROMOTIONS, name = "Promotions", unreadCount = 0),
            Folder(id = FolderIds.UPDATES, name = "Updates", unreadCount = 0),
            Folder(id = FolderIds.SENT, name = "Sent", unreadCount = 0),
            Folder(id = FolderIds.ARCHIVE, name = "Archive", unreadCount = 0),
            Folder(id = FolderIds.SPAM, name = "Spam", unreadCount = 1),
            Folder(id = FolderIds.SCREENED_OUT, name = "Screened out", unreadCount = 0),
            Folder(id = FolderIds.TRASH, name = "Trash", unreadCount = 0),
        )
        val allEmails = emails(you)
        DatabaseService.shared.upsertMailboxes(listOf(mailbox))
        DatabaseService.shared.upsertFolders(mailbox.id, folders)
        DatabaseService.shared.upsertEmails(mailbox.id, allEmails)

        when (mode) {
            PreviewMode.Screener -> {
                val screener = allEmails.filter { it.folderId == FolderIds.SCREENER }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = screener,
                    selectedTab = HomeTab.Folder(FolderIds.SCREENER),
                    selectedEmail = screener.firstOrNull(),
                    threadEmails = screener.take(1),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                )
            }
            PreviewMode.ScreenerList -> {
                val screener = allEmails.filter { it.folderId == FolderIds.SCREENER }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = screener,
                    selectedTab = HomeTab.Folder(FolderIds.SCREENER),
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                )
            }
            PreviewMode.Spam -> {
                val spam = allEmails.filter { it.folderId == FolderIds.SPAM }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = spam,
                    selectedTab = HomeTab.Folder(FolderIds.SPAM),
                    selectedEmail = spam.firstOrNull(),
                    threadEmails = spam.take(1),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                )
            }
            PreviewMode.ReplyLater -> {
                val queued = allEmails.filter { it.replyLater }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = queued,
                    selectedTab = HomeTab.ReplyLater,
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = queued.size,
                    isAdmin = false,
                )
            }
            PreviewMode.LoadFailed -> {
                app.applyDebugPreview(
                    mailboxes = emptyList(),
                    selectedMailboxId = null,
                    folders = emptyList(),
                    emails = emptyList(),
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = 0,
                    isAdmin = false,
                    mailboxesLoadFailed = true,
                    errorMessage = OFFLINE_MESSAGE,
                )
            }
            PreviewMode.ListError -> {
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = emptyList(),
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = 0,
                    isAdmin = false,
                    emailListError = OFFLINE_MESSAGE,
                )
            }
            PreviewMode.LoadMore -> {
                // A full first page (fixtures + filler) with more on the "server": scrolling
                // to the end shows the pulsing load-more row, which stays up (no network).
                val inbox = allEmails.filter { it.folderId == FolderIds.INBOX } + fillerSeenEmails(you)
                DatabaseService.shared.upsertEmails(mailbox.id, inbox)
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = AppModel.orderNewThenSeen(inbox),
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                    hasMorePages = true,
                )
            }
            else -> {
                // Inbox list only (matches production sync + iOS previewMailbox).
                val inbox = allEmails.filter { it.folderId == FolderIds.INBOX }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = inbox,
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = null,
                    threadEmails = emptyList(),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                    administeredDomains = administeredDomains,
                    domainServices = domainServices,
                )
            }
        }
    }

    fun invite() = InvitePublic(
        mailboxId = addr("team"),
        role = "member",
        inviteeEmail = "alex@example.com",
        inviteeName = "Alex",
        expiresAt = "2026-12-01T00:00:00.000Z",
        status = "pending",
    )

    fun identities() = listOf(
        LinkedIdentity(type = "password", key = "user:preview", label = "Password (${addr("you")})"),
        LinkedIdentity(type = "google", key = "sub:preview", label = "Google"),
    )

    fun applyAdminPreview(app: AppModel, domainServices: Map<String, DomainService> = emptyMap()) {
        app.applyDebugPreview(
            mailboxes = emptyList(),
            selectedMailboxId = null,
            folders = emptyList(),
            emails = emptyList(),
            selectedTab = HomeTab.AiInbox,
            selectedEmail = null,
            threadEmails = emptyList(),
            replyLaterCount = 0,
            isAdmin = true,
            administeredDomains = domainServices.keys.toList(),
            domainServices = domainServices,
        )
    }

    fun adminRows(): List<AdminMailboxRow> {
        val you = addr("you")
        val ops = addr("ops")
        val pending = addr("pending")
        return listOf(
            AdminMailboxRow(
                id = you,
                email = you,
                name = "Alex Rivera",
                acl = MailboxAcl(owners = listOf("email:admin@example.com", "sub:google-oauth2|1029384756"), members = emptyList()),
                claimed = true,
                fromName = "Alex Rivera",
            ),
            AdminMailboxRow(
                id = ops,
                email = ops,
                name = "Ops",
                acl = MailboxAcl(
                    owners = listOf(
                        "email:ops-lead@inboxies.email",
                        "email:dev-operations-infrastructure@inboxies.email",
                        "sub:github|998877",
                    ),
                    members = emptyList(),
                ),
                claimed = true,
                fromName = "Ops",
            ),
            AdminMailboxRow(
                id = pending,
                email = pending,
                name = "Pending",
                acl = MailboxAcl(owners = listOf("email:admin@example.com"), members = emptyList()),
                claimed = true,
                fromName = "Pending",
            ),
        )
    }

    /** Older, read inbox rows that pad the load-more preview past one screen. */
    private fun fillerSeenEmails(you: String): List<Email> {
        val senders = listOf(
            "Priya Natarajan" to "priya@example.com",
            "Marco Bellini" to "marco@example.com",
            "Hana Sato" to "hana@example.com",
            "Theo Laurent" to "theo@example.com",
        )
        val subjects = listOf(
            "Weekly metrics digest",
            "Re: Offsite logistics",
            "Contract redlines attached",
            "Lunch next week?",
            "Release notes draft",
        )
        return (1..22).map { i ->
            val (name, address) = senders[i % senders.size]
            Email(
                id = "preview-older-$i",
                folderId = FolderIds.INBOX,
                subject = subjects[i % subjects.size],
                sender = address,
                senderName = name,
                recipient = you,
                date = "2026-08-%02dT10:00:00.000Z".format(28 - i),
                read = true,
                starred = false,
                snippet = "Following up on the thread from last week.",
                listSection = "seen",
            )
        }
    }

    fun emails(you: String = addr("you")): List<Email> = listOf(
        Email(
            id = "preview-1",
            folderId = FolderIds.INBOX,
            subject = "Quarterly planning notes",
            sender = "jordan@example.com",
            senderName = "Jordan Hale",
            recipient = you,
            date = "2026-09-03T14:30:00.000Z",
            read = false,
            starred = false,
            // Remote pixel exercises the "Load images" bar in DEBUG previews.
            body = "<p>Can we move Thursday's sync to the morning instead?</p>" +
                "<img src=\"https://example.com/pixel.gif\" width=\"1\" height=\"1\" alt=\"\">",
            snippet = "Can we move Thursday's sync to the morning instead?",
            threadCount = 3,
            listSection = "new",
        ),
        Email(
            id = "preview-2",
            folderId = FolderIds.INBOX,
            subject = "Re: Invoice for March",
            sender = "alex@example.com",
            senderName = "Alex Rivera",
            recipient = you,
            date = "2026-09-02T09:12:00.000Z",
            read = true,
            starred = true,
            replyLater = true,
            replyLaterAt = "2026-09-02T10:00:00.000Z",
            snippet = "Attached is the updated PDF for last month's work.",
            needsReply = true,
            hasAttachment = true,
            listSection = "seen",
        ),
        Email(
            id = "preview-3",
            folderId = FolderIds.INBOX,
            subject = "Design review tomorrow",
            sender = "sam@example.com",
            senderName = "Sam Chen",
            recipient = you,
            date = "2026-08-28T18:04:00.000Z",
            read = false,
            starred = false,
            snippet = "Posting the latest frames in the shared folder now.",
            hasDraft = true,
            listSection = "new",
        ),
        Email(
            id = "preview-4",
            folderId = FolderIds.INBOX,
            subject = "Flight confirmation",
            sender = "taylor@example.com",
            senderName = "Taylor Brooks",
            recipient = you,
            date = "2026-03-15T11:00:00.000Z",
            read = true,
            starred = false,
            snippet = "Your itinerary for next week's trip is ready to view.",
            listSection = "seen",
        ),
        Email(
            id = "preview-screener-1",
            folderId = FolderIds.SCREENER,
            subject = "Quick intro from Acme",
            sender = "hello@acme.example",
            senderName = "Acme Outreach",
            recipient = you,
            date = "2026-09-19T12:00:00.000Z",
            read = false,
            starred = false,
            body = "<p>Hi — we'd love to show you Acme. No pressure.</p>",
            snippet = "Hi — we'd love to show you Acme. No pressure.",
            folderName = "Screener",
        ),
        Email(
            id = "preview-spam-1",
            folderId = FolderIds.SPAM,
            subject = "You've won a $500 gift card",
            sender = "prizes@winner.example",
            senderName = "Rewards Center",
            recipient = you,
            date = "2026-09-20T07:15:00.000Z",
            read = false,
            starred = false,
            body = "<p>Claim your reward before it expires.</p>",
            snippet = "Claim your reward before it expires.",
            folderName = "Spam",
        ),
        Email(
            id = "preview-rl-2",
            folderId = FolderIds.INBOX,
            subject = "Can you review the contract?",
            sender = "legal@example.com",
            senderName = "Pat Legal",
            recipient = you,
            date = "2026-09-10T08:00:00.000Z",
            read = true,
            starred = false,
            replyLater = true,
            replyLaterAt = "2026-09-11T09:00:00.000Z",
            snippet = "Draft is in the shared drive — need a sign-off by Friday.",
            needsReply = true,
            listSection = "seen",
        ),
    )
}

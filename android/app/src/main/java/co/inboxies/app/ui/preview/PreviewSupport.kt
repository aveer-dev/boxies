package co.inboxies.app.ui.preview

import co.inboxies.app.BuildConfig
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.Email
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.SignatureSettings
import co.inboxies.app.services.AppModel
import co.inboxies.app.services.AuthStore
import java.net.URI

/**
 * Shared DEBUG fixtures for emulator previews and Compose `@Preview`.
 * Parallel to iOS `PreviewSupport.swift`.
 */
object PreviewSupport {
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

    fun applyMailboxPreview(app: AppModel, mode: PreviewMode) {
        val you = addr("you")
        val mailbox = Mailbox(
            id = "mb-preview",
            email = you,
            name = "Alex Rivera",
            settings = MailboxSettings(
                fromName = "Alex Rivera",
                signature = SignatureSettings(enabled = true, text = "Alex"),
            ),
        )
        val folders = listOf(
            Folder(id = FolderIds.INBOX, name = "Inbox", unreadCount = 3),
            Folder(id = FolderIds.SCREENER, name = "Screener", unreadCount = 1),
            Folder(id = FolderIds.PROMOTIONS, name = "Promotions", unreadCount = 0),
            Folder(id = FolderIds.UPDATES, name = "Updates", unreadCount = 0),
            Folder(id = FolderIds.SENT, name = "Sent", unreadCount = 0),
            Folder(id = FolderIds.ARCHIVE, name = "Archive", unreadCount = 0),
            Folder(id = FolderIds.SCREENED_OUT, name = "Screened out", unreadCount = 0),
        )
        val allEmails = emails(you)

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
                )
            }
        }
    }

    fun applyAdminPreview(app: AppModel) {
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
        )
    }

    fun adminRows(): List<AdminMailboxRow> {
        val you = addr("you")
        val ops = addr("ops")
        val pending = addr("pending")
        val owners = listOf("email:admin@example.com")
        return listOf(
            AdminMailboxRow(
                id = you,
                email = you,
                name = "Alex Rivera",
                acl = MailboxAcl(owners = owners, members = emptyList()),
                claimed = true,
                fromName = "Alex Rivera",
            ),
            AdminMailboxRow(
                id = ops,
                email = ops,
                name = "Ops",
                acl = MailboxAcl(owners = owners, members = emptyList()),
                claimed = true,
                fromName = "Ops",
            ),
            AdminMailboxRow(
                id = pending,
                email = pending,
                name = "Pending",
                acl = MailboxAcl(owners = owners, members = emptyList()),
                claimed = true,
                fromName = "Pending",
            ),
        )
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
            body = "<p>Can we move Thursday's sync to the morning instead?</p>",
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

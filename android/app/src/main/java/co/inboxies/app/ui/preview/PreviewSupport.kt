package co.inboxies.app.ui.preview

import co.inboxies.app.BuildConfig
import co.inboxies.app.models.AdminMailboxRow
import co.inboxies.app.models.DomainService
import co.inboxies.app.models.Email
import co.inboxies.app.models.ThreadNote
import co.inboxies.app.services.ThreadNoteSummary
import co.inboxies.app.models.Folder
import co.inboxies.app.models.FolderIds
import co.inboxies.app.models.HomeTab
import co.inboxies.app.models.InvitePublic
import co.inboxies.app.models.LinkedIdentity
import co.inboxies.app.models.Mailbox
import co.inboxies.app.models.MailboxAcl
import co.inboxies.app.models.AiUsageCounter
import co.inboxies.app.models.AiUsageSnapshot
import co.inboxies.app.models.MailboxSettings
import co.inboxies.app.models.ScreenerSettings
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

    /** AI usage fixture (AVE-45): warning level 42 / 50, or the limit 50 / 50. Resets next UTC midnight. */
    fun aiUsage(atLimit: Boolean): AiUsageSnapshot {
        val today = java.time.LocalDate.now(java.time.ZoneOffset.UTC)
        val resetsAt = today.plusDays(1).atStartOfDay(java.time.ZoneOffset.UTC).toInstant()
        return AiUsageSnapshot(
            tier = "free",
            day = today.toString(),
            resetsAt = resetsAt.toString(),
            chat = AiUsageCounter(used = if (atLimit) 50 else 42, limit = 50),
            inbound = AiUsageCounter(used = 37, limit = 200),
        )
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
                screener = if (mode == PreviewMode.SettingsScreenerOff) ScreenerSettings(enabled = false) else null,
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
            PreviewMode.Newsletter -> {
                val newsletter = newsletterEmail(you)
                DatabaseService.shared.upsertEmails(mailbox.id, listOf(newsletter))
                val inbox = listOf(newsletter) + allEmails.filter { it.folderId == FolderIds.INBOX }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = inbox,
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = newsletter,
                    threadEmails = listOf(newsletter),
                    replyLaterCount = allEmails.count { it.replyLater },
                    isAdmin = false,
                )
            }
            PreviewMode.Notes, PreviewMode.NotesDetail -> {
                val notes = noteFixtures()
                val thread = noteThread(you)
                DatabaseService.shared.upsertEmails(mailbox.id, thread)
                val inbox = allEmails
                    .filter { it.folderId == FolderIds.INBOX }
                    .map { if (it.id == "preview-1") thread.last() else it }
                    .map { email ->
                        val summary = ThreadNoteSummary.of(notes[email.noteThreadKey].orEmpty())
                        email.copy(
                            hasStickyNote = summary.hasStickyNote,
                            stickyNoteText = summary.stickyNoteText,
                            inlineNoteCount = summary.inlineNoteCount,
                        )
                    }
                app.previewThreadNotes.clear()
                app.previewThreadNotes.putAll(notes)
                val opened = inbox.firstOrNull { it.id == "preview-1" }.takeIf { mode == PreviewMode.NotesDetail }
                app.applyDebugPreview(
                    mailboxes = listOf(mailbox),
                    selectedMailboxId = mailbox.id,
                    folders = folders,
                    emails = inbox,
                    selectedTab = HomeTab.Folder(FolderIds.INBOX),
                    selectedEmail = opened,
                    threadEmails = if (opened != null) thread else emptyList(),
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
            PreviewMode.ManyNew -> {
                // A dozen New conversations: Inbox shows three, then "Show N more new", then Seen.
                val inbox = allEmails.filter { it.folderId == FolderIds.INBOX } +
                    manyNewEmails(you) + fillerSeenEmails(you)
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
        if (mode == PreviewMode.Toast) {
            // Pinned sample toast with an action (AVE-134): icon + message + Undo.
            app.showToast("Archived", isUndo = true, durationMs = 0)
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

    /** Unread inbox rows for the capped-New preview (AVE-23). */
    private fun manyNewEmails(you: String): List<Email> {
        val senders = listOf(
            "Priya Shah", "Marco Rossi", "Lena Fischer", "Tom Becker", "Ava Chen",
            "Noah Kim", "Sara Lind", "Omar Haddad", "Ivy Park", "Ben Ortiz",
        )
        return senders.mapIndexed { i, name ->
            Email(
                id = "preview-new-$i",
                folderId = FolderIds.INBOX,
                subject = "Follow-up ${i + 1}",
                sender = "${name.substringBefore(' ').lowercase()}@example.com",
                senderName = name,
                recipient = you,
                date = "2026-09-%02dT09:00:00.000Z".format(2 + i),
                read = false,
                starred = false,
                snippet = "Checking in on the thread from last week.",
                listSection = "new",
            )
        }
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

    // Notes to self (AVE-62) — same fixtures as iOS `PreviewSupport.noteFixtures`.

    const val NOTES_THREAD_KEY = "thread-preview-q3"

    fun noteThread(you: String = addr("you")): List<Email> = listOf(
        Email(
            id = "preview-1a",
            threadId = NOTES_THREAD_KEY,
            folderId = FolderIds.INBOX,
            subject = "Quarterly planning notes",
            sender = "jordan@example.com",
            senderName = "Jordan Hale",
            recipient = you,
            date = "2026-09-01T09:05:00.000Z",
            read = true,
            body = "<p>Hi team — here is the proposal for the Q3 review. Section 3 covers the SLA " +
                "requirements and the pricing tiers we discussed.</p><p>Let me know what you think.</p>",
            snippet = "Hi team — here is the proposal for the Q3 review.",
        ),
        Email(
            id = "preview-1b",
            threadId = NOTES_THREAD_KEY,
            folderId = FolderIds.INBOX,
            subject = "Re: Quarterly planning notes",
            sender = you,
            senderName = "Alex Rivera",
            recipient = "jordan@example.com",
            date = "2026-09-02T16:40:00.000Z",
            read = true,
            body = "<p>Looks solid. Legal is reviewing section 3 now; I'll confirm pricing by Friday.</p>",
            snippet = "Looks solid. Legal is reviewing section 3 now.",
        ),
        Email(
            id = "preview-1",
            threadId = NOTES_THREAD_KEY,
            folderId = FolderIds.INBOX,
            subject = "Re: Quarterly planning notes",
            sender = "jordan@example.com",
            senderName = "Jordan Hale",
            recipient = you,
            date = "2026-09-03T14:30:00.000Z",
            read = false,
            body = "<p>Thanks! Can we move Thursday's sync to the morning instead? I have a conflict at 3pm.</p>" +
                "<p>— Jordan</p>",
            snippet = "Can we move Thursday's sync to the morning instead?",
            threadCount = 3,
            listSection = "new",
        ),
    )

    /** Sticky + inline notes for the Q3 thread, and a sticky / note count on two other rows. */
    fun noteFixtures(): Map<String, List<ThreadNote>> {
        fun note(
            id: String,
            thread: String,
            type: String,
            body: String,
            created: String,
            emailId: String? = null,
            updated: String = created,
        ) = ThreadNote(
            id = id,
            threadId = thread,
            emailId = emailId,
            noteType = type,
            body = body,
            createdAt = created,
            updatedAt = updated,
        )
        return mapOf(
            NOTES_THREAD_KEY to listOf(
                note(
                    "note-sticky-q3", NOTES_THREAD_KEY, ThreadNote.STICKY,
                    "**Call Jordan before Thursday** re: pricing — keep it under \$15k.\n\n" +
                        "- [x] Loop in Sam\n- [ ] Send the revised deck",
                    "2026-09-03T15:02:00.000Z",
                ),
                note(
                    "note-inline-q3-1", NOTES_THREAD_KEY, ThreadNote.INLINE,
                    "Discussed section 3 on SLA requirements; _approved by legal_.",
                    "2026-09-01T10:25:00.000Z",
                    emailId = "preview-1a",
                ),
                note(
                    "note-inline-q3-2", NOTES_THREAD_KEY, ThreadNote.INLINE,
                    "Follow up if Jordan hasn't confirmed by **Friday**. " +
                        "See [the pricing sheet](https://example.com/pricing).",
                    "2026-09-02T17:00:00.000Z",
                    emailId = "preview-1b",
                    updated = "2026-09-02T18:10:00.000Z",
                ),
            ),
            "preview-2" to listOf(
                note(
                    "note-sticky-invoice", "preview-2", ThreadNote.STICKY,
                    "Paid by wire on Sep 4 — ref `INV-2291`",
                    "2026-09-04T09:00:00.000Z",
                ),
            ),
            "preview-3" to listOf(
                note(
                    "note-inline-design-1", "preview-3", ThreadNote.INLINE,
                    "Bring the mobile frames.", "2026-08-28T19:00:00.000Z", emailId = "preview-3",
                ),
                note(
                    "note-inline-design-2", "preview-3", ThreadNote.INLINE,
                    "Ask about the icon set.", "2026-08-28T19:05:00.000Z", emailId = "preview-3",
                ),
            ),
        )
    }

    /**
     * AVE-133: a promo mail whose HTML carries a `<style>` block, a hidden `&shy;`/`&zwnj;`
     * preheader and layout tables, so the reply's quoted original shows the cleaned text.
     * iOS twin: `PreviewSupport.promoEmail` (`-previewMailbox -previewReplyQuote`).
     */
    fun promoEmail(you: String = addr("you")): Email = Email(
        id = "preview-promo",
        folderId = FolderIds.INBOX,
        subject = "Don’t let the details haunt you",
        sender = "uber@uber.example",
        senderName = "Uber",
        recipient = you,
        date = "2026-10-27T16:46:00.000Z",
        read = true,
        starred = false,
        body = PROMO_HTML,
        snippet = "Grab everything for spooky season in one easy order.",
    )

    private val PROMO_HTML = """
        <html><head><style type="text/css">body{margin:0;padding:0} .mso td{padding:0}</style></head><body>
        <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">Grab everything for spooky season in one easy order.&#847; &zwnj; &nbsp; &shy; &#847; &zwnj; &nbsp; &shy; &#847; &zwnj; &nbsp; &shy;</div>
        <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000">
          <tr><td align="center" style="padding:24px;color:#ffffff;font-size:28px;">Uber</td></tr>
          <tr><td style="padding:24px;color:#ffffff;">
            <h1 style="font-size:36px;">Don&rsquo;t let the details haunt you. Save 30%.</h1>
            <p>Whatever&#39;s on your Halloween list, you&#39;ll find it on Uber&nbsp;Eats. Spend ${'$'}40+ and save up to ${'$'}20. Terms&nbsp;apply.</p>
            <a href="https://example.com/shop" style="background:#ffffff;color:#000000;padding:12px 20px;">Shop now</a>
          </td></tr>
          <tr><td style="padding:24px;color:#ffffff;"><h2>All treats, no tricks</h2><p>${'$'}0 Delivery Fee</p></td></tr>
          <tr><td style="color:#ffffff;">${'$'}17.09</td><td style="color:#999999;"><s>${'$'}24.39</s></td><td style="color:#00c853;">30% off</td></tr>
          <tr><td colspan="3" style="color:#ffffff;">REESE&#39;S Assorted Peanut Butter Halloween&hellip;</td></tr>
        </table>
        <img src="https://example.com/open.gif" width="1" height="1" style="display:none">
        </body></html>
    """.trimIndent()

    /**
     * AVE-89: a long marketing mail with a fixed 640px card, a long unbroken URL and a rigid
     * 900px table, for the fit-to-width / sideways-scroll body. iOS twin:
     * `PreviewSupport.newsletterEmail` (`-previewDetail -previewNewsletter`).
     */
    fun newsletterEmail(you: String = addr("you")): Email = Email(
        id = "preview-newsletter",
        folderId = FolderIds.INBOX,
        subject = "The Weekly Ledger: Q3 in numbers",
        sender = "news@ledger.example",
        senderName = "The Weekly Ledger",
        recipient = you,
        date = "2026-09-04T07:00:00.000Z",
        read = true,
        starred = false,
        body = NEWSLETTER_HTML,
        snippet = "Good morning. This issue is built like most marketing mail.",
    )

    private val NEWSLETTER_HTML = """
        <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f1ea">
        <tr><td align="center" style="padding:16px 0;">
        <table width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:640px;">
        <tr><td style="padding:28px 32px;background-color:#1b3a5c;color:#ffffff;font-family:Georgia,serif;font-size:30px;">The Weekly Ledger</td></tr>
        <tr><td style="padding:0;"><div style="width:640px;height:180px;background-color:#d9c7a3;color:#1b3a5c;font-family:Georgia,serif;font-size:22px;line-height:180px;text-align:center;">640px hero banner</div></td></tr>
        <tr><td style="padding:24px 32px;color:#333333;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;">
        <p style="margin:0 0 16px;">Good morning. This issue is built like most marketing mail: a fixed 640px card inside a full-width background, so it is wider than a phone.</p>
        <p style="margin:0 0 16px;">Read the full report: https://example.com/reports/2026/q3/the-weekly-ledger/extremely-long-unbroken-link-that-keeps-going-and-going-and-going</p>
        <p style="margin:0 0 16px;">Markets were calm this week. Freight rates eased, the dollar held steady, and early holiday orders came in ahead of plan across most regions we track.</p>
        <p style="margin:0 0 16px;">Inventory is the story to watch. Retailers who over-ordered last year kept shelves lean, and suppliers have adjusted lead times to match a slower, steadier cadence.</p>
        <p style="margin:0 0 16px;">In payments, instant transfers keep gaining share. Small businesses cite faster access to cash as the main reason, ahead of lower fees and simpler reconciliation.</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
        <table width="900" cellpadding="8" cellspacing="0" border="1" style="width:900px;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#333333;">
        <tr bgcolor="#eef2f7"><td style="white-space:nowrap;">Region</td><td style="white-space:nowrap;">Orders (week)</td><td style="white-space:nowrap;">Change vs last year</td><td style="white-space:nowrap;">Average basket</td><td style="white-space:nowrap;">Fulfilment time</td><td style="white-space:nowrap;">Returns rate</td></tr>
        <tr><td style="white-space:nowrap;">North America</td><td style="white-space:nowrap;">1,204,331</td><td style="white-space:nowrap;">+6.2%</td><td style="white-space:nowrap;">$84.10</td><td style="white-space:nowrap;">2.1 days</td><td style="white-space:nowrap;">8.4%</td></tr>
        <tr><td style="white-space:nowrap;">Europe</td><td style="white-space:nowrap;">982,145</td><td style="white-space:nowrap;">+3.9%</td><td style="white-space:nowrap;">&euro;71.35</td><td style="white-space:nowrap;">2.6 days</td><td style="white-space:nowrap;">11.2%</td></tr>
        <tr><td style="white-space:nowrap;">Asia Pacific</td><td style="white-space:nowrap;">1,530,702</td><td style="white-space:nowrap;">+9.8%</td><td style="white-space:nowrap;">$62.80</td><td style="white-space:nowrap;">1.8 days</td><td style="white-space:nowrap;">6.1%</td></tr>
        </table>
        </td></tr>
        <tr><td style="padding:0 32px 24px;color:#333333;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;">
        <p style="margin:0 0 16px;">That table is a rigid 900px grid that cannot shrink, so it scrolls sideways on a phone.</p>
        <p style="margin:0 0 16px;">Section two. Logistics networks are rebalancing toward regional hubs. Shorter routes cut emissions and make delivery promises easier to keep during peak weeks.</p>
        <p style="margin:0 0 16px;">Section three. Hiring has cooled in warehousing but remains strong for drivers and technicians, with wage growth slowing to its lowest pace in three years.</p>
        <p style="margin:0 0 16px;">Section four. Energy costs for cold storage dropped again. Operators are reinvesting the savings in automation and better forecasting tools.</p>
        <p style="margin:0 0 16px;">Section five. Cross-border e-commerce keeps growing, helped by clearer customs rules and faster duty calculation at checkout.</p>
        <p style="margin:0 0 16px;">Section six. Consumer sentiment improved slightly, though shoppers remain price-sensitive and quick to switch brands for a better deal.</p>
        <p style="margin:0 0 16px;">Section seven. Subscription services are bundling more aggressively, trading margin for retention as churn edges up across categories.</p>
        <p style="margin:0 0 16px;">Section eight. Fraud attempts rose around big sale events. Merchants using device signals and velocity checks saw the smallest losses.</p>
        <p style="margin:0;">End of issue. If you can read this line, the whole message scrolled into view.</p>
        </td></tr>
        <tr><td style="padding:20px 32px;background-color:#1b3a5c;color:#c9d6e6;font-family:Helvetica,Arial,sans-serif;font-size:12px;">You are receiving this because you subscribed to The Weekly Ledger. Unsubscribe</td></tr>
        </table>
        </td></tr>
        </table>
    """.trimIndent()

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
            // Remote image shows that https images load by default in DEBUG previews.
            body = "<p>Can we move Thursday's sync to the morning instead?</p>" +
                "<img src=\"https://www.cloudflare.com/favicon.ico\" width=\"48\" height=\"48\" alt=\"Cloudflare logo\">",
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
            // AVE-99: RFC 8058 bulk mail, so Report Spam offers "Unsubscribe".
            oneClickUnsubscribe = true,
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
            // Designed mail (own colours): a light paper card in dark mode.
            // Remote image: Spam keeps it blocked behind "Load images" (AVE-132).
            body = """<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#fff4e5"><tr><td style="padding: 16px; color: #7a3e00"><img src="https://www.cloudflare.com/favicon.ico" width="48" height="48" alt="Gift card"><p><b>Claim your reward</b> before it expires.</p></td></tr></table>""",
            snippet = "Claim your reward before it expires.",
            folderName = "Spam",
            // AVE-94: reason line + "Unverified sender" banner in the reader.
            authTier = "unverified",
            classificationReason = "ai-spam",
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

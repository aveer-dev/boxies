import Foundation
import Observation
import SwiftUI

/// App-owned compose session so minimize docks instead of destroying the draft.
@Observable
@MainActor
final class ComposeSession {
    var presentation: ComposePresentation
    let form: ComposeFormModel

    init(form: ComposeFormModel, presentation: ComposePresentation = .expanded) {
        self.form = form
        self.presentation = presentation
    }

    var dockTitle: String { form.displayTitle }
    var isExpanded: Bool { presentation == ComposePresentation.expanded }
    var isMinimized: Bool { presentation == ComposePresentation.minimized }

    func expand() { presentation = ComposePresentation.expanded }
    func minimize() { presentation = ComposePresentation.minimized }
}

enum DraftSaveStatus: Equatable {
    case idle
    case saving
    case saved(Date)
    case failed(String)
}

struct ComposeToast: Equatable {
    let message: String
    var isError: Bool = false
    let id = UUID()
}

@Observable
@MainActor
final class ComposeFormModel {
    let mode: ComposeMode
    /// `Idempotency-Key` for this compose: sent on every attempt (undo-window commit,
    /// retry after a failed send) so a send that did reach the server isn't repeated.
    /// A new compose gets a new key; a restored pending send keeps its record's key.
    private(set) var sendIdempotencyKey = UUID().uuidString.lowercased()
    var fromMailboxId: String
    var fromEmail: String
    var fromName: String?

    var toTokens: [MailAddress] = [] {
        didSet {
            if toTokens != oldValue { scheduleAutoSave() }
        }
    }
    var ccTokens: [MailAddress] = [] {
        didSet {
            if ccTokens != oldValue { scheduleAutoSave() }
        }
    }
    var bccTokens: [MailAddress] = [] {
        didSet {
            if bccTokens != oldValue { scheduleAutoSave() }
        }
    }
    var toDraft = ""
    var ccDraft = ""
    var bccDraft = ""
    var showCcBcc = false
    var subject = "" {
        didSet {
            if subject != oldValue { scheduleAutoSave() }
        }
    }
    var body = "" {
        didSet {
            if body != oldValue { scheduleAutoSave() }
        }
    }
    var attachments: [ComposePendingAttachment] = [] {
        didSet {
            if attachments != oldValue { scheduleAutoSave() }
        }
    }
    let quotedOriginal: QuotedOriginal?

    var originalEmailId: String?
    var threadId: String?
    var draftId: String?
    /// Set when this form was rebuilt from a pending-send record left by a killed launch.
    var restoredPendingSendId: UUID?

    var isSending = false
    var isSavingDraft = false
    var saveStatus: DraftSaveStatus = .idle
    var toast: ComposeToast?
    var errorMessage: String?
    /// Recipients the last send was refused for (409 `recipient_suppressed`).
    /// The sheet shows the ones still addressed; see `visibleSuppressedRecipients`.
    var suppressedRecipients: [SuppressedRecipient] = []
    /// The server's sentence for that refusal, for the failure toast (the notice
    /// replaces the inline error, so it doesn't go in `errorMessage`).
    var suppressionMessage: String?
    var isUnsuppressing = false

    private let signature: String
    private let initialSnapshot: String
    private var lastSavedSnapshot: String
    /// Debounce only. Keystrokes cancel this, never the request in `inFlightSave`.
    private var autoSaveTask: Task<Void, Never>?
    /// The POST on the wire. Unstructured so a cancelled caller can't abort it: a
    /// cancelled request can still land server-side, and losing its response loses
    /// the new draft id (the next save would then create a duplicate).
    private var inFlightSave: Task<Bool, Never>?
    private var toastDismissTask: Task<Void, Never>?
    private var consecutiveFailures = 0
    private let continuousFailureThreshold = 3

    var onDraftSaved: ((_ draftId: String, _ threadId: String?, _ originalEmailId: String?, _ subject: String?, _ body: String?, _ recipient: String) -> Void)?
    var onDraftDeleted: ((_ draftId: String, _ threadId: String?, _ originalEmailId: String?) -> Void)?

    private let originalEmail: Email?
    private let selfAddresses: Set<String>

    /// Reply in a conversation that came in on a private email. The server sends
    /// it from that alias with no display name, so From is fixed here too.
    let isPrivateReply: Bool
    /// The alias address, when the payload carried it.
    let privateEmail: String?

    var isFromLocked: Bool { isPrivateReply }

    var fromDisplayName: String {
        if isPrivateReply { return privateEmail ?? "Private email" }
        if let fromName, !fromName.isEmpty { return fromName }
        return fromEmail
    }

    init(
        mode: ComposeMode,
        mailbox: Mailbox,
        original: Email? = nil,
        draft: Email? = nil,
        initialTo: [MailAddress] = []
    ) {
        self.mode = mode
        let mailboxId = mailbox.id
        let mailboxEmail = mailbox.email
        let mailboxFromName = mailbox.settings?.fromName ?? (mailbox.name != mailbox.email ? mailbox.name : nil)

        // Keyed on aliasId only; the alias address shares the mailbox domain.
        let replySource = (mode == .reply || mode == .replyAll) ? original : nil
        let aliasCarriers = [draft, replySource].compactMap { $0 }.filter { $0.aliasId != nil }
        let privateEmail = aliasCarriers.lazy
            .compactMap { $0.aliasEmail?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .first { !$0.isEmpty }
        let isPrivateReply = !aliasCarriers.isEmpty
        let resolvedFrom = privateEmail ?? mailboxEmail
        var selves = ComposeHTML.selfAddresses(mailbox: mailbox)
        if let privateEmail { selves.insert(privateEmail) }

        self.isPrivateReply = isPrivateReply
        self.privateEmail = privateEmail
        self.fromMailboxId = mailboxId
        self.fromEmail = resolvedFrom
        // A name or signature next to the alias would tie it back to the owner.
        self.fromName = isPrivateReply ? nil : mailboxFromName
        self.originalEmail = original
        self.selfAddresses = selves

        let signature = isPrivateReply
            ? ""
            : ComposeHTML.signatureText(settings: mailbox.settings, fromName: mailboxFromName)
        self.signature = signature

        var nextTo: [MailAddress] = []
        var nextCc: [MailAddress] = []
        var nextBcc: [MailAddress] = []
        var nextShowCcBcc = false
        var nextSubject = ""
        var nextBody = ""
        var nextQuoted: QuotedOriginal?
        var nextOriginalId: String?
        var nextThreadId: String?
        var nextDraftId: String?

        if mode == .reply || mode == .replyAll || mode == .forward, let original {
            nextQuoted = ComposeHTML.quotedOriginal(from: original, isForward: mode == .forward)
        }

        if let draft {
            nextDraftId = draft.id
            nextOriginalId = draft.inReplyTo
            nextThreadId = draft.threadId
            nextTo = MailAddress.parseList(draft.recipient)
            nextCc = MailAddress.parseList(draft.cc)
            nextBcc = MailAddress.parseList(draft.bcc)
            nextShowCcBcc = !nextCc.isEmpty || !nextBcc.isEmpty
            nextSubject = draft.subject
            nextBody = ComposeHTML.editableReply(
                fromDraftHTML: draft.body ?? "",
                quotedHeader: nextQuoted?.header
            )
            if let original {
                nextTo = ComposeHTML.correctedReplyTo(
                    draftTo: nextTo,
                    original: original,
                    selfAddresses: selves
                )
            }
        } else if let original {
            nextOriginalId = original.id
            nextThreadId = original.threadId ?? original.id
            switch mode {
            case .reply:
                nextTo = ComposeHTML.replyFields(original: original, selfAddresses: selves)
                nextSubject = ComposeHTML.prefixedSubject(original.subject, prefix: "Re")
                nextBody = ComposeHTML.replyBody(signature: signature)
            case .replyAll:
                let fields = ComposeHTML.replyAllFields(original: original, selfAddresses: selves)
                nextTo = fields.to
                nextCc = fields.cc
                nextShowCcBcc = !fields.cc.isEmpty
                nextSubject = ComposeHTML.prefixedSubject(original.subject, prefix: "Re")
                nextBody = ComposeHTML.replyBody(signature: signature)
            case .forward:
                nextSubject = ComposeHTML.prefixedSubject(original.subject, prefix: "Fwd")
                // The forwarded message is shown under the editor and appended on send.
                nextBody = ComposeHTML.bodyWithSignature(signature)
            case .new, .editDraft:
                if mode == .new && !initialTo.isEmpty {
                    nextTo = initialTo
                }
                nextBody = ComposeHTML.bodyWithSignature(signature)
            }
        } else {
            if !initialTo.isEmpty {
                nextTo = initialTo
            }
            nextBody = ComposeHTML.bodyWithSignature(signature)
        }

        self.toTokens = nextTo
        self.ccTokens = nextCc
        self.bccTokens = nextBcc
        self.showCcBcc = nextShowCcBcc
        self.subject = nextSubject
        self.body = nextBody
        self.quotedOriginal = nextQuoted
        self.originalEmailId = nextOriginalId
        self.threadId = nextThreadId
        self.draftId = nextDraftId
        // Same From as `currentSnapshot`, so an untouched alias reply isn't dirty.
        let initial = Self.snapshot(
            to: nextTo, cc: nextCc, bcc: nextBcc,
            subject: nextSubject, body: nextBody, from: resolvedFrom
        )
        self.initialSnapshot = initial
        self.lastSavedSnapshot = initial
    }

    var title: String {
        switch mode {
        case .new: return "New Message"
        case .reply: return "Reply"
        case .replyAll: return "Reply All"
        case .forward: return "Forward"
        case .editDraft: return "Edit Draft"
        }
    }

    /// Nav / dock title: subject when set, otherwise mode title.
    var displayTitle: String {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return trimmed }
        return title
    }

    var isEmpty: Bool {
        toTokens.isEmpty && ccTokens.isEmpty && bccTokens.isEmpty
            && toDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && attachments.isEmpty
            && !ComposeHTML.bodyHasUserContent(body, signature: signature)
    }

    var currentSnapshot: String {
        Self.snapshot(
            to: toTokens, cc: ccTokens, bcc: bccTokens,
            subject: subject, body: body, from: fromEmail
        )
    }

    var hasUnsavedChanges: Bool {
        let hasPendingRecipients = !toDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !ccDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !bccDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return currentSnapshot != lastSavedSnapshot || hasPendingRecipients
    }

    var isDirty: Bool {
        return currentSnapshot != initialSnapshot || (draftId != nil && !isEmpty)
    }

    func scheduleAutoSave(debounceSeconds: Double = 3.0) {
        guard !isSending else { return }
        autoSaveTask?.cancel()
        autoSaveTask = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(debounceSeconds))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            guard !isEmpty && hasUnsavedChanges else { return }
            _ = await performSaveDraft(explicit: false)
        }
    }

    func cancelAutoSave() {
        autoSaveTask?.cancel()
        autoSaveTask = nil
    }

    func showToast(_ message: String, isError: Bool = false) {
        toastDismissTask?.cancel()
        withAnimation(ToastMetrics.animation) {
            toast = ComposeToast(message: message, isError: isError)
        }
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            withAnimation(ToastMetrics.animation) {
                toast = nil
            }
        }
    }

    func hideToast() {
        toastDismissTask?.cancel()
        withAnimation(ToastMetrics.animation) { toast = nil }
    }

    func commitPendingTokens() {
        commit(&toDraft, into: &toTokens)
        commit(&ccDraft, into: &ccTokens)
        commit(&bccDraft, into: &bccTokens)
    }

    func removeTo(_ token: MailAddress) { toTokens.removeAll { $0.id == token.id } }
    func removeCc(_ token: MailAddress) { ccTokens.removeAll { $0.id == token.id } }
    func removeBcc(_ token: MailAddress) { bccTokens.removeAll { $0.id == token.id } }

    func addSuggestion(_ address: MailAddress, to field: RecipientField) {
        switch field {
        case .to:
            if !toTokens.contains(where: { $0.id == address.id }) {
                toTokens.append(address)
            }
            toDraft = ""
        case .cc:
            if !ccTokens.contains(where: { $0.id == address.id }) {
                ccTokens.append(address)
            }
            ccDraft = ""
        case .bcc:
            if !bccTokens.contains(where: { $0.id == address.id }) {
                bccTokens.append(address)
            }
            bccDraft = ""
        }
    }

    enum RecipientField {
        case to, cc, bcc
    }

    func selectFrom(mailbox: Mailbox) {
        guard !isFromLocked else { return }
        fromMailboxId = mailbox.id
        fromEmail = mailbox.email
        fromName = mailbox.settings?.fromName ?? (mailbox.name != mailbox.email ? mailbox.name : nil)
    }

    @discardableResult
    func saveDraft(explicit: Bool = true) async -> Bool {
        cancelAutoSave()
        return await performSaveDraft(explicit: explicit)
    }

    @discardableResult
    private func performSaveDraft(explicit: Bool) async -> Bool {
        commitPendingTokens()

        // Queue behind a save already on the wire; it clears `inFlightSave` when done.
        while let pending = inFlightSave {
            _ = await pending.value
        }

        guard !isEmpty else {
            return true
        }
        guard hasUnsavedChanges || draftId == nil else {
            if explicit {
                showToast("Draft saved")
            }
            return true
        }

        let save = Task { @MainActor in
            let saved = await self.writeDraft(explicit: explicit)
            self.inFlightSave = nil
            return saved
        }
        inFlightSave = save
        return await save.value
    }

    private func writeDraft(explicit: Bool) async -> Bool {
        // Taken before the request: edits made while it's in flight stay unsaved.
        let snapshot = currentSnapshot

        // Preview support: simulate successful draft save in Xcode Previews / canvas mock fixtures
        if ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" || fromMailboxId.hasPrefix("mb-") {
            try? await Task.sleep(for: .milliseconds(300))
            if draftId == nil { draftId = UUID().uuidString }
            lastSavedSnapshot = snapshot
            saveStatus = .saved(Date())
            consecutiveFailures = 0
            if explicit {
                showToast("Draft saved")
            }
            if let draftId {
                onDraftSaved?(draftId, threadId, originalEmailId, subject, outgoingHTML(), recipientListValue())
            }
            return true
        }

        isSavingDraft = true
        saveStatus = .saving
        errorMessage = nil
        defer { isSavingDraft = false }
        do {
            var payload: [String: Any] = [
                "body": outgoingHTML(),
            ]
            if !toTokens.isEmpty { payload["to"] = replySendRecipients().map(\.email).joined(separator: ", ") }
            if !ccTokens.isEmpty { payload["cc"] = ccTokens.map(\.email).joined(separator: ", ") }
            if !bccTokens.isEmpty { payload["bcc"] = bccTokens.map(\.email).joined(separator: ", ") }
            if !subject.isEmpty { payload["subject"] = subject }
            if let originalEmailId { payload["in_reply_to"] = originalEmailId }
            if let threadId { payload["thread_id"] = threadId }
            if let draftId { payload["draft_id"] = draftId }

            let saved = try await APIClient.shared.saveDraft(mailboxId: fromMailboxId, draft: payload)
            let resolved = saved.resolvedId.isEmpty ? (draftId ?? saved.id) : saved.resolvedId
            if isSending {
                if let resolved, !resolved.isEmpty {
                    try? await APIClient.shared.deleteEmail(mailboxId: fromMailboxId, id: resolved)
                    onDraftDeleted?(resolved, threadId, originalEmailId)
                }
                return false
            }
            draftId = resolved
            lastSavedSnapshot = snapshot
            saveStatus = .saved(Date())
            consecutiveFailures = 0
            if explicit {
                showToast("Draft saved")
            }
            if let draftId {
                onDraftSaved?(draftId, threadId, originalEmailId, subject, outgoingHTML(), recipientListValue())
            }
            return true
        } catch {
            // Draft saves stay out of `errorMessage` (the inline send/validation slot):
            // a background hiccup shouldn't put red text under the body while typing.
            print("[ComposeFormModel] saveDraft error: \(error)")
            saveStatus = .failed(error.localizedDescription)
            consecutiveFailures += 1
            if explicit || consecutiveFailures == continuousFailureThreshold {
                showToast("Couldn’t save draft", isError: true)
            }
            // Retry on its own so a failure isn't stranded until the next edit.
            // 5s, 10s, 20s, … capped at 60s; a keystroke resets to the normal debounce.
            let backoff = min(5.0 * pow(2.0, Double(consecutiveFailures - 1)), 60.0)
            scheduleAutoSave(debounceSeconds: backoff)
            return false
        }
    }

    /// `sessionToken` pins the send to the session it was written in; it is only sent as an
    /// override once the shared token has changed (sign-out during the undo window).
    @discardableResult
    func performActualSend(sessionToken: String? = nil) async -> Bool {
        let pinnedToken: String? = {
            guard let sessionToken, sessionToken != APIClient.shared.authToken else { return nil }
            return sessionToken
        }()
        cancelAutoSave()
        commitPendingTokens()
        guard !toTokens.isEmpty else {
            errorMessage = "Add at least one recipient."
            return false
        }
        let sendRecipients = replySendRecipients()
        guard !sendRecipients.isEmpty else {
            errorMessage = "Add at least one recipient."
            return false
        }
        var waited = 0
        while isSavingDraft && waited < 100 {
            try? await Task.sleep(for: .milliseconds(50))
            waited += 1
        }
        isSending = true
        errorMessage = nil
        suppressedRecipients = []
        suppressionMessage = nil
        defer { isSending = false }

        let html = outgoingHTML()
        let text = outgoingPlainText()
        var payload: [String: Any] = [
            "subject": subject,
            "html": html,
            "text": text,
        ]
        if mode == .reply || mode == .replyAll || mode == .forward {
            // The Worker appends the original as a sanitised, formatted quote (AVE-133),
            // also for a reopened draft whose original didn't load here.
            payload["quote_original"] = true
            payload["quote_time_zone"] = TimeZone.current.identifier
        }
        let toEmails = sendRecipients.map(\.email)
        payload["to"] = toEmails.count == 1 ? toEmails[0] as Any : toEmails as Any
        if !ccTokens.isEmpty {
            let ccEmails = ccTokens.map(\.email)
            payload["cc"] = ccEmails.count == 1 ? ccEmails[0] as Any : ccEmails as Any
        }
        if !bccTokens.isEmpty {
            let bccEmails = bccTokens.map(\.email)
            payload["bcc"] = bccEmails.count == 1 ? bccEmails[0] as Any : bccEmails as Any
        }
        if let fromName, !fromName.isEmpty {
            payload["from"] = ["email": fromEmail, "name": fromName]
        } else {
            payload["from"] = fromEmail
        }
        if !attachments.isEmpty {
            payload["attachments"] = attachments.map(\.sendPayload)
        }

        let estimated = OutboundLimits.estimateMessageBytes(
            html: html + quotedBodySize,
            text: text,
            attachmentBytes: attachments.map(\.size)
        )
        if estimated > OutboundLimits.maxMessageBytes {
            errorMessage = OutboundLimits.sizeError
            return false
        }

        do {
            switch mode {
            case .reply, .replyAll:
                guard let originalEmailId else {
                    errorMessage = "Missing original email for reply."
                    return false
                }
                _ = try await APIClient.shared.replyToEmail(
                    mailboxId: fromMailboxId,
                    emailId: originalEmailId,
                    payload: payload,
                    bearerToken: pinnedToken,
                    idempotencyKey: sendIdempotencyKey
                )
            case .forward:
                guard let originalEmailId else {
                    errorMessage = "Missing original email for forward."
                    return false
                }
                _ = try await APIClient.shared.forwardEmail(
                    mailboxId: fromMailboxId,
                    emailId: originalEmailId,
                    payload: payload,
                    bearerToken: pinnedToken,
                    idempotencyKey: sendIdempotencyKey
                )
            case .new, .editDraft:
                _ = try await APIClient.shared.sendEmail(
                    mailboxId: fromMailboxId,
                    payload: payload,
                    bearerToken: pinnedToken,
                    idempotencyKey: sendIdempotencyKey
                )
            }

            if let draftId {
                try? await APIClient.shared.deleteEmail(mailboxId: fromMailboxId, id: draftId, bearerToken: pinnedToken)
                onDraftDeleted?(draftId, threadId, originalEmailId)
            }
            return true
        } catch APIError.recipientSuppressed(let message, let suppressed) {
            suppressedRecipients = suppressed
            suppressionMessage = message.isEmpty ? nil : message
            return false
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    /// Suppressed recipients still in To / Cc / Bcc. Removing one clears its notice.
    var visibleSuppressedRecipients: [SuppressedRecipient] {
        BounceSuppression.stillAddressed(
            suppressedRecipients,
            recipients: (toTokens + ccTokens + bccTokens).map(\.email)
        )
    }

    /// Lifts every shown suppression so the caller can send again with the same
    /// `Idempotency-Key`. One already lifted (404) is skipped. False, with
    /// `errorMessage` set, when a lift fails or one can't be lifted from here.
    func unsuppressVisibleRecipients() async -> Bool {
        let targets = visibleSuppressedRecipients
        guard !targets.isEmpty, !isUnsuppressing, !isSending,
              targets.allSatisfy(\.canUnsuppress) else { return false }
        isUnsuppressing = true
        errorMessage = nil
        defer { isUnsuppressing = false }
        for target in targets {
            do {
                try await APIClient.shared.unsuppress(mailboxId: fromMailboxId, address: target.address)
            } catch APIError.http(404, _) {
                // Already lifted (by someone else, or an earlier attempt): carry on.
                continue
            } catch {
                errorMessage = error.localizedDescription
                return false
            }
        }
        let lifted = Set(targets.map(\.address))
        suppressedRecipients.removeAll { lifted.contains($0.address) }
        suppressionMessage = nil
        return true
    }

    /// Snapshot persisted while this message sits in the undo-send window.
    func pendingSendRecord(accountKey: String) -> PendingSendRecord {
        func addresses(_ tokens: [MailAddress]) -> [PendingSendRecord.Address] {
            tokens.map { PendingSendRecord.Address(name: $0.name, email: $0.email) }
        }
        return PendingSendRecord(
            id: UUID(),
            accountKey: accountKey,
            mailboxId: fromMailboxId,
            mode: mode.rawValue,
            to: addresses(toTokens),
            cc: addresses(ccTokens),
            bcc: addresses(bccTokens),
            subject: subject,
            body: body,
            originalEmailId: originalEmailId,
            threadId: threadId,
            draftId: draftId,
            attachments: attachments.map {
                PendingSendRecord.AttachmentRecord(
                    filename: $0.filename,
                    mimeType: $0.mimeType,
                    size: $0.size,
                    base64: $0.base64
                )
            },
            createdAt: Date(),
            idempotencyKey: sendIdempotencyKey
        )
    }

    /// Refills a fresh form from a persisted pending send (kill inside the undo window).
    /// The edits mark the form dirty, so the next draft save keeps it on the server.
    func restore(from record: PendingSendRecord) {
        func tokens(_ addresses: [PendingSendRecord.Address]) -> [MailAddress] {
            addresses.map { MailAddress(name: $0.name, email: $0.email) }
        }
        toTokens = tokens(record.to)
        ccTokens = tokens(record.cc)
        bccTokens = tokens(record.bcc)
        showCcBcc = !ccTokens.isEmpty || !bccTokens.isEmpty
        subject = record.subject
        body = record.body
        attachments = record.attachments.map {
            ComposePendingAttachment(filename: $0.filename, mimeType: $0.mimeType, size: $0.size, base64: $0.base64)
        }
        originalEmailId = record.originalEmailId ?? originalEmailId
        threadId = record.threadId ?? threadId
        draftId = record.draftId ?? draftId
        if let key = record.idempotencyKey, !key.isEmpty {
            sendIdempotencyKey = key
        }
    }

    private func recipientListValue() -> String {
        toTokens.map(\.email).joined(separator: ", ")
    }

    /// Reply to your own Sent mail must go to the original recipients, not back to you.
    private func replySendRecipients() -> [MailAddress] {
        guard mode == .reply || mode == .replyAll, let originalEmail else {
            return toTokens
        }
        return ComposeHTML.correctedReplyTo(
            draftTo: toTokens,
            original: originalEmail,
            selfAddresses: selfAddresses
        )
    }

    /// What the user wrote. The quoted original is not part of it (nor of the
    /// saved draft): the Worker appends it on send (`quote_original`, AVE-133).
    private func outgoingHTML() -> String {
        body.contains("<") ? body : ComposeHTML.textToHTML(body)
    }

    private func outgoingPlainText() -> String {
        ComposeHTML.stripHTML(body)
    }

    /// The quoted original still counts toward the 5 MiB limit.
    private var quotedBodySize: String {
        quotedOriginal?.bodyHTML ?? ""
    }

    var remainingAttachmentBudget: Int {
        OutboundLimits.remainingBudget(
            html: outgoingHTML() + quotedBodySize,
            text: outgoingPlainText(),
            attachmentBytes: attachments.map(\.size)
        )
    }

    var exceedsOutboundLimit: Bool {
        OutboundLimits.estimateMessageBytes(
            html: outgoingHTML() + quotedBodySize,
            text: outgoingPlainText(),
            attachmentBytes: attachments.map(\.size)
        ) > OutboundLimits.maxMessageBytes
    }

    func addPreparedAttachment(_ attachment: ComposePendingAttachment) {
        attachments.append(attachment)
    }

    func removeAttachment(_ id: UUID) {
        attachments.removeAll { $0.id == id }
    }

    private func commit(_ draft: inout String, into tokens: inout [MailAddress]) {
        let parts = MailAddress.parseList(draft)
        for part in parts where !tokens.contains(where: { $0.id == part.id }) {
            tokens.append(part)
        }
        draft = ""
    }

    private static func snapshot(
        to: [MailAddress], cc: [MailAddress], bcc: [MailAddress],
        subject: String, body: String, from: String
    ) -> String {
        [
            to.map(\.email).joined(separator: ","),
            cc.map(\.email).joined(separator: ","),
            bcc.map(\.email).joined(separator: ","),
            subject,
            body,
            from,
        ]
            .joined(separator: "|")
    }
}

/// The message a reply / forward quotes (AVE-133). Shown rendered, read-only,
/// under the editor; the Worker appends it to the sent mail.
struct QuotedOriginal: Equatable {
    /// Dock label: "On <date>, <sender> wrote:" or "Forwarded message from <sender>".
    var header: String
    /// Header lines shown above the message in the sheet.
    var detailLines: [String]
    var bodyHTML: String
    var emailId: String
    var folderId: String?
    var attachments: [Attachment]
    var isForward: Bool
}

enum ComposeHTML {
    static func splitAddresses(_ raw: String?) -> [String] {
        guard let raw, !raw.isEmpty else { return [] }
        return raw
            .split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func prefixedSubject(_ subject: String, prefix: String) -> String {
        let expected = "\(prefix): "
        return subject.hasPrefix(expected) ? subject : expected + subject
    }

    static func signatureLine(fromName: String?) -> String {
        guard let fromName, !fromName.isEmpty else { return "" }
        return fromName
    }

    /// Signature inserted into compose when mailbox signature is enabled.
    static func signatureText(settings: MailboxSettings?, fromName: String?) -> String {
        guard settings?.signature?.enabled ?? true else { return "" }
        if let html = settings?.signature?.html?.trimmingCharacters(in: .whitespacesAndNewlines),
           !html.isEmpty {
            return stripHTML(html)
        }
        if let text = settings?.signature?.text?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            return text
        }
        return "Sent with Inboxies Email"
    }

    /// Two empty paragraphs above the signature so the user has room to type.
    static func bodyWithSignature(_ signature: String) -> String {
        signature.isEmpty ? "" : "\n\n\(signature)"
    }

    /// True when compose text has user-authored content beyond the mailbox signature.
    static func bodyHasUserContent(_ body: String, signature: String) -> Bool {
        var text = stripHTML(body)
        if !signature.isEmpty, let range = text.range(of: signature) {
            text.removeSubrange(range)
        }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func stripHTML(_ html: String) -> String {
        html
            .replacingOccurrences(of: "<br>", with: "\n", options: .caseInsensitive)
            .replacingOccurrences(of: "<br/>", with: "\n", options: .caseInsensitive)
            .replacingOccurrences(of: "<br />", with: "\n", options: .caseInsensitive)
            .replacingOccurrences(of: "</p>", with: "\n\n", options: .caseInsensitive)
            .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func htmlToEditableText(_ html: String) -> String {
        stripHTML(html)
    }

    static func escapeHTML(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func textToHTML(_ text: String) -> String {
        let escaped = escapeHTML(text)
        let withBreaks = escaped.replacingOccurrences(of: "\n", with: "<br>")
        return "<p>\(withBreaks)</p>"
    }

    static func replyBody(signature: String) -> String {
        bodyWithSignature(signature)
    }

    static func quotedOriginal(from original: Email, isForward: Bool = false) -> QuotedOriginal? {
        let body = original.body ?? original.snippet ?? ""
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let date = formatDate(original.date)
        let header = isForward
            ? "Forwarded message from \(original.formattedFrom)"
            : "On \(date), \(original.formattedFrom) wrote:"
        let detailLines = isForward
            ? [
                "---------- Forwarded message ---------",
                "From: \(original.formattedFrom)",
                "Date: \(date)",
                "Subject: \(original.subject)",
                "To: \(original.recipient)",
            ]
            : [header]
        return QuotedOriginal(
            header: header,
            detailLines: detailLines,
            bodyHTML: body,
            emailId: original.id,
            folderId: original.folderId,
            attachments: original.attachments ?? [],
            isForward: isForward
        )
    }

    /// Pull the user's reply out of a saved draft, dropping the inlined original.
    static func editableReply(fromDraftHTML html: String, quotedHeader: String?) -> String {
        var text = htmlToEditableText(html)
        // Drafts saved before AVE-133 carry the forwarded message inline.
        if let range = text.range(of: "---------- Forwarded message") {
            text = String(text[..<range.lowerBound])
        }
        if let quotedHeader, let range = text.range(of: quotedHeader, options: .backwards) {
            text = String(text[..<range.lowerBound])
        } else if let regex = try? NSRegularExpression(
            pattern: #"^On .+ wrote:\s*$"#,
            options: .anchorsMatchLines
        ) {
            let nsRange = NSRange(text.startIndex..., in: text)
            if let match = regex.matches(in: text, range: nsRange).last,
               let range = Range(match.range, in: text) {
                text = String(text[..<range.lowerBound])
            }
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func selfAddresses(mailbox: Mailbox) -> Set<String> {
        Set([mailbox.email, mailbox.id]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty })
    }

    static func isSelfAddress(_ address: String, selfAddresses: Set<String>) -> Bool {
        selfAddresses.contains(address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    static func replyFields(original: Email, selfAddresses: Set<String>) -> [MailAddress] {
        if isSelfAddress(original.fromAddress.email, selfAddresses: selfAddresses) {
            var to: [MailAddress] = []
            var seen = Set<String>()
            for recipient in original.toAddresses {
                let email = recipient.email.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !email.isEmpty else { continue }
                let normalized = email.lowercased()
                guard !selfAddresses.contains(normalized), !seen.contains(normalized) else { continue }
                seen.insert(normalized)
                to.append(recipient)
            }
            return to.isEmpty ? [original.fromAddress] : to
        }
        return [original.fromAddress]
    }

    static func correctedReplyTo(
        draftTo: [MailAddress],
        original: Email,
        selfAddresses: Set<String>
    ) -> [MailAddress] {
        let onlySelf = !draftTo.isEmpty && draftTo.allSatisfy {
            isSelfAddress($0.email, selfAddresses: selfAddresses)
        }
        guard onlySelf, isSelfAddress(original.fromAddress.email, selfAddresses: selfAddresses) else {
            return draftTo
        }
        let corrected = replyFields(original: original, selfAddresses: selfAddresses)
        return corrected.isEmpty ? draftTo : corrected
    }

    static func replyAllFields(original: Email, selfAddresses: Set<String>) -> (to: [MailAddress], cc: [MailAddress]) {
        var to: [MailAddress] = []
        var toSeen = Set<String>()

        func appendUnique(_ address: MailAddress, into list: inout [MailAddress], seen: inout Set<String>) {
            let email = address.email.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !email.isEmpty else { return }
            let normalized = email.lowercased()
            guard !selfAddresses.contains(normalized), !seen.contains(normalized) else { return }
            seen.insert(normalized)
            list.append(address)
        }

        appendUnique(original.fromAddress, into: &to, seen: &toSeen)
        for recipient in original.toAddresses {
            appendUnique(recipient, into: &to, seen: &toSeen)
        }

        var cc: [MailAddress] = []
        var ccSeen = Set<String>()
        for recipient in original.ccAddresses {
            let normalized = recipient.email.lowercased()
            if selfAddresses.contains(normalized) || toSeen.contains(normalized) || ccSeen.contains(normalized) {
                continue
            }
            ccSeen.insert(normalized)
            cc.append(recipient)
        }
        return (to, cc)
    }

    private static func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        let out = DateFormatter()
        out.dateStyle = .medium
        out.timeStyle = .short
        return out.string(from: date)
    }
}

import SwiftUI

/// Medium sheet of email actions, opened from the detail ellipsis or list swipe More.
struct EmailActionsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    let email: Email
    var onRemoveFromList: ((String) -> Void)? = nil
    /// Detail message menu: starts a private note to self on this message.
    var onAddNote: (() -> Void)? = nil

    private var source: Email {
        email
    }

    private var availability: EmailActionAvailability {
        EmailActionAvailability(email: source, readOnly: app.isReadOnly)
    }

    private var fromList: Bool {
        onRemoveFromList != nil
    }

    private var moveTargets: [Folder] {
        guard availability.showsMove else { return [] }
        let current = source.folderId
        return app.folders.filter { $0.id != current }
    }

    /// Your own messages are never judged as spam.
    private var isSelfSender: Bool {
        guard let mailbox = app.selectedMailbox?.email else { return false }
        return source.sender.caseInsensitiveCompare(mailbox) == .orderedSame
    }

    private var showsSpamAction: Bool {
        !isSelfSender && (availability.showsReportSpam || availability.showsNotSpam)
    }

    private var offersUnsubscribe: Bool {
        availability.showsReportSpam && !availability.showsNotSpam && source.offersOneClickUnsubscribe
    }

    private var previewLine: String {
        source.previewText.isEmpty ? "(no preview)" : source.previewText
    }

    var body: some View {
        NavigationStack {
            List {
                if availability.showsReplyActions {
                    Section {
                        quickActionsRow
                            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 16, trailing: 0))
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                }

                Section {
                    actionRow(
                        source.starred ? "Unstar" : "Star",
                        systemImage: source.starred ? "star.fill" : "star"
                    ) {
                        Task { await app.toggleStar(on: source) }
                    }

                    actionRow(
                        source.replyLater ? "Remove from Reply Later" : "Reply later",
                        systemImage: source.replyLater ? "clock.arrow.circlepath" : "clock"
                    ) {
                        // The sheet holds a snapshot of the email, so close it (as Android
                        // does) rather than leave a stale label that would re-apply the flag.
                        dismiss()
                        Task { await app.toggleReplyLater(on: source) }
                    }

                    actionRow(
                        source.read ? "Mark as Unread" : "Mark as Read",
                        systemImage: source.read ? "envelope.badge" : "envelope.open"
                    ) {
                        Task { await app.toggleRead(on: source) }
                    }

                    if !moveTargets.isEmpty {
                        NavigationLink {
                            MoveToFolderView(
                                folders: moveTargets,
                                sender: source,
                                mailboxEmail: app.selectedMailbox?.email,
                                onClose: dismissSheet
                            ) { folderId, setPreference in
                                Task {
                                    dismiss()
                                    await app.moveEmail(
                                        source,
                                        to: folderId,
                                        fromList: fromList,
                                        setSenderPreference: setPreference
                                    )
                                    if fromList { onRemoveFromList?(source.id) }
                                }
                            }
                        } label: {
                            Label("Move to Folder", systemImage: "folder")
                        }
                    }

                    if showsSpamAction, availability.showsNotSpam {
                        actionRow("Not Spam", systemImage: "checkmark.shield") {
                            Task {
                                dismiss()
                                await app.markNotSpam(source, fromList: fromList)
                                if fromList { onRemoveFromList?(source.id) }
                            }
                        }
                    } else if showsSpamAction {
                        // Confirm first: "Move their other mail to Spam" starts
                        // on (AVE-98); RFC 8058 bulk mail adds "Unsubscribe",
                        // which starts off (AVE-99).
                        NavigationLink {
                            ReportSpamConfirmView(
                                sender: source,
                                offersUnsubscribe: offersUnsubscribe,
                                onClose: dismissSheet
                            ) { unsubscribe, refileSender in
                                Task {
                                    dismiss()
                                    await app.reportSpam(
                                        source,
                                        fromList: fromList,
                                        unsubscribe: unsubscribe,
                                        refileSender: refileSender
                                    )
                                    if fromList { onRemoveFromList?(source.id) }
                                }
                            }
                        } label: {
                            Label("Report Spam", systemImage: "exclamationmark.triangle")
                        }
                    }

                    if let onAddNote {
                        actionRow("Add Private Note", systemImage: "note.text.badge.plus") {
                            dismiss()
                            onAddNote()
                        }
                    }

                    NavigationLink {
                        EmailSourceView(email: source, onClose: dismissSheet)
                    } label: {
                        Label("View Source", systemImage: "chevron.left.forwardslash.chevron.right")
                    }

                    if availability.showsDelete {
                        Menu {
                            Button("Delete Message", role: .destructive) {
                                Task {
                                    dismiss()
                                    await app.deleteEmail(source, fromList: fromList)
                                    if fromList { onRemoveFromList?(source.id) }
                                }
                            }
                        } label: {
                            Label("Delete", systemImage: "trash")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .listSectionSpacing(.custom(16))
            .navigationBarBackButtonHidden(true)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(alignment: .top, spacing: AppTheme.List.dotToText) {
                        Circle()
                            .fill(source.isUnread ? AppTheme.unread : AppTheme.pillActive)
                            .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotSize)
                            .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotLineHeight, alignment: .center)
                            .accessibilityLabel(source.isUnread ? "Unread" : "Read")

                        VStack(alignment: .leading, spacing: 2) {
                            Text(source.displaySender)
                                .font(.inter(size: AppTheme.List.sender, weight: source.isUnread ? .medium : .regular))
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)
                                .tracking(AppTheme.List.tracking)
                            
                            Text(previewLine)
                                .font(.inter(size: AppTheme.List.preview, weight: .regular))
                                .foregroundStyle(AppTheme.muted)
                                .lineLimit(1)
                                .tracking(AppTheme.List.tracking)
                        }
                    }
                }
            }
            .actionsSheetChrome(onClose: dismissSheet)
        }
        .padding(.top, 10)
        .tint(AppTheme.ink)
        .presentationDetents([.height(estimatedHeight)])
        .presentationDragIndicator(.visible)
        .presentationContentInteraction(.resizes)
        .presentationBackground(AppTheme.background)
    }

    private var estimatedHeight: CGFloat {
        var h: CGFloat = 140 // base height for nav bar, paddings, and safe area
        if availability.showsReplyActions {
            h += 130 // quick actions row + section spacing
        }
        var rows = 3 // Star, Reply Later, Read
        if !moveTargets.isEmpty { rows += 1 }
        if showsSpamAction { rows += 1 }
        rows += 1 // View Source
        if onAddNote != nil { rows += 1 }
        if availability.showsDelete { rows += 1 }
        
        h += CGFloat(rows) * 44 // standard list row height
        return h
    }

    private func dismissSheet() {
        dismiss()
    }

    private var quickActionsRow: some View {
        HStack(spacing: 8) {
            quickActionButton("Reply", systemImage: "arrowshape.turn.up.left") {
                Task {
                    dismiss()
                    await app.startCompose(mode: .reply, original: source)
                }
            }
            quickActionButton("Reply All", systemImage: "arrowshape.turn.up.left.2") {
                Task {
                    dismiss()
                    await app.startCompose(mode: .replyAll, original: source)
                }
            }
            quickActionButton("Forward", systemImage: "arrowshape.turn.up.right") {
                Task {
                    dismiss()
                    await app.startCompose(mode: .forward, original: source)
                }
            }
            if availability.showsArchive {
                quickActionButton("Archive", systemImage: "archivebox") {
                    Task {
                        dismiss()
                        await app.archiveEmail(source, fromList: fromList)
                        if fromList { onRemoveFromList?(source.id) }
                    }
                }
            }
        }
        .padding(16)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func quickActionButton(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.inter(size: 18, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 52, height: 52)
                    .background(AppTheme.pillFill)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(title)
                    .font(.inter(size: 11, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private func actionRow(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .foregroundStyle(AppTheme.ink)
        }
    }
}

private struct MoveToFolderView: View {
    let folders: [Folder]
    let sender: Email
    var mailboxEmail: String?
    var onClose: () -> Void
    var onMove: (String, Bool) -> Void

    @State private var pendingFolderId: String?

    private static let purposeFolderIds: Set<String> = ["inbox", "promotions", "updates"]

    private var senderLabel: String {
        let name = sender.displaySender.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return sender.sender
    }

    private var isSelfSender: Bool {
        guard let mailboxEmail else { return false }
        return sender.sender.caseInsensitiveCompare(mailboxEmail) == .orderedSame
    }

    var body: some View {
        List(folders) { folder in
            Button(folder.name) {
                // Into or out of Spam is Not spam / Report spam: leaving Spam is
                // the signal, so there's no "remember?" prompt.
                if sender.folderId == "spam" || folder.id == "spam" {
                    onMove(folder.id, true)
                } else if Self.purposeFolderIds.contains(folder.id),
                   !sender.sender.isEmpty,
                   !isSelfSender {
                    pendingFolderId = folder.id
                } else {
                    onMove(folder.id, false)
                }
            }
            .foregroundStyle(AppTheme.ink)
        }
        .navigationTitle("Move to")
        .actionsSheetChrome(onClose: onClose)
        .confirmationDialog(
            "Put future mail from \(senderLabel) here?",
            isPresented: Binding(
                get: { pendingFolderId != nil },
                set: { if !$0 { pendingFolderId = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Yes, for this sender") {
                if let pendingFolderId {
                    onMove(pendingFolderId, true)
                }
                pendingFolderId = nil
            }
            Button("Just this message") {
                if let pendingFolderId {
                    onMove(pendingFolderId, false)
                }
                pendingFolderId = nil
            }
            Button("Cancel", role: .cancel) {
                pendingFolderId = nil
            }
        } message: {
            Text("Also move their existing Inbox, Promotions, and Updates mail.")
        }
    }
}

/// Report spam confirmation: "Move their other mail to Spam", on by default
/// (AVE-98), plus an "Unsubscribe" toggle, off by default, for RFC 8058 bulk
/// mail (AVE-99); then one Report Spam button. Web/Android twins.
struct ReportSpamConfirmView: View {
    let sender: Email
    var offersUnsubscribe: Bool = true
    var onClose: () -> Void
    /// (unsubscribe, refileSender)
    var onReport: (Bool, Bool) -> Void

    @State private var unsubscribe = false
    @State private var refileSender = true

    var body: some View {
        List {
            Section {
                Toggle(isOn: $refileSender) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Move their other mail to Spam")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text("Also moves what they sent to Inbox, Promotions and Updates.")
                            .font(.inter(size: AppTheme.FontSize.meta))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                .tint(AppTheme.accent)
                .accessibilityIdentifier("reportSpamRefileToggle")

                if offersUnsubscribe {
                    Toggle(isOn: $unsubscribe) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Unsubscribe")
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                            Text("Also ask the sender to stop sending to this list.")
                                .font(.inter(size: AppTheme.FontSize.meta))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .tint(AppTheme.accent)
                    .accessibilityIdentifier("reportSpamUnsubscribeToggle")
                }
            } footer: {
                Text("Future mail from \(sender.displaySender) will go to Spam.")
                    .font(.inter(size: AppTheme.FontSize.meta))
                    .foregroundStyle(AppTheme.muted)
            }

            Section {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onReport(offersUnsubscribe && unsubscribe, refileSender)
                } label: {
                    Label("Report Spam", systemImage: "exclamationmark.triangle")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                }
                .accessibilityIdentifier("reportSpamConfirmButton")
            }
        }
        .navigationTitle("Report spam?")
        .actionsSheetChrome(onClose: onClose)
    }
}

private struct EmailSourceView: View {
    let email: Email
    var onClose: () -> Void

    var body: some View {
        List {
            ForEach(Array(email.sourceHeaders.enumerated()), id: \.offset) { _, header in
                VStack(alignment: .leading, spacing: 2) {
                    Text(header.key)
                        .font(.inter(size: 12, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                    Text(header.value)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(AppTheme.ink)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
            }
        }
        .navigationTitle("Source")
        .actionsSheetChrome(onClose: onClose)
    }
}



private struct ActionsSheetChrome: ViewModifier {
    var onClose: () -> Void

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .contentMargins(.vertical, 16, for: .scrollContent)
            .background(AppTheme.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarRole(.editor)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                }
            }
    }
}

private extension View {
    func actionsSheetChrome(onClose: @escaping () -> Void) -> some View {
        modifier(ActionsSheetChrome(onClose: onClose))
    }
}

#Preview("Actions sheet") {
    PreviewHost {
        EmailActionsSheet(email: PreviewSupport.emails[0])
    }
}

#Preview("Report spam + unsubscribe") {
    PreviewHost {
        NavigationStack {
            ReportSpamConfirmView(sender: PreviewSupport.emails[3], onClose: {}, onReport: { _, _ in })
        }
    }
}

import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

/// System sheet compose chrome matching Ask AI / email detail, Notion-styled fields.
struct ComposeSheetView: View {
    @Environment(AppModel.self) private var app
    var session: ComposeSession

    @State private var recipientFocus: Field?
    @State private var viewportHeight: CGFloat = 0
    @State private var headerHeight: CGFloat = 0
    @State private var showQuotedOriginal = false
    @State private var showFormatSheet = false
    @State private var showAttachMenu = false
    @State private var showCamera = false
    @State private var showFileImporter = false
    @State private var showPhotosPicker = false
    @State private var photoSelection: [PhotosPickerItem] = []
    @State private var richText = ComposeRichTextSession()
    @State private var suggestions: [RecentRecipient] = []
    @State private var suggestionRequestID = UUID()
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case to, cc, bcc, subject, body
    }

    private var form: ComposeFormModel { session.form }

    private var fromDisplayName: String {
        if let name = form.fromName, !name.isEmpty { return name }
        return form.fromEmail
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        composeHeader
                            .onGeometryChange(for: CGFloat.self) { proxy in
                                proxy.size.height
                            } action: { headerHeight = $0 }

                        bodyEditor
                            .frame(minHeight: editorMinHeight, alignment: .top)
                    }
                }
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { viewportHeight = $0 }

                if let error = form.errorMessage ?? (form.exceedsOutboundLimit ? OutboundLimits.sizeError : nil) {
                    Text(error)
                        .font(.inter(.footnote))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    ComposeAttachChips(attachments: form.attachments) { id in
                        form.removeAttachment(id)
                    }
                    if showFormatSheet {
                        ComposeFormatSheet(session: richText) {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                showFormatSheet = false
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else {
                        ComposeFormatAttachBar(
                            onFormat: {
                                focusedField = .body
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                    showFormatSheet = true
                                }
                            },
                            onAttach: { showAttachMenu = true }
                        )
                    }
                    if let quoted = form.quotedOriginal, !showQuotedOriginal {
                        quotedOriginalDock(quoted)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
            }
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: showQuotedOriginal)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: showFormatSheet)
            .background(AppTheme.background)
            .background(DetailNavigationTitleFont())
            .navigationTitle(form.displayTitle)
            .navigationBarTitleDisplayMode(.large)
            .onChange(of: focusedField) { _, new in
                if new == .subject || new == .body {
                    recipientFocus = nil
                    suggestions = []
                    form.commitPendingTokens()
                }
            }
            .onChange(of: recipientFocus) { _, new in
                if let new, new == .to || new == .cc || new == .bcc {
                    scheduleSuggestionFetch(for: new)
                } else {
                    suggestions = []
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if form.isEmpty {
                        Button {
                            form.commitPendingTokens()
                            form.cancelAutoSave()
                            app.closeCompose()
                        } label: {
                            Image(systemName: "xmark")
                                .symbolRenderingMode(.hierarchical)
                        }
                    } else {
                        Menu {
                            Button("Save Draft") {
                                Task {
                                    form.commitPendingTokens()
                                    if await form.saveDraft(explicit: true) {
                                        app.showToast("Draft saved")
                                        app.minimizeCompose()
                                    }
                                }
                            }
                            Button("Minimize") {
                                form.commitPendingTokens()
                                app.minimizeCompose()
                            }
                            Button("Delete Draft", role: .destructive) {
                                Task { await deleteAndClose() }
                            }
                        } label: {
                            Image(systemName: "xmark")
                                .symbolRenderingMode(.hierarchical)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "arrow.up")
                            .symbolRenderingMode(.hierarchical)
                    }
                    .disabled(!canSend || form.isSending || form.exceedsOutboundLimit)
                    .accessibilityLabel("Send")
                }
            }
            .background {
                Button {
                    Task { await form.saveDraft(explicit: true) }
                } label: {
                    EmptyView()
                }
                .keyboardShortcut("s", modifiers: .command)
                .opacity(0)
            }
            .sheet(isPresented: $showQuotedOriginal) {
                if let quoted = form.quotedOriginal {
                    quotedOriginalSheet(quoted)
                }
            }
            .confirmationDialog("Attach", isPresented: $showAttachMenu, titleVisibility: .visible) {
                Button("Photo Library") { showPhotosPicker = true }
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Take Photo") { showCamera = true }
                }
                Button("Files") { showFileImporter = true }
                Button("Cancel", role: .cancel) {}
            }
            .photosPicker(
                isPresented: $showPhotosPicker,
                selection: $photoSelection,
                maxSelectionCount: 8,
                matching: .images
            )
            .onChange(of: photoSelection) { _, items in
                Task { await ingestPhotos(items) }
            }
            .fileImporter(
                isPresented: $showFileImporter,
                allowedContentTypes: [.item],
                allowsMultipleSelection: true
            ) { result in
                ingestFiles(result)
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraImagePicker(
                    onImage: { image in
                        showCamera = false
                        ingestCamera(image)
                    },
                    onCancel: { showCamera = false }
                )
                .ignoresSafeArea()
            }
            .overlay(alignment: .bottom) {
                if let toast = form.toast {
                    HStack(spacing: 8) {
                        Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(toast.isError ? .red : AppTheme.ink)

                        Text(toast.message)
                            .font(.inter(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .overlay {
                        Capsule()
                            .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: form.toast?.id)
        }
    }

    private var editorMinHeight: CGFloat {
        max(0, viewportHeight - headerHeight)
    }

    private var composeHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            fromRow
            toRow
            if form.showCcBcc {
                ccRow
                bccRow
            }
            if !suggestions.isEmpty, let focus = recipientFocus,
               focus == .to || focus == .cc || focus == .bcc {
                recipientSuggestions(for: focus)
            }
            subjectRow
            divider
        }
        .padding(.top, 8)
    }

    private func recipientSuggestions(for field: Field) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(suggestions) { suggestion in
                Button {
                    selectSuggestion(suggestion, for: field)
                } label: {
                    let trimmedName = suggestion.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    VStack(alignment: .leading, spacing: 2) {
                        Text(trimmedName.isEmpty ? suggestion.email : trimmedName)
                            .font(.inter(size: AppTheme.FontSize.sender, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(1)
                        if !trimmedName.isEmpty {
                            Text(suggestion.email)
                                .font(.inter(size: AppTheme.FontSize.meta))
                                .foregroundStyle(AppTheme.muted)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(AppTheme.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(AppTheme.line.opacity(0.65))
                .frame(height: 0.5)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.line.opacity(0.65))
                .frame(height: 0.5)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: suggestions.map(\.id))
    }

    private var fromRow: some View {
        HStack(spacing: 4) {
            Text("From:")
                .foregroundStyle(AppTheme.muted)
                .font(.inter(size: AppTheme.FontSize.sender, weight: .medium))

            if app.mailboxes.count > 1 {
                Menu {
                    Picker("From", selection: fromMailboxBinding) {
                        ForEach(app.mailboxes) { mailbox in
                            Text(mailbox.email).tag(mailbox.id)
                        }
                    }
                    .labelsHidden()
                } label: {
                    HStack(spacing: 4) {
                        Text(fromDisplayName)
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.inter(size: AppTheme.FontSize.chevron, weight: .semibold))
                    }
                    .foregroundStyle(AppTheme.muted)
                    .font(.inter(size: AppTheme.FontSize.sender, weight: .medium))
                    .contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .buttonStyle(.plain)
                .accessibilityLabel("From")
                .accessibilityValue(fromDisplayName)
                .accessibilityHint("Select sender")
            } else {
                Text(fromDisplayName)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                    .font(.inter(size: AppTheme.FontSize.sender, weight: .medium))
                    .accessibilityLabel("From \(fromDisplayName)")
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 2)
    }

    private var fromMailboxBinding: Binding<String> {
        Binding(
            get: { form.fromMailboxId },
            set: { id in
                guard let mailbox = app.mailboxes.first(where: { $0.id == id }) else { return }
                form.selectFrom(mailbox: mailbox)
            }
        )
    }

    private var toRow: some View {
        recipientRow(label: "To:", field: .to, showsOverflowMenu: true)
    }

    private var ccRow: some View {
        recipientRow(label: "Cc", field: .cc)
    }

    private var bccRow: some View {
        recipientRow(label: "Bcc", field: .bcc)
    }

    private var subjectRow: some View {
        TextField("Subject", text: Binding(
            get: { form.subject },
            set: { form.subject = $0 }
        ))
        .focused($focusedField, equals: .subject)
        .font(.inter(size: AppTheme.FontSize.inlineTitle, weight: .medium))
        .foregroundStyle(AppTheme.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var bodyEditor: some View {
        ComposeRichTextEditor(
            html: Binding(
                get: { form.body },
                set: { form.body = $0 }
            ),
            session: richText,
            minHeight: editorMinHeight
        )
        .frame(minHeight: editorMinHeight, alignment: .top)
        .padding(.horizontal, 4)
    }

    private func quotedOriginalDock(_ quoted: QuotedOriginal) -> some View {
        Button {
            focusedField = nil
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                showQuotedOriginal = true
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "text.quote")
                    .font(.inter(size: AppTheme.FontSize.meta, weight: .semibold))
                Text(quoted.header)
                    .font(.inter(size: AppTheme.FontSize.body, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
            }
            .foregroundStyle(AppTheme.ink)
            .padding(.horizontal, 18)
            .frame(height: 48)
            .frame(maxWidth: .infinity)
            .background(AppTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.1), radius: 12, y: 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .accessibilityLabel("Show original email")
        .accessibilityHint("Opens the original message. Swipe down to close.")
    }

    private func quotedOriginalSheet(_ quoted: QuotedOriginal) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(quoted.header)
                    .font(.inter(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)

                Text(quoted.text)
                    .font(.inter(size: AppTheme.FontSize.body))
                    .foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(AppTheme.muted.opacity(0.35))
                            .frame(width: 2)
                    }
                    .textSelection(.enabled)
            }
            .padding(.horizontal, 20)
            .padding(.top, 28)
            .padding(.bottom, 28)
        }
        .background(AppTheme.background)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
    }

    private var divider: some View {
        Rectangle()
            .fill(AppTheme.line)
            .frame(height: 1)
            .padding(.leading, 16)
    }

    private func recipientRow(label: String, field: Field, showsOverflowMenu: Bool = false) -> some View {
        let isActive = recipientFocus == field
        let labeledField = HStack(alignment: .top, spacing: 8) {
            Text(label)
                .font(.inter(size: AppTheme.FontSize.meta, weight: .medium))
                .foregroundStyle(AppTheme.muted)
                .frame(minWidth: 28, alignment: .leading)
                .frame(height: CollapsedTokenMetrics.lineHeight)
            tokenField(for: field)
        }
        .frame(maxWidth: .infinity, alignment: .leading)

        return HStack(alignment: .top, spacing: 8) {
            if isActive {
                labeledField
            } else {
                labeledField
                    .contentShape(Rectangle())
                    .onTapGesture { activateRecipient(field) }
            }

            if showsOverflowMenu {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        form.showCcBcc.toggle()
                    }
                    if form.showCcBcc {
                        activateRecipient(.cc)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.inter(size: AppTheme.FontSize.sender, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 28, height: 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(form.showCcBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func tokenField(for field: Field) -> some View {
        switch field {
        case .to:
            tokenField(
                tokens: form.toTokens,
                draft: Binding(get: { form.toDraft }, set: { form.toDraft = $0 }),
                focus: .to,
                placeholder: "Add an email",
                onCommit: { form.commitPendingTokens() },
                onRemove: { form.removeTo($0) }
            )
        case .cc:
            tokenField(
                tokens: form.ccTokens,
                draft: Binding(get: { form.ccDraft }, set: { form.ccDraft = $0 }),
                focus: .cc,
                placeholder: "Add an email",
                onCommit: { form.commitPendingTokens() },
                onRemove: { form.removeCc($0) }
            )
        case .bcc:
            tokenField(
                tokens: form.bccTokens,
                draft: Binding(get: { form.bccDraft }, set: { form.bccDraft = $0 }),
                focus: .bcc,
                placeholder: "Add an email",
                onCommit: { form.commitPendingTokens() },
                onRemove: { form.removeBcc($0) }
            )
        case .subject, .body:
            EmptyView()
        }
    }

    private func activateRecipient(_ field: Field) {
        focusedField = nil
        recipientFocus = field
    }

    private func tokenField(
        tokens: [MailAddress],
        draft: Binding<String>,
        focus: Field,
        placeholder: String,
        onCommit: @escaping () -> Void,
        onRemove: @escaping (MailAddress) -> Void
    ) -> some View {
        RecipientTokenEditor(
            tokens: tokens,
            draft: draft,
            isFocused: recipientFocus == focus,
            placeholder: placeholder,
            onCommit: onCommit,
            onRemove: onRemove,
            onFocusChange: { focused in
                if focused {
                    activateRecipient(focus)
                } else if recipientFocus == focus {
                    recipientFocus = nil
                }
            }
        )
        .onChange(of: draft.wrappedValue) { _, newValue in
            if Self.shouldCommitToken(newValue) {
                onCommit()
                suggestions = []
            } else {
                scheduleSuggestionFetch(for: focus)
            }
        }
    }

    private func selectSuggestion(_ suggestion: RecentRecipient, for field: Field) {
        let address = suggestion.asMailAddress
        switch field {
        case .to:
            form.addSuggestion(address, to: .to)
        case .cc:
            form.addSuggestion(address, to: .cc)
        case .bcc:
            form.addSuggestion(address, to: .bcc)
        case .subject, .body:
            break
        }
        suggestions = []
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func scheduleSuggestionFetch(for field: Field) {
        let draft: String
        let existing: [MailAddress]
        switch field {
        case .to:
            draft = form.toDraft
            existing = form.toTokens
        case .cc:
            draft = form.ccDraft
            existing = form.ccTokens
        case .bcc:
            draft = form.bccDraft
            existing = form.bccTokens
        case .subject, .body:
            suggestions = []
            return
        }

        let query = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let requestID = UUID()
        suggestionRequestID = requestID
        let mailboxId = form.fromMailboxId

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            guard suggestionRequestID == requestID else { return }
            // Preview / mock mailboxes have no API.
            if ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
                || mailboxId.hasPrefix("mb-") {
                suggestions = []
                return
            }
            do {
                let results = try await APIClient.shared.listRecipients(
                    mailboxId: mailboxId,
                    q: query,
                    limit: 8
                )
                guard suggestionRequestID == requestID else { return }
                let existingIDs = Set(existing.map(\.id))
                suggestions = results.filter { !existingIDs.contains($0.id) }
            } catch {
                guard suggestionRequestID == requestID else { return }
                suggestions = []
            }
        }
    }

    private var canSend: Bool {
        !form.toTokens.isEmpty || !form.toDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func shouldCommitToken(_ text: String) -> Bool {
        let hasDelimiter = text.contains { $0 == "," || $0 == ";" }
        let hasSpacedEmail = text.contains { $0 == " " } && text.contains { $0 == "@" }
        return hasDelimiter || hasSpacedEmail
    }

    private func ingestPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let mime = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            ingestAttachment(data: data, filename: "photo-\(UUID().uuidString.prefix(8)).\(ext)", mime: mime)
        }
        photoSelection = []
    }

    private func ingestFiles(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        for url in urls {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            ingestAttachment(
                data: data,
                filename: url.lastPathComponent,
                mime: OutboundImageCompressor.mime(for: url.lastPathComponent)
            )
        }
    }

    private func ingestCamera(_ image: UIImage) {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return }
        ingestAttachment(data: data, filename: "photo-\(UUID().uuidString.prefix(8)).jpg", mime: "image/jpeg")
    }

    private func ingestAttachment(data: Data, filename: String, mime: String) {
        do {
            let prepared = try OutboundImageCompressor.prepare(
                data: data,
                filename: filename,
                mimeType: mime,
                budget: form.remainingAttachmentBudget
            )
            form.addPreparedAttachment(prepared)
        } catch {
            form.showToast(error.localizedDescription, isError: true)
        }
    }

    private func send() async {
        form.cancelAutoSave()
        form.commitPendingTokens()
        guard form.toTokens.isEmpty == false else { return }
        
        let sessionToRestore = session
        let formToRestore = form
        
        app.scheduleUndoableAction(
            optimistic: {
                app.closeCompose()
            },
            commit: { @Sendable in
                let success = await formToRestore.performActualSend()
                if success {
                    await app.loadEmailsForCurrentTab()
                }
            },
            rollback: { @MainActor in
                app.composeSession = sessionToRestore
                app.composeSession?.expand()
            },
            pendingMessage: "Sending...",
            completedMessage: "Sent"
        )
    }

    private func deleteAndClose() async {
        form.cancelAutoSave()
        if let draftId = form.draftId {
            try? await APIClient.shared.deleteEmail(mailboxId: form.fromMailboxId, id: draftId)
            form.onDraftDeleted?(draftId, form.threadId, form.originalEmailId)
            await app.loadEmailsForCurrentTab()
        }
        app.closeCompose()
    }
}

/// Wrapping recipient chips plus a field that highlights the last token before deleting it.
private struct RecipientTokenEditor: View {
    let tokens: [MailAddress]
    @Binding var draft: String
    var isFocused: Bool
    var placeholder: String
    var onCommit: () -> Void
    var onRemove: (MailAddress) -> Void
    var onFocusChange: (Bool) -> Void

    @State private var pendingRemovalID: String?

    var body: some View {
        Group {
            if isFocused {
                expandedEditor
            } else {
                CollapsedTokenSummary(tokens: tokens, placeholder: placeholder)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(collapsedAccessibilityLabel)
                    .accessibilityHint("Edits recipients")
                    .accessibilityAddTraits(.isButton)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: draft) { _, _ in
            guard pendingRemovalID != nil else { return }
            pendingRemovalID = nil
        }
        .onChange(of: isFocused) { _, focused in
            if focused {
                pendingRemovalID = nil
            } else {
                pendingRemovalID = nil
                onCommit()
            }
        }
        .onChange(of: tokens.map(\.id)) { _, ids in
            if let pendingRemovalID, !ids.contains(pendingRemovalID) {
                self.pendingRemovalID = nil
            }
        }
    }

    private var collapsedAccessibilityLabel: String {
        if tokens.isEmpty { return placeholder }
        let names = tokens.map(\.tokenLabel)
        if names.count <= 3 { return names.joined(separator: ", ") }
        return "\(names.prefix(3).joined(separator: ", ")) and \(names.count - 3) others"
    }

    private var expandedEditor: some View {
        FlowLayout(spacing: 6) {
            ForEach(tokens) { token in
                RecipientTokenPill(
                    token: token,
                    isPendingRemoval: token.id == pendingRemovalID,
                    onRemove: {
                        pendingRemovalID = nil
                        onRemove(token)
                    }
                )
            }
            BackspaceTextField(
                text: $draft,
                placeholder: tokens.isEmpty ? placeholder : "",
                isFocused: isFocused,
                onSubmit: onCommit,
                onDeleteBackwardWhenEmpty: handleDeleteWhenEmpty,
                onBeganEditing: { onFocusChange(true) }
            )
        }
        .frame(maxWidth: .infinity, minHeight: CollapsedTokenMetrics.lineHeight, alignment: .leading)
    }

    private func handleDeleteWhenEmpty() {
        guard let last = tokens.last else { return }
        if pendingRemovalID == last.id {
            pendingRemovalID = nil
            onRemove(last)
        } else {
            withAnimation(.easeInOut(duration: 0.12)) {
                pendingRemovalID = last.id
            }
        }
    }
}

private enum CollapsedTokenMetrics {
    static let spacing: CGFloat = 6
    static let minPillWidth: CGFloat = 56
    static let pillHorizontalPadding: CGFloat = 16
    static let pillFont = UIFont.inter(size: AppTheme.FontSize.meta, weight: .medium)

    static var lineHeight: CGFloat {
        ceil(pillFont.lineHeight) + 8
    }

    static func overflowLabel(hidden: Int) -> String {
        "+ \(hidden) others"
    }

    static func textWidth(_ string: String) -> CGFloat {
        ceil((string as NSString).size(withAttributes: [.font: pillFont]).width)
    }

    static func naturalPillWidth(label: String) -> CGFloat {
        textWidth(label) + pillHorizontalPadding
    }

    static func overflowWidth(hidden: Int) -> CGFloat {
        guard hidden > 0 else { return 0 }
        return textWidth(overflowLabel(hidden: hidden)) + spacing
    }

    static func layout(
        tokens: [MailAddress],
        width: CGFloat
    ) -> (visible: [MailAddress], hidden: Int, widths: [CGFloat]) {
        guard !tokens.isEmpty else { return ([], 0, []) }
        let width = max(width, minPillWidth)

        for hidden in 0..<tokens.count {
            let visible = Array(tokens.prefix(tokens.count - hidden))
            var remaining = width - overflowWidth(hidden: hidden)
            var widths: [CGFloat] = []
            var fits = true

            for (index, token) in visible.enumerated() {
                let natural = naturalPillWidth(label: token.tokenLabel)
                let isLast = index == visible.count - 1
                if natural <= remaining {
                    widths.append(natural)
                    remaining -= natural + spacing
                } else if isLast, remaining >= minPillWidth {
                    widths.append(remaining)
                    remaining = 0
                } else {
                    fits = false
                    break
                }
            }

            if fits {
                return (visible, hidden, widths)
            }
        }

        let hidden = tokens.count - 1
        let firstWidth = max(minPillWidth, width - overflowWidth(hidden: hidden))
        return (Array(tokens.prefix(1)), hidden, [firstWidth])
    }
}

private struct CollapsedTokenSummary: View {
    let tokens: [MailAddress]
    var placeholder: String
    @State private var width: CGFloat = 0

    var body: some View {
        HStack(alignment: .center, spacing: CollapsedTokenMetrics.spacing) {
            if tokens.isEmpty {
                Text(placeholder)
                    .font(.inter(size: AppTheme.FontSize.meta, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
            } else {
                let plan = CollapsedTokenMetrics.layout(tokens: tokens, width: width)
                ForEach(Array(plan.visible.enumerated()), id: \.element.id) { index, token in
                    RecipientTokenPill(
                        token: token,
                        isPendingRemoval: false,
                        showsRemove: false,
                        maxWidth: plan.widths[index],
                        onRemove: {}
                    )
                }
                if plan.hidden > 0 {
                    Text(CollapsedTokenMetrics.overflowLabel(hidden: plan.hidden))
                        .font(.inter(size: AppTheme.FontSize.meta, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: CollapsedTokenMetrics.lineHeight, alignment: .leading)
        .contentShape(Rectangle())
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            guard abs(width - newWidth) > 0.5 else { return }
            width = newWidth
        }
    }
}

private struct RecipientTokenPill: View {
    let token: MailAddress
    var isPendingRemoval: Bool
    var showsRemove: Bool = true
    var maxWidth: CGFloat? = nil
    var onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(token.tokenLabel)
                .font(.inter(size: AppTheme.FontSize.meta, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            if showsRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.inter(size: AppTheme.FontSize.chevron, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(token.tokenLabel)")
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, showsRemove ? 6 : 8)
        .padding(.vertical, 4)
        .frame(maxWidth: maxWidth, alignment: .leading)
        .background(isPendingRemoval ? AppTheme.pillActive : AppTheme.pillFill)
        .clipShape(Capsule())
        .foregroundStyle(isPendingRemoval ? AppTheme.ink : AppTheme.muted)
        .fixedSize(horizontal: maxWidth == nil, vertical: true)
        .accessibilityAddTraits(isPendingRemoval ? .isSelected : [])
        .accessibilityValue(token.email)
        .accessibilityHint(showsRemove ? (isPendingRemoval ? "Delete again to remove" : "Double tap the close button to remove") : "")
    }
}

/// Email field that reports backspace when empty so tokens can be selected, then removed.
private struct BackspaceTextField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var isFocused: Bool
    var onSubmit: () -> Void
    var onDeleteBackwardWhenEmpty: () -> Void
    var onBeganEditing: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> TokenUITextField {
        let field = TokenUITextField()
        field.delegate = context.coordinator
        field.borderStyle = .none
        field.backgroundColor = .clear
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.keyboardType = .emailAddress
        field.returnKeyType = .next
        field.tintColor = UIColor(AppTheme.ink)
        field.textColor = UIColor(AppTheme.ink)
        field.font = UIFont.inter(size: AppTheme.FontSize.recipient, weight: .regular)
        field.setContentHuggingPriority(.required, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.addTarget(context.coordinator, action: #selector(Coordinator.editingChanged), for: .editingChanged)
        context.coordinator.text = $text
        context.coordinator.onSubmit = onSubmit
        context.coordinator.onDeleteBackwardWhenEmpty = onDeleteBackwardWhenEmpty
        context.coordinator.onBeganEditing = onBeganEditing
        field.onDeleteBackwardWhenEmpty = { [weak coordinator = context.coordinator] in
            coordinator?.onDeleteBackwardWhenEmpty()
        }
        return field
    }

    func updateUIView(_ uiView: TokenUITextField, context: Context) {
        context.coordinator.text = $text
        context.coordinator.onSubmit = onSubmit
        context.coordinator.onDeleteBackwardWhenEmpty = onDeleteBackwardWhenEmpty
        context.coordinator.onBeganEditing = onBeganEditing
        uiView.onDeleteBackwardWhenEmpty = { [weak coordinator = context.coordinator] in
            coordinator?.onDeleteBackwardWhenEmpty()
        }

        if uiView.isFirstResponder {
            // Don't push SwiftUI's lagged string back into a live field (wipes the
            // latest character). Only apply SwiftUI changes that clear after commit.
            if text.isEmpty, !(uiView.text ?? "").isEmpty {
                uiView.text = ""
            }
        } else if uiView.text != text {
            uiView.text = text
        }
        if uiView.placeholder != placeholder {
            uiView.attributedPlaceholder = NSAttributedString(
                string: placeholder,
                attributes: [
                    .foregroundColor: UIColor(AppTheme.muted),
                    .font: UIFont.inter(size: AppTheme.FontSize.recipient, weight: .regular),
                ]
            )
        }

        // Only resign after SwiftUI has acknowledged this field was focused and then
        // moved focus elsewhere. Resigning whenever `isFocused` is false drops the
        // keyboard on the first keystroke (FocusState lags the UIKit first responder).
        if isFocused {
            context.coordinator.swiftUIOwnsFocus = true
            if !uiView.isFirstResponder {
                DispatchQueue.main.async {
                    guard context.coordinator.swiftUIOwnsFocus else { return }
                    uiView.becomeFirstResponder()
                }
            }
        } else if context.coordinator.swiftUIOwnsFocus {
            context.coordinator.swiftUIOwnsFocus = false
            if uiView.isFirstResponder {
                uiView.resignFirstResponder()
            }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: TokenUITextField, context: Context) -> CGSize? {
        uiView.intrinsicContentSize
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var text: Binding<String> = .constant("")
        var onSubmit: () -> Void = {}
        var onDeleteBackwardWhenEmpty: () -> Void = {}
        var onBeganEditing: () -> Void = {}
        var swiftUIOwnsFocus = false

        @objc func editingChanged(_ textField: UITextField) {
            let value = textField.text ?? ""
            if text.wrappedValue != value {
                text.wrappedValue = value
            }
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            onBeganEditing()
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            onSubmit()
            return true
        }
    }
}

private final class TokenUITextField: UITextField {
    var onDeleteBackwardWhenEmpty: (() -> Void)?

    /// Keep a stable size so FlowLayout does not relayout (and steal focus) per keystroke.
    override var intrinsicContentSize: CGSize {
        CGSize(width: 128, height: CollapsedTokenMetrics.lineHeight)
    }

    override func deleteBackward() {
        if (text ?? "").isEmpty {
            onDeleteBackwardWhenEmpty?()
            return
        }
        super.deleteBackward()
    }
}

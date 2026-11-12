import SwiftUI

// Tags (AVE-242): many per email, on top of the one folder it lives in. The pieces the
// list, reader and home shell share: the pill, the picker, the home Tags group and the
// create / rename / delete dialogs. Web: `TagPicker.tsx`, `TagDialogs.tsx`,
// `FoldersColumn.tsx`. Android twin: `ui/tags/TagViews.kt`.

/// A tag on a mail row or in the reader: tag glyph + name on `pillFill`, the row-chip
/// shape (6pt corners) so it sits with the other chips.
struct TagPill: View {
    let name: String
    var size: CGFloat = AppTheme.List.badge

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "tag")
                .font(.system(size: size - 1, weight: .medium))
            Text(name)
                .font(.inter(size: size, weight: .medium))
                .lineLimit(1)
        }
        .padding(.horizontal, size > AppTheme.List.badge ? 10 : 8)
        .padding(.vertical, size > AppTheme.List.badge ? 5 : 3)
        .background(AppTheme.pillFill)
        .clipShape(RoundedRectangle(cornerRadius: size > AppTheme.List.badge ? 7 : 6, style: .continuous))
        .foregroundStyle(AppTheme.muted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Tag \(name)")
    }
}

/// Find, toggle and create tags for one conversation. Pushed inside the email actions
/// sheet, or presented on its own with `TagPickerSheet`.
struct TagPickerView: View {
    @Environment(AppModel.self) private var app

    let email: Email
    var onClose: (() -> Void)? = nil

    @State private var query = ""
    @State private var isCreating = false
    @State private var error: String?
    @FocusState private var searchFocused: Bool

    private var applied: Set<String> {
        Set(app.conversationTags(for: currentEmail).map(\.id))
    }

    /// The live copy: the row or open email the picker was opened from, after edits.
    private var currentEmail: Email {
        if let selected = app.selectedEmail, MailTags.threadKey(selected) == MailTags.threadKey(email) {
            return selected
        }
        return app.emails.first { $0.id == email.id } ?? email
    }

    private var options: (matches: [MailTag], create: String?) {
        MailTags.pickerOptions(app.tags, query: query)
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                    TextField(
                        text: $query,
                        prompt: Text(verbatim: MailTags.pickerPlaceholder).foregroundStyle(AppTheme.muted)
                    ) {
                        Text(verbatim: MailTags.pickerPlaceholder)
                    }
                    .font(.inter(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($searchFocused)
                    .onSubmit { submit() }
                    .onChange(of: query) { _, _ in error = nil }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(error == nil ? AppTheme.line : AppTheme.deepDarkRed, lineWidth: error == nil ? 0.5 : 1)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

                if let error {
                    Text(error)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.deepDarkRed)
                        .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 0, trailing: 0))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
            }

            Section {
                ForEach(options.matches) { tag in
                    Button {
                        Task { await app.setTag(tag.ref, on: !applied.contains(tag.id), for: currentEmail) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "tag")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.muted)
                                .frame(width: 20)
                            Text(tag.name)
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                                .opacity(applied.contains(tag.id) ? 1 : 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tag.name)
                    .accessibilityAddTraits(applied.contains(tag.id) ? .isSelected : [])
                }

                if let create = options.create {
                    Button {
                        submit()
                    } label: {
                        HStack(spacing: 12) {
                            Group {
                                if isCreating {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "plus")
                                        .font(.system(size: 14, weight: .semibold))
                                }
                            }
                            .foregroundStyle(AppTheme.accent)
                            .frame(width: 20)
                            Text(MailTags.createOption(create))
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isCreating)
                }

                if app.tags.isEmpty && options.create == nil {
                    Text(MailTags.pickerEmpty)
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.muted)
                        .listRowBackground(Color.clear)
                }
            }
            .listRowBackground(AppTheme.surface)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.tags)
        .navigationTitle(MailTags.pickerTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
            }
        }
        .task { await app.refreshTags() }
    }

    /// Enter / the Create row: create what's typed and tag the conversation with it.
    private func submit() {
        guard let name = options.create, !isCreating else { return }
        isCreating = true
        Task {
            defer { isCreating = false }
            do {
                try await app.createTag(name: name, applyingTo: currentEmail)
                query = ""
            } catch {
                self.error = AppModel.message(for: error, fallback: MailTags.createFailed)
            }
        }
    }
}

/// `TagPickerView` as its own sheet (reader chip, list context menu).
struct TagPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let email: Email

    var body: some View {
        NavigationStack {
            TagPickerView(email: email, onClose: { dismiss() })
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
        .tint(AppTheme.ink)
    }
}

// MARK: - Create / rename / delete

enum TagEditorAction: Identifiable, Equatable {
    case create
    case rename(MailTag)
    case delete(MailTag)

    var id: String {
        switch self {
        case .create: return "create"
        case .rename(let tag): return "rename-\(tag.id)"
        case .delete(let tag): return "delete-\(tag.id)"
        }
    }
}

/// The three tag dialogs (web `useTagEditor`). Errors come back in their own alert, since
/// the app toast can sit under a sheet.
private struct TagEditorDialogs: ViewModifier {
    @Environment(AppModel.self) private var app
    @Binding var action: TagEditorAction?
    var onCreated: ((MailTag) -> Void)?

    @State private var draft = ""
    @State private var error: String?
    /// The dialog last opened: the alert clears `action` as it closes, before Save runs.
    @State private var active: TagEditorAction?

    private var promptTag: MailTag? {
        if case .rename(let tag) = action { return tag }
        return nil
    }

    private var deleting: MailTag? {
        if case .delete(let tag) = action { return tag }
        return nil
    }

    private var isPrompting: Binding<Bool> {
        Binding(
            get: {
                switch action {
                case .create, .rename: return true
                default: return false
                }
            },
            set: { if !$0, action != nil, deleting == nil { action = nil } }
        )
    }

    func body(content: Content) -> some View {
        content
            .alert(promptTag == nil ? MailTags.createTitle : MailTags.renameTitle, isPresented: isPrompting) {
                TextField(MailTags.nameField, text: $draft)
                    .autocorrectionDisabled()
                Button("Cancel", role: .cancel) {}
                Button(promptTag == nil ? "Create" : "Save") {
                    let current = active
                    Task { await submit(current) }
                }
            }
            .confirmationDialog(
                deleting.map { MailTags.deleteTitle($0.name) } ?? "",
                isPresented: Binding(
                    get: { deleting != nil },
                    set: { if !$0 { action = nil } }
                ),
                titleVisibility: .visible,
                presenting: deleting
            ) { tag in
                Button(MailTags.deleteMenu, role: .destructive) {
                    Task { await submit(.delete(tag)) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text(MailTags.deleteMessage)
            }
            .alert(
                error ?? "",
                isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
            ) {
                Button("OK", role: .cancel) {}
            }
            .onChange(of: action) { _, next in
                guard let next else { return }
                active = next
                if case .rename(let tag) = next { draft = tag.name } else if next == .create { draft = "" }
            }
    }

    private func submit(_ current: TagEditorAction?) async {
        action = nil
        do {
            switch current {
            case .create:
                let created = try await app.createTag(name: draft)
                onCreated?(created)
            case .rename(let tag):
                try await app.renameTag(tag, to: draft)
            case .delete(let tag):
                try await app.deleteTag(tag)
            case nil:
                break
            }
        } catch {
            let fallback: String
            switch current {
            case .rename: fallback = MailTags.renameFailed
            case .delete: fallback = MailTags.deleteFailed
            default: fallback = MailTags.createFailed
            }
            self.error = AppModel.message(for: error, fallback: fallback)
        }
    }
}

extension View {
    func tagEditorDialogs(_ action: Binding<TagEditorAction?>, onCreated: ((MailTag) -> Void)? = nil) -> some View {
        modifier(TagEditorDialogs(action: action, onCreated: onCreated))
    }
}

// MARK: - Home Tags group

/// One tag in the home Tags group (phone sheet and the iPad folder column).
struct TagGroupRow: View {
    let tag: MailTag
    var isSelected = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "tag")
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted)
                .frame(width: 20)
            Text(tag.name)
                .font(.inter(size: 15, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)
            Spacer(minLength: 4)
            if tag.unreadCount > 0 {
                Text(tag.unreadCount > 999 ? "999+" : "\(tag.unreadCount)")
                    .font(.inter(size: AppTheme.FontSize.meta))
                    .monospacedDigit()
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: HomeChromeMetrics.folderRowHeight)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: HomeChromeMetrics.folderRowCornerRadius, style: .continuous)
                    .fill(AppTheme.pillFill)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tag.name)
        .accessibilityValue(tag.unreadCount > 0 ? "\(tag.unreadCount) unread" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The Tags group's rows with rename / delete on long press; shared by the phone sheet
/// and the iPad folder column.
struct TagGroupList: View {
    @Environment(AppModel.self) private var app
    var selectedTagId: String?
    @Binding var editor: TagEditorAction?
    let onOpen: (MailTag) -> Void

    var body: some View {
        if app.tags.isEmpty {
            Text(MailTags.groupEmpty)
                .font(.inter(size: 13))
                .foregroundStyle(AppTheme.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            ForEach(app.tags) { tag in
                Button {
                    onOpen(tag)
                } label: {
                    TagGroupRow(tag: tag, isSelected: tag.id == selectedTagId)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    if !app.isReadOnly {
                        Button("Rename…", systemImage: "pencil") { editor = .rename(tag) }
                        Button(MailTags.deleteMenu, systemImage: "trash", role: .destructive) { editor = .delete(tag) }
                    }
                }
            }
        }
    }
}

/// Phone home Tags group: opened from the folders menu. Tap a tag for its view.
struct TagListSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var editor: TagEditorAction?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    TagGroupList(selectedTagId: app.openTagId, editor: $editor) { tag in
                        dismiss()
                        app.openTagView(tag.id)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.tags)
            }
            .background(AppTheme.background)
            .navigationTitle(MailTags.groupTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                    }
                    .accessibilityLabel("Close")
                }
                if !app.isReadOnly {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            editor = .create
                        } label: {
                            Image(systemName: "plus")
                                .foregroundStyle(AppTheme.ink)
                                .frame(width: 32, height: 32)
                        }
                        .accessibilityLabel(MailTags.createLabel)
                    }
                }
            }
            .tagEditorDialogs($editor)
            .task { await app.refreshTags() }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
        .tint(AppTheme.ink)
    }
}

// MARK: - DEBUG fixtures

/// Tag fixtures (AVE-242), the same four as Android `PreviewSupport`.
enum PreviewMailTags {
    static let clients = MailTag(id: "tag_clients", name: "Clients", emailCount: 3, unreadCount: 1)
    static let q3 = MailTag(id: "tag_q3", name: "Q3 planning", emailCount: 1, unreadCount: 0)
    static let waiting = MailTag(id: "tag_waiting", name: "Waiting on", emailCount: 2, unreadCount: 2)
    static let personal = MailTag(id: "tag_personal", name: "Personal", emailCount: 0, unreadCount: 0)
    static let tags = MailTags.sorted([clients, q3, waiting, personal])
}

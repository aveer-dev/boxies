import SwiftUI

/// Settings → Tags (AVE-158): create, rename and delete the mailbox's custom folders.
/// Web shows them as tags in the Folders column (`FoldersColumn.tsx`); names, validation
/// and error copy follow web and the Worker (`CustomFolders`). Deleting a tag moves its
/// mail to the Inbox. Android twin: `TagsSettingsView.kt`.
struct TagsSettingsView: View {
    @Environment(AppModel.self) private var app

    @State private var draft = ""
    @State private var createError: String?
    @State private var isCreating = false
    @State private var renaming: Folder?
    @State private var renameDraft = ""
    @State private var deleting: Folder?
    @State private var busyFolderId: String?
    /// Local toast: the app-level toast sits underneath the settings sheet.
    @State private var toast: ComposeToast?
    @State private var toastDismissTask: Task<Void, Never>?
    @FocusState private var fieldFocused: Bool

    private var tags: [Folder] { CustomFolders.custom(in: app.folders) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(CustomFolders.introText)
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 20)

                createField

                if tags.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(CustomFolders.emptyTitle)
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                        Text(CustomFolders.emptyMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(tags) { tag in
                            tagRow(tag)
                            if tag.id != tags.last?.id {
                                Divider().overlay(AppTheme.line)
                            }
                        }
                    }
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                }
            }
            .padding(.top, 8)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: tags)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(AppTheme.background)
        .navigationTitle(CustomFolders.pageTitle)
        .navigationBarTitleDisplayMode(.inline)
        .alert(
            CustomFolders.renameTitle,
            isPresented: Binding(
                get: { renaming != nil },
                set: { if !$0 { renaming = nil } }
            ),
            presenting: renaming
        ) { tag in
            TextField("Tag name", text: $renameDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                Task { await rename(tag) }
            }
        } message: { tag in
            Text("Mail in \(CustomFolders.displayName(tag)) stays in it.")
        }
        .confirmationDialog(
            deleting.map(CustomFolders.deleteConfirmTitle) ?? "",
            isPresented: Binding(
                get: { deleting != nil },
                set: { if !$0 { deleting = nil } }
            ),
            titleVisibility: .visible,
            presenting: deleting
        ) { tag in
            Button("Delete tag", role: .destructive) {
                Task { await delete(tag) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text(CustomFolders.deleteConfirmMessage)
        }
        .overlay(alignment: .bottom) {
            if let toast {
                InboxiesToast(
                    message: toast.message,
                    icon: toast.toastIcon,
                    onDismiss: {
                        toastDismissTask?.cancel()
                        self.toast = nil
                    }
                )
                .padding(.horizontal, ToastMetrics.screenInset)
                .padding(.bottom, ToastMetrics.standaloneBottomInset)
            }
        }
        .animation(ToastMetrics.animation, value: toast?.id)
        #if DEBUG
        .task {
            // `-previewTagsRename` / `-previewTagsDelete`: open the dialogs for screenshots.
            let args = ProcessInfo.processInfo.arguments
            guard let first = tags.first else { return }
            try? await Task.sleep(nanoseconds: 400_000_000)
            if args.contains("-previewTagsRename") {
                beginRename(first)
            } else if args.contains("-previewTagsDelete") {
                deleting = first
            }
        }
        #endif
    }

    private var createField: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField(text: $draft, prompt: Text(verbatim: CustomFolders.namePlaceholder).foregroundStyle(AppTheme.muted)) {
                    Text(verbatim: "Tag name")
                }
                .font(.inter(size: 15))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($fieldFocused)
                .onSubmit { Task { await create() } }
                .onChange(of: draft) { _, _ in createError = nil }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(createError == nil ? AppTheme.line : AppTheme.deepDarkRed, lineWidth: createError == nil ? 0.5 : 1)
                }
                .accessibilityLabel("Tag name")

                Button {
                    Task { await create() }
                } label: {
                    Group {
                        if isCreating {
                            ProgressView().tint(.white)
                        } else {
                            Text("Create")
                                .font(.inter(size: 14, weight: .semibold))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 40)
                    .background(AppTheme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .opacity(canCreate ? 1 : 0.45)
                }
                .buttonStyle(.plain)
                .disabled(!canCreate)
                .accessibilityLabel("Create tag")
            }
            if let createError {
                Text(createError)
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.deepDarkRed)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 20)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: createError)
    }

    private var canCreate: Bool {
        !isCreating && !CustomFolders.normalizedName(draft).isEmpty
    }

    private func tagRow(_ tag: Folder) -> some View {
        HStack(spacing: 12) {
            Text("#")
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(AppTheme.muted)
                .frame(width: 18)
            Text(CustomFolders.bareName(tag.name))
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 8)
            if tag.unreadCount > 0 {
                Text("\(tag.unreadCount)")
                    .font(.inter(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .accessibilityLabel("\(tag.unreadCount) unread")
            }
            if busyFolderId == tag.id {
                ProgressView()
                    .controlSize(.small)
                    .frame(width: 32, height: 32)
            } else {
                Menu {
                    Button("Rename", systemImage: "pencil") {
                        beginRename(tag)
                    }
                    Button("Delete", systemImage: "trash", role: .destructive) {
                        deleting = tag
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .buttonStyle(.plain)
                .disabled(busyFolderId != nil)
                .accessibilityLabel("Actions for \(CustomFolders.displayName(tag))")
            }
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
    }

    // MARK: Actions

    private func beginRename(_ tag: Folder) {
        renameDraft = CustomFolders.bareName(tag.name)
        renaming = tag
    }

    private func create() async {
        guard canCreate else { return }
        // Same checks as the Worker, so a duplicate never makes a round trip.
        if let message = CustomFolders.validateCreate(draft, existing: app.folders) {
            createError = message
            return
        }
        createError = nil
        isCreating = true
        defer { isCreating = false }
        do {
            try await app.createCustomFolder(name: draft)
            draft = ""
            fieldFocused = false
        } catch {
            // Keep the name so it can be fixed (web keeps its dialog open).
            createError = Self.message(for: error, fallback: CustomFolders.createFailed)
        }
    }

    private func rename(_ tag: Folder) async {
        renaming = nil
        busyFolderId = tag.id
        defer { busyFolderId = nil }
        do {
            try await app.renameCustomFolder(tag, to: renameDraft)
        } catch {
            showToast(Self.message(for: error, fallback: CustomFolders.renameFailed), isError: true)
        }
    }

    private func delete(_ tag: Folder) async {
        deleting = nil
        busyFolderId = tag.id
        defer { busyFolderId = nil }
        do {
            try await app.deleteCustomFolder(tag)
            showToast(CustomFolders.deletedToast(tag))
        } catch {
            showToast(Self.message(for: error, fallback: CustomFolders.deleteFailed), isError: true)
        }
    }

    private static func message(for error: Error, fallback: String) -> String {
        let message = error.localizedDescription
        return message.isEmpty ? fallback : message
    }

    private func showToast(_ message: String, isError: Bool = false) {
        toastDismissTask?.cancel()
        toast = ComposeToast(message: message, isError: isError)
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            toast = nil
        }
    }
}

/// DEBUG preview fixtures (`-previewTags`): custom folders beside the system ones.
enum PreviewTags {
    static let folders: [Folder] = [
        Folder(id: "engineering-prs", name: "Engineering-PRs", unreadCount: 4),
        Folder(id: "receipts", name: "Receipts", unreadCount: 0),
        Folder(id: "travel", name: "Travel", unreadCount: 1),
    ]
}

#Preview("Tags") {
    PreviewHost {
        NavigationStack {
            TagsSettingsView()
        }
    }
}

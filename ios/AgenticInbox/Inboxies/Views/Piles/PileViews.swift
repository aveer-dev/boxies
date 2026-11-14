import SwiftUI

// Piles people make (AVE-194), beside Reply Later and Set Aside. The pieces the email
// actions sheet, reader and home shell share: the picker, the home Piles group and the
// create / rename / delete dialogs. Web: `PileDialogs.tsx`, `FoldersColumn.tsx`,
// `EmailPanelToolbar.tsx` (PileMenu). Android twin: `ui/piles/PileViews.kt`.

/// Move one mail to a pile people made, take it out (tap its ticked pile again), or make
/// a new pile for it. Pushed inside the email actions sheet, or on its own with
/// `PilePickerSheet`.
struct PilePickerView: View {
    @Environment(AppModel.self) private var app

    let email: Email
    var onClose: (() -> Void)? = nil

    @State private var editor: PileEditorAction?

    /// The live copy: the row or open email the picker was opened from, after edits.
    private var currentEmail: Email {
        if let selected = app.selectedEmail, selected.id == email.id { return selected }
        return app.emails.first { $0.id == email.id } ?? email
    }

    var body: some View {
        List {
            Section {
                ForEach(app.customPiles) { pile in
                    let on = currentEmail.pileId == pile.id
                    Button {
                        Task { await app.setPile(on ? nil : pile.id, on: currentEmail) }
                        onClose?()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "square.stack")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(AppTheme.muted)
                                .frame(width: 20)
                            Text(MailPiles.displayName(pile))
                                .font(.inter(size: 15, weight: .medium))
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                                .opacity(on ? 1 : 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(MailPiles.displayName(pile))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }

                Button {
                    editor = .create
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                            .frame(width: 20)
                        Text(MailPiles.createMenu)
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.accent)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pilePickerCreate")
            } footer: {
                if app.customPiles.isEmpty {
                    Text(MailPiles.groupEmpty)
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .listRowBackground(AppTheme.surface)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.customPiles)
        .navigationTitle(MailPiles.pickerTitle)
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
        .pileEditorDialogs($editor, applyingTo: currentEmail) { _ in onClose?() }
        .task { await app.refreshPiles() }
    }
}

/// `PilePickerView` as its own sheet (list context menu, reader).
struct PilePickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let email: Email

    var body: some View {
        NavigationStack {
            PilePickerView(email: email, onClose: { dismiss() })
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
        .tint(AppTheme.ink)
    }
}

// MARK: - Create / rename / delete

enum PileEditorAction: Identifiable, Equatable {
    case create
    case rename(WorkflowPile)
    case delete(WorkflowPile)

    var id: String {
        switch self {
        case .create: return "create"
        case .rename(let pile): return "rename-\(pile.id)"
        case .delete(let pile): return "delete-\(pile.id)"
        }
    }
}

/// The three pile dialogs (web `PileDialogs.tsx`). Errors come back in their own alert,
/// since the app toast can sit under a sheet. With `applyingTo`, a new pile takes that mail.
private struct PileEditorDialogs: ViewModifier {
    @Environment(AppModel.self) private var app
    @Binding var action: PileEditorAction?
    var applyingTo: Email?
    var onCreated: ((WorkflowPile) -> Void)?

    @State private var draft = ""
    @State private var error: String?
    /// The dialog last opened: the alert clears `action` as it closes, before Save runs.
    @State private var active: PileEditorAction?

    private var renaming: WorkflowPile? {
        if case .rename(let pile) = action { return pile }
        return nil
    }

    private var deleting: WorkflowPile? {
        if case .delete(let pile) = action { return pile }
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
            .alert(renaming == nil ? MailPiles.createTitle : MailPiles.renameTitle, isPresented: isPrompting) {
                TextField(MailPiles.nameField, text: $draft)
                Button("Cancel", role: .cancel) {}
                Button(renaming == nil ? "Create" : "Save") {
                    let current = active
                    Task { await submit(current) }
                }
            }
            .confirmationDialog(
                deleting.map { MailPiles.deleteTitle(MailPiles.displayName($0)) } ?? "",
                isPresented: Binding(
                    get: { deleting != nil },
                    set: { if !$0 { action = nil } }
                ),
                titleVisibility: .visible,
                presenting: deleting
            ) { pile in
                Button(MailPiles.deleteMenu, role: .destructive) {
                    Task { await submit(.delete(pile)) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text(MailPiles.deleteMessage)
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
                if case .rename(let pile) = next { draft = MailPiles.displayName(pile) } else if next == .create { draft = "" }
            }
    }

    private func submit(_ current: PileEditorAction?) async {
        action = nil
        do {
            switch current {
            case .create:
                let created = try await app.createPile(name: draft)
                if let applyingTo { await app.setPile(created.id, on: applyingTo) }
                onCreated?(created)
            case .rename(let pile):
                try await app.renamePile(pile, to: draft)
            case .delete(let pile):
                try await app.deletePile(pile)
            case nil:
                break
            }
        } catch {
            let fallback: String
            switch current {
            case .rename: fallback = MailPiles.renameFailed
            case .delete: fallback = MailPiles.deleteFailed
            default: fallback = MailPiles.createFailed
            }
            self.error = AppModel.message(for: error, fallback: fallback)
        }
    }
}

extension View {
    func pileEditorDialogs(
        _ action: Binding<PileEditorAction?>,
        applyingTo email: Email? = nil,
        onCreated: ((WorkflowPile) -> Void)? = nil
    ) -> some View {
        modifier(PileEditorDialogs(action: action, applyingTo: email, onCreated: onCreated))
    }
}

// MARK: - Home Piles group

/// One pile in the home Piles group (phone sheet and the iPad folder column).
struct PileGroupRow: View {
    let pile: WorkflowPile
    var isSelected = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "square.stack")
                .font(.inter(size: 15, weight: .medium))
                .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted)
                .frame(width: 20)
            Text(MailPiles.displayName(pile))
                .font(.inter(size: 15, weight: isSelected ? .semibold : .regular))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)
            Spacer(minLength: 4)
            if pile.count > 0 {
                Text(pile.count > 999 ? "999+" : "\(pile.count)")
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
        .accessibilityLabel(MailPiles.displayName(pile))
        .accessibilityValue(pile.count > 0 ? "\(pile.count) in pile" : "Empty")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The Piles group's rows with rename / delete on long press; shared by the phone sheet
/// and the iPad folder column.
struct PileGroupList: View {
    @Environment(AppModel.self) private var app
    var selectedPileId: String?
    @Binding var editor: PileEditorAction?
    let onOpen: (WorkflowPile) -> Void

    var body: some View {
        if app.customPiles.isEmpty {
            Text(MailPiles.groupEmpty)
                .font(.inter(size: 13))
                .foregroundStyle(AppTheme.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            ForEach(app.customPiles) { pile in
                Button {
                    onOpen(pile)
                } label: {
                    PileGroupRow(pile: pile, isSelected: pile.id == selectedPileId)
                }
                .buttonStyle(.plain)
                .contextMenu {
                    if !app.isReadOnly {
                        Button("Rename…", systemImage: "pencil") { editor = .rename(pile) }
                        Button(MailPiles.deleteMenu, systemImage: "trash", role: .destructive) { editor = .delete(pile) }
                    }
                }
            }
        }
    }
}

/// Phone home Piles group: opened from the folders menu. Tap a pile for its view.
struct PileListSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var editor: PileEditorAction?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    PileGroupList(selectedPileId: app.openPileId, editor: $editor) { pile in
                        dismiss()
                        app.openPileView(pile.id)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.customPiles)
            }
            .background(AppTheme.background)
            .navigationTitle(MailPiles.groupTitle)
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
                        .accessibilityLabel(MailPiles.createLabel)
                    }
                }
            }
            .pileEditorDialogs($editor)
            .task { await app.refreshPiles() }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
        .tint(AppTheme.ink)
    }
}

// MARK: - DEBUG fixtures

/// Custom pile fixtures (AVE-194), the same three as Android `PreviewSupport`.
enum PreviewPiles {
    static let waitingOn = WorkflowPile(id: "p_waiting", count: 2, dueCount: 0, name: "Waiting on", builtin: false, clearsOnReply: false)
    static let toPay = WorkflowPile(id: "p_topay", count: 1, dueCount: 0, name: "To pay", builtin: false, clearsOnReply: false)
    static let hiring = WorkflowPile(id: "p_hiring", count: 0, dueCount: 0, name: "Hiring", builtin: false, clearsOnReply: false)
    static let piles = [waitingOn, toPay, hiring]
}

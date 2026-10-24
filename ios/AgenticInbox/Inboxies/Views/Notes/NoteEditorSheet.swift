import SwiftUI
import UIKit

/// What the note editor is writing.
struct NoteEditorTarget: Identifiable {
    enum Kind {
        /// A new sticky pinned to the whole conversation.
        case newSticky
        /// A new private note on one message.
        case newInline(emailId: String)
        case edit(ThreadNote)
    }

    let id = UUID()
    let kind: Kind
    /// Conversation key the note is filed under.
    let threadKey: String

    var isSticky: Bool {
        switch kind {
        case .newSticky: return true
        case .newInline: return false
        case .edit(let note): return note.isSticky
        }
    }

    var initialBody: String {
        if case .edit(let note) = kind { return note.body }
        return ""
    }

    var title: String {
        switch kind {
        case .newSticky: return "Sticky Note"
        case .newInline: return "Private Note"
        case .edit: return "Edit Note"
        }
    }

    var submitLabel: String {
        if case .edit = kind { return "Save" }
        return "Add"
    }

    var placeholder: String {
        switch kind {
        case .newSticky: return "Pin a note to this conversation…"
        case .newInline: return "Add a private note about this message…"
        case .edit: return "Write a note to yourself…"
        }
    }
}

/// Markdown editor for a note to self: a plain text view with a few formatting
/// buttons and a Write / Preview switch. A sticky is written on its paper.
struct NoteEditorSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    let target: NoteEditorTarget

    @State private var text: String
    @State private var selection: NSRange
    @State private var mode: Mode = .write
    @State private var isSaving = false

    private enum Mode: String, CaseIterable, Identifiable {
        case write = "Write"
        case preview = "Preview"
        var id: String { rawValue }
    }

    init(target: NoteEditorTarget, startInPreview: Bool = false) {
        self.target = target
        let body = target.initialBody
        _text = State(initialValue: body)
        _selection = State(initialValue: NSRange(location: (body as NSString).length, length: 0))
        _mode = State(initialValue: startInPreview ? .preview : .write)
    }

    private var ink: Color { target.isSticky ? AppTheme.Note.ink : AppTheme.ink }
    private var muted: Color { target.isSticky ? AppTheme.Note.muted : AppTheme.muted }
    private var paper: Color { target.isSticky ? AppTheme.Note.paper : AppTheme.background }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var tooLong: Bool { text.count > ThreadNote.bodyMax }
    private var nearLimit: Bool { text.count > ThreadNote.bodyMax * 9 / 10 }
    private var canSave: Bool {
        !trimmed.isEmpty && !tooLong && !isSaving && trimmed != target.initialBody
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                privacyRow

                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)

                if mode == .write {
                    formatBar
                    NoteTextView(
                        text: $text,
                        selection: $selection,
                        textColor: UIColor(ink),
                        autoFocus: true
                    )
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text(target.placeholder)
                                .font(.inter(size: 15))
                                .foregroundStyle(muted.opacity(0.8))
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                    }
                } else {
                    ScrollView {
                        if trimmed.isEmpty {
                            Text("Nothing to preview")
                                .font(.inter(size: 14))
                                .foregroundStyle(muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            NoteMarkdownView(text, fontSize: 15, ink: ink)
                        }
                    }
                    .frame(maxHeight: .infinity)
                }

                Text(nearLimit
                     ? "\(text.count.formatted()) / \(ThreadNote.bodyMax.formatted())"
                     : "Markdown supported")
                    .font(.inter(size: 11))
                    .foregroundStyle(tooLong ? AppTheme.deepDarkRed : muted)
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(paper.ignoresSafeArea())
            .navigationTitle(target.title)
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
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(target.submitLabel) { save() }
                            .font(.inter(size: 16, weight: .semibold))
                            .disabled(!canSave)
                            .keyboardShortcut(.return, modifiers: .command)
                    }
                }
            }
        }
        .tint(AppTheme.accent)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(paper)
        .interactiveDismissDisabled(isSaving)
    }

    private var privacyRow: some View {
        HStack(spacing: 5) {
            Image(systemName: target.isSticky ? "pin.fill" : "lock.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(target.isSticky ? AppTheme.Note.pin : muted)
            Text(target.isSticky ? "Note to self · Only visible to you" : "Private note to self · Only visible to you")
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(muted)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    private var formatBar: some View {
        HStack(spacing: 2) {
            ForEach(NoteFormat.allCases) { format in
                Button {
                    apply(format)
                } label: {
                    Image(systemName: format.systemImage)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ink)
                        .frame(width: 36, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(format.label)
                .modifier(FormatShortcut(format: format))
            }
        }
        .padding(2)
        .background(ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func apply(_ format: NoteFormat) {
        let edit = format.apply(to: text, selection: selection)
        text = edit.text
        selection = edit.selection
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func save() {
        guard canSave else { return }
        let body = trimmed
        isSaving = true
        Task {
            let saved: Bool
            switch target.kind {
            case .newSticky:
                saved = await app.createThreadNote(
                    threadKey: target.threadKey,
                    body: body,
                    noteType: ThreadNote.stickyType
                )
            case .newInline(let emailId):
                saved = await app.createThreadNote(
                    threadKey: target.threadKey,
                    body: body,
                    noteType: ThreadNote.inlineType,
                    emailId: emailId
                )
            case .edit(let note):
                saved = await app.updateThreadNoteBody(note, body: body)
            }
            isSaving = false
            if saved { dismiss() }
        }
    }
}

/// ⌘B / ⌘I / ⌘K on a hardware keyboard, like the web editor.
private struct FormatShortcut: ViewModifier {
    let format: NoteFormat

    func body(content: Content) -> some View {
        switch format {
        case .bold: content.keyboardShortcut("b", modifiers: .command)
        case .italic: content.keyboardShortcut("i", modifiers: .command)
        case .link: content.keyboardShortcut("k", modifiers: .command)
        default: content
        }
    }
}

/// Plain `UITextView` with a selection binding, so the format buttons can wrap the
/// selected text (SwiftUI `TextEditor` exposes no selection on iOS 17).
struct NoteTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    var textColor: UIColor
    var autoFocus = false

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = UIFont.inter(size: 15)
        view.textColor = textColor
        view.tintColor = AppTheme.uiAccent
        view.text = text
        view.selectedRange = selection
        view.autocorrectionType = .default
        view.autocapitalizationType = .sentences
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        view.accessibilityLabel = "Note (Markdown)"
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        if autoFocus {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        }
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        view.textColor = textColor
        if view.text != text {
            view.text = text
        }
        let length = (view.text as NSString).length
        let clamped = NSRange(
            location: min(selection.location, length),
            length: max(0, min(selection.length, length - min(selection.location, length)))
        )
        if view.selectedRange != clamped {
            view.selectedRange = clamped
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NoteTextView

        init(_ parent: NoteTextView) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            parent.selection = textView.selectedRange
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            if parent.selection != textView.selectedRange {
                parent.selection = textView.selectedRange
            }
        }
    }
}

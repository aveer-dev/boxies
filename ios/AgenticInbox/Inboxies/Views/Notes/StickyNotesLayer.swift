import SwiftUI
import UIKit

/// A note's markdown, compact and in the surrounding ink, so it reads on the
/// sticky's paper and on the inline card alike. Images show their alt text (no
/// remote loads), raw HTML stays text, and links only open web or mail URLs.
struct NoteMarkdownView: View {
    let markdown: String
    var fontSize: CGFloat = 13
    var ink: Color = AppTheme.ink

    init(_ markdown: String, fontSize: CGFloat = 13, ink: Color = AppTheme.ink) {
        self.markdown = markdown
        self.fontSize = fontSize
        self.ink = ink
    }

    var body: some View {
        MarkdownContentView(text: NoteText.renderable(markdown), fontSize: fontSize, ink: ink)
            .tint(ink)
            .environment(\.openURL, OpenURLAction { url in
                let scheme = url.scheme?.lowercased() ?? ""
                return ["http", "https", "mailto"].contains(scheme) ? .systemAction : .discarded
            })
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The reader's sticky notes (whole-conversation notes to self), floating over the
/// message area like paper pinned to it. Each can be dragged anywhere in the view
/// (clamped to its edges); where it's dropped is saved.
struct StickyNotesLayer: View {
    let notes: [ThreadNote]
    var onEdit: (ThreadNote) -> Void
    var onDelete: (ThreadNote) -> Void
    var onMove: (ThreadNote, CGPoint) -> Void

    @State private var front: String?

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in
                    StickyNoteView(
                        note: note,
                        index: index,
                        view: proxy.size,
                        onFocus: { front = note.id },
                        onEdit: { onEdit(note) },
                        onDelete: { onDelete(note) },
                        onMove: { onMove(note, $0) }
                    )
                    .zIndex(front == note.id ? 2 : 1)
                    .transition(.scale(scale: 0.92, anchor: .top).combined(with: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: notes.map(\.id))
    }
}

private struct StickyNoteSizeKey: PreferenceKey {
    static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

private struct StickyBodyHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct StickyNoteView: View {
    let note: ThreadNote
    let index: Int
    /// The message area the note lives in.
    let view: CGSize
    var onFocus: () -> Void
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onMove: (CGPoint) -> Void

    /// Tallest the body grows before it fades out (the editor shows all of it).
    private static let bodyMaxHeight: CGFloat = 220
    private static let spring = Animation.spring(response: 0.32, dampingFraction: 0.86)

    @State private var size = CGSize(width: StickyNoteLayout.width, height: 120)
    @State private var bodyHeight: CGFloat = 0
    @State private var collapsed = false
    /// Where the note sat when the current drag began.
    @State private var dragStart: CGPoint?
    /// Shown instead of the saved spot while dragging and until the save lands.
    @State private var livePosition: CGPoint?
    @State private var isDragging = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var noteWidth: CGFloat { StickyNoteLayout.noteWidth(in: view) }

    private var resting: CGPoint {
        StickyNoteLayout.position(saved: note.savedPosition, index: index, note: size, view: view)
    }

    private var position: CGPoint {
        livePosition.map { StickyNoteLayout.clamp($0, note: size, view: view) } ?? resting
    }

    var body: some View {
        paper
            .frame(width: noteWidth)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(key: StickyNoteSizeKey.self, value: proxy.size)
                }
            }
            .onPreferenceChange(StickyNoteSizeKey.self) { measured in
                if measured.width > 0, measured.height > 0 { size = measured }
            }
            .rotationEffect(.degrees(isDragging || reduceMotion ? 0 : AppTheme.Note.tilt))
            .scaleEffect(isDragging ? 1.03 : 1)
            .shadow(
                color: AppTheme.Note.shadow,
                radius: isDragging ? 18 : 9,
                x: 0,
                y: isDragging ? 12 : 4
            )
            .offset(x: position.x, y: position.y)
            .gesture(dragGesture)
            .onTapGesture(perform: onFocus)
            .onChange(of: note.savedPosition) { _, _ in
                // The model now holds the dropped spot (or put it back after a failed save).
                if dragStart == nil { livePosition = nil }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Sticky note to self")
            .accessibilityAction(named: "Move to top right") {
                onMove(StickyNoteLayout.position(saved: nil, index: 0, note: size, view: view))
            }
    }

    private var paperShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: AppTheme.Note.cornerRadius,
            bottomLeadingRadius: AppTheme.Note.cornerRadius,
            bottomTrailingRadius: AppTheme.Note.curlRadius,
            topTrailingRadius: AppTheme.Note.cornerRadius,
            style: .continuous
        )
    }

    private var paper: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Group {
                if collapsed {
                    Text(NoteText.preview(note.body))
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.Note.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        noteBody
                        footer
                    }
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
        .background(paperShape.fill(AppTheme.Note.paper))
        .overlay(paperShape.strokeBorder(AppTheme.Note.paperEdge, lineWidth: 0.5))
        .overlay(alignment: .top) { pin }
    }

    private var pin: some View {
        Image(systemName: "pin.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(AppTheme.Note.pin)
            .rotationEffect(.degrees(20))
            .shadow(color: .black.opacity(0.25), radius: 1, y: 1)
            .offset(y: -9)
            .accessibilityHidden(true)
    }

    private var header: some View {
        HStack(spacing: 0) {
            Text("Note to self")
                .font(.inter(size: 11, weight: .medium))
                .foregroundStyle(AppTheme.Note.muted)
                .lineLimit(1)
            Spacer(minLength: 4)
            headerButton(
                collapsed ? "chevron.down" : "chevron.up",
                label: collapsed ? "Expand note" : "Fold note"
            ) {
                withAnimation(Self.spring) { collapsed.toggle() }
            }
            headerButton("pencil", label: "Edit note") {
                collapsed = false
                onEdit()
            }
            headerButton("trash", label: "Delete note", action: onDelete)
        }
        .padding(.leading, 12)
        .padding(.trailing, 2)
        .padding(.top, 6)
    }

    private func headerButton(_ systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.Note.muted)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var noteBody: some View {
        let clipped = bodyHeight > Self.bodyMaxHeight
        return NoteMarkdownView(note.body, fontSize: 13, ink: AppTheme.Note.ink)
            .fixedSize(horizontal: false, vertical: true)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(key: StickyBodyHeightKey.self, value: proxy.size.height)
                }
            }
            .onPreferenceChange(StickyBodyHeightKey.self) { bodyHeight = $0 }
            .frame(maxHeight: clipped ? Self.bodyMaxHeight : nil, alignment: .top)
            .clipped()
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: clipped ? 0.8 : 1),
                        .init(color: .black.opacity(clipped ? 0 : 1), location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
    }

    private var footer: some View {
        // updatedAt also moves when the note is dragged, so show when it was written.
        HStack(spacing: 4) {
            Image(systemName: "lock.fill")
                .font(.system(size: 8, weight: .bold))
            Text("Only visible to you · \(NoteDates.short(note.createdAt))")
                .font(.inter(size: 10))
                .lineLimit(1)
        }
        .foregroundStyle(AppTheme.Note.muted)
        .accessibilityElement(children: .combine)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: StickyNoteLayout.dragThreshold, coordinateSpace: .global)
            .onChanged { value in
                if dragStart == nil {
                    dragStart = position
                    onFocus()
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    withAnimation(Self.spring) { isDragging = true }
                }
                guard let start = dragStart else { return }
                livePosition = StickyNoteLayout.clamp(
                    CGPoint(x: start.x + value.translation.width, y: start.y + value.translation.height),
                    note: size,
                    view: view
                )
            }
            .onEnded { value in
                guard let start = dragStart else { return }
                let end = StickyNoteLayout.dropPosition(
                    start: start,
                    translation: value.translation,
                    predicted: value.predictedEndTranslation,
                    note: size,
                    view: view
                )
                dragStart = nil
                withAnimation(Self.spring) {
                    livePosition = end
                    isDragging = false
                }
                if end != resting {
                    onMove(end)
                } else {
                    livePosition = nil
                }
            }
    }
}

/// Notes to self on one message, in line under it in the thread. Neutral card with
/// a dashed hairline and the private indicator. Only their author sees them.
struct InlineNotesView: View {
    let notes: [ThreadNote]
    var onEdit: (ThreadNote) -> Void
    var onDelete: (ThreadNote) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(notes) { note in
                InlineNoteCard(note: note, onEdit: { onEdit(note) }, onDelete: { onDelete(note) })
            }
        }
    }
}

/// "🔒 Private note to self · Only visible to you" (+ date when given).
struct PrivateNoteLabel: View {
    var date: String? = nil
    var edited = false

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "lock.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(AppTheme.muted)
            (Text("Private note to self")
                .font(.inter(size: 11, weight: .medium))
                .foregroundColor(AppTheme.ink)
             + Text(" · Only visible to you\(dateSuffix)")
                .font(.inter(size: 11))
                .foregroundColor(AppTheme.muted))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
    }

    private var dateSuffix: String {
        guard let date else { return "" }
        let formatted = NoteDates.short(date)
        guard !formatted.isEmpty else { return "" }
        return " · \(edited ? "Edited " : "")\(formatted)"
    }
}

private struct InlineNoteCard: View {
    let note: ThreadNote
    var onEdit: () -> Void
    var onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                PrivateNoteLabel(date: note.updatedAt, edited: note.updatedAt != note.createdAt)
                Spacer(minLength: 0)
                Menu {
                    Button(action: onEdit) {
                        Label("Edit Note", systemImage: "pencil")
                    }
                    Button(role: .destructive, action: onDelete) {
                        Label("Delete Note", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.inter(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 28, height: 24)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Note options")
            }
            NoteMarkdownView(note.body, fontSize: 13)
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(
            AppTheme.pillFill.opacity(0.45),
            in: RoundedRectangle(cornerRadius: AppTheme.Note.inlineCornerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.Note.inlineCornerRadius, style: .continuous)
                .strokeBorder(AppTheme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
        .contextMenu {
            Button(action: onEdit) {
                Label("Edit Note", systemImage: "pencil")
            }
            Button(role: .destructive, action: onDelete) {
                Label("Delete Note", systemImage: "trash")
            }
        }
    }
}

/// The list row's sticky strip: the note's text on warm paper, clamped to two lines.
struct StickyNoteRowStrip: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "pin.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(AppTheme.Note.pin)
                .rotationEffect(.degrees(20))
                .padding(.top, 2)
            Text(text)
                .font(.inter(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.Note.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(stripShape.fill(AppTheme.Note.paper))
        .overlay(stripShape.strokeBorder(AppTheme.Note.paperEdge, lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Note to self: \(text)")
    }

    private var stripShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 8,
            bottomLeadingRadius: 8,
            bottomTrailingRadius: 11,
            topTrailingRadius: 8,
            style: .continuous
        )
    }
}

/// "🔒 N private notes" chip on a list row (notes on single messages).
struct PrivateNotesChip: View {
    let count: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "lock.fill")
                .font(.system(size: 8, weight: .bold))
            Text("\(count) private note\(count == 1 ? "" : "s")")
                .font(.inter(size: AppTheme.List.badge, weight: .medium))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(AppTheme.pillFill)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .foregroundStyle(AppTheme.muted)
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }
}

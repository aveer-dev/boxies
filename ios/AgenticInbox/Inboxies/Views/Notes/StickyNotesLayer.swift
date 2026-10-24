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
    /// Lifted: picked up and following the finger.
    @State private var isDragging = false
    /// Lean from the finger's horizontal speed while lifted (degrees).
    @State private var dragTilt: Double = 0
    /// Eases `dragTilt` back to level once the finger stops moving.
    @State private var tiltSettle: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var noteWidth: CGFloat { StickyNoteLayout.noteWidth(in: view) }

    private var resting: CGPoint {
        StickyNoteLayout.position(saved: note.savedPosition, index: index, note: size, view: view)
    }

    private var position: CGPoint {
        livePosition.map { StickyNoteLayout.clamp($0, note: size, view: view) } ?? resting
    }

    /// Lifted: the speed lean (level under Reduce Motion). Resting: the paper's tilt.
    private var rotation: Double {
        if reduceMotion { return 0 }
        return isDragging ? dragTilt : AppTheme.Note.tilt
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
            .rotationEffect(.degrees(rotation))
            .scaleEffect(isDragging ? AppTheme.Note.liftScale : 1)
            .shadow(
                color: isDragging ? AppTheme.Note.shadowLifted : AppTheme.Note.shadow,
                radius: isDragging ? AppTheme.Note.liftedShadowRadius : AppTheme.Note.restingShadowRadius,
                x: 0,
                y: isDragging ? AppTheme.Note.liftedShadowY : AppTheme.Note.restingShadowY
            )
            .offset(x: position.x, y: position.y)
            .gesture(dragGesture)
            .onTapGesture(perform: onFocus)
            .onChange(of: note.savedPosition) { _, _ in
                // The model now holds the dropped spot (or put it back after a failed save).
                if dragStart == nil { livePosition = nil }
            }
            .onDisappear { tiltSettle?.cancel() }
            #if DEBUG
            // Steps arrive through the live view (not a captured copy), so they see the
            // current size, spot and saved position.
            .onReceive(NotificationCenter.default.publisher(for: PreviewSupport.scriptedDragNotification)) { note in
                guard index == 0, let step = note.object as? PreviewSupport.ScriptedDragStep else { return }
                scriptedDrag(step)
            }
            .task { await PreviewSupport.runScriptedStickyThrow(index: index) }
            #endif
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
        .overlay(paperShape.strokeBorder(AppTheme.Note.paperEdge, lineWidth: 1))
        // Dark mode: a faint mint ring so the paper's edge holds against the black shadow.
        .overlay(paperShape.strokeBorder(AppTheme.Note.ring, lineWidth: 1).padding(-1))
        .overlay(alignment: .top) { pin }
    }

    private var pin: some View {
        Image(systemName: "pin.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(AppTheme.Note.pin)
            .rotationEffect(.degrees(20))
            .shadow(color: AppTheme.Note.shadowLifted, radius: 1, y: 1)
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
                if dragStart == nil { pickUp() }
                follow(translation: value.translation, velocity: value.velocity)
            }
            .onEnded { value in
                release(translation: value.translation, velocity: value.velocity)
            }
    }

    /// Pick up: lift (scale + deeper shadow), level the resting tilt, light haptic.
    private func pickUp() {
        dragStart = position
        onFocus()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(reduceMotion ? AppTheme.Note.reducedSettle : AppTheme.Note.liftSpring) {
            isDragging = true
            dragTilt = 0
        }
    }

    /// Follow the finger 1:1, leaning with its horizontal speed.
    private func follow(translation: CGSize, velocity: CGSize) {
        guard let start = dragStart else { return }
        var still = Transaction()
        still.disablesAnimations = true
        withTransaction(still) {
            livePosition = StickyNoteLayout.clamp(
                CGPoint(x: start.x + translation.width, y: start.y + translation.height),
                note: size,
                view: view
            )
        }
        guard !reduceMotion else { return }
        withAnimation(AppTheme.Note.tiltSpring) {
            dragTilt = StickyNoteLayout.tilt(forVelocityX: velocity.width)
        }
        // No new touch events once the finger stops, so ease the lean back after a beat.
        tiltSettle?.cancel()
        tiltSettle = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled else { return }
            withAnimation(AppTheme.Note.tiltSpring) { dragTilt = 0 }
        }
    }

    /// Let go: carry the throw a short way, clamp, settle on a slightly underdamped
    /// spring launched at the release speed; scale, shadow and resting tilt return.
    private func release(translation: CGSize, velocity: CGSize) {
        guard let start = dragStart else { return }
        tiltSettle?.cancel()
        let letGo = StickyNoteLayout.clamp(
            CGPoint(x: start.x + translation.width, y: start.y + translation.height),
            note: size,
            view: view
        )
        let end = StickyNoteLayout.throwTarget(
            release: letGo,
            velocity: reduceMotion ? .zero : velocity,
            note: size,
            view: view
        )
        dragStart = nil
        let settle: Animation = reduceMotion
            ? AppTheme.Note.reducedSettle
            : .interpolatingSpring(
                AppTheme.Note.settle,
                initialVelocity: StickyNoteLayout.settleVelocity(from: letGo, to: end, velocity: velocity)
            )
        withAnimation(settle) {
            livePosition = end
            isDragging = false
            dragTilt = 0
        }
        if end != resting {
            onMove(end)
        } else {
            livePosition = nil
        }
    }

    #if DEBUG
    /// Drives the same pick-up / follow / release path as a finger, for the
    /// `-previewNotesThrow` recording (see `PreviewSupport.runScriptedStickyThrow`).
    private func scriptedDrag(_ step: PreviewSupport.ScriptedDragStep) {
        switch step {
        case .pickUp:
            pickUp()
            PreviewSupport.scriptedStart = position
            PreviewSupport.scriptedView = view
        case let .move(translation, velocity):
            follow(translation: translation, velocity: velocity)
        case let .release(translation, velocity):
            release(translation: translation, velocity: velocity)
        }
    }
    #endif
}

/// Notes to self on one message, in line under it in the thread: on the same mint
/// note paper as the sticky (paper fill, solid paper-edge border, note ink), so they
/// read as the user's own and never as mail. Only their author sees them.
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
                .foregroundStyle(AppTheme.Note.pin)
            (Text("Private note to self")
                .font(.inter(size: 11, weight: .medium))
                .foregroundColor(AppTheme.Note.muted)
             + Text(" · Only visible to you\(dateSuffix)")
                .font(.inter(size: 11))
                .foregroundColor(AppTheme.Note.muted))
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
                        .foregroundStyle(AppTheme.Note.muted)
                        .frame(width: 28, height: 24)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Note options")
            }
            NoteMarkdownView(note.body, fontSize: 13, ink: AppTheme.Note.ink)
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(
            AppTheme.Note.paper,
            in: RoundedRectangle(cornerRadius: AppTheme.Note.inlineCornerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: AppTheme.Note.inlineCornerRadius, style: .continuous)
                .strokeBorder(AppTheme.Note.paperEdge, lineWidth: 1)
        )
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: AppTheme.Note.inlineCornerRadius, style: .continuous))
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

/// The list row's sticky strip: the note's text on the mint note paper, clamped to two lines.
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
        .overlay(stripShape.strokeBorder(AppTheme.Note.paperEdge, lineWidth: 1))
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

/// "🔒 N private notes" chip on a list row (notes on single messages), on note paper.
struct PrivateNotesChip: View {
    let count: Int

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "lock.fill")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(AppTheme.Note.pin)
            Text("\(count) private note\(count == 1 ? "" : "s")")
                .font(.inter(size: AppTheme.List.badge, weight: .medium))
                .foregroundStyle(AppTheme.Note.muted)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(chipShape.fill(AppTheme.Note.paper))
        .overlay(chipShape.strokeBorder(AppTheme.Note.paperEdge, lineWidth: 1))
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }

    private var chipShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
    }
}

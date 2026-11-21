import SwiftUI

/// Letter timing in ms, shared with web `MorphText` and Android `MorphingTitle`. Each letter fades
/// over `exit`/`enter`; neighbours start `step` apart, capped at `spread` for the whole string so
/// long titles take no longer. The new text trails the old by `lag`.
private enum MorphTiming {
    static let exit = 140.0
    static let enter = 180.0
    static let lag = 40.0
    static let maxStep = 4.0
    static let spread = 140.0
    /// Longest a morph can run.
    static let total = lag + enter + spread
    static let blur: CGFloat = 4
    static let shift: CGFloat = 3
    static let easeOut = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.23, y: 1), endControlPoint: UnitPoint(x: 0.32, y: 1))
    static let easeIn = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.4, y: 0), endControlPoint: UnitPoint(x: 1, y: 1))

    static func step(_ count: Int) -> Double {
        min(maxStep, spread / Double(max(count, 1)))
    }

    static func enter(_ index: Int, of count: Int, at ms: Double) -> Double {
        easeOut.value(at: ((ms - lag - Double(index) * step(count)) / enter).clamped)
    }

    static func exit(_ index: Int, of count: Int, at ms: Double) -> Double {
        1 - easeIn.value(at: ((ms - Double(index) * step(count)) / exit).clamped)
    }
}

private extension Double {
    var clamped: Double { Swift.min(Swift.max(self, 0), 1) }
}

/// What a `MorphingTitle` last showed, kept by the screen around it so the next instance (the
/// email detail rebuilds per email) can morph from it. Not observed: nothing redraws on it.
final class MorphingTitleMemory {
    fileprivate var shown: String?
    fileprivate var morphStart: Date?
}

/// Title text that changes letter by letter: the old letters blur out and the new ones sharpen
/// in, left to right, in about 300 ms. iOS 18+ draws each glyph from the real text layout, so
/// kerning and line breaks match the plain text; iOS 17 fades the whole title with the same blur.
/// Reduce Motion just swaps.
struct MorphingTitle: View {
    let text: String
    let font: Font
    let memory: MorphingTitleMemory?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var leaving: String?
    /// How far the leaving text's own entrance had got when it was cut short (ms), if it was.
    @State private var leavingCutAt: Double?
    /// Milliseconds into the morph; `MorphTiming.total` at rest.
    @State private var elapsed: Double
    @State private var morphStart: Date?

    init(
        text: String,
        font: Font = .inter(size: AppTheme.FontSize.largeTitle, weight: .bold),
        memory: MorphingTitleMemory? = nil
    ) {
        self.text = text
        self.font = font
        self.memory = memory
        // A new instance after another title: start the morph from it on the first frame.
        if let from = memory?.shown, from != text {
            _leaving = State(initialValue: from)
            _leavingCutAt = State(initialValue: memory?.morphStart.flatMap { Self.cutAt($0) })
            _elapsed = State(initialValue: 0)
        } else {
            _elapsed = State(initialValue: MorphTiming.total)
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            letters(text, leaving: false, cutAt: nil)
            if let leaving {
                letters(leaving, leaving: true, cutAt: leavingCutAt)
                    .accessibilityHidden(true)
            }
        }
        .onAppear {
            memory?.shown = text
            if leaving != nil { play() }
        }
        .onChange(of: text) { old, new in
            memory?.shown = new
            leavingCutAt = morphStart.flatMap { Self.cutAt($0) }
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                leaving = old
                elapsed = 0
            }
            DispatchQueue.main.async { play() }
        }
    }

    private static func cutAt(_ start: Date) -> Double? {
        let ms = Date().timeIntervalSince(start) * 1000
        return ms < MorphTiming.total ? ms : nil
    }

    private func play() {
        guard !reduceMotion else {
            elapsed = MorphTiming.total
            leaving = nil
            return
        }
        let start = Date()
        morphStart = start
        memory?.morphStart = start
        withAnimation(.linear(duration: MorphTiming.total / 1000)) {
            elapsed = MorphTiming.total
        } completion: {
            guard morphStart == start else { return }
            morphStart = nil
            memory?.morphStart = nil
            // A title that lost a line eases to its new height.
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) { leaving = nil }
        }
    }

    @ViewBuilder
    private func letters(_ string: String, leaving: Bool, cutAt: Double?) -> some View {
        let base = Text(string)
            .font(font)
            .foregroundStyle(AppTheme.ink)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        if #available(iOS 18.0, *) {
            base.textRenderer(MorphRenderer(elapsed: elapsed, leaving: leaving, cutAt: cutAt))
        } else {
            // The whole title as one letter.
            let v = leaving
                ? MorphTiming.exit(0, of: 1, at: elapsed) * (cutAt.map { MorphTiming.enter(0, of: 1, at: $0) } ?? 1)
                : MorphTiming.enter(0, of: 1, at: elapsed)
            base
                .opacity(v)
                .blur(radius: (1 - v) * MorphTiming.blur)
                .offset(y: (1 - v) * MorphTiming.shift * (leaving ? -1 : 1))
        }
    }
}

/// Draws each glyph where the text laid it out, faded, blurred and nudged by its own timing.
@available(iOS 18.0, *)
private struct MorphRenderer: TextRenderer {
    var elapsed: Double
    var leaving: Bool
    var cutAt: Double?

    var animatableData: Double {
        get { elapsed }
        set { elapsed = newValue }
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        let glyphs = layout.flatMap { line in line.flatMap { run in run } }
        for (index, glyph) in glyphs.enumerated() {
            var v = leaving
                ? MorphTiming.exit(index, of: glyphs.count, at: elapsed)
                : MorphTiming.enter(index, of: glyphs.count, at: elapsed)
            // Cut short: it leaves from where its entrance got to.
            if leaving, let cutAt { v *= MorphTiming.enter(index, of: glyphs.count, at: cutAt) }
            guard v > 0.001 else { continue }
            var copy = context
            copy.opacity = v
            if v < 0.999 { copy.addFilter(.blur(radius: (1 - v) * MorphTiming.blur)) }
            copy.translateBy(x: 0, y: (1 - v) * MorphTiming.shift * (leaving ? -1 : 1))
            copy.draw(glyph)
        }
    }
}

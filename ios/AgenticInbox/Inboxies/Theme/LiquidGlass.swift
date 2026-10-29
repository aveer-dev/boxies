import SwiftUI

/// Shared Liquid Glass styling (iOS 26+) with material fallback for earlier releases.
enum HomeChromeMetrics {
    static let actionBarHeight: CGFloat = 52
    static let chromeHorizontalPadding: CGFloat = 12
    static let chromeSpacing: CGFloat = 0
    static let chromeBottomPadding: CGFloat = 0
    static let chromeCornerRadius: CGFloat = 50
    static let tabLabelPointSize: CGFloat = 10
    static let minimizedComposeHeight: CGFloat = 66
    static let minimizedComposeGap: CGFloat = 0

    /// Compose stack: same-size discs, bottom-aligned, back layers lift upward so
    /// only top crescents peek (Figma). Depth 0 = front. Peek ≈ 6% of diameter
    /// from the spaced reference (10px / 164px); 6pt on a 52pt control (readable on light chrome; Figma teaching spacing).
    static let composeStackLayerCount = 3
    static let composeStackPeekOffset: CGFloat = 3
    /// Same radius per layer — depth comes from Y offset + darker fill, not scale.
    static let composeStackScales: [CGFloat] = [1.0, 1.0, 1.0]
    /// Press feedback: the stack squishes on touch-down and pops back with a bounce on release.
    /// The glyph shrinks a little further than the discs so it overshoots on its own.
    static let composeStackPressedScale: CGFloat = 0.88
    static let composeStackPressedIconScale: CGFloat = 0.84
    /// Peeks compress while pressed so the stack squashes, then spring back up.
    static let composeStackPressedPeekRatio: CGFloat = 0.4

    /// Short long-press opens compose (menu opens on tap, instantly).
    static let composeLongPressDuration: TimeInterval = 0.18
    static let composeDoubleTapWindow: TimeInterval = 0.28

    static func composeStackScale(depth: Int) -> CGFloat {
        let scales = composeStackScales
        let index = min(max(depth, 0), scales.count - 1)
        return scales[index]
    }

    /// Front disc + visible top peeks.
    static func composeStackHeight(frontSize: CGFloat = actionBarHeight) -> CGFloat {
        frontSize + composeStackPeekOffset * CGFloat(composeStackLayerCount - 1)
    }

    static func listBottomInset(hasMinimizedCompose: Bool) -> CGFloat {
        var height = actionBarHeight + chromeBottomPadding
        if hasMinimizedCompose {
            height += minimizedComposeHeight
        }
        return height
    }

    // MARK: Regular width (iPad) two-pane

    /// List column share of the window in the two-pane layout, clamped so rows keep
    /// their phone proportions and the reading pane gets the rest.
    static let listColumnFraction: CGFloat = 0.38
    static let listColumnMinWidth: CGFloat = 320
    static let listColumnMaxWidth: CGFloat = 420

    static func listColumnWidth(for totalWidth: CGFloat) -> CGFloat {
        min(max(totalWidth * listColumnFraction, listColumnMinWidth), listColumnMaxWidth)
    }

    // MARK: Wide regular width (large iPad landscape) three-column

    /// Window width from which the leading folder column fits beside the list and the
    /// reading pane (AVE-73). 1180pt is an 11-inch iPad in landscape; 13-inch iPads
    /// (1366pt) clear it too, while portrait and Split View halves stay two-pane.
    /// Android uses the same number in dp.
    static let threeColumnMinWidth: CGFloat = 1180
    /// Fixed width of the folder column (web Miller "Folders" column).
    static let folderColumnWidth: CGFloat = 240
    static let folderRowHeight: CGFloat = 38
    static let folderRowCornerRadius: CGFloat = 10
    /// UIKit's regular-width bar margin, restored on the list column when it no longer
    /// touches the window edge.
    static let listColumnNavigationBarMargin: CGFloat = 20
}

/// Toast metrics (AVE-134): body-size type, a 52pt pill like the bottom bar, capped
/// width on iPad, lifted clear of the bar. Android twin: `ToastMetrics` in HomeChrome.kt.
enum ToastMetrics {
    static let minHeight: CGFloat = HomeChromeMetrics.actionBarHeight
    static let cornerRadius: CGFloat = HomeChromeMetrics.actionBarHeight / 2
    static let maxWidth: CGFloat = 440
    static let fontSize: CGFloat = 15
    static let iconSize: CGFloat = 18
    static let contentSpacing: CGFloat = 10
    static let horizontalPadding: CGFloat = 18
    static let verticalPadding: CGFloat = 12
    static let actionHeight: CGFloat = 36
    static let actionHorizontalPadding: CGFloat = 14
    static let actionTrailingPadding: CGFloat = 8
    /// Side inset from the screen edge.
    static let screenInset: CGFloat = 16
    /// Gap between the toast and the floating bottom bar / composer below it.
    static let barGap: CGFloat = 12
    /// Bottom inset when nothing sits under the toast (sheets, sign-in).
    static let standaloneBottomInset: CGFloat = 24
    static let dismissDistance: CGFloat = 36
    static let animation: Animation = .spring(response: 0.32, dampingFraction: 0.86)
}

extension View {
    @ViewBuilder
    func liquidGlass<S: Shape>(in shape: S) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: shape)
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.stroke(Color.white.opacity(0.45), lineWidth: 0.5)
                }
                .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
        }
    }

    @ViewBuilder
    func liquidGlassContainer(spacing: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { self }
        } else {
            self
        }
    }
}

struct ProgressiveBlurBackground: View {
    var body: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .ignoresSafeArea(edges: .top)
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0.6),
                        .init(color: .clear, location: 1)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .allowsHitTesting(false)
    }
}

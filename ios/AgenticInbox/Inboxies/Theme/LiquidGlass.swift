import SwiftUI

/// Shared Liquid Glass styling (iOS 26+) with material fallback for earlier releases.
enum HomeChromeMetrics {
    static let actionBarHeight: CGFloat = 52
    static let chromeHorizontalPadding: CGFloat = 12
    static let chromeSpacing: CGFloat = 10
    static let chromeBottomPadding: CGFloat = 20
    static let chromeCornerRadius: CGFloat = 50
    static let tabLabelPointSize: CGFloat = 10
    static let minimizedComposeHeight: CGFloat = 66

    /// Visible back-layer peeks on the compose stack control (design twin of Android).
    /// Depth 0 = front; higher depth = smaller + darker.
    static let composeStackLayerCount = 3
    static let composeStackPeekOffset: CGFloat = 5
    /// Progressive scales: front 1.0, mid, back (clearly stepped).
    static let composeStackScales: [CGFloat] = [1.0, 0.72, 0.50]

    /// Short long-press opens compose (menu opens on tap, instantly).
    static let composeLongPressDuration: TimeInterval = 0.18
    static let composeDoubleTapWindow: TimeInterval = 0.28

    static func composeStackScale(depth: Int) -> CGFloat {
        let scales = composeStackScales
        let index = min(max(depth, 0), scales.count - 1)
        return scales[index]
    }

    /// Total height of the compose stack control (front + visible peeks).
    static func composeStackHeight(frontSize: CGFloat = actionBarHeight) -> CGFloat {
        let smallest = composeStackScale(depth: composeStackLayerCount - 1)
        return frontSize + composeStackPeekOffset * CGFloat(composeStackLayerCount - 1) +
            frontSize * (1 - smallest)
    }

    static func listBottomInset(hasMinimizedCompose: Bool) -> CGFloat {
        var height = actionBarHeight + chromeBottomPadding
        if hasMinimizedCompose {
            height += minimizedComposeHeight
        }
        return height
    }
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

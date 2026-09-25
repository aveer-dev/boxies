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

    /// Concentric compose stack (design twin of Android). Depth 0 = front face.
    /// Scales are fractions of the outer envelope: front is the largest *face*
    /// (innermost disc); each layer behind is a slightly larger disc so only a
    /// thin darker annulus shows — nested rings, shared center, no Y-offset peeks.
    /// White face ~88% of outer diameter; equal ~3% steps read as thin nested rings
    /// on light chrome while staying Figma-close (illustration ~90–95%, export was near-solid).
    static let composeStackLayerCount = 3
    static let composeStackScales: [CGFloat] = [0.88, 0.94, 1.0]

    /// Short long-press opens compose (menu opens on tap, instantly).
    static let composeLongPressDuration: TimeInterval = 0.18
    static let composeDoubleTapWindow: TimeInterval = 0.28

    static func composeStackScale(depth: Int) -> CGFloat {
        let scales = composeStackScales
        let index = min(max(depth, 0), scales.count - 1)
        return scales[index]
    }

    /// Outer envelope of the concentric stack (matches `actionBarHeight` by default).
    static func composeStackHeight(frontSize: CGFloat = actionBarHeight) -> CGFloat {
        frontSize
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

import SwiftUI

/// App splash screen displaying only the app logo.
struct SplashScreenView: View {
    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            InboxiesLogo()
                .frame(width: 72, height: 72)
                .foregroundStyle(AppTheme.ink)
        }
    }
}

/// The official Inboxies app logo / icon component.
/// Renders the Notion-inspired squircle card tile (22% continuous corners) with the paper plane.
struct AppLogoView: View {
    var size: CGFloat = 64
    var showTile: Bool = true

    var body: some View {
        if showTile {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                    .fill(AppTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                            .stroke(AppTheme.line.opacity(0.8), lineWidth: 1)
                    )
                    .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 3)

                InboxiesLogo()
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: size * 0.60, height: size * 0.60)
            }
            .frame(width: size, height: size)
        } else {
            InboxiesLogo()
                .foregroundStyle(AppTheme.ink)
                .frame(width: size, height: size)
        }
    }
}

/// Private Email product logo: the simplified paper plane with a half-filled shield badge
/// at the bottom right. One colour (`AppTheme.ink`), so it follows the in-app theme.
struct PrivateEmailLogoView: View {
    var size: CGFloat = 24
    var showTile: Bool = false
    /// Forces the light palette (e.g. on a fixed white surface).
    var alwaysLight: Bool = false

    var body: some View {
        Group {
            if showTile {
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                        .fill(AppTheme.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                                .stroke(AppTheme.line.opacity(0.8), lineWidth: 1)
                        )
                        .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 3)

                    PrivateEmailMarkShape()
                        .fill(AppTheme.ink)
                        .frame(width: size * 0.8, height: size * 0.8)
                }
                .frame(width: size, height: size)
            } else {
                PrivateEmailMarkShape()
                    .fill(AppTheme.ink)
                    .frame(width: size, height: size)
            }
        }
        .environment(\.colorScheme, alwaysLight ? .light : colorScheme)
        .accessibilityLabel("Private Email Logo")
    }

    @Environment(\.colorScheme) private var colorScheme
}

/// Vector paper plane logo for Inboxies. Fills with the current foreground style.
struct InboxiesLogo: View {
    var body: some View {
        InboxiesLogoShape()
            .fill()
    }
}

/// Logo geometry. Mirrors `scripts/generate-logo-assets.mjs` (MASTER / SMALL / PRIVATE);
/// keep them in sync. Lines are stroked with round caps and joins, then outlined so the
/// mark can be filled like any other shape.
enum InboxiesMark {
    struct Geometry {
        let grid: CGFloat
        let stroke: CGFloat
        /// Polylines; the first is the closed silhouette.
        let lines: [[CGPoint]]
        /// Filled shadow polygon under the keel.
        let shadow: [CGPoint]
    }

    private static func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

    /// 512-unit master with every fold. Used above 32 pt.
    static let master = Geometry(
        grid: 512,
        stroke: 10,
        lines: [
            [p(406, 114), p(106, 224), p(158, 284), p(182, 396), p(232, 354), p(294, 398), p(406, 114)],
            [p(106, 224), p(248, 228), p(406, 114)],
            [p(406, 114), p(206, 316), p(182, 396)],
            [p(406, 114), p(274, 254), p(294, 398)],
        ],
        shadow: [p(206, 316), p(270, 364), p(266, 377), p(232, 354), p(182, 396)]
    )

    /// 32-unit simplified mark with heavier strokes. Used at 32 pt and below.
    static let small = Geometry(
        grid: 32,
        stroke: 2,
        lines: [
            [p(26, 6), p(5, 14), p(9, 18), p(11, 26), p(15, 23), p(19, 26), p(26, 6)],
            [p(26, 6), p(13, 20), p(11, 26)],
        ],
        shadow: [p(13, 20), p(17, 24), p(15, 23), p(11, 26)]
    )

    /// The small plane at 85%, tucked top-left for the Private Email badge (32 grid).
    static let privatePlane = Geometry(
        grid: 32,
        stroke: 2,
        lines: [
            [p(21.2, 3.7), p(3.35, 10.5), p(6.75, 13.9), p(8.45, 20.7), p(11.85, 18.15), p(15.25, 20.7), p(21.2, 3.7)],
            [p(21.2, 3.7), p(10.15, 15.6), p(8.45, 20.7)],
        ],
        shadow: [p(10.15, 15.6), p(13.55, 19), p(11.85, 18.15), p(8.45, 20.7)]
    )

    static func transform(grid: CGFloat, in rect: CGRect) -> CGAffineTransform {
        let scale = min(rect.width, rect.height) / grid
        let dx = rect.minX + (rect.width - grid * scale) / 2
        let dy = rect.minY + (rect.height - grid * scale) / 2
        return CGAffineTransform(translationX: dx, y: dy).scaledBy(x: scale, y: scale)
    }

    static func polygon(_ points: [CGPoint]) -> CGMutablePath {
        let path = CGMutablePath()
        path.addLines(between: points)
        path.closeSubpath()
        return path
    }

    /// Outlined (fillable) path for a geometry, in grid units.
    static func outlined(_ g: Geometry) -> CGPath {
        let lines = CGMutablePath()
        for line in g.lines { lines.addLines(between: line) }
        let stroke = { (path: CGPath, width: CGFloat) in
            path.copy(strokingWithWidth: width, lineCap: .round, lineJoin: .round, miterLimit: 10)
        }
        let shadow = polygon(g.shadow)
        return stroke(lines, g.stroke)
            .union(stroke(shadow, g.stroke))
            .union(shadow)
    }

    static let masterPath = outlined(master)
    static let smallPath = outlined(small)

    /// Private Email mark: small plane + shield whose right half is filled.
    static let privatePath: CGPath = {
        let shield = CGMutablePath()
        shield.move(to: p(24.1, 16.1))
        shield.addLine(to: p(28.6, 17.85))
        shield.addLine(to: p(28.6, 22.1))
        shield.addCurve(to: p(24.1, 28.35), control1: p(28.6, 25.1), control2: p(26.6, 27.2))
        shield.addCurve(to: p(19.6, 22.1), control1: p(21.6, 27.2), control2: p(19.6, 25.1))
        shield.addLine(to: p(19.6, 17.85))
        shield.closeSubpath()

        let half = CGMutablePath()
        half.move(to: p(24.1, 16.1))
        half.addLine(to: p(28.6, 17.85))
        half.addLine(to: p(28.6, 22.1))
        half.addCurve(to: p(24.1, 28.35), control1: p(28.6, 25.1), control2: p(26.6, 27.2))
        half.closeSubpath()

        let shieldOutline = shield.copy(strokingWithWidth: 1.5, lineCap: .round, lineJoin: .round, miterLimit: 10)
        return outlined(privatePlane).union(shieldOutline).union(half)
    }()
}

/// The paper plane, picking the simplified mark at 32 pt and below.
struct InboxiesLogoShape: Shape {
    func path(in rect: CGRect) -> Path {
        let useSmall = min(rect.width, rect.height) <= 32
        let base = useSmall ? InboxiesMark.smallPath : InboxiesMark.masterPath
        var t = InboxiesMark.transform(grid: useSmall ? 32 : 512, in: rect)
        return Path(base.copy(using: &t) ?? base)
    }
}

/// The Private Email mark (32 grid), scaled into the rect.
struct PrivateEmailMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        var t = InboxiesMark.transform(grid: 32, in: rect)
        return Path(InboxiesMark.privatePath.copy(using: &t) ?? InboxiesMark.privatePath)
    }
}

#Preview("Splash Screen - Light") {
    SplashScreenView()
        .preferredColorScheme(.light)
}

#Preview("Splash Screen - Dark") {
    SplashScreenView()
        .preferredColorScheme(.dark)
}

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

/// Private Email product logo: the concept chosen by `PRIVATE_EMAIL_CONCEPT` in
/// `scripts/generate-logo-assets.mjs` (`design/logo/private-email-concepts/`). One colour (`AppTheme.ink`), so it follows
/// the in-app theme. Artwork: `PrivateEmailMark` (generated vector template image).
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

                    mark.frame(width: size * 0.8, height: size * 0.8)
                }
                .frame(width: size, height: size)
            } else {
                mark.frame(width: size, height: size)
            }
        }
        .environment(\.colorScheme, alwaysLight ? .light : colorScheme)
        .accessibilityLabel("Private Email Logo")
    }

    private var mark: some View {
        Image("PrivateEmailMark")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(AppTheme.ink)
    }

    @Environment(\.colorScheme) private var colorScheme
}

/// The Inboxies paper plane, tinted with the current foreground style.
///
/// Every logo asset is derived from `design/logo/inboxies-mark.svg` by
/// `scripts/generate-logo-assets.mjs`; this view only picks the stroke weight for its size:
/// `InboxiesMark` (in-app weight) above 32 pt, `InboxiesMarkSmall` (heavier strokes,
/// fewer folds) at 32 pt and below. Both keep the master's padding, so swapping is seamless.
struct InboxiesLogo: View {
    var body: some View {
        GeometryReader { proxy in
            let small = min(proxy.size.width, proxy.size.height) <= 32
            Image(small ? "InboxiesMarkSmall" : "InboxiesMark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
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

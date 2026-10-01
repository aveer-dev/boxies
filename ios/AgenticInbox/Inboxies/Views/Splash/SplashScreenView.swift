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
/// Renders the Notion-inspired squircle card tile with the faceted origami paper plane.
struct AppLogoView: View {
    var size: CGFloat = 64
    var showTile: Bool = true

    var body: some View {
        if showTile {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
                    .fill(AppTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
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

/// Vector origami paper plane logo for Inboxies.
struct InboxiesLogo: View {
    var body: some View {
        InboxiesLogoShape()
            .fill(style: FillStyle(eoFill: true))
    }
}

/// Shape representing the faceted paper plane icon (512x512 normalized coordinate space).
struct InboxiesLogoShape: Shape {
    static let baseCGPath: CGPath = {
        let d = "M 384.7,107.2 L 398.9,109.1 L 409.2,117.2 L 413.5,128.5 L 412.1,141.7 L 308.2,391.1 L 303.0,400.0 L 294.0,404.8 L 288.8,404.8 L 281.7,401.9 L 228.4,357.5 L 195.3,399.6 L 187.8,403.3 L 177.4,400.5 L 172.2,393.0 L 154.2,289.1 L 102.3,238.1 L 98.5,230.5 L 99.0,221.5 L 104.6,213.5 L 112.7,209.7 L 371.9,111.0 L 384.2,107.7 Z M 404.5,115.7 L 400.7,112.4 L 393.2,109.6 L 380.9,110.1 L 106.5,214.9 L 101.3,221.5 L 101.3,225.8 L 124.9,228.1 L 396.5,122.3 L 404.1,116.2 Z M 407.8,119.5 L 406.4,117.6 L 405.0,118.1 L 397.0,128.0 L 290.7,375.5 L 294.5,401.9 L 299.7,400.0 L 304.9,393.4 L 409.2,143.1 L 411.1,137.0 L 411.1,127.1 L 408.3,120.0 Z M 387.1,129.0 L 388.0,128.5 L 386.6,128.0 L 130.6,227.2 L 244.4,228.1 L 386.6,129.4 Z M 393.2,132.3 L 386.1,137.9 L 272.8,257.9 L 290.2,372.2 L 392.7,132.7 Z M 385.6,133.7 L 385.2,132.7 L 378.6,137.0 L 247.3,228.1 L 245.8,230.0 L 248.2,242.8 L 244.9,231.4 L 240.7,229.6 L 126.8,231.0 L 176.4,274.9 L 177.8,273.9 L 176.9,275.4 L 180.7,300.9 L 184.0,357.5 L 184.0,354.7 L 182.6,354.2 L 176.0,278.2 L 158.5,288.6 L 159.9,285.8 L 174.1,276.8 L 174.1,275.4 L 124.0,230.5 L 100.9,227.7 L 103.2,235.7 L 150.9,281.5 L 156.1,288.1 L 174.1,391.5 L 179.3,399.1 L 183.0,401.0 L 184.0,400.0 L 199.6,332.0 L 214.2,316.9 L 223.2,319.8 L 259.5,354.2 L 278.0,368.9 L 287.9,374.1 L 270.4,259.8 L 230.7,301.8 L 218.0,312.7 L 269.9,257.4 L 269.5,246.6 L 201.0,313.1 L 196.3,321.6 L 193.4,335.8 L 192.5,334.4 L 191.5,349.5 L 191.1,348.1 L 190.1,350.0 L 190.6,343.4 L 195.3,320.2 L 202.4,308.9 L 222.2,289.1 L 341.7,174.3 L 340.3,175.7 L 341.7,176.7 L 271.3,244.7 L 272.3,255.1 L 380.0,141.7 L 379.0,140.8 L 374.3,144.1 L 367.7,152.1 L 363.9,155.4 L 363.0,154.0 L 361.6,155.4 L 385.2,134.2 Z M 236.9,233.3 L 239.2,233.8 L 223.2,245.1 L 200.0,260.7 L 197.2,260.7 L 196.7,263.1 L 195.8,261.7 L 195.8,263.6 L 193.0,263.6 L 236.4,233.8 Z M 271.3,367.5 L 271.3,375.5 L 263.3,383.5 L 282.7,400.0 L 288.4,402.4 L 292.6,401.9 L 288.8,376.9 L 270.9,367.0 Z"
        let path = CGMutablePath()
        let tokens = d.split(separator: " ")
        var i = 0
        while i < tokens.count {
            let token = tokens[i]
            if token == "M" {
                i += 1
                let parts = tokens[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 2 { path.move(to: CGPoint(x: parts[0], y: parts[1])) }
            } else if token == "L" {
                i += 1
                let parts = tokens[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 2 { path.addLine(to: CGPoint(x: parts[0], y: parts[1])) }
            } else if token == "Z" {
                path.closeSubpath()
            }
            i += 1
        }
        return path
    }()

    func path(in rect: CGRect) -> Path {
        let cgPath = Self.baseCGPath
        let scale = min(rect.width / 512.0, rect.height / 512.0)
        let dx = (rect.width - 512.0 * scale) / 2.0
        let dy = (rect.height - 512.0 * scale) / 2.0
        var transform = CGAffineTransform(translationX: dx, y: dy).scaledBy(x: scale, y: scale)
        if let transformed = cgPath.copy(using: &transform) {
            return Path(transformed)
        }
        return Path(cgPath)
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

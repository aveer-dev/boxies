import SwiftUI
import UIKit

/// Notion-inspired light palette. CSS variables → SwiftUI Color constants.
enum AppTheme {
    static let background = Color(red: 0.98, green: 0.98, blue: 0.985)
    static let surface = Color.white
    static let ink = Color(red: 0.12, green: 0.12, blue: 0.14)
    static let muted = Color(red: 0.45, green: 0.45, blue: 0.48)
    static let line = Color(red: 0.90, green: 0.90, blue: 0.92)
    static let pillFill = Color(red: 0.93, green: 0.93, blue: 0.94)
    static let pillActive = Color(red: 0.86, green: 0.86, blue: 0.875)
    static let accent = Color(red: 0.15, green: 0.35, blue: 0.85)
    static let unread = Color(red: 0.22, green: 0.22, blue: 0.24)
    static let deepDarkRed = Color(red: 0.42, green: 0.08, blue: 0.10)

    /// Type sizes from EmailDetailView; compose uses the same values for analogous chrome.
    enum FontSize {
        /// Large navigation title (subject) and compose heading.
        static let largeTitle: CGFloat = 22
        /// Collapsed navigation title and compose subject field.
        static let inlineTitle: CGFloat = 14
        /// Sender name and compose From line.
        static let sender: CGFloat = 12
        /// Recipient summary, expanded From label, and compose recipient field.
        static let recipient: CGFloat = 12
        /// Dates, To/Cc/Bcc labels, address pills, and compose recipient chrome.
        static let meta: CGFloat = 12
        /// Expand/picker chevrons.
        static let chevron: CGFloat = 8
        /// HTML email body and compose editor.
        static let body: CGFloat = 13
        /// Home large-title subtitle (e.g. "No unread").
        static let homeSubtitle: CGFloat = 14
    }

    /// List row typography and spacing (email list, AI chat list, search).
    enum List {
        /// Primary title size (email sender name or chat title).
        static let title: CGFloat = 15
        static let sender: CGFloat = 15
        static let subject: CGFloat = 13
        static let preview: CGFloat = 12
        static let date: CGFloat = 10
        static let badge: CGFloat = 10
        /// Section header size (e.g. date groups).
        static let sectionHeader: CGFloat = 11
        /// Consistent letter-tracking across list text.
        static let tracking: CGFloat = 0.25
        static let rowVerticalPadding: CGFloat = 18
        static let rowTextSpacing: CGFloat = 6
        static let rowHorizontalPadding: CGFloat = 20
        static let dotToText: CGFloat = 14
        static let unreadDotSize: CGFloat = 8
        /// Aligns the unread dot with the sender baseline area.
        static let unreadDotLineHeight: CGFloat = 22
        /// Separator inset past the unread dot column.
        static var separatorLeadingInset: CGFloat {
            rowHorizontalPadding + unreadDotSize + dotToText
        }
        /// Standard row separator height.
        static let separatorHeight: CGFloat = 0.5
        /// Standard row separator color.
        static let separatorColor = Color(red: 0.90, green: 0.90, blue: 0.92).opacity(0.65)
    }

    /// AI Chat typography and spacing system.
    enum Chat {
        /// Chat bubble message body font size (matches AppTheme.FontSize.body).
        static let body: CGFloat = 13
        /// Tool call / status / action note font size.
        static let toolAction: CGFloat = 12
        /// Thinking label / timestamp / reasoning modal meta.
        static let meta: CGFloat = 11
        /// Suggested prompts font size.
        static let prompt: CGFloat = 14
        /// Chat input text field font size.
        static let input: CGFloat = 14
        /// Monospaced code block text size.
        static let code: CGFloat = 12.5
        /// Code block header and language tag font size.
        static let codeMeta: CGFloat = 11
        /// Table cell font size.
        static let tableCell: CGFloat = 12
        /// Consistent letter-tracking matching list typography.
        static let tracking: CGFloat = 0.25
        /// Clean line rhythm ratio for markdown paragraphs.
        static let bodyLineSpacingRatio: CGFloat = 0.28
    }

    /// Registers bundled Inter fonts if needed (useful for previews and tests where UIAppFonts isn't read by the system).
    static func registerFontsIfNeeded() {
        let fontNames = [
            "Inter-Regular",
            "Inter-Medium",
            "Inter-SemiBold",
            "Inter-Bold",
            "Inter-Italic"
        ]
        for name in fontNames {
            if UIFont(name: name, size: 12) != nil { continue }
            if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }

    /// Configures global UIKit appearance proxies so navigation bars, tab bars, segmented controls,
    /// and buttons default to Inter throughout the app.
    static func configureGlobalAppearance() {
        registerFontsIfNeeded()

        let navBarAppearance = UINavigationBarAppearance()
        navBarAppearance.configureWithDefaultBackground()
        navBarAppearance.titleTextAttributes = [
            .font: UIFont.inter(size: 17, weight: .semibold),
            .foregroundColor: UIColor(ink)
        ]
        navBarAppearance.largeTitleTextAttributes = [
            .font: UIFont.inter(size: 34, weight: .bold),
            .foregroundColor: UIColor(ink)
        ]
        if #available(iOS 26.0, *) {
            navBarAppearance.subtitleTextAttributes = [
                .font: UIFont.inter(size: 13, weight: .regular),
                .foregroundColor: UIColor(muted)
            ]
            navBarAppearance.largeSubtitleTextAttributes = [
                .font: UIFont.inter(size: 13, weight: .regular),
                .foregroundColor: UIColor(muted)
            ]
        }
        UINavigationBar.appearance().standardAppearance = navBarAppearance
        UINavigationBar.appearance().compactAppearance = navBarAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navBarAppearance

        UIBarButtonItem.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 16, weight: .regular)
        ], for: .normal)
        UIBarButtonItem.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 16, weight: .semibold)
        ], for: .highlighted)

        UITabBarItem.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 10, weight: .medium)
        ], for: .normal)
        UITabBarItem.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 10, weight: .semibold)
        ], for: .selected)

        UISegmentedControl.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 13, weight: .medium)
        ], for: .normal)
        UISegmentedControl.appearance().setTitleTextAttributes([
            .font: UIFont.inter(size: 13, weight: .semibold)
        ], for: .selected)

        UITextField.appearance().font = UIFont.inter(size: 15, weight: .regular)
    }
}

extension Font {
    /// Returns an Inter font with the specified point size and weight.
    static func inter(size: CGFloat, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        let fontName: String
        switch weight {
        case .bold, .heavy, .black:
            fontName = italic ? "Inter-BoldItalic" : "Inter-Bold"
        case .semibold:
            fontName = italic ? "Inter-SemiBoldItalic" : "Inter-SemiBold"
        case .medium:
            fontName = italic ? "Inter-MediumItalic" : "Inter-Medium"
        default:
            fontName = italic ? "Inter-Italic" : "Inter-Regular"
        }
        return .custom(fontName, size: size)
    }

    /// Returns an Inter font scaled for a Dynamic Type text style.
    static func inter(_ textStyle: Font.TextStyle, weight: Font.Weight = .regular, italic: Bool = false) -> Font {
        let fontName: String
        switch weight {
        case .bold, .heavy, .black:
            fontName = italic ? "Inter-BoldItalic" : "Inter-Bold"
        case .semibold:
            fontName = italic ? "Inter-SemiBoldItalic" : "Inter-SemiBold"
        case .medium:
            fontName = italic ? "Inter-MediumItalic" : "Inter-Medium"
        default:
            fontName = italic ? "Inter-Italic" : "Inter-Regular"
        }
        return .custom(fontName, size: defaultPointSize(for: textStyle), relativeTo: textStyle)
    }

    private static func defaultPointSize(for textStyle: Font.TextStyle) -> CGFloat {
        switch textStyle {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline: return 17
        case .subheadline: return 15
        case .body: return 17
        case .callout: return 16
        case .footnote: return 13
        case .caption: return 12
        case .caption2: return 11
        @unknown default: return 17
        }
    }
}

extension UIFont {
    /// Returns an Inter UIFont with the specified point size and weight.
    static func inter(size: CGFloat, weight: UIFont.Weight = .regular, italic: Bool = false) -> UIFont {
        let fontName: String
        if weight >= .bold {
            fontName = italic ? "Inter-BoldItalic" : "Inter-Bold"
        } else if weight >= .semibold {
            fontName = italic ? "Inter-SemiBoldItalic" : "Inter-SemiBold"
        } else if weight >= .medium {
            fontName = italic ? "Inter-MediumItalic" : "Inter-Medium"
        } else {
            fontName = italic ? "Inter-Italic" : "Inter-Regular"
        }
        return UIFont(name: fontName, size: size) ?? UIFont.systemFont(ofSize: size, weight: weight)
    }
}

extension View {
    /// Gentle opacity pulse used while skeleton placeholders are on screen.
    func skeletonPulse(_ active: Bool) -> some View {
        modifier(SkeletonPulseModifier(active: active))
    }
}

/// Configures navigation bar title and subtitle fonts to Inter for screens with custom bar appearance.
struct NavigationBarTitleFont: UIViewControllerRepresentable {
    var largeTitleSize: CGFloat = 34
    var inlineTitleSize: CGFloat = 17
    var largeTitleWeight: UIFont.Weight = .bold
    var inlineTitleWeight: UIFont.Weight = .semibold
    var subtitleSize: CGFloat = 13
    var subtitleWeight: UIFont.Weight = .regular

    func makeUIViewController(context: Context) -> UIViewController {
        Controller(
            largeTitleSize: largeTitleSize,
            inlineTitleSize: inlineTitleSize,
            largeTitleWeight: largeTitleWeight,
            inlineTitleWeight: inlineTitleWeight,
            subtitleSize: subtitleSize,
            subtitleWeight: subtitleWeight
        )
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        (uiViewController as? Controller)?.update(
            largeTitleSize: largeTitleSize,
            inlineTitleSize: inlineTitleSize,
            largeTitleWeight: largeTitleWeight,
            inlineTitleWeight: inlineTitleWeight,
            subtitleSize: subtitleSize,
            subtitleWeight: subtitleWeight
        )
    }

    private final class Controller: UIViewController {
        private var largeTitleSize: CGFloat
        private var inlineTitleSize: CGFloat
        private var largeTitleWeight: UIFont.Weight
        private var inlineTitleWeight: UIFont.Weight
        private var subtitleSize: CGFloat
        private var subtitleWeight: UIFont.Weight

        init(
            largeTitleSize: CGFloat,
            inlineTitleSize: CGFloat,
            largeTitleWeight: UIFont.Weight,
            inlineTitleWeight: UIFont.Weight,
            subtitleSize: CGFloat,
            subtitleWeight: UIFont.Weight
        ) {
            self.largeTitleSize = largeTitleSize
            self.inlineTitleSize = inlineTitleSize
            self.largeTitleWeight = largeTitleWeight
            self.inlineTitleWeight = inlineTitleWeight
            self.subtitleSize = subtitleSize
            self.subtitleWeight = subtitleWeight
            super.init(nibName: nil, bundle: nil)
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        func update(
            largeTitleSize: CGFloat,
            inlineTitleSize: CGFloat,
            largeTitleWeight: UIFont.Weight,
            inlineTitleWeight: UIFont.Weight,
            subtitleSize: CGFloat,
            subtitleWeight: UIFont.Weight
        ) {
            self.largeTitleSize = largeTitleSize
            self.inlineTitleSize = inlineTitleSize
            self.largeTitleWeight = largeTitleWeight
            self.inlineTitleWeight = inlineTitleWeight
            self.subtitleSize = subtitleSize
            self.subtitleWeight = subtitleWeight
            apply()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            apply()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            apply()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            apply()
        }

        private func apply() {
            guard let nav = navigationController ?? parent?.navigationController else { return }
            let bar = nav.navigationBar
            let largeFont = UIFont.inter(size: largeTitleSize, weight: largeTitleWeight)
            let inlineFont = UIFont.inter(size: inlineTitleSize, weight: inlineTitleWeight)
            let subtitleFont = UIFont.inter(size: subtitleSize, weight: subtitleWeight)
            let ink = UIColor(AppTheme.ink)
            let muted = UIColor(AppTheme.muted)

            func styled(_ existing: UINavigationBarAppearance) -> UINavigationBarAppearance {
                let appearance = existing.copy() as? UINavigationBarAppearance ?? existing
                appearance.largeTitleTextAttributes[.font] = largeFont
                appearance.largeTitleTextAttributes[.foregroundColor] = ink
                appearance.titleTextAttributes[.font] = inlineFont
                appearance.titleTextAttributes[.foregroundColor] = ink
                if #available(iOS 26.0, *) {
                    appearance.subtitleTextAttributes[.font] = subtitleFont
                    appearance.subtitleTextAttributes[.foregroundColor] = muted
                    appearance.largeSubtitleTextAttributes[.font] = subtitleFont
                    appearance.largeSubtitleTextAttributes[.foregroundColor] = muted
                }
                return appearance
            }

            bar.standardAppearance = styled(bar.standardAppearance)
            if let scrollEdge = bar.scrollEdgeAppearance {
                bar.scrollEdgeAppearance = styled(scrollEdge)
            } else {
                bar.scrollEdgeAppearance = styled(bar.standardAppearance)
            }
            if let compact = bar.compactAppearance {
                bar.compactAppearance = styled(compact)
            }

            let item = parent?.navigationItem ?? navigationItem
            if let itemStandard = item.standardAppearance {
                item.standardAppearance = styled(itemStandard)
            }
            if let itemScrollEdge = item.scrollEdgeAppearance {
                item.scrollEdgeAppearance = styled(itemScrollEdge)
            }
            if let itemCompact = item.compactAppearance {
                item.compactAppearance = styled(itemCompact)
            }
        }
    }
}

/// Sets navigation bar title attributes for detail screens (e.g. EmailDetailView, ComposeSheetView).
struct DetailNavigationTitleFont: View {
    var body: some View {
        NavigationBarTitleFont(
            largeTitleSize: AppTheme.FontSize.largeTitle,
            inlineTitleSize: AppTheme.FontSize.inlineTitle,
            largeTitleWeight: .bold,
            inlineTitleWeight: .semibold
        )
    }
}

/// Sets navigation bar title and subtitle attributes for the home shell.
struct HomeNavigationTitleFont: View {
    var body: some View {
        NavigationBarTitleFont(
            largeTitleSize: 34,
            inlineTitleSize: 17,
            largeTitleWeight: .bold,
            inlineTitleWeight: .semibold,
            subtitleSize: AppTheme.FontSize.homeSubtitle,
            subtitleWeight: .regular
        )
    }
}

/// Sets navigation bar title attributes for inline modal sheets.
struct InlineNavigationTitleFont: View {
    var body: some View {
        NavigationBarTitleFont(
            largeTitleSize: 34,
            inlineTitleSize: 17,
            largeTitleWeight: .bold,
            inlineTitleWeight: .semibold
        )
    }
}

private struct SkeletonPulseModifier: ViewModifier {
    var active: Bool
    @State private var dimmed = false

    func body(content: Content) -> some View {
        content
            .opacity(active && dimmed ? 0.55 : 1)
            .onAppear { startIfNeeded() }
            .onChange(of: active) { _, _ in startIfNeeded() }
    }

    private func startIfNeeded() {
        guard active else {
            dimmed = false
            return
        }
        dimmed = false
        withAnimation(.easeInOut(duration: 0.95).repeatForever(autoreverses: true)) {
            dimmed = true
        }
    }
}

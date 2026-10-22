import SwiftUI

/// How the home shell arranges mail. Driven by `horizontalSizeClass`, not the device:
/// a full-screen iPad is regular (two-pane); iPhone, Slide Over and narrow Split View
/// are compact and keep the phone layout (email detail as a sheet).
///
/// Extensible on purpose: a third column (AVE-73) becomes another case here plus
/// another column in `HomeSplitLayout`.
enum HomeLayoutMode: Equatable {
    /// Phone layout: list fills the window, detail presents as a sheet.
    case stacked
    /// Regular width: list column + persistent reading pane.
    case twoPane

    init(horizontalSizeClass: UserInterfaceSizeClass?) {
        self = horizontalSizeClass == .regular ? .twoPane : .stacked
    }
}

private struct HomeLayoutModeKey: EnvironmentKey {
    static let defaultValue: HomeLayoutMode = .stacked
}

extension EnvironmentValues {
    /// Lets list rows highlight the email open in the reading pane.
    var homeLayoutMode: HomeLayoutMode {
        get { self[HomeLayoutModeKey.self] }
        set { self[HomeLayoutModeKey.self] = newValue }
    }
}

/// List column + hairline + detail column. In `.stacked` mode only the list is laid
/// out, at full width, so the phone layout is unchanged. The list keeps the same view
/// identity in both modes so resizing in Split View doesn't reset its scroll or state.
struct HomeSplitLayout<ListColumn: View, Detail: View>: View {
    let mode: HomeLayoutMode
    @ViewBuilder var list: ListColumn
    @ViewBuilder var detail: Detail

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                list
                    .frame(width: mode == .twoPane ? HomeChromeMetrics.listColumnWidth(for: proxy.size.width) : nil)
                    .frame(maxWidth: mode == .twoPane ? nil : .infinity)

                if mode == .twoPane {
                    Rectangle()
                        .fill(AppTheme.line)
                        .frame(width: AppTheme.List.separatorHeight)
                        .ignoresSafeArea()
                        .accessibilityHidden(true)

                    detail
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .environment(\.homeLayoutMode, mode)
    }
}

/// Reading pane for the two-pane layout: the selected email, or a quiet placeholder.
struct HomeReadingPane: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if app.selectedEmail != nil {
                EmailDetailView()
            } else {
                ContentUnavailableView(
                    "No email selected",
                    systemImage: "envelope",
                    description: Text("Choose an email from the list to read it here.")
                )
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppTheme.background.ignoresSafeArea())
            }
        }
        // Same ink chrome as the list column (and the phone's detail sheet), not system blue.
        .tint(AppTheme.ink)
    }
}

extension View {
    /// Centered form sheet on iPad (regular width); unchanged sheet on iPhone.
    /// `presentationSizing` is iOS 18+; iOS 17 iPads keep the system's default sheet.
    @ViewBuilder
    func formSheetSizing() -> some View {
        if #available(iOS 18.0, *) {
            self.presentationSizing(.form)
        } else {
            self
        }
    }
}

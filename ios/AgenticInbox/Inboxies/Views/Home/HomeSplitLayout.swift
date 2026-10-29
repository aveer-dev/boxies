import SwiftUI
import UIKit

/// How the home shell arranges mail. Driven by `horizontalSizeClass` and the window
/// width, not the device: a full-screen iPad is regular (two-pane); iPhone, Slide Over
/// and narrow Split View are compact and keep the phone layout (email detail as a sheet).
/// A wide regular window (≥ `HomeChromeMetrics.threeColumnMinWidth`, e.g. a large iPad in
/// landscape) adds a leading folder column, mirroring the web's Miller columns (AVE-73).
enum HomeLayoutMode: Equatable {
    /// Phone layout: list fills the window, detail presents as a sheet.
    case stacked
    /// Regular width: list column + persistent reading pane.
    case twoPane
    /// Wide regular width: folder column + list column + reading pane.
    case threeColumn

    /// - Parameter showsFolderColumn: the user's folder-column toggle. Off keeps wide
    ///   windows two-pane; it has no effect below the three-column width.
    init(horizontalSizeClass: UserInterfaceSizeClass?, width: CGFloat, showsFolderColumn: Bool = true) {
        if horizontalSizeClass != .regular {
            self = .stacked
        } else if showsFolderColumn && Self.allowsFolderColumn(horizontalSizeClass: horizontalSizeClass, width: width) {
            self = .threeColumn
        } else {
            self = .twoPane
        }
    }

    /// Whether the window is wide enough for the folder column (drives the toggle).
    static func allowsFolderColumn(horizontalSizeClass: UserInterfaceSizeClass?, width: CGFloat) -> Bool {
        horizontalSizeClass == .regular && width >= HomeChromeMetrics.threeColumnMinWidth
    }

    /// Mail opens in the reading pane rather than a sheet.
    var isSplit: Bool { self != .stacked }
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

/// [Folder column + hairline +] list column + hairline + detail column. In `.stacked`
/// mode only the list is laid out, at full width, so the phone layout is unchanged. The
/// list keeps the same structural identity and width with or without the folder column
/// (which takes its space from the reading pane), so resizing in Split View or toggling
/// the column doesn't reset its scroll or reflow its rows.
struct HomeSplitLayout<Folders: View, ListColumn: View, Detail: View>: View {
    let mode: HomeLayoutMode
    @ViewBuilder var folders: Folders
    @ViewBuilder var list: ListColumn
    @ViewBuilder var detail: Detail

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 0) {
                if mode == .threeColumn {
                    folders
                        .frame(width: HomeChromeMetrics.folderColumnWidth)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                    hairline
                }

                list
                    .frame(width: mode.isSplit ? HomeChromeMetrics.listColumnWidth(for: proxy.size.width) : nil)
                    .frame(maxWidth: mode.isSplit ? nil : .infinity)

                if mode.isSplit {
                    hairline

                    detail
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .environment(\.homeLayoutMode, mode)
    }

    private var hairline: some View {
        Rectangle()
            .fill(AppTheme.line)
            .frame(width: AppTheme.List.separatorHeight)
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}

/// Leading column of the three-column layout: the mailbox's folders plus the Reply Later
/// pile, like the web's Miller "Folders" column. Same destinations as the compose-stack
/// folder menu and the folder swipe; it only switches `HomeTab`.
struct HomeFolderColumn: View {
    @Environment(AppModel.self) private var app

    let title: String
    let subtitle: String
    let folders: [HomeTab]
    let selected: HomeTab
    let onSelect: (HomeTab) -> Void
    let onHide: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.inter(size: 17, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.inter(size: AppTheme.FontSize.homeSubtitle))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .lineLimit(1)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)

                    Spacer(minLength: 0)

                    Button(action: onHide) {
                        Image(systemName: "sidebar.left")
                            .font(.inter(size: 15, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hide folders")
                }
                .padding(.leading, 10)
                .padding(.top, 14)
                .padding(.bottom, 12)

                ForEach(folders, id: \.self) { tab in
                    row(tab, count: tab.syncFolderId.map { app.unreadCount(forFolderId: $0) } ?? 0, countLabel: "unread")
                }

                Text("Workflow")
                    .font(.inter(size: AppTheme.List.sectionHeader, weight: .medium))
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 10)
                    .padding(.top, 20)
                    .padding(.bottom, 6)
                    .accessibilityAddTraits(.isHeader)

                row(.replyLater, count: app.replyLaterCount, countLabel: "queued", dueCount: app.replyLaterDueCount)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(AppTheme.background.ignoresSafeArea())
        .tint(AppTheme.ink)
    }

    /// `dueCount`: Reply Later reminders that fired on unread mail, in the attention color (AVE-86).
    private func row(_ tab: HomeTab, count: Int, countLabel: String, dueCount: Int = 0) -> some View {
        let isSelected = tab == selected
        return Button {
            onSelect(tab)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: tab.systemImage)
                    .font(.inter(size: 15, weight: .medium))
                    .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted)
                    .frame(width: 20)
                Text(tab.title)
                    .font(.inter(size: 15, weight: isSelected ? .semibold : .regular))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if dueCount > 0 {
                    HStack(spacing: 3) {
                        Image(systemName: "alarm.fill")
                            .font(.inter(size: 10, weight: .semibold))
                        Text("\(dueCount) due")
                            .font(.inter(size: AppTheme.FontSize.meta, weight: .medium))
                            .monospacedDigit()
                    }
                    .foregroundStyle(AppTheme.background)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1.5)
                    .background(AppTheme.attention, in: Capsule())
                }
                if count > 0 {
                    Text(count > 999 ? "999+" : "\(count)")
                        .font(.inter(size: AppTheme.FontSize.meta))
                        .monospacedDigit()
                        .foregroundStyle(AppTheme.muted)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: HomeChromeMetrics.folderRowHeight)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: HomeChromeMetrics.folderRowCornerRadius, style: .continuous)
                        .fill(AppTheme.pillFill)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityValue(
            [count > 0 ? "\(count) \(countLabel)" : nil, dueCount > 0 ? "\(dueCount) due" : nil]
                .compactMap { $0 }
                .joined(separator: ", ")
        )
        .accessibilityAddTraits(isSelected ? .isSelected : [])
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

/// UIKit only gives a navigation bar its system margins where its view touches the window
/// edge, so a list column pushed in by the folder column draws its large title flush
/// against the hairline. Pins the enclosing bar's horizontal margins while `margin` is set
/// and hands them back to UIKit otherwise.
private struct NavigationBarHorizontalMargin: UIViewControllerRepresentable {
    let margin: CGFloat?

    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.margin = margin
        controller.apply()
    }

    final class Controller: UIViewController {
        var margin: CGFloat?

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            apply()
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            apply()
        }

        func apply() {
            guard let bar = navigationController?.navigationBar else { return }
            if let margin {
                bar.preservesSuperviewLayoutMargins = false
                var margins = bar.directionalLayoutMargins
                guard margins.leading != margin || margins.trailing != margin else { return }
                margins.leading = margin
                margins.trailing = margin
                bar.directionalLayoutMargins = margins
            } else if !bar.preservesSuperviewLayoutMargins {
                bar.preservesSuperviewLayoutMargins = true
            }
        }
    }
}

extension View {
    /// For the root view of the list column's `NavigationStack`: keeps the bar's regular-
    /// width margins when the folder column moves the list off the window edge.
    func listColumnNavigationBarMargins(_ mode: HomeLayoutMode) -> some View {
        background {
            NavigationBarHorizontalMargin(
                margin: mode == .threeColumn ? HomeChromeMetrics.listColumnNavigationBarMargin : nil
            )
            .frame(width: 0, height: 0)
            .accessibilityHidden(true)
        }
    }

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

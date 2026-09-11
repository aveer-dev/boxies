import SwiftUI

enum ComposeActionItem: String, Identifiable, CaseIterable {
    case settings
    case trash
    case archive
    case drafts
    case sent
    case inbox
    case compose

    var id: String { rawValue }

    var title: String {
        switch self {
        case .settings: return "Settings"
        case .trash: return "Trash"
        case .archive: return "Archive"
        case .drafts: return "Drafts"
        case .sent: return "Sent"
        case .inbox: return "Inbox"
        case .compose: return "Compose"
        }
    }

    var systemImage: String {
        switch self {
        case .settings: return "gearshape"
        case .trash: return HomeTab.folder("trash").systemImage
        case .archive: return HomeTab.folder("archive").systemImage
        case .drafts: return HomeTab.folder("draft").systemImage
        case .sent: return HomeTab.folder("sent").systemImage
        case .inbox: return HomeTab.folder("inbox").systemImage
        case .compose: return "square.and.pencil"
        }
    }

    var folderTab: HomeTab? {
        switch self {
        case .inbox: return .folder("inbox")
        case .sent: return .folder("sent")
        case .drafts: return .folder("draft")
        case .archive: return .folder("archive")
        case .trash: return .folder("trash")
        case .settings, .compose: return nil
        }
    }
}

/// World App–style right-aligned action list over a blurred backdrop.
struct ComposeActionListOverlay: View {
    var highlightedID: ComposeActionItem.ID?
    var onSelect: (ComposeActionItem) -> Void
    var onDismiss: () -> Void
    var onRowFramesChange: ([ComposeActionItem.ID: CGRect]) -> Void

    @State private var appeared = false
    @Namespace private var highlightNamespace

    private let actions = ComposeActionItem.allCases
    private let iconSize: CGFloat = 48
    private let rowSpacing: CGFloat = 18

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(appeared ? 1 : 0)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)
                .accessibilityLabel("Dismiss actions")

            VStack(alignment: .trailing, spacing: rowSpacing) {
                ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                    actionRow(action)
                        .opacity(appeared ? 1 : 0)
                        .offset(y: appeared ? 0 : 12)
                        .animation(
                            .spring(response: 0.28, dampingFraction: 0.84)
                                .delay(Double(actions.count - 1 - index) * 0.015),
                            value: appeared
                        )
                }
            }
            .padding(.trailing, 24)
            .padding(.bottom, HomeChromeMetrics.actionBarHeight + HomeChromeMetrics.chromeBottomPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .allowsHitTesting(appeared)
            .animation(.spring(response: 0.28, dampingFraction: 0.82), value: highlightedID)
        }
        .onPreferenceChange(ComposeActionRowFramesKey.self, perform: onRowFramesChange)
        .onAppear {
            withAnimation(.easeOut(duration: 0.12)) {
                appeared = true
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Actions")
    }

    private func actionRow(_ action: ComposeActionItem) -> some View {
        let isHighlighted = highlightedID == action.id

        return Button {
            onSelect(action)
        } label: {
            HStack(spacing: 14) {
                Text(action.title)
                    .font(.inter(size: 17, weight: .medium))
                    .foregroundStyle(AppTheme.ink)

                Image(systemName: action.systemImage)
                    .font(.inter(size: 17, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: iconSize, height: iconSize)
                    .liquidGlass(in: Circle())
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .padding(.vertical, 4)
            .background {
                if isHighlighted {
                    Capsule()
                        .fill(AppTheme.pillActive)
                        .matchedGeometryEffect(id: "compose-action-focus", in: highlightNamespace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(action.title)
        .accessibilityAddTraits(isHighlighted ? .isSelected : [])
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ComposeActionRowFramesKey.self,
                    value: [action.id: proxy.frame(in: .global)]
                )
            }
        }
    }
}

private struct ComposeActionRowFramesKey: PreferenceKey {
    static var defaultValue: [ComposeActionItem.ID: CGRect] = [:]

    static func reduce(value: inout [ComposeActionItem.ID: CGRect], nextValue: () -> [ComposeActionItem.ID: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

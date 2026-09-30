import SwiftUI
import UIKit

enum ComposeActionItem: String, Identifiable, CaseIterable {
    case settings
    case trash
    case archive
    case drafts
    case sent
    case inbox
    case forYou
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
        case .forYou: return "For you"
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
        case .forYou: return HomeTab.aiInbox.systemImage
        case .compose: return "square.and.pencil"
        }
    }

    var folderTab: HomeTab? {
        switch self {
        case .forYou: return .aiInbox
        case .inbox: return .folder("inbox")
        case .sent: return .folder("sent")
        case .drafts: return .folder("draft")
        case .archive: return .folder("archive")
        case .trash: return .folder("trash")
        case .settings, .compose: return nil
        }
    }
}

/// Compose stack — same-size discs with top peeks.
/// Back layers share the horizontal center and lift upward.
/// Uses native button surface fill, natural shadow, and faint hairline border.
struct ComposeStackButton: View {
    var size: CGFloat = HomeChromeMetrics.actionBarHeight
    var isExpanded: Bool = false

    private var layerCount: Int { HomeChromeMetrics.composeStackLayerCount }
    private var peek: CGFloat { HomeChromeMetrics.composeStackPeekOffset }

    var body: some View {
        ZStack(alignment: .bottom) {
            ForEach((0..<layerCount).reversed(), id: \.self) { depth in
                let scale = HomeChromeMetrics.composeStackScale(depth: depth)
                let layerSize = size * scale
                let lift: CGFloat = isExpanded ? 0 : peek * CGFloat(depth)
                Circle()
                    .fill(AppTheme.surface)
                    .overlay {
                        Circle()
                            .strokeBorder(AppTheme.line.opacity(0.7), lineWidth: 0.5)
                    }
                    .shadow(color: Color.black.opacity(0.08), radius: 4, x: 0, y: 2)
                    .frame(width: layerSize, height: layerSize)
                    .offset(y: -lift)
                    .opacity(isExpanded && depth > 0 ? 0 : 1)
                    .zIndex(Double(layerCount - depth))
            }

            Image(systemName: "square.and.pencil")
                .font(.inter(size: 18, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .frame(width: size, height: size)
                .zIndex(Double(layerCount + 1))
        }
        .frame(width: size, height: HomeChromeMetrics.composeStackHeight(frontSize: size), alignment: .bottom)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: isExpanded)
        .accessibilityHidden(true)
    }
}

/// World App–style right-aligned action list over a blurred backdrop.
/// Rows spring out from the stacked compose control (bottom-trailing).
struct ComposeActionListOverlay: View {
    var highlightedID: ComposeActionItem.ID?
    var isClosing: Bool = false
    var onSelect: (ComposeActionItem) -> Void
    var onDismiss: () -> Void
    var onRowFramesChange: ([ComposeActionItem.ID: CGRect]) -> Void
    var onDismissStarted: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var isDismissingInternal = false
    @Namespace private var highlightNamespace

    private let actions = ComposeActionItem.allCases
    private let iconSize: CGFloat = 48
    private let rowSpacing: CGFloat = 18
    private let baseOffsetToStack: CGFloat = 64

    private var expandSpring: Animation {
        .spring(response: 0.32, dampingFraction: 0.86)
    }

    private var rowSpring: Animation {
        .spring(response: 0.32, dampingFraction: 0.86)
    }

    private var closeSpring: Animation {
        .spring(response: 0.26, dampingFraction: 0.86)
    }

    private var isExpanded: Bool {
        appeared && !isClosing && !isDismissingInternal
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .opacity(isExpanded ? 1 : 0)
                .animation(
                    reduceMotion ? .easeOut(duration: 0.12) : .easeOut(duration: 0.22),
                    value: isExpanded
                )
                .ignoresSafeArea()
                .onTapGesture {
                    triggerDismiss()
                }
                .accessibilityLabel("Dismiss actions")

            VStack(alignment: .trailing, spacing: rowSpacing) {
                ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                    actionRow(action, index: index)
                }
            }
            .padding(.trailing, 24)
            .padding(.bottom, 70)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .allowsHitTesting(isExpanded)
            .animation(.spring(response: 0.28, dampingFraction: 0.82), value: highlightedID)
        }
        .onPreferenceChange(ComposeActionRowFramesKey.self, perform: onRowFramesChange)
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.12) : expandSpring) {
                appeared = true
            }
        }
        .onChange(of: isClosing) { _, closing in
            if closing && !isDismissingInternal {
                triggerDismiss()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Actions")
    }

    private func triggerDismiss(with action: ComposeActionItem? = nil) {
        guard !isDismissingInternal else { return }
        isDismissingInternal = true
        onDismissStarted?()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(reduceMotion ? .easeOut(duration: 0.1) : closeSpring) {
            appeared = false
        }
        let delay: TimeInterval = reduceMotion ? 0.12 : 0.24
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if let action = action {
                onSelect(action)
            } else {
                onDismiss()
            }
        }
    }

    private func actionRow(_ action: ComposeActionItem, index: Int) -> some View {
        let isHighlighted = highlightedID == action.id
        let distanceFromBottom = CGFloat(actions.count - 1 - index)
        let stride = iconSize + rowSpacing
        let stackedOffset = distanceFromBottom * stride + baseOffsetToStack

        return Button {
            triggerDismiss(with: action)
        } label: {
            HStack(spacing: 14) {
                Text(action.title)
                    .font(.inter(size: 17, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .opacity(isExpanded ? 1 : 0)
                    .offset(x: isExpanded ? 0 : 10)

                Image(systemName: action.systemImage)
                    .font(.inter(size: 17, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: iconSize, height: iconSize)
                    .liquidGlass(in: Circle())
            }
            .padding(.leading, 14)
            .padding(.trailing, 2)
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
        .opacity(isExpanded ? 1 : 0)
        .offset(y: isExpanded || reduceMotion ? 0 : stackedOffset)
        .scaleEffect(isExpanded || reduceMotion ? 1 : 0.76)
        .animation(
            reduceMotion
                ? .easeOut(duration: 0.12)
                : (isExpanded
                    ? rowSpring.delay(Double(distanceFromBottom) * 0.016)
                    : closeSpring.delay(Double(index) * 0.012)),
            value: isExpanded
        )
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

import SwiftUI

/// Trailing button on a toast: Undo, Add reminder, …
struct ToastAction: Equatable {
    /// `.accent` (Undo) or `.ink`: grey-scale, for actions that shouldn't add colour
    /// to the shell (Add reminder, AVE-86).
    enum Tone: Equatable { case accent, ink }

    let title: String
    var accessibilityHint: String? = nil
    var tone: Tone = .accent
    let perform: @MainActor () -> Void

    static func == (lhs: ToastAction, rhs: ToastAction) -> Bool {
        lhs.title == rhs.title && lhs.accessibilityHint == rhs.accessibilityHint && lhs.tone == rhs.tone
    }
}

/// Leading glyph on a toast.
enum ToastIcon: Equatable {
    case none
    case success
    case error
    case loading
    /// Any SF Symbol, tinted ink.
    case symbol(String)
}

/// The app's one toast (AVE-134): a liquid-glass pill that floats above the bottom
/// chrome. Message, optional leading icon, optional trailing action; swipe it down or
/// tap it to dismiss. Callers own auto-dismiss timing (`AppModel.showToast`) and place
/// it with `ToastMetrics`. Twins: Android `InboxiesToast`, web Kumo toasts restyled in
/// `app/index.css`.
struct InboxiesToast: View {
    let message: String
    var icon: ToastIcon = .none
    var action: ToastAction? = nil
    /// Swipe-down / tap dismiss. Nil leaves the toast to its timer.
    var onDismiss: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: ToastMetrics.cornerRadius, style: .continuous)
    }

    var body: some View {
        HStack(spacing: ToastMetrics.contentSpacing) {
            leadingIcon

            Text(message)
                .font(.inter(size: ToastMetrics.fontSize, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let action {
                Button {
                    action.perform()
                } label: {
                    Text(action.title)
                        .font(.inter(size: ToastMetrics.fontSize, weight: .semibold))
                        .foregroundStyle(action.tone == .ink ? AppTheme.ink : AppTheme.accent)
                        .padding(.horizontal, ToastMetrics.actionHorizontalPadding)
                        .frame(minHeight: ToastMetrics.actionHeight)
                        .background(
                            action.tone == .ink ? AppTheme.ink.opacity(0.08) : AppTheme.accent.opacity(0.12),
                            in: Capsule()
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint(action.accessibilityHint ?? "")
            }
        }
        .padding(.leading, ToastMetrics.horizontalPadding)
        .padding(.trailing, action == nil ? ToastMetrics.horizontalPadding : ToastMetrics.actionTrailingPadding)
        .padding(.vertical, ToastMetrics.verticalPadding)
        .frame(minHeight: ToastMetrics.minHeight)
        .contentShape(shape)
        .liquidGlass(in: shape)
        .frame(maxWidth: ToastMetrics.maxWidth)
        .offset(y: dragOffset)
        .opacity(1 - min(max(dragOffset, 0) / 120, 0.6))
        .gesture(dismissDrag, including: onDismiss == nil ? .subviews : .all)
        .onTapGesture { onDismiss?() }
        .transition(
            reduceMotion
                ? .opacity
                : .move(edge: .bottom).combined(with: .opacity)
        )
        .accessibilityElement(children: .contain)
        .accessibilityAction(named: "Dismiss") { onDismiss?() }
    }

    @ViewBuilder
    private var leadingIcon: some View {
        switch icon {
        case .none:
            EmptyView()
        case .loading:
            ProgressView()
                .controlSize(.small)
                .frame(width: ToastMetrics.iconSize, height: ToastMetrics.iconSize)
        case .success:
            glyph("checkmark.circle.fill", tint: AppTheme.ink)
        case .error:
            glyph("exclamationmark.circle.fill", tint: .red)
        case .symbol(let name):
            glyph(name, tint: AppTheme.ink)
        }
    }

    private func glyph(_ name: String, tint: Color) -> some View {
        Image(systemName: name)
            .font(.system(size: ToastMetrics.iconSize, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: ToastMetrics.iconSize, height: ToastMetrics.iconSize)
            .accessibilityHidden(true)
    }

    /// Follows the finger down (rubber-bands upward); past the threshold it dismisses.
    private var dismissDrag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let dy = value.translation.height
                dragOffset = dy > 0 ? dy : dy / 4
            }
            .onEnded { value in
                let dismissed = value.translation.height > ToastMetrics.dismissDistance
                    || value.predictedEndTranslation.height > ToastMetrics.dismissDistance * 2.5
                if dismissed, let onDismiss {
                    onDismiss()
                } else {
                    withAnimation(ToastMetrics.animation) { dragOffset = 0 }
                }
            }
    }
}

extension AppToast {
    var toastIcon: ToastIcon {
        if isLoading { return .loading }
        if isError { return .error }
        if let icon { return .symbol(icon) }
        return .success
    }
}

extension ComposeToast {
    var toastIcon: ToastIcon { isError ? .error : .success }
}

import SwiftUI
import UIKit

/// Visual grabber + interactive drag-to-dismiss for `fullScreenCover` surfaces.
/// System interactive dismiss only exists on `.sheet`; covers need this gesture.
struct CoverDragDismiss: ViewModifier {
    var onDismiss: () -> Void
    /// When false, grabber still shows but drag will not dismiss (intentional lock-in).
    var enabled: Bool = true

    @State private var dragOffset: CGFloat = 0
    @GestureState private var gestureTranslation: CGFloat = 0

    private let handleTop: CGFloat = 12
    private let handleHeight: CGFloat = 5
    private let handleBottom: CGFloat = 16
    private let dismissDistance: CGFloat = 96
    private let dismissVelocity: CGFloat = 900
    private var extraTop: CGFloat { handleTop + handleHeight + handleBottom }

    private var currentOffset: CGFloat {
        max(0, dragOffset + gestureTranslation)
    }

    private var chromeSpring: Animation {
        .spring(response: 0.32, dampingFraction: 0.86)
    }

    func body(content: Content) -> some View {
        content
            .offset(y: currentOffset)
            .animation(chromeSpring, value: dragOffset)
            .background {
                ExtraTopSafeAreaInset(extra: extraTop)
            }
            .overlay(alignment: .top) {
                dragHandle
            }
    }

    private var dragHandle: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(AppTheme.muted.opacity(0.45))
                .frame(width: 36, height: handleHeight)
                .padding(.top, handleTop)
                .padding(.bottom, handleBottom)
        }
        .frame(maxWidth: .infinity)
        // Full-width hit target above the nav chrome — was previously a dead overlay
        // that stole touches without dismissing.
        .contentShape(Rectangle())
        .offset(y: -extraTop)
        .gesture(dragGesture)
        .accessibilityLabel("Drag to close")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            guard enabled else { return }
            onDismiss()
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .updating($gestureTranslation) { value, state, _ in
                guard enabled else {
                    state = 0
                    return
                }
                state = max(0, value.translation.height)
            }
            .onEnded { value in
                guard enabled else {
                    dragOffset = 0
                    return
                }
                let distance = value.translation.height
                let predicted = value.predictedEndTranslation.height
                let flicked = value.velocity.height > dismissVelocity || predicted > dismissDistance * 1.6
                let draggedFar = distance > dismissDistance
                if draggedFar || flicked {
                    let dismissY = max(UIScreen.main.bounds.height, distance + 120)
                    withAnimation(chromeSpring) {
                        dragOffset = dismissY
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                        onDismiss()
                        dragOffset = 0
                    }
                } else {
                    withAnimation(chromeSpring) {
                        dragOffset = 0
                    }
                }
            }
    }
}

extension View {
    func coverDragDismiss(enabled: Bool = true, onDismiss: @escaping () -> Void) -> some View {
        modifier(CoverDragDismiss(onDismiss: onDismiss, enabled: enabled))
    }
}

/// Pushes UINavigationBar down. SwiftUI safeAreaInset is ignored by the toolbar.
private struct ExtraTopSafeAreaInset: UIViewRepresentable {
    var extra: CGFloat

    func makeUIView(context: Context) -> ExtraTopSafeAreaView {
        let view = ExtraTopSafeAreaView()
        view.extra = extra
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: ExtraTopSafeAreaView, context: Context) {
        view.extra = extra
        view.apply()
    }

    static func dismantleUIView(_ view: ExtraTopSafeAreaView, coordinator: ()) {
        view.clear()
    }
}

private final class ExtraTopSafeAreaView: UIView {
    var extra: CGFloat = 0
    private weak var appliedTo: UIViewController?

    override func didMoveToWindow() {
        super.didMoveToWindow()
        apply()
    }

    override func didMoveToSuperview() {
        super.didMoveToSuperview()
        apply()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // Apply on every layout pass so the first cover presentation (esp. zoom)
        // does not size the compose ScrollView before the grabber inset exists.
        apply()
    }

    func apply() {
        guard window != nil else {
            clear()
            return
        }
        guard let target = nearestHost() else { return }
        if appliedTo !== target {
            appliedTo?.additionalSafeAreaInsets.top = 0
            appliedTo = target
        }
        if target.additionalSafeAreaInsets.top != extra {
            target.additionalSafeAreaInsets.top = extra
        }
    }

    func clear() {
        appliedTo?.additionalSafeAreaInsets.top = 0
        appliedTo = nil
    }

    private func nearestHost() -> UIViewController? {
        var responder: UIResponder? = self
        var lastViewController: UIViewController?
        while let current = responder {
            if let viewController = current as? UIViewController {
                lastViewController = viewController
                if viewController.presentingViewController != nil {
                    return viewController
                }
            }
            responder = current.next
        }
        return lastViewController?.navigationController ?? lastViewController
    }
}

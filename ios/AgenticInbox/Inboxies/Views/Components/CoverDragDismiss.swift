import SwiftUI
import UIKit

/// Visual grabber + interactive drag-to-dismiss for `fullScreenCover` surfaces.
/// System interactive dismiss only exists on `.sheet`; covers need this gesture.
///
/// Grabber chrome sits *above* the navigation content in the SwiftUI hierarchy.
/// The previous `additionalSafeAreaInsets` approach raced the first cover layout
/// (especially with zoom) and collapsed compose ScrollView content to title-only
/// until remount. The old overlay also stole touches without dismissing.
struct CoverDragDismiss: ViewModifier {
    var onDismiss: () -> Void
    /// When false, grabber still shows but drag will not dismiss (intentional lock-in).
    var enabled: Bool = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0
    @State private var coverHeight: CGFloat = 800
    @GestureState private var gestureTranslation: CGFloat = 0

    private let handleTop: CGFloat = 12
    private let handleHeight: CGFloat = 5
    private let handleBottom: CGFloat = 10
    private let hitExtension: CGFloat = 28
    private let dismissDistance: CGFloat = 96
    private let dismissVelocity: CGFloat = 900

    private var chromeHeight: CGFloat { handleTop + handleHeight + handleBottom }

    private var currentOffset: CGFloat {
        max(0, dragOffset + gestureTranslation)
    }

    private var chromeSpring: Animation {
        .spring(response: 0.32, dampingFraction: 0.86)
    }

    func body(content: Content) -> some View {
        VStack(spacing: 0) {
            dragHandle
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .offset(y: currentOffset)
        .animation(chromeSpring, value: dragOffset)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.height
        } action: { coverHeight = max($0, 1) }
    }

    private var dragHandle: some View {
        Color.clear
            .frame(height: chromeHeight + hitExtension)
            .overlay(alignment: .top) {
                Capsule()
                    .fill(AppTheme.muted.opacity(0.45))
                    .frame(width: 36, height: handleHeight)
                    .padding(.top, handleTop)
                    .frame(maxWidth: .infinity)
            }
            .contentShape(Rectangle())
            .highPriorityGesture(dragGesture)
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
                let flicked: Bool
                if #available(iOS 18.0, *) {
                    flicked = value.velocity.height > dismissVelocity || predicted > dismissDistance * 1.6
                } else {
                    flicked = predicted > dismissDistance * 1.6
                }
                let draggedFar = distance > dismissDistance
                if draggedFar || flicked {
                    if reduceMotion {
                        onDismiss()
                        dragOffset = 0
                    } else {
                        withAnimation(chromeSpring) {
                            dragOffset = max(coverHeight, distance + 120)
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                            onDismiss()
                            dragOffset = 0
                        }
                    }
                } else if reduceMotion {
                    dragOffset = 0
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

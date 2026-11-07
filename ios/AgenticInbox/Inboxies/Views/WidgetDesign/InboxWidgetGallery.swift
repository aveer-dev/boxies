#if DEBUG
import SwiftUI

/// DEBUG-only gallery of every widget mock state at real size (AVE-138 design review).
/// Launch with `-previewWidgets`; add `-app_theme Dark` (or `Light`) to force a theme.
/// Round 2 ("Depth") is on top: tap › to flip the deck, the same thing the real widget's
/// intent button does. The tilt inspector below it is preview-only. Round 1 ("Calm")
/// follows for comparison.
/// Android twin: `InboxWidgetGallery` (`run-debug-preview.sh widgets`).
struct InboxWidgetGallery: View {
    @State private var smallFront = 0
    @State private var mediumFront = 0
    @State private var inspectorFront = 1

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Today's inbox")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                    Text("Widget design mocks · round 2: depth")
                        .font(.inter(size: AppTheme.FontSize.homeSubtitle))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.bottom, 2)

                sectionTitle("Depth", note: "Tap › to flip through New mail. Works on the home screen: an intent button, animated by WidgetKit.")

                HStack(alignment: .top, spacing: 16) {
                    labeled("Small · new mail") {
                        InboxWidgetDepthMock(family: .small, snapshot: .sampleHasMail, front: smallFront) {
                            withAnimation(AppTheme.Widget.Depth.flip) { smallFront = next(smallFront) }
                        }
                    }
                    labeled("Small · inbox zero") {
                        InboxWidgetDepthMock(family: .small, snapshot: .sampleInboxZero)
                    }
                }
                labeled("Medium · new mail") {
                    InboxWidgetDepthMock(family: .medium, snapshot: .sampleHasMail, front: mediumFront) {
                        withAnimation(AppTheme.Widget.Depth.flip) { mediumFront = next(mediumFront) }
                    }
                }
                labeled("Medium · inbox zero") {
                    InboxWidgetDepthMock(family: .medium, snapshot: .sampleInboxZero)
                }

                sectionTitle("Depth inspector", note: nil)
                    .padding(.top, 6)
                InboxWidgetTiltInspector {
                    InboxWidgetDepthMock(family: .medium, snapshot: .sampleHasMail, front: inspectorFront, spread: $0) {
                        withAnimation(AppTheme.Widget.Depth.flip) { inspectorFront = next(inspectorFront) }
                    }
                }

                sectionTitle("Calm · round 1", note: nil)
                    .padding(.top, 6)
                HStack(alignment: .top, spacing: 16) {
                    labeled("Small · new mail") {
                        InboxWidgetMock(family: .small, snapshot: .sampleHasMail)
                    }
                    labeled("Small · inbox zero") {
                        InboxWidgetMock(family: .small, snapshot: .sampleInboxZero)
                    }
                }
                labeled("Medium · new mail") {
                    InboxWidgetMock(family: .medium, snapshot: .sampleHasMail)
                }
                labeled("Medium · inbox zero") {
                    InboxWidgetMock(family: .medium, snapshot: .sampleInboxZero)
                }
            }
            .padding(.horizontal, 19)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
        }
        .background(AppTheme.background.ignoresSafeArea())
    }

    private func next(_ front: Int) -> Int {
        (front + 1) % max(InboxWidgetSnapshot.sampleHasMail.threads.count, 1)
    }

    private func sectionTitle(_ title: String, note: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.inter(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
            if let note {
                Text(note)
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.inter(size: AppTheme.List.sectionHeader, weight: .semibold))
                .tracking(AppTheme.List.tracking)
                .foregroundStyle(AppTheme.muted)
            content()
                .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
        }
    }
}

/// Drag to tilt the widget in 3D and fan its layers apart, so the depth recipe can be
/// inspected. PREVIEW ONLY: a home-screen widget can't track a finger, tilt or read the
/// gyroscope; this exists to review the layers, not as a widget feature.
private struct InboxWidgetTiltInspector<Content: View>: View {
    /// Receives the layer spread (1 at rest, up to ~2.4 at full tilt).
    @ViewBuilder let content: (CGFloat) -> Content
    @State private var tilt: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let maxTilt: Double = 14

    var body: some View {
        let amount = min(1, hypot(tilt.width, tilt.height) / maxTilt)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Preview only")
                    .font(.inter(size: 10, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.horizontal, 7)
                    .frame(height: 18)
                    .background { Capsule().fill(AppTheme.pillActive) }
                Text("Not possible in a home-screen widget")
                    .font(.inter(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
            }
            Text("Drag the widget to tilt it and fan the layers apart. Widgets can't track touch, tilt or motion, so this only exists here to review the depth.")
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
            content(1 + 1.4 * amount)
                .shadow(color: .black.opacity(0.06 + 0.10 * amount), radius: 10 + 14 * amount, y: 4 + 10 * amount)
                .rotation3DEffect(.degrees(tilt.height), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
                .rotation3DEffect(.degrees(tilt.width), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .onChanged { value in
                            guard !reduceMotion else { return }
                            tilt = CGSize(
                                width: max(-maxTilt, min(maxTilt, value.translation.width / 8)),
                                height: max(-maxTilt, min(maxTilt, -value.translation.height / 8))
                            )
                        }
                        .onEnded { _ in
                            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { tilt = .zero }
                        }
                )
        }
    }
}

#Preview("Gallery") {
    InboxWidgetGallery()
}
#endif

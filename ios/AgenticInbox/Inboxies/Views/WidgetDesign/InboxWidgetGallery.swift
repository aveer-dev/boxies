#if DEBUG
import SwiftUI

/// DEBUG-only gallery of every widget mock state at real size (AVE-138 design review).
/// Launch with `-previewWidgets`; add `-app_theme Dark` (or `Light`) to force a theme.
/// Android twin: `InboxWidgetGallery` (`run-debug-preview.sh widgets`).
struct InboxWidgetGallery: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Today's inbox")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                    Text("Widget design mocks · small and medium")
                        .font(.inter(size: AppTheme.FontSize.homeSubtitle))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.bottom, 4)

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

#Preview("Gallery") {
    InboxWidgetGallery()
}
#endif

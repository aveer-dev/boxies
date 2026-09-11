import SwiftUI

struct ThemeSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    ForEach(ThemeMode.allCases) { mode in
                        Button {
                            appTheme = mode
                        } label: {
                            HStack {
                                Text(mode.rawValue)
                                    .font(.inter(size: 15))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                if appTheme == mode {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundStyle(AppTheme.accent)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if mode != ThemeMode.allCases.last {
                            Divider()
                                .overlay(AppTheme.line)
                                .padding(.leading, 16)
                        }
                    }
                }
                .background(AppTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(16)
                
                Text("Select System to automatically switch between Light and Dark mode based on your device settings.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 24)
            }
        }
        .background(AppTheme.background)
        .navigationTitle("Theme")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 32, height: 32)
                }
            }
        }
        .applyThemeController()
    }
}

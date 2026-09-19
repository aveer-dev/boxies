import SwiftUI

/// Shared chrome for mailbox settings forms — inset-grouped cards with section footers.
enum SettingsFormChrome {
    static let rowHorizontalPadding: CGFloat = 16
    static let footerFontSize: CGFloat = 12
    static let rowFontSize: CGFloat = 16
}

extension View {
    /// Applies the Inboxies settings form surface (inset grouped list on app background).
    func settingsFormListStyle() -> some View {
        self
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(AppTheme.background)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .tint(AppTheme.accent)
    }
}

/// Trailing-aligned text field for settings rows (label leading, value trailing).
struct SettingsTextFieldRow: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    var disabled: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .layoutPriority(1)

            TextField(placeholder, text: $text)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(keyboardType)
                .textContentType(textContentType)
                .disabled(disabled)
                .opacity(disabled ? 0.45 : 1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Single-line text field that fills the settings row (placeholder as the cue).
struct SettingsPlainTextFieldRow: View {
    @Binding var text: String
    var placeholder: String
    var disabled: Bool = false

    var body: some View {
        TextField(placeholder, text: $text)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .foregroundStyle(AppTheme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .disabled(disabled)
            .opacity(disabled ? 0.45 : 1)
    }
}

/// Label leading, menu picker trailing — matches iOS Settings value rows.
struct SettingsMenuPickerRow<SelectionValue: Hashable, Content: View>: View {
    let title: String
    @Binding var selection: SelectionValue
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)

            Spacer(minLength: 8)

            Picker(title, selection: $selection) {
                content()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(AppTheme.muted)
        }
    }
}

struct SettingsToggleRow: View {
    let title: String
    @Binding var isOn: Bool
    var disabled: Bool = false

    var body: some View {
        Toggle(title, isOn: $isOn)
            .font(.inter(size: SettingsFormChrome.rowFontSize))
            .foregroundStyle(AppTheme.ink)
            .tint(AppTheme.accent)
            .disabled(disabled)
            .opacity(disabled ? 0.45 : 1)
    }
}

struct SettingsFormFooter: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(size: SettingsFormChrome.footerFontSize))
            .foregroundStyle(AppTheme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SettingsFormErrorBanner: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.inter(size: 13, weight: .medium))
            .foregroundStyle(AppTheme.deepDarkRed)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

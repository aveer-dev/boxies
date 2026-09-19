import SwiftUI
import UIKit

struct ComposeFormatSheet: View {
    @Bindable var session: ComposeRichTextSession
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Format")
                    .font(.inter(size: 22, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.inter(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 36, height: 36)
                        .background(AppTheme.pillFill, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close format")
            }

            HStack(spacing: 8) {
                ForEach(ComposeParagraphStyle.allCases, id: \.self) { style in
                    let active = session.state.paragraph == style
                    Button {
                        session.applyParagraph(style)
                    } label: {
                        Text(style.label)
                            .font(.inter(
                                size: style == .caption ? 11 : 14,
                                weight: style == .title ? .bold : style == .subtitle ? .semibold : .medium
                            ))
                            .foregroundStyle(active ? Color.white : AppTheme.ink)
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(active ? AppTheme.accent : Color.clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 8) {
                formatGlyph("B", active: session.state.bold) { session.toggleBold() }
                formatGlyph("I", active: session.state.italic, italic: true) { session.toggleItalic() }
                formatGlyph("U", active: session.state.underline, underline: true) { session.toggleUnderline() }
                formatGlyph("S", active: session.state.strikethrough, strike: true) { session.toggleStrikethrough() }
                ColorPicker("", selection: colorBinding, supportsOpacity: false)
                    .labelsHidden()
                    .frame(width: 36, height: 36)
                    .accessibilityLabel("Text color")
            }

            HStack(spacing: 8) {
                Text("Default Font")
                    .font(.inter(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(AppTheme.pillFill, in: Capsule())

                HStack(spacing: 0) {
                    Button {
                        session.bumpFontSize(-1)
                    } label: {
                        Image(systemName: "minus")
                            .frame(width: 44, height: 44)
                    }
                    Text("\(Int(session.state.fontSize))")
                        .font(.inter(size: 14, weight: .medium))
                        .frame(width: 28)
                    Button {
                        session.bumpFontSize(1)
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 44, height: 44)
                    }
                }
                .foregroundStyle(AppTheme.ink)
                .background(AppTheme.pillFill, in: Capsule())
            }

            HStack(spacing: 8) {
                formatIcon("list.bullet", active: session.state.isBulletList) { session.toggleBulletList() }
                formatIcon("list.number", active: session.state.isOrderedList) { session.toggleOrderedList() }
                formatIcon("text.alignleft", active: session.state.alignment == .left) { session.setAlignment(.left) }
                formatIcon("text.aligncenter", active: session.state.alignment == .center) { session.setAlignment(.center) }
                formatIcon("text.alignright", active: session.state.alignment == .right) { session.setAlignment(.right) }
                formatIcon("arrow.left.to.line", active: false) { session.indent(-24) }
                    .accessibilityLabel("Outdent")
                formatIcon("arrow.right.to.line", active: false) { session.indent(24) }
                    .accessibilityLabel("Indent")
            }
        }
        .padding(20)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { Color(uiColor: session.state.color) },
            set: { session.setColor(UIColor($0)) }
        )
    }

    private func formatGlyph(
        _ glyph: String,
        active: Bool,
        italic: Bool = false,
        underline: Bool = false,
        strike: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(glyph)
                .font(.inter(size: 16, weight: italic ? .regular : .semibold, italic: italic))
                .underline(underline)
                .strikethrough(strike)
                .foregroundStyle(AppTheme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(active ? AppTheme.pillActive : AppTheme.pillFill, in: Capsule())
        }
        .buttonStyle(ComposeDockPressStyle())
    }

    private func formatIcon(_ name: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.inter(size: 16, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(active ? AppTheme.pillActive : AppTheme.pillFill, in: Capsule())
        }
        .buttonStyle(ComposeDockPressStyle())
    }
}

struct ComposeFormatAttachBar: View {
    var onFormat: () -> Void
    var onAttach: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            HStack(spacing: 2) {
                barButton("textformat", label: "Format", action: onFormat)
                barButton("paperclip", label: "Attach", action: onAttach)
            }
            .padding(4)
            .liquidGlass(in: Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private func barButton(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.inter(size: 17, weight: .medium))
                .foregroundStyle(AppTheme.ink)
                .frame(width: 40, height: 40)
                .contentShape(Circle())
        }
        .buttonStyle(ComposeDockPressStyle())
        .accessibilityLabel(label)
    }
}

private struct ComposeDockPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

struct ComposeAttachChips: View {
    let attachments: [ComposePendingAttachment]
    var onRemove: (UUID) -> Void

    var body: some View {
        if !attachments.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(attachments) { attachment in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.filename)
                                    .font(.inter(size: 11))
                                    .foregroundStyle(AppTheme.ink)
                                    .lineLimit(1)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file))
                                    .font(.inter(size: 9))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Button {
                                onRemove(attachment.id)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.inter(size: 9, weight: .semibold))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(attachment.filename)")
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: 180, alignment: .leading)
                        .background(AppTheme.pillFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

struct CameraImagePicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    var onCancel: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraImagePicker
        init(parent: CameraImagePicker) { self.parent = parent }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCancel()
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImage(image)
            } else {
                parent.onCancel()
            }
        }
    }
}

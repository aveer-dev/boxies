import SwiftUI

struct ThemeControllerModifier: ViewModifier {
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system

    func body(content: Content) -> some View {
        content
            .background(ViewControllerResolver { vc in
                vc.overrideUserInterfaceStyle = appTheme.uiUserInterfaceStyle
                vc.view.window?.overrideUserInterfaceStyle = appTheme.uiUserInterfaceStyle
                
                // Also walk up to the presenting controller if inside a sheet
                var parent = vc.parent ?? vc.presentingViewController
                while let p = parent {
                    p.overrideUserInterfaceStyle = appTheme.uiUserInterfaceStyle
                    parent = p.parent ?? p.presentingViewController
                }
            })
    }
}

private struct ViewControllerResolver: UIViewControllerRepresentable {
    let onResolve: (UIViewController) -> Void

    func makeUIViewController(context: Context) -> UIViewController {
        ResolverViewController(onResolve: onResolve)
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        onResolve(uiViewController)
    }
}

private class ResolverViewController: UIViewController {
    let onResolve: (UIViewController) -> Void

    init(onResolve: @escaping (UIViewController) -> Void) {
        self.onResolve = onResolve
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        if let parent = parent {
            onResolve(parent)
        }
    }
}

extension View {
    func applyThemeController() -> some View {
        self.modifier(ThemeControllerModifier())
    }
}

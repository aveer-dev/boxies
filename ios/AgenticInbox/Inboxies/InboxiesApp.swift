// Inboxies — native iOS MVP client for the Cloudflare Agentic Inbox backend.
// Mentally map: SwiftUI View ≈ React component, @Observable ≈ Zustand/context, async/await ≈ fetch.

import SwiftUI

@main
struct InboxiesApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var authStore = AuthStore()
    @State private var appModel = AppModel()
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system

    init() {
        AppTheme.configureGlobalAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(authStore)
                .environment(appModel)
                .applyThemeController()
        }
    }
}

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
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-htmlHardenFixture") {
                HTMLHardenFixtureView()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewMailbox") {
                PreviewMailboxRoot()
                    .applyThemeController()
            } else {
                RootView()
                    .environment(authStore)
                    .environment(appModel)
                    .applyThemeController()
            }
            #else
            RootView()
                .environment(authStore)
                .environment(appModel)
                .applyThemeController()
            #endif
        }
    }
}

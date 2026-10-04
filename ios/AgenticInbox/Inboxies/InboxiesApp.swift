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
        if let stored = UserDefaults.standard.string(forKey: "apiBaseURL"),
           (stored.contains("localhost") || stored.contains("127.0.0.1") || stored.contains("10.0.2.2")) {
            UserDefaults.standard.removeObject(forKey: "apiBaseURL")
        }
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-htmlHardenFixture") {
                HTMLHardenFixtureView()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewMailbox")
                || ProcessInfo.processInfo.arguments.contains("-previewDetail")
                || ProcessInfo.processInfo.arguments.contains("-previewCompose")
                || ProcessInfo.processInfo.arguments.contains("-previewComposeMinimized")
                || ProcessInfo.processInfo.arguments.contains("-previewChat")
                || ProcessInfo.processInfo.arguments.contains("-previewScreener")
                || ProcessInfo.processInfo.arguments.contains("-previewScreenerList")
                || ProcessInfo.processInfo.arguments.contains("-previewReplyLater") {
                PreviewMailboxRoot()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewDomainAdmin")
                || ProcessInfo.processInfo.arguments.contains("-previewDomainAdminDetail")
                || ProcessInfo.processInfo.arguments.contains("-previewDomainAdminDetailUnassigned")
                || ProcessInfo.processInfo.arguments.contains("-previewPasswordSignIn")
                || ProcessInfo.processInfo.arguments.contains("-previewAuthOptions")
                || ProcessInfo.processInfo.arguments.contains("-previewInviteAccept")
                || ProcessInfo.processInfo.arguments.contains("-previewSignInMethods") {
                PreviewAdminAuthRoot()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewSplash") {
                SplashScreenView()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewWelcome") {
                SignInView(isShowingSplash: false)
                    .environment(authStore)
                    .environment(appModel)
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

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
        #if DEBUG
        let wasPreviewingAutofill = SharedSession.previewAutofill
        SharedSession.previewAutofill = ProcessInfo.processInfo.arguments.contains("-previewAutofill")
        if SharedSession.previewAutofill {
            // QuickType suggestions need identities registered by the app itself.
            Task { await PrivateEmailIdentities.replace(with: PrivateEmail.previewFixtures) }
        } else if wasPreviewingAutofill {
            // Leaving the preview: the fixture identities go with it.
            Task { await PrivateEmailIdentities.removeAll() }
        }
        #endif
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
                || ProcessInfo.processInfo.arguments.contains("-previewSpam")
                || ProcessInfo.processInfo.arguments.contains("-previewReplyLater")
                || PreviewSupport.isServiceMailboxPreview {
                PreviewMailboxRoot()
                    .applyThemeController()
            } else if ProcessInfo.processInfo.arguments.contains("-previewDomainAdmin")
                || ProcessInfo.processInfo.arguments.contains("-previewDomainAdminServiceEnded")
                || ProcessInfo.processInfo.arguments.contains("-previewDomainAdminDetail")
                || ProcessInfo.processInfo.arguments.contains("-previewDomainAdminDetailUnassigned")
                || ProcessInfo.processInfo.arguments.contains("-previewPasswordSignIn")
                || ProcessInfo.processInfo.arguments.contains("-previewAuthOptions")
                || ProcessInfo.processInfo.arguments.contains("-previewInviteAccept")
                || ProcessInfo.processInfo.arguments.contains("-previewInviteAcceptSignedIn")
                || ProcessInfo.processInfo.arguments.contains("-previewSignInMethods")
                || ProcessInfo.processInfo.arguments.contains("-previewMembers")
                || ProcessInfo.processInfo.arguments.contains("-previewSessions")
                || ProcessInfo.processInfo.arguments.contains("-previewSenders")
                || ProcessInfo.processInfo.arguments.contains("-previewSettings") {
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

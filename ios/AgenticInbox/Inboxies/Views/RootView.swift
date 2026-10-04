import AuthenticationServices
import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @Bindable private var pushManager = PushNotificationManager.shared
    @State private var pendingInviteToken: String?
    @State private var isShowingSplash: Bool = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-previewMailbox")
            || args.contains("-previewDetail")
            || args.contains("-previewCompose")
            || args.contains("-previewComposeMinimized")
            || args.contains("-previewChat")
            || args.contains("-previewScreener")
            || args.contains("-previewScreenerList")
            || args.contains("-previewReplyLater")
            || args.contains("-previewDomainAdmin")
            || args.contains("-previewDomainAdminDetail")
            || args.contains("-previewDomainAdminDetailUnassigned")
            || args.contains("-previewPasswordSignIn")
            || args.contains("-previewInviteAccept")
            || args.contains("-previewSignInMethods") {
            return false
        }
        #endif
        return true
    }()

    var body: some View {
        ZStack {
            Group {
                if let token = pendingInviteToken {
                    InviteAcceptView(token: token) {
                        pendingInviteToken = nil
                    }
                } else if auth.isAuthenticated {
                    if !app.isMailboxLoading && app.mailboxes.isEmpty {
                        MailboxOnboardingView(initialTrack: .select)
                    } else {
                        HomeShellView()
                            .task(id: pushManager.pendingDeepLink) {
                                await consumePendingDeepLinkIfReady()
                            }
                            .onChange(of: app.isMailboxLoading) { _, loading in
                                if !loading {
                                    Task { await consumePendingDeepLinkIfReady() }
                                }
                            }
                    }
                } else {
                    SignInView(isShowingSplash: isShowingSplash)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)

            if isShowingSplash {
                SplashScreenView()
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .task(id: auth.token) {
            #if DEBUG
            let args = ProcessInfo.processInfo.arguments
            if args.contains("-previewMailbox")
                || args.contains("-previewDetail")
                || args.contains("-previewCompose")
                || args.contains("-previewComposeMinimized")
                || args.contains("-previewChat")
                || args.contains("-previewScreener")
                || args.contains("-previewScreenerList")
                || args.contains("-previewReplyLater")
                || args.contains("-previewDomainAdmin")
                || args.contains("-previewDomainAdminDetail")
                || args.contains("-previewDomainAdminDetailUnassigned")
                || args.contains("-previewPasswordSignIn")
                || args.contains("-previewInviteAccept")
                || args.contains("-previewSignInMethods") {
                return
            }
            #endif
            if let token = auth.token, !token.isEmpty {
                await app.bootstrap(authToken: token)
            } else {
                app.reset()
            }
        }
        .task {
            guard isShowingSplash else { return }
            try? await Task.sleep(nanoseconds: 800_000_000)
            withAnimation(.easeInOut(duration: 0.3)) {
                isShowingSplash = false
            }
        }
        .font(.inter(size: 14))
        .onOpenURL { url in
            if let token = Self.inviteToken(from: url) {
                pendingInviteToken = token
            } else if url.scheme == "inboxies" && (url.host == "onboarding" || url.host == "domain-ready") {
                Task {
                    await app.refreshMailboxes(showLoading: true)
                }
            }
        }
        .onAppear {
            if let stored = UserDefaults.standard.string(forKey: "pendingInviteToken") {
                pendingInviteToken = stored
                UserDefaults.standard.removeObject(forKey: "pendingInviteToken")
            }
        }
        .onChange(of: pendingInviteToken) { _, token in
            if let token {
                UserDefaults.standard.set(token, forKey: "pendingInviteToken")
            } else {
                UserDefaults.standard.removeObject(forKey: "pendingInviteToken")
            }
        }
    }

    @MainActor
    private func consumePendingDeepLinkIfReady() async {
        guard auth.isAuthenticated,
              !app.isMailboxLoading,
              !app.mailboxes.isEmpty,
              let link = pushManager.pendingDeepLink else { return }
        pushManager.pendingDeepLink = nil
        await app.openEmailFromNotification(
            mailboxId: link.mailboxId,
            emailId: link.emailId,
            folderId: link.folderId
        )
    }

    static func inviteToken(from url: URL) -> String? {
        // inboxies://invite/<token> or https://inboxies.email/invite/<token>
        let path = url.path
        if url.host == "invite", let token = url.pathComponents.dropFirst().first, !token.isEmpty {
            return token
        }
        let parts = path.split(separator: "/").map(String.init)
        if let idx = parts.firstIndex(of: "invite"), idx + 1 < parts.count {
            let token = parts[idx + 1]
            return token.isEmpty ? nil : token
        }
        return nil
    }
}

struct InviteAcceptView: View {
    let token: String
    var onDone: () -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    @State private var invite: InvitePublic?
    @State private var loadError: String?
    @State private var password = ""
    @State private var confirm = ""
    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var formError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Accept invite")
                        .font(.inter(size: 24, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                    if let invite {
                        Text("Set a password for \(invite.mailboxId)")
                            .font(.inter(size: 15))
                            .foregroundStyle(AppTheme.muted)
                    } else if let loadError {
                        Text(loadError)
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    } else {
                        ProgressView()
                    }
                }

                if invite != nil {
                    Section {
                        TextField("Display name (optional)", text: $displayName)
                        SecureField("Password", text: $password)
                        SecureField("Confirm password", text: $confirm)
                    }

                    if let formError {
                        Section {
                            Text(formError)
                                .foregroundStyle(AppTheme.deepDarkRed)
                                .font(.inter(size: 13))
                        }
                    }

                    Section {
                        Button {
                            Task { await accept() }
                        } label: {
                            HStack {
                                Spacer()
                                if isSubmitting { ProgressView() }
                                else { Text("Create account").font(.inter(size: 16, weight: .medium)) }
                                Spacer()
                            }
                        }
                        .disabled(isSubmitting || password.count < 10)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onDone() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            invite = try await APIClient.shared.getInvite(token: token)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func accept() async {
        formError = nil
        guard password == confirm else {
            formError = "Passwords do not match"
            return
        }
        guard password.count >= 10 else {
            formError = "Password must be at least 10 characters"
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let result = try await APIClient.shared.acceptInvite(
                token: token,
                password: password,
                displayName: displayName.isEmpty ? nil : displayName
            )
            auth.applySession(token: result.token, email: result.mailboxId)
            await app.bootstrap(authToken: result.token)
            onDone()
        } catch {
            formError = error.localizedDescription
        }
    }
}

final class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WebAuthPresenter()
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? UIWindow()
        return window
    }
}

struct MailboxOnboardingView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth

    enum OnboardingTrack: Equatable, Hashable {
        case select
        case personal
        case domain
        case dnsWizard(domain: String, nameservers: [String])
    }

    struct OnboardingUserItem: Identifiable, Hashable {
        let id = UUID()
        var name: String
        var email: String
        var username: String
    }

    struct OnboardingAliasItem: Identifiable, Hashable {
        let id = UUID()
        var alias: String
        var target: String
    }

    var initialTrack: OnboardingTrack = .select
    var onDismiss: (() -> Void)? = nil
    var showsDragHandle: Bool = false
    var safeAreaTop: CGFloat = 0

    @State private var navigationPath: [OnboardingTrack] = []
    @State private var devTapCount = 0

    // Personal track state (4 steps)
    @State private var personalStep = 1
    @State private var personalName = ""
    @State private var personalPassword = ""
    @State private var isPersonalPasswordVisible = false
    @State private var personalBackupEmail = ""
    @State private var personalUsername = ""

    // Custom domain track state (11 steps)
    @State private var domainStep = 1
    @State private var customName = ""
    @State private var customPassword = ""
    @State private var isCustomPasswordVisible = false
    @State private var customBackupEmail = ""
    @State private var customDomain = ""
    @State private var customUsername = ""

    // Domain purchase / connect state
    @State private var availability: DomainAvailabilityResponse?
    @State private var isCheckingDomain = false
    @State private var domainAction = "purchase"
    @State private var checkTask: Task<Void, Never>?
    @State private var activeNameservers: [String] = ["ns1.cloudflare.com", "ns2.cloudflare.com"]
    @State private var isWatchingDns = false
    @State private var dnsWatchTimer: Task<Void, Never>?
    @State private var isPaymentSyncing = false
    @State private var createdAuthToken: String?
    @State private var webAuthSession: ASWebAuthenticationSession?

    // Team users state
    @State private var teamUsers: [OnboardingUserItem] = []
    @State private var newUserName = ""
    @State private var newUserEmail = ""
    @State private var newUserUsername = ""

    // Aliases state
    @State private var domainAliases: [OnboardingAliasItem] = []
    @State private var newAliasUsername = ""
    @State private var newAliasTarget = ""

    // General UI
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?

    init(
        initialTrack: OnboardingTrack = .select,
        onDismiss: (() -> Void)? = nil,
        showsDragHandle: Bool = false,
        safeAreaTop: CGFloat = 0
    ) {
        self.initialTrack = initialTrack
        self.onDismiss = onDismiss
        self.showsDragHandle = showsDragHandle
        self.safeAreaTop = safeAreaTop
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewDomainOnboarding") {
            _navigationPath = State(initialValue: [.domain])
            return
        }
        #endif
        switch initialTrack {
        case .select:
            _navigationPath = State(initialValue: [])
        case .personal:
            _navigationPath = State(initialValue: [.personal])
        case .domain:
            _navigationPath = State(initialValue: [.domain])
        case .dnsWizard(let domain, let nameservers):
            _navigationPath = State(initialValue: [.dnsWizard(domain: domain, nameservers: nameservers)])
        }
    }

    private var canGoBack: Bool {
        if !navigationPath.isEmpty {
            return true
        }
        if personalStep > 1 {
            return true
        }
        if domainStep > 1 && domainStep < 11 {
            return true
        }
        return false
    }

    private func handleBack() {
        if let current = navigationPath.last {
            switch current {
            case .select:
                break
            case .personal:
                handlePersonalBack()
            case .domain:
                handleDomainBack()
            case .dnsWizard:
                if !navigationPath.isEmpty {
                    navigationPath.removeLast()
                } else {
                    onDismiss?()
                }
            }
        }
    }

    private var headerNavigationBar: some View {
        HStack {
            if canGoBack {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    handleBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 42, height: 42)
                        .liquidGlass(in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back")
            } else if auth.isAuthenticated && onDismiss == nil {
                Button("Sign out", role: .destructive) {
                    app.reset()
                    auth.signOut()
                }
                .foregroundStyle(.red)
            } else {
                Spacer()
                    .frame(width: 42, height: 42)
            }

            Spacer()

            if let onDismiss {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 42, height: 42)
                        .liquidGlass(in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            } else if auth.isAuthenticated && canGoBack {
                Button("Sign out", role: .destructive) {
                    app.reset()
                    auth.signOut()
                }
                .foregroundStyle(.red)
            } else {
                Spacer()
                    .frame(width: 42, height: 42)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, showsDragHandle ? 14 : max(safeAreaTop, 16))
        .padding(.bottom, 8)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsDragHandle {
                Capsule()
                    .fill(AppTheme.line)
                    .frame(width: 36, height: 5)
                    .padding(.top, max(safeAreaTop, 44) + 16)
            }

            headerNavigationBar

            NavigationStack(path: $navigationPath) {
                selectStepView
                    .navigationDestination(for: OnboardingTrack.self) { track in
                        switch track {
                        case .select:
                            EmptyView()
                        case .personal:
                            personalStepView
                        case .domain:
                            domainStepView
                        case .dnsWizard(let domain, let nameservers):
                            dnsWizardStepView(domain: domain, nameservers: nameservers)
                        }
                    }
                    .toolbar(.hidden, for: .navigationBar)
            }
        }
        .safeAreaPadding(.top)
        .background(AppTheme.surface)
    }

    private var selectStepView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                if let error = app.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundStyle(AppTheme.deepDarkRed)
                            Text("Could not load mailboxes: \(error)")
                                .font(.inter(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.deepDarkRed)
                        }
                        Button {
                            Task {
                                await app.refreshMailboxes(showLoading: true)
                            }
                        } label: {
                            Text("Retry")
                                .font(.inter(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.deepDarkRed.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Welcome to Inboxies")
                        .font(.inter(size: 28, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                    Text("Choose how you would like to set up your email.")
                        .font(.inter(size: 16))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.top, 12)

                VStack(spacing: 14) {
                    Button {
                        navigationPath.append(.personal)
                    } label: {
                        HStack(spacing: 16) {
                            Image(systemName: "envelope")
                                .font(.system(size: 22, weight: .regular))
                                .foregroundStyle(AppTheme.accent)
                                .frame(width: 36, height: 36)

                            VStack(alignment: .leading, spacing: 3) {
                                Text("Personal Address")
                                    .font(.inter(size: 15, weight: .semibold))
                                    .foregroundStyle(AppTheme.ink)
                                Text("Instant @\(app.mailDomain) email. No setup required.")
                                    .font(.inter(size: 13))
                                    .foregroundStyle(AppTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color(uiColor: .tertiaryLabel))
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .background(AppTheme.pillFill)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    Button {
                        navigationPath.append(.domain)
                    } label: {
                        HStack(spacing: 16) {
                            Image(systemName: "globe")
                                .font(.system(size: 22, weight: .regular))
                                .foregroundStyle(AppTheme.accent)
                                .frame(width: 36, height: 36)

                            VStack(alignment: .leading, spacing: 3) {
                                Text("Custom Domain")
                                    .font(.inter(size: 15, weight: .semibold))
                                    .foregroundStyle(AppTheme.ink)
                                Text("We'll automate your custom domain setup via Cloudflare DNS.")
                                    .font(.inter(size: 13))
                                    .foregroundStyle(AppTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color(uiColor: .tertiaryLabel))
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .background(AppTheme.pillFill)
                        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 32)
        }
        .background(AppTheme.surface)
    }

    // MARK: - Personal Track

    private var isPersonalContinueEnabled: Bool {
        switch personalStep {
        case 1:
            return !personalName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case 2:
            return personalPassword.count >= 10
        case 3:
            return personalBackupEmail.contains("@") && personalBackupEmail.contains(".")
        case 4:
            return !personalUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
        default:
            return false
        }
    }

    private var personalContinueTitle: String {
        if personalStep == 4 {
            return auth.isAuthenticated ? "Create Mailbox" : "Create Account"
        }
        return "Continue"
    }

    private func handlePersonalBack() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        errorMessage = nil
        if auth.isAuthenticated && personalStep == 4 {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                personalStep = 1
            }
        } else if personalStep > 1 {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                personalStep -= 1
            }
        } else {
            if !navigationPath.isEmpty {
                navigationPath.removeLast()
            } else {
                onDismiss?()
            }
        }
    }

    private func handlePersonalContinue() {
        switch personalStep {
        case 1:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                personalStep = auth.isAuthenticated ? 4 : 2
            }
        case 2:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                personalStep = 3
            }
        case 3:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                personalStep = 4
            }
        case 4:
            Task { await createPersonal() }
        default:
            break
        }
    }

    private var personalStepHeader: some View {
        let (title, subtitle): (String, String) = {
            switch personalStep {
            case 1:
                return ("What's your name?", "Tell us what to call you. This will be shown on your outgoing emails.")
            case 2:
                return ("Set your password", "Choose a secure password (minimum 10 characters).")
            case 3:
                return ("Account backup email", "Provide an existing email address to recover your account.")
            default:
                return ("Choose your email", "Select your username on @\(app.mailDomain).")
            }
        }()

        return OnboardingStepHeader(
            title: title,
            subtitle: subtitle
        )
    }

    @ViewBuilder
    private var personalStepFields: some View {
        switch personalStep {
        case 1:
            OnboardingCapsuleTextField(
                "Full Name (e.g. Alex Miller)",
                text: $personalName,
                contentType: .name,
                autocapitalization: .words,
                autocorrectionDisabled: false,
                submitLabel: .next,
                autoFocus: true,
                onSubmit: {
                    if isPersonalContinueEnabled {
                        handlePersonalContinue()
                    }
                }
            )

        case 2:
            VStack(alignment: .leading, spacing: 8) {
                OnboardingCapsuleTextField(
                    "Password (min 10 chars)",
                    text: $personalPassword,
                    isSecure: !isPersonalPasswordVisible,
                    contentType: .newPassword,
                    submitLabel: .next,
                    autoFocus: true,
                    onSubmit: {
                        if isPersonalContinueEnabled {
                            handlePersonalContinue()
                        }
                    }
                ) {
                    Button {
                        isPersonalPasswordVisible.toggle()
                    } label: {
                        Image(systemName: isPersonalPasswordVisible ? "eye.slash" : "eye")
                            .font(.system(size: 15))
                            .foregroundStyle(Color(uiColor: .tertiaryLabel))
                            .frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isPersonalPasswordVisible ? "Hide password" : "Show password")
                }

                if !personalPassword.isEmpty && personalPassword.count < 10 {
                    Text("\(10 - personalPassword.count) more characters needed")
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.leading, 16)
                }
            }

        case 3:
            VStack(alignment: .leading, spacing: 12) {
                OnboardingCapsuleTextField(
                    "e.g. alex@example.com",
                    text: $personalBackupEmail,
                    keyboardType: .emailAddress,
                    contentType: .emailAddress,
                    submitLabel: .next,
                    autoFocus: true,
                    onSubmit: {
                        if isPersonalContinueEnabled {
                            handlePersonalContinue()
                        }
                    }
                )

                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 15))
                        .foregroundStyle(AppTheme.accent)
                        .padding(.top, 2)
                    Text("We'll use the provided email for account backup when needed.")
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.ink)
                        .lineSpacing(2)
                }
                .padding(.horizontal, 4)
                .padding(.top, 4)
            }

        default:
            OnboardingCapsuleTextField(
                "username",
                text: $personalUsername,
                keyboardType: .emailAddress,
                contentType: .username,
                submitLabel: .go,
                autoFocus: true,
                onSubmit: {
                    if isPersonalContinueEnabled {
                        handlePersonalContinue()
                    }
                }
            ) {
                Text("@\(app.mailDomain)")
                    .font(.inter(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.trailing, 4)
            }
        }
    }

    @ViewBuilder
    private var personalStepView: some View {
        if app.isAdmin && ProcessInfo.processInfo.arguments.contains("-previewDomainAdmin") {
            DomainAdminSettingsView(showsDismiss: false)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    personalStepHeader

                    if let errorMessage {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(AppTheme.deepDarkRed)
                            Text(errorMessage)
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.deepDarkRed)
                        }
                        .padding(.vertical, 4)
                    }

                    personalStepFields
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(AppTheme.surface)
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    OnboardingContinueButton(
                        title: personalContinueTitle,
                        isEnabled: isPersonalContinueEnabled,
                        isSubmitting: isSubmitting,
                        action: handlePersonalContinue
                    )
                }
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .background(
                    LinearGradient(
                        stops: [
                            .init(color: AppTheme.surface.opacity(0), location: 0),
                            .init(color: AppTheme.surface.opacity(0.85), location: 0.25),
                            .init(color: AppTheme.surface, location: 0.5)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .ignoresSafeArea()
                )
            }
        }
    }

    // MARK: - Custom Domain Track

    private var isDomainContinueEnabled: Bool {
        switch domainStep {
        case 1:
            return !customName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case 2:
            return customPassword.count >= 10
        case 3:
            return customBackupEmail.contains("@") && customBackupEmail.contains(".")
        case 4:
            return !customDomain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isCheckingDomain && availability?.alreadyInInboxies != true
        case 5:
            return !isSubmitting
        case 6:
            return !customUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
        case 7:
            return !isSubmitting
        case 8:
            return !isSubmitting
        case 9:
            return true
        case 10:
            return true
        case 11:
            return true
        default:
            return false
        }
    }

    private var domainContinueTitle: String {
        switch domainStep {
        case 5:
            if domainAction == "purchase" && (availability?.available == true) {
                let total = availability?.pricing?.totalAnnualUsd ?? availability?.retailPriceUsd ?? 20.0
                let price = String(format: "%.2f", total)
                return "Subscribe & Register ($\(price)/yr)"
            } else {
                return "I've Updated My Nameservers"
            }
        case 6:
            return "Continue"
        case 7:
            return "Continue"
        case 8:
            return "Continue"
        case 9:
            return "Review DNS Records"
        case 10:
            return "Continue"
        case 11:
            return "Open Inbox"
        default:
            return "Continue"
        }
    }

    private var domainSkipAction: (() -> Void)? {
        switch domainStep {
        case 7:
            return {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    domainStep = 8
                }
            }
        case 8:
            return {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    domainStep = 9
                }
            }
        case 10:
            return {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    domainStep = 11
                }
            }
        default:
            return nil
        }
    }

    private func handleDomainBack() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        errorMessage = nil
        if domainStep > 1 && domainStep < 11 {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep -= 1
            }
        } else {
            if !navigationPath.isEmpty {
                navigationPath.removeLast()
            } else {
                onDismiss?()
            }
        }
    }

    private func handleDomainContinue() {
        switch domainStep {
        case 1:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 2
            }
        case 2:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 3
            }
        case 3:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 4
            }
        case 4:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 5
            }
        case 5:
            if domainAction == "purchase" && (availability?.available == true) {
                Task { await startInAppBrowserPayment() }
            } else {
                startDnsWatcher()
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    domainStep = 6
                }
            }
        case 6:
            Task { await provisionDomainAccount() }
        case 7:
            Task { await persistTeamUsers() }
        case 8:
            Task { await persistAliases() }
        case 9:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 10
            }
        case 10:
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 11
            }
        case 11:
            Task {
                await app.refreshMailboxes(showLoading: true)
                onDismiss?()
            }
        default:
            break
        }
    }

    private var domainStepHeader: some View {
        let (title, subtitle): (String, String) = {
            switch domainStep {
            case 1:
                return ("Admin Name", "Provide your full name for administrator communications.")
            case 2:
                return ("Set Admin Password", "Choose a secure password (minimum 10 characters).")
            case 3:
                return ("Account Backup Email", "Provide an existing email address for account recovery.")
            case 4:
                return ("Custom Domain", "Choose a domain to register or connect one you already own.")
            case 5:
                if domainAction == "purchase" {
                    return ("Pricing Breakdown", "Review your domain purchase details. Automatic DNS is included.")
                } else {
                    return ("Update Nameservers", "Point your domain to Cloudflare to activate automatic routing.")
                }
            case 6:
                return ("Admin Mailbox", "Pick your primary admin username for @\(customDomain.isEmpty ? "yourdomain.com" : customDomain).")
            case 7:
                return ("Add Team Users", "Create mailboxes for your team members (optional).")
            case 8:
                return ("Add Email Aliases", "Create aliases that forward to your mailboxes (e.g. support@).")
            case 9:
                return ("Setup Status", "Review the state of your automated Cloudflare domain setup.")
            case 10:
                return ("DNS Records Review", "These records have been configured automatically for \(customDomain).")
            default:
                return ("Welcome to Inboxies", "Your custom domain email is live and ready.")
            }
        }()

        return OnboardingStepHeader(
            title: title,
            subtitle: subtitle
        )
    }

    private var domainStepView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                domainStepHeader

                if let errorMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(AppTheme.deepDarkRed)
                        Text(errorMessage)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                    }
                    .padding(.vertical, 4)
                }

                if isPaymentSyncing {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Syncing domain payment and configuring DNS...")
                            .font(.inter(size: 14))
                            .foregroundStyle(AppTheme.ink)
                    }
                    .padding(.vertical, 16)
                } else {
                    domainStepContent
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(AppTheme.surface)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            if !isPaymentSyncing {
                VStack(spacing: 8) {
                    OnboardingContinueButton(
                        title: domainContinueTitle,
                        isEnabled: isDomainContinueEnabled,
                        isSubmitting: isSubmitting,
                        action: handleDomainContinue
                    )

                    if let skip = domainSkipAction {
                        Button("Skip") {
                            skip()
                        }
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .buttonStyle(.plain)
                        .padding(.top, 2)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 8)
                .background(
                    LinearGradient(
                        stops: [
                            .init(color: AppTheme.surface.opacity(0), location: 0),
                            .init(color: AppTheme.surface.opacity(0.85), location: 0.25),
                            .init(color: AppTheme.surface, location: 0.5)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .ignoresSafeArea()
                )
            }
        }
    }

    @ViewBuilder
    private var domainStepContent: some View {
        switch domainStep {
        case 1:
            OnboardingCapsuleTextField(
                "Full Name (e.g. Alex Miller)",
                text: $customName,
                contentType: .name,
                autocapitalization: .words,
                autocorrectionDisabled: false,
                submitLabel: .next,
                autoFocus: true,
                onSubmit: {
                    if isDomainContinueEnabled {
                        handleDomainContinue()
                    }
                }
            )

        case 2:
            VStack(alignment: .leading, spacing: 8) {
                OnboardingCapsuleTextField(
                    "Password (min 10 chars)",
                    text: $customPassword,
                    isSecure: !isCustomPasswordVisible,
                    contentType: .newPassword,
                    submitLabel: .next,
                    autoFocus: true,
                    onSubmit: {
                        if isDomainContinueEnabled {
                            handleDomainContinue()
                        }
                    }
                ) {
                    Button {
                        isCustomPasswordVisible.toggle()
                    } label: {
                        Image(systemName: isCustomPasswordVisible ? "eye.slash" : "eye")
                            .font(.system(size: 15))
                            .foregroundStyle(Color(uiColor: .tertiaryLabel))
                            .frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isCustomPasswordVisible ? "Hide password" : "Show password")
                }

                if !customPassword.isEmpty && customPassword.count < 10 {
                    Text("\(10 - customPassword.count) more characters needed")
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.leading, 16)
                }
            }

        case 3:
            VStack(alignment: .leading, spacing: 12) {
                OnboardingCapsuleTextField(
                    "e.g. alex@example.com",
                    text: $customBackupEmail,
                    keyboardType: .emailAddress,
                    contentType: .emailAddress,
                    submitLabel: .next,
                    autoFocus: true,
                    onSubmit: {
                        if isDomainContinueEnabled {
                            handleDomainContinue()
                        }
                    }
                )

                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 15))
                        .foregroundStyle(AppTheme.accent)
                        .padding(.top, 2)
                    Text("We'll use the provided email for account backup when needed.")
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.ink)
                        .lineSpacing(2)
                }
                .padding(.horizontal, 4)
                .padding(.top, 4)
            }

        case 4:
            VStack(alignment: .leading, spacing: 14) {
                OnboardingCapsuleTextField(
                    "e.g. acme.corp",
                    text: $customDomain,
                    keyboardType: .URL,
                    contentType: .URL,
                    submitLabel: .done,
                    autoFocus: true
                ) {
                    if isCheckingDomain {
                        ProgressView().controlSize(.small)
                    }
                }
                .onChange(of: customDomain) { _, newDomain in
                    handleDomainChange(newDomain)
                }

                if let avail = availability {
                    if avail.alreadyInInboxies == true {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(AppTheme.deepDarkRed)
                                .font(.system(size: 14))
                            Text("This domain is already registered on Inboxies. Please sign in or use another.")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.deepDarkRed)
                        }
                        .padding(14)
                        .background(AppTheme.pillFill)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else if avail.available {
                        let total = avail.pricing?.totalAnnualUsd ?? avail.retailPriceUsd
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Color.green)
                                    .font(.system(size: 15))
                                Text("Available for $\(String(format: "%.2f", total))/yr")
                                    .font(.inter(size: 14, weight: .semibold))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                            }
                            Picker("Setup Mode", selection: $domainAction) {
                                Text("Register ($\(String(format: "%.0f", total))/yr)").tag("purchase")
                                Text("I already own it").tag("connect")
                            }
                            .pickerStyle(.segmented)
                        }
                        .padding(16)
                        .background(AppTheme.pillFill)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Domain is registered elsewhere.")
                                .font(.inter(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.muted)
                            Text("You can connect it by pointing its nameservers to Cloudflare.")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.ink)
                        }
                        .padding(16)
                        .background(AppTheme.pillFill)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                }
            }

        case 5:
            if domainAction == "purchase" && (availability?.available == true) {
                let total = availability?.pricing?.totalAnnualUsd ?? availability?.retailPriceUsd ?? 20.0
                let domainCost = availability?.pricing?.domainWholesaleUsd ?? 10.46
                let platformCost = availability?.pricing?.platformFeeUsd ?? (total - domainCost)
                VStack(alignment: .leading, spacing: 14) {
                    Text("Subscription & Fee Breakdown")
                        .font(.inter(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .textCase(.uppercase)

                    VStack(spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Domain Registration")
                                    .font(.inter(size: 14, weight: .medium))
                                    .foregroundStyle(AppTheme.ink)
                                Text("Wholesale pass-through via Cloudflare Registrar")
                                    .font(.inter(size: 11))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                            Text("$\(String(format: "%.2f", domainCost))/yr")
                                .font(.inter(size: 14, weight: .semibold))
                                .foregroundStyle(AppTheme.ink)
                        }

                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Platform, AI & Infrastructure")
                                    .font(.inter(size: 14, weight: .medium))
                                    .foregroundStyle(AppTheme.ink)
                                Text("Workers AI agent, edge sync, R2 storage & DNS")
                                    .font(.inter(size: 11))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                            Text("$\(String(format: "%.2f", platformCost))/yr")
                                .font(.inter(size: 14, weight: .semibold))
                                .foregroundStyle(AppTheme.ink)
                        }

                        Divider()
                            .padding(.vertical, 2)

                        HStack {
                            Text("ICANN & Registry Fees")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            Text("Included")
                                .font(.inter(size: 12, weight: .medium))
                                .foregroundStyle(Color.green)
                        }

                        HStack {
                            Text("WHOIS Privacy Protection")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            Text("Free")
                                .font(.inter(size: 12, weight: .medium))
                                .foregroundStyle(Color.green)
                        }

                        HStack {
                            Text("Auto MX/SPF/DKIM/DMARC")
                                .font(.inter(size: 13))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            Text("Automatic")
                                .font(.inter(size: 12, weight: .medium))
                                .foregroundStyle(Color.green)
                        }

                        Divider()
                            .padding(.vertical, 2)

                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Total Annual Subscription")
                                    .font(.inter(size: 15, weight: .bold))
                                    .foregroundStyle(AppTheme.ink)
                                Text("Billed annually • Cancel anytime")
                                    .font(.inter(size: 11))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                            Text("$\(String(format: "%.2f", total))/yr")
                                .font(.inter(size: 16, weight: .bold))
                                .foregroundStyle(AppTheme.accent)
                        }
                    }
                    .padding(16)
                    .background(AppTheme.pillFill)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Update Nameservers at Registrar")
                        .font(.inter(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .textCase(.uppercase)

                    Text("Point your domain's nameservers at your registrar (GoDaddy, Namecheap, etc.) to Cloudflare:")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)

                    VStack(spacing: 10) {
                        ForEach(activeNameservers, id: \.self) { ns in
                            HStack {
                                Text(ns)
                                    .font(.system(size: 14, design: .monospaced))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = ns
                                    statusMessage = "Copied \(ns)"
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .foregroundStyle(AppTheme.accent)
                                        .frame(width: 32, height: 32)
                                }
                                .buttonStyle(.plain)
                            }
                            if ns != activeNameservers.last {
                                Divider()
                            }
                        }
                    }
                    .padding(16)
                    .background(AppTheme.pillFill)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                    if let statusMessage {
                        Text(statusMessage)
                            .font(.inter(size: 12, weight: .medium))
                            .foregroundStyle(Color.green)
                    }
                }
            }

        case 6:
            VStack(alignment: .leading, spacing: 12) {
                Text("Primary Admin Mailbox")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)

                OnboardingCapsuleTextField(
                    "username (e.g. alex)",
                    text: $customUsername,
                    keyboardType: .emailAddress,
                    contentType: .username,
                    submitLabel: .go,
                    autoFocus: true,
                    onSubmit: {
                        if isDomainContinueEnabled {
                            handleDomainContinue()
                        }
                    }
                ) {
                    Text("@\(customDomain.isEmpty ? "yourdomain.com" : customDomain)")
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.trailing, 4)
                }

                Text("This will be your primary administrative mailbox.")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
            }

        case 7:
            VStack(alignment: .leading, spacing: 14) {
                Text("Add Team Members")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)

                OnboardingGroupedContainer {
                    OnboardingGroupedRow(
                        "Full Name",
                        text: $newUserName,
                        contentType: .name,
                        autocapitalization: .words,
                        autocorrectionDisabled: false,
                        showDivider: true
                    )

                    OnboardingGroupedRow(
                        "Contact / Backup Email",
                        text: $newUserEmail,
                        keyboardType: .emailAddress,
                        contentType: .emailAddress,
                        showDivider: true
                    )

                    OnboardingGroupedRow(
                        "username",
                        text: $newUserUsername,
                        keyboardType: .emailAddress,
                        contentType: .username,
                        submitLabel: .done,
                        showDivider: false
                    ) {
                        Text("@\(customDomain)")
                            .font(.inter(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .padding(.trailing, 2)
                    }
                }

                Button {
                    let trimmedUser = newUserUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    if !trimmedUser.isEmpty {
                        teamUsers.append(OnboardingUserItem(
                            name: newUserName.trimmingCharacters(in: .whitespacesAndNewlines),
                            email: newUserEmail.trimmingCharacters(in: .whitespacesAndNewlines),
                            username: trimmedUser
                        ))
                        newUserName = ""
                        newUserEmail = ""
                        newUserUsername = ""
                    }
                } label: {
                    Label("Add User", systemImage: "person.badge.plus")
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }
                .disabled(newUserUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if !teamUsers.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Configured Users (\(teamUsers.count))")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                            .textCase(.uppercase)
                            .padding(.top, 8)

                        VStack(spacing: 8) {
                            ForEach(teamUsers) { user in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(user.username)@\(customDomain)")
                                            .font(.inter(size: 14, weight: .medium))
                                            .foregroundStyle(AppTheme.ink)
                                        if !user.name.isEmpty {
                                            Text(user.name)
                                                .font(.inter(size: 12))
                                                .foregroundStyle(AppTheme.muted)
                                        }
                                    }
                                    Spacer()
                                    Button {
                                        teamUsers.removeAll { $0.id == user.id }
                                    } label: {
                                        Image(systemName: "trash")
                                            .font(.system(size: 14))
                                            .foregroundStyle(AppTheme.deepDarkRed)
                                            .frame(width: 32, height: 32)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(14)
                                .background(AppTheme.pillFill)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                        }
                    }
                }
            }

        case 8:
            VStack(alignment: .leading, spacing: 14) {
                Text("Common Alias Presets")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(["support", "hello", "sales", "billing", "info"], id: \.self) { preset in
                            Button {
                                newAliasUsername = preset
                            } label: {
                                Text("\(preset)@")
                                    .font(.inter(size: 13, weight: .medium))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(AppTheme.accent.opacity(0.1))
                                    .foregroundStyle(AppTheme.accent)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 2)
                }

                Text("New Alias")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                    .padding(.top, 4)

                OnboardingGroupedContainer {
                    OnboardingGroupedRow(
                        "alias (e.g. support)",
                        text: $newAliasUsername,
                        keyboardType: .emailAddress,
                        contentType: .username,
                        showDivider: true
                    ) {
                        Text("@\(customDomain)")
                            .font(.inter(size: 14, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .padding(.trailing, 2)
                    }

                    OnboardingGroupedRow(
                        "Forwards to (defaults to your inbox)",
                        text: $newAliasTarget,
                        keyboardType: .emailAddress,
                        contentType: .emailAddress,
                        submitLabel: .done,
                        showDivider: false
                    )
                }

                Button {
                    let trimmedAlias = newAliasUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    let target = newAliasTarget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "\(customUsername)@\(customDomain)"
                        : newAliasTarget.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmedAlias.isEmpty {
                        domainAliases.append(OnboardingAliasItem(alias: trimmedAlias, target: target))
                        newAliasUsername = ""
                        newAliasTarget = ""
                    }
                } label: {
                    Label("Add Alias", systemImage: "arrowshape.turn.up.right")
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.accent)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }
                .disabled(newAliasUsername.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if !domainAliases.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Configured Aliases (\(domainAliases.count))")
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.muted)
                            .textCase(.uppercase)
                            .padding(.top, 8)

                        VStack(spacing: 8) {
                            ForEach(domainAliases) { item in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(item.alias)@\(customDomain)")
                                            .font(.inter(size: 14, weight: .medium))
                                            .foregroundStyle(AppTheme.ink)
                                        Text("→ \(item.target)")
                                            .font(.inter(size: 12))
                                            .foregroundStyle(AppTheme.muted)
                                    }
                                    Spacer()
                                    Button {
                                        domainAliases.removeAll { $0.id == item.id }
                                    } label: {
                                        Image(systemName: "trash")
                                            .font(.system(size: 14))
                                            .foregroundStyle(AppTheme.deepDarkRed)
                                            .frame(width: 32, height: 32)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(14)
                                .background(AppTheme.pillFill)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                        }
                    }
                }
            }

        case 9:
            VStack(alignment: .leading, spacing: 16) {
                Text("State of Setup")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)

                VStack(alignment: .leading, spacing: 12) {
                    SetupStatusRow(title: "Custom Domain Provisioned", detail: customDomain, status: .ready)
                    SetupStatusRow(title: "Cloudflare Nameservers", detail: activeNameservers.joined(separator: ", "), status: .ready)
                    SetupStatusRow(title: "Email Routing & Catch-All", detail: "Automatic worker routing enabled", status: .ready)
                    SetupStatusRow(title: "DNS (MX, SPF, DMARC)", detail: "Injected and protected", status: .ready)
                    SetupStatusRow(title: "Primary Mailbox", detail: "\(customUsername)@\(customDomain)", status: .ready)
                    SetupStatusRow(title: "Team Users", detail: "\(teamUsers.count) users added", status: .ready)
                    SetupStatusRow(title: "Email Aliases", detail: "\(domainAliases.count) aliases configured", status: .ready)
                }
                .padding(16)
                .background(AppTheme.pillFill)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .foregroundStyle(AppTheme.accent)
                    Text("Configured automatically via Cloudflare Email Routing & Workers.")
                        .font(.inter(size: 12))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.top, 4)
            }

        case 10:
            VStack(alignment: .leading, spacing: 14) {
                Text("Configured DNS Records")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)

                Text("For users moving existing nameservers, confirm or set these DNS records at your provider:")
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)

                VStack(spacing: 8) {
                    DnsRecordRow(type: "MX", host: "@", value: "route1.mx.cloudflare.net (Pri 10)")
                    Divider()
                    DnsRecordRow(type: "MX", host: "@", value: "route2.mx.cloudflare.net (Pri 20)")
                    Divider()
                    DnsRecordRow(type: "MX", host: "@", value: "route3.mx.cloudflare.net (Pri 30)")
                    Divider()
                    DnsRecordRow(type: "TXT", host: "@", value: "v=spf1 include:_spf.mx.cloudflare.net ~all")
                    Divider()
                    DnsRecordRow(type: "TXT", host: "_dmarc", value: "v=DMARC1; p=none; sp=none;")
                }
                .padding(16)
                .background(AppTheme.pillFill)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

        default:
            VStack(spacing: 20) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(Color.green)

                Text("Welcome to Inboxies!")
                    .font(.inter(size: 28, weight: .bold))
                    .foregroundStyle(AppTheme.ink)

                Text("Your domain \(customDomain) is configured with Cloudflare Email Routing. You can now send and receive email at:")
                    .font(.inter(size: 16))
                    .foregroundStyle(AppTheme.muted)
                    .multilineTextAlignment(.center)

                Text("\(customUsername)@\(customDomain)")
                    .font(.system(size: 18, weight: .bold, design: .monospaced))
                    .foregroundStyle(AppTheme.accent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(AppTheme.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                HStack(spacing: 24) {
                    VStack {
                        Text("\(1 + teamUsers.count)")
                            .font(.inter(size: 20, weight: .bold))
                        Text("Mailboxes")
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)
                    }
                    VStack {
                        Text("\(domainAliases.count)")
                            .font(.inter(size: 20, weight: .bold))
                        Text("Aliases")
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)
                    }
                    VStack {
                        Image(systemName: "shield.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(Color.green)
                        Text("Protected")
                            .font(.inter(size: 12))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    private func dnsWizardStepView(domain: String, nameservers: [String]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Domain Registered!", systemImage: "checkmark.circle.fill")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(Color.green)
                    Text("Cloudflare Email Routing is ready for \(domain).")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Nameservers")
                        .font(.inter(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .textCase(.uppercase)

                    VStack(spacing: 10) {
                        ForEach(nameservers, id: \.self) { ns in
                            HStack {
                                Text(ns)
                                    .font(.system(size: 14, design: .monospaced))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                Button {
                                    UIPasteboard.general.string = ns
                                } label: {
                                    Image(systemName: "doc.on.doc")
                                        .foregroundStyle(AppTheme.accent)
                                        .frame(width: 32, height: 32)
                                }
                                .buttonStyle(.plain)
                            }
                            if ns != nameservers.last {
                                Divider()
                            }
                        }
                    }
                    .padding(16)
                    .background(AppTheme.pillFill)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .background(AppTheme.surface)
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            OnboardingContinueButton(
                title: "Go to Inbox",
                isEnabled: true,
                isSubmitting: isSubmitting,
                action: {
                    Task {
                        await app.refreshMailboxes(showLoading: true)
                        onDismiss?()
                    }
                }
            )
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(
                LinearGradient(
                    stops: [
                        .init(color: AppTheme.surface.opacity(0), location: 0),
                        .init(color: AppTheme.surface.opacity(0.85), location: 0.25),
                        .init(color: AppTheme.surface, location: 0.5)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
        }
    }

    // MARK: - Actions

    private func createPersonal() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            if !auth.isAuthenticated {
                guard personalPassword.count >= 10 else {
                    errorMessage = "Password must be at least 10 characters"
                    return
                }
                let res = try await APIClient.shared.signupPersonal(
                    username: personalUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                    password: personalPassword,
                    displayName: personalName.isEmpty ? nil : personalName,
                    backupEmail: personalBackupEmail.isEmpty ? nil : personalBackupEmail
                )
                auth.applySession(token: res.token, email: res.mailbox.email)
                await app.bootstrap(authToken: res.token)
                onDismiss?()
            } else {
                let fullEmail = "\(personalUsername)@\(app.mailDomain)"
                try await app.createMailbox(name: personalName.isEmpty ? personalUsername : personalName, email: fullEmail)
                onDismiss?()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handleDomainChange(_ newDomain: String) {
        checkTask?.cancel()
        let trimmed = newDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard trimmed.contains("."), !trimmed.hasPrefix("."), !trimmed.hasSuffix(".") else {
            availability = nil
            isCheckingDomain = false
            return
        }

        isCheckingDomain = true
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            do {
                let res = try await APIClient.shared.checkDomainAvailability(domain: trimmed)
                guard !Task.isCancelled else { return }
                availability = res
                if res.available {
                    domainAction = "purchase"
                } else {
                    domainAction = "connect"
                }
            } catch {
                guard !Task.isCancelled else { return }
                availability = nil
            }
            isCheckingDomain = false
        }
    }

    private func startInAppBrowserPayment() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let domain = customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let username = customUsername.isEmpty ? "admin" : customUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let returnUrl = "inboxies://onboarding/domain-ready"
            let res = try await APIClient.shared.createDomainCheckout(
                domain: domain,
                username: username,
                password: customPassword,
                displayName: customName.isEmpty ? nil : customName,
                returnUrl: returnUrl,
                client: "ios"
            )
            guard let url = URL(string: res.checkoutUrl) else { return }

            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "inboxies") { callbackUrl, error in
                DispatchQueue.main.async {
                    if let callbackUrl = callbackUrl {
                        handlePaymentComplete(callbackUrl: callbackUrl)
                    } else if let error = error {
                        let nsError = error as NSError
                        if nsError.code != ASWebAuthenticationSessionError.canceledLogin.rawValue {
                            errorMessage = error.localizedDescription
                        }
                    }
                }
            }
            session.presentationContextProvider = WebAuthPresenter.shared
            session.prefersEphemeralWebBrowserSession = false
            self.webAuthSession = session
            session.start()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handlePaymentComplete(callbackUrl: URL) {
        isPaymentSyncing = true
        Task {
            let components = URLComponents(url: callbackUrl, resolvingAgainstBaseURL: false)
            let token = components?.queryItems?.first(where: { $0.name == "token" })?.value
            let domainFromUrl = components?.queryItems?.first(where: { $0.name == "domain" })?.value
            let targetDomain = domainFromUrl ?? customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

            if let token = token, !token.isEmpty {
                createdAuthToken = token
                let username = customUsername.isEmpty ? "admin" : customUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let email = "\(username)@\(targetDomain)"
                auth.applySession(token: token, email: email)
                await app.bootstrap(authToken: token)
            }

            _ = try? await APIClient.shared.fixDomainEmailDns(domain: targetDomain)

            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                isPaymentSyncing = false
                domainStep = 7
            }
        }
    }

    private func provisionDomainAccount() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let res = try await APIClient.shared.signupDomain(
                domain: customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                username: customUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                password: customPassword,
                displayName: customName.isEmpty ? nil : customName,
                backupEmail: customBackupEmail.isEmpty ? nil : customBackupEmail
            )
            createdAuthToken = res.token
            auth.applySession(token: res.token, email: res.mailbox.email)
            await app.bootstrap(authToken: res.token)
            if !res.domain.nameservers.isEmpty {
                activeNameservers = res.domain.nameservers
            }
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                domainStep = 7
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func persistTeamUsers() async {
        if !teamUsers.isEmpty {
            let domain = customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let payload = teamUsers.map { [
                "name": $0.name,
                "email": $0.email,
                "username": $0.username
            ] }
            _ = try? await APIClient.shared.setupDomainUsers(domain: domain, users: payload)
        }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            domainStep = 8
        }
    }

    private func persistAliases() async {
        if !domainAliases.isEmpty {
            let domain = customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let payload = domainAliases.map { [
                "alias": $0.alias,
                "target": $0.target
            ] }
            _ = try? await APIClient.shared.setupDomainAliases(domain: domain, aliases: payload)
        }
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            domainStep = 9
        }
    }

    private func startDnsWatcher() {
        isWatchingDns = true
        dnsWatchTimer?.cancel()
        dnsWatchTimer = Task {
            let domain = customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            for _ in 0..<10 {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { break }
                _ = try? await APIClient.shared.fixDomainEmailDns(domain: domain)
            }
        }
    }
}

// MARK: - Onboarding UI Components

private struct SetupStatusRow: View {
    enum Status {
        case ready, pending
    }
    let title: String
    let detail: String
    let status: Status

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(Color.green)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.inter(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                Text(detail)
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer()
        }
    }
}

private struct DnsRecordRow: View {
    let type: String
    let host: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(type)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(AppTheme.accent.opacity(0.12))
                    .foregroundStyle(AppTheme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                Text(host)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Button {
                    UIPasteboard.general.string = value
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.accent)
                }
                .buttonStyle(.borderless)
            }
            Text(value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(AppTheme.muted)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Onboarding Shared Components

private struct OnboardingStepHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.inter(size: 26, weight: .bold))
                .foregroundStyle(AppTheme.ink)

            Text(subtitle)
                .font(.inter(size: 16))
                .foregroundStyle(AppTheme.muted)
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 8)
    }
}

private struct OnboardingContinueButton: View {
    let title: String
    var isEnabled: Bool = true
    var isSubmitting: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isSubmitting {
                    ProgressView()
                        .tint(isEnabled ? AppTheme.surface : AppTheme.muted)
                } else {
                    Text(title)
                        .font(.inter(size: 16, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(isEnabled ? AppTheme.ink : AppTheme.pillActive, in: Capsule())
            .foregroundStyle(isEnabled ? AppTheme.surface : AppTheme.muted)
            .liquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isSubmitting)
    }
}

private struct OnboardingCapsuleTextField<Trailing: View>: View {
    let placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var autocapitalization: TextInputAutocapitalization = .never
    var autocorrectionDisabled: Bool = true
    var submitLabel: SubmitLabel = .done
    var autoFocus: Bool = false
    var onSubmit: (() -> Void)? = nil
    @ViewBuilder var trailing: () -> Trailing

    @FocusState private var isFieldFocused: Bool

    init(
        _ placeholder: String,
        text: Binding<String>,
        isSecure: Bool = false,
        keyboardType: UIKeyboardType = .default,
        contentType: UITextContentType? = nil,
        autocapitalization: TextInputAutocapitalization = .never,
        autocorrectionDisabled: Bool = true,
        submitLabel: SubmitLabel = .done,
        autoFocus: Bool = false,
        onSubmit: (() -> Void)? = nil,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.placeholder = placeholder
        self._text = text
        self.isSecure = isSecure
        self.keyboardType = keyboardType
        self.contentType = contentType
        self.autocapitalization = autocapitalization
        self.autocorrectionDisabled = autocorrectionDisabled
        self.submitLabel = submitLabel
        self.autoFocus = autoFocus
        self.onSubmit = onSubmit
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 8) {
            if isSecure {
                SecureField(placeholder, text: $text)
                    .font(.inter(size: 16))
                    .textContentType(contentType)
                    .submitLabel(submitLabel)
                    .onSubmit { onSubmit?() }
                    .focused($isFieldFocused)
            } else {
                TextField(placeholder, text: $text)
                    .font(.inter(size: 16))
                    .keyboardType(keyboardType)
                    .textContentType(contentType)
                    .textInputAutocapitalization(autocapitalization)
                    .autocorrectionDisabled(autocorrectionDisabled)
                    .submitLabel(submitLabel)
                    .onSubmit { onSubmit?() }
                    .focused($isFieldFocused)
            }

            if isFieldFocused && !text.isEmpty && !isSecure {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Color(uiColor: .tertiaryLabel))
                }
                .buttonStyle(.plain)
                .transition(.opacity)
                .accessibilityLabel("Clear text")
            }

            trailing()
        }
        .padding(.horizontal, 20)
        .frame(height: 52)
        .background(AppTheme.pillFill, in: Capsule())
        .clipShape(Capsule())
        .animation(.spring(response: 0.25, dampingFraction: 0.86), value: isFieldFocused)
        .onAppear {
            if autoFocus {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    isFieldFocused = true
                }
            }
        }
    }
}

private typealias OnboardingInputField = OnboardingCapsuleTextField

private struct OnboardingGroupedContainer<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppTheme.pillFill)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct OnboardingGroupedRow<Trailing: View>: View {
    let placeholder: String
    @Binding var text: String
    var isSecure: Bool = false
    var keyboardType: UIKeyboardType = .default
    var contentType: UITextContentType? = nil
    var autocapitalization: TextInputAutocapitalization = .never
    var autocorrectionDisabled: Bool = true
    var submitLabel: SubmitLabel = .next
    var autoFocus: Bool = false
    var onSubmit: (() -> Void)? = nil
    var showDivider: Bool = true
    @ViewBuilder var trailing: () -> Trailing

    @FocusState private var isFieldFocused: Bool

    init(
        _ placeholder: String,
        text: Binding<String>,
        isSecure: Bool = false,
        keyboardType: UIKeyboardType = .default,
        contentType: UITextContentType? = nil,
        autocapitalization: TextInputAutocapitalization = .never,
        autocorrectionDisabled: Bool = true,
        submitLabel: SubmitLabel = .next,
        autoFocus: Bool = false,
        onSubmit: (() -> Void)? = nil,
        showDivider: Bool = true,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.placeholder = placeholder
        self._text = text
        self.isSecure = isSecure
        self.keyboardType = keyboardType
        self.contentType = contentType
        self.autocapitalization = autocapitalization
        self.autocorrectionDisabled = autocorrectionDisabled
        self.submitLabel = submitLabel
        self.autoFocus = autoFocus
        self.onSubmit = onSubmit
        self.showDivider = showDivider
        self.trailing = trailing
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                if isSecure {
                    SecureField(placeholder, text: $text)
                        .font(.inter(size: 16))
                        .textContentType(contentType)
                        .submitLabel(submitLabel)
                        .onSubmit { onSubmit?() }
                        .focused($isFieldFocused)
                } else {
                    TextField(placeholder, text: $text)
                        .font(.inter(size: 16))
                        .keyboardType(keyboardType)
                        .textContentType(contentType)
                        .textInputAutocapitalization(autocapitalization)
                        .autocorrectionDisabled(autocorrectionDisabled)
                        .submitLabel(submitLabel)
                        .onSubmit { onSubmit?() }
                        .focused($isFieldFocused)
                }

                if isFieldFocused && !text.isEmpty && !isSecure {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Color(uiColor: .tertiaryLabel))
                    }
                    .buttonStyle(.plain)
                    .transition(.opacity)
                    .accessibilityLabel("Clear text")
                }

                trailing()
            }
            .padding(.horizontal, 16)
            .frame(height: 50)

            if showDivider {
                Divider()
                    .padding(.leading, 16)
            }
        }
        .animation(.spring(response: 0.25, dampingFraction: 0.86), value: isFieldFocused)
        .onAppear {
            if autoFocus {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    isFieldFocused = true
                }
            }
        }
    }
}

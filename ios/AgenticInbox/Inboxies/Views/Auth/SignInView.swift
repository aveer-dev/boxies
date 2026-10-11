import AuthenticationServices
import SafariServices
import SwiftUI

/// Redesigned onboarding welcome and sign-in flow.
/// Features:
/// 1. Splash handoff transition with logo gliding up.
/// 2. 3-line headline ("Your \n Personal \n email app") + circular downward arrow button.
/// 3. Auth buttons reveal by moving the welcome view UP (not a modal).
/// 4. Side-by-side Apple and Google buttons displaying ONLY company logos in black (no text).
/// 5. Email login screen pushes entire view UP from below, with interactive drag-down return.
struct SignInView: View {
    var isShowingSplash: Bool = false
    var expandPasswordForm: Bool = false

    enum AuthSubscreen {
        case none
        case email
        case onboarding
    }

    @Environment(AuthStore.self) private var auth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var hasStartedTransition: Bool = {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewGetStarted") {
            return true
        }
        #endif
        return false
    }()
    @State private var isAuthRevealed: Bool = {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewGetStarted") {
            return true
        }
        #endif
        return false
    }()
    @State private var activeSubscreen: AuthSubscreen = {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewGetStarted") {
            return .onboarding
        }
        #endif
        return .none
    }()
    @State private var welcomeDragOffset: CGFloat = 0
    @State private var emailDragOffset: CGFloat = 0
    @State private var onboardingDragOffset: CGFloat = 0
    @State private var emailRefocusTrigger: Int = 0
    @State private var showTermsBrowser = false
    @State private var isEmailAtRoot: Bool = true
    @State private var isOnboardingAtRoot: Bool = true
    @State private var emailPastThreshold: Bool = false
    @State private var onboardingPastThreshold: Bool = false

    /// Spring with obvious bounce for revealing auth buttons when the downward arrow is tapped.
    private var authRevealAnimation: Animation {
        if reduceMotion {
            return .spring(response: 0.32, dampingFraction: 0.86)
        }
        return .spring(duration: 0.52, bounce: 0.40)
    }

    /// Smooth transition for subpages ("Continue with Email" and "Get started") without spring bounce.
    private var subscreenTransitionAnimation: Animation {
        if reduceMotion {
            return .easeInOut(duration: 0.24)
        }
        return .easeInOut(duration: 0.32)
    }

    @State private var apiBase: String = {
        if let stored = UserDefaults.standard.string(forKey: "apiBaseURL") {
            if stored.contains("localhost") || stored.contains("127.0.0.1") || stored.contains("10.0.2.2") {
                UserDefaults.standard.removeObject(forKey: "apiBaseURL")
                return "https://inboxies.email"
            }
            return stored
        }
        return AppConfig.apiBaseURL.absoluteString
    }()
    @State private var appleCoordinator = AppleAuthCoordinator()
    @State private var toastDismissTask: Task<Void, Never>?
    #if DEBUG
    @State private var showDevConfig = ProcessInfo.processInfo.arguments.contains("-showApiBase")
    @State private var devTapCount = 0
    #endif

    private let authRevealHeightBase: CGFloat = 300

    var body: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geometry in
            let screenHeight = geometry.size.height
            let safeArea = geometry.safeAreaInsets
            let authRevealHeight = authRevealHeightBase + safeArea.bottom

            let isSubscreenOpen = activeSubscreen != .none
            let activeDragOffset: CGFloat = {
                switch activeSubscreen {
                case .email: return emailDragOffset
                case .onboarding: return onboardingDragOffset
                case .none: return 0
                }
            }()

            let page1OffsetY: CGFloat = (isSubscreenOpen ? -screenHeight : 0) + activeDragOffset
            let emailPageOffsetY: CGFloat = (activeSubscreen == .email ? 0 : screenHeight) + emailDragOffset
            let onboardingPageOffsetY: CGFloat = (activeSubscreen == .onboarding ? 0 : screenHeight) + onboardingDragOffset

            ZStack(alignment: .top) {
                // Page 1: Welcome Screen & Auth Buttons
                ZStack(alignment: .top) {
                    // Base Canvas Background
                    AppTheme.background
                        .frame(width: geometry.size.width, height: screenHeight)

                    // Layer 1: Auth Buttons Section (Fixed at bottom of canvas, revealed when welcome card moves up)
                    VStack {
                        Spacer()
                        AuthButtonsSection(
                            onGetStarted: {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                commitAPIBaseURL()
                                withAnimation(subscreenTransitionAnimation) {
                                    activeSubscreen = .onboarding
                                    onboardingDragOffset = 0
                                }
                            },
                            onContinueWithEmail: {
                                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                withAnimation(subscreenTransitionAnimation) {
                                    activeSubscreen = .email
                                    emailDragOffset = 0
                                }
                            },
                            onAppleSignIn: {
                                Task {
                                    commitAPIBaseURL()
                                    let result = await appleCoordinator.authenticate()
                                    await handleApple(result)
                                }
                            },
                            onGoogleSignIn: {
                                Task {
                                    commitAPIBaseURL()
                                    await handleGoogle()
                                }
                            },
                            onOpenTerms: {
                                showTermsBrowser = true
                            },
                            commitAPIBaseURL: commitAPIBaseURL
                        )
                        .padding(.horizontal, 24)
                        .padding(.bottom, max(18, safeArea.bottom + 8))
                    }
                    .frame(width: geometry.size.width, height: screenHeight)

                    // Layer 2: Welcome Container (Moves UP to reveal auth buttons below)
                    VStack(spacing: 0) {
                        // Top spacer pushes contents much lower down so they remain comfortably positioned
                        Spacer(minLength: isAuthRevealed ? (authRevealHeight + safeArea.top + 60) : max(safeArea.top + 160, 220))

                        // App Logo
                        InboxiesLogo()
                            .frame(width: 64, height: 64)
                            .foregroundStyle(AppTheme.ink)
                            .offset(y: hasStartedTransition ? 0 : 160)

                        // App Name & 3-line Headline
                        VStack(spacing: 12) {
                            Text("Inboxies")
                                .font(.inter(size: 20, weight: .bold))
                                .foregroundStyle(AppTheme.ink)
                                .tracking(-0.3)
                                .padding(.top, 14)

                            VStack(spacing: -2) {
                                Text("Your")
                                    .font(.inter(size: 44, weight: .bold))
                                    .foregroundStyle(AppTheme.ink)

                                Text("Personal")
                                    .font(.inter(size: 44, weight: .bold))
                                    .foregroundStyle(AppTheme.ink)

                                Text("email app")
                                    .font(.inter(size: 44, weight: .bold))
                                    .foregroundStyle(
                                        LinearGradient(
                                            colors: [AppTheme.accent, Color(red: 0.35, green: 0.55, blue: 1.0)],
                                            startPoint: .leading,
                                            endPoint: .trailing
                                        )
                                    )
                            }
                            .multilineTextAlignment(.center)
                            .tracking(-0.6)
                        }
                        .opacity(hasStartedTransition ? 1 : 0)
                        .offset(y: hasStartedTransition ? 0 : 28)

                        // Circular Downward Arrow Button (Hidden when auth buttons are revealed)
                        if !isAuthRevealed {
                            Button {
                                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                withAnimation(authRevealAnimation) {
                                    isAuthRevealed = true
                                }
                            } label: {
                                ZStack {
                                    Circle()
                                        .fill(
                                            LinearGradient(
                                                colors: [AppTheme.accent, Color(red: 0.28, green: 0.48, blue: 0.95)],
                                                startPoint: .topLeading,
                                                endPoint: .bottomTrailing
                                            )
                                        )
                                        .frame(width: 54, height: 54)
                                        .shadow(color: AppTheme.accent.opacity(0.35), radius: 10, x: 0, y: 5)

                                    Image(systemName: "arrow.down")
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundStyle(.white)
                                }
                            }
                            .buttonStyle(ArrowBounceButtonStyle())
                            .padding(.top, 32)
                            .opacity(hasStartedTransition ? 1 : 0)
                            .scaleEffect(hasStartedTransition ? 1 : 0.8)
                            .transition(.scale.combined(with: .opacity))
                        }

                        Spacer(minLength: 20)

                        // Bottom drag handle on the welcome card when revealed
                        if isAuthRevealed {
                            Capsule()
                                .fill(AppTheme.line)
                                .frame(width: 36, height: 5)
                                .padding(.bottom, 12)
                                .transition(.opacity)
                        }
                    }
                    .padding(.top, safeArea.top)
                    .padding(.bottom, isAuthRevealed ? 0 : safeArea.bottom)
                    .frame(maxWidth: .infinity)
                    .frame(height: screenHeight)
                    .background(
                        colorScheme == .dark
                            ? (isAuthRevealed ? Color(red: 0.135, green: 0.135, blue: 0.145) : AppTheme.surface)
                            : AppTheme.surface
                    )
                    .clipShape(
                        UnevenRoundedRectangle(
                            bottomLeadingRadius: isAuthRevealed ? 36 : 0,
                            bottomTrailingRadius: isAuthRevealed ? 36 : 0
                        )
                    )
                    .overlay {
                        if isAuthRevealed {
                            UnevenRoundedRectangle(
                                bottomLeadingRadius: 36,
                                bottomTrailingRadius: 36
                            )
                            .stroke(
                                colorScheme == .dark
                                    ? Color.white.opacity(0.14)
                                    : AppTheme.line.opacity(0.55),
                                lineWidth: 0.5
                            )
                        }
                    }
                    .shadow(
                        color: Color.black.opacity(
                            isAuthRevealed ? (colorScheme == .dark ? 0.65 : 0.12) : 0
                        ),
                        radius: colorScheme == .dark ? 24 : 16,
                        x: 0,
                        y: colorScheme == .dark ? 8 : 6
                    )
                    .offset(y: (isAuthRevealed ? -authRevealHeight : 0) + welcomeDragOffset)
                    .gesture(
                        isAuthRevealed && activeSubscreen == .none ?
                            DragGesture(minimumDistance: 10)
                                .onChanged { value in
                                    if value.translation.height > 0 {
                                        welcomeDragOffset = value.translation.height
                                    }
                                }
                                .onEnded { value in
                                    if value.translation.height > 60 || value.velocity.height > 300 {
                                        withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                                            isAuthRevealed = false
                                            welcomeDragOffset = 0
                                        }
                                    } else {
                                        withAnimation(authRevealAnimation) {
                                            welcomeDragOffset = 0
                                        }
                                    }
                                }
                            : nil
                    )
                    .onTapGesture {
                        if isAuthRevealed && activeSubscreen == .none {
                            withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                                isAuthRevealed = false
                                welcomeDragOffset = 0
                            }
                        } else if !isAuthRevealed {
                            #if DEBUG
                            devTapCount += 1
                            if devTapCount >= 5 {
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                    showDevConfig.toggle()
                                }
                                devTapCount = 0
                            }
                            #endif
                        }
                    }
                }
                .frame(width: geometry.size.width, height: screenHeight)
                .offset(y: page1OffsetY)

                // Page 2: Email Onboarding Screen (Pushes welcome view entirely up, follows in lockstep, draggable back down only from root)
                EmailLoginScreen(
                    safeAreaTop: safeArea.top,
                    isPresented: activeSubscreen == .email,
                    refocusTrigger: emailRefocusTrigger,
                    isAtRoot: $isEmailAtRoot,
                    onDismiss: {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        auth.errorMessage = nil
                        withAnimation(subscreenTransitionAnimation) {
                            activeSubscreen = .none
                            emailDragOffset = 0
                        }
                    },
                    commitAPIBaseURL: commitAPIBaseURL
                )
                .frame(width: geometry.size.width, height: screenHeight)
                .background(AppTheme.surface)
                .offset(y: emailPageOffsetY)
                .simultaneousGesture(
                    isEmailAtRoot ?
                        DragGesture(minimumDistance: 4)
                            .onChanged { value in
                                if value.translation.height > 0 && abs(value.translation.height) >= abs(value.translation.width) * 0.8 {
                                    if value.translation.height > 30 {
                                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                                    }
                                    let rawOffset = value.translation.height * 0.85
                                    emailDragOffset = rawOffset
                                    let isPast = rawOffset >= 90
                                    if isPast != emailPastThreshold {
                                        emailPastThreshold = isPast
                                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    }
                                }
                            }
                            .onEnded { value in
                                let distance = value.translation.height * 0.85
                                let flicked: Bool
                                if #available(iOS 18.0, *) {
                                    flicked = value.velocity.height > 350
                                } else {
                                    flicked = value.predictedEndTranslation.height > 100
                                }
                                if distance >= 90 || flicked {
                                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                                    auth.errorMessage = nil
                                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                    emailPastThreshold = false
                                    withAnimation(subscreenTransitionAnimation) {
                                        activeSubscreen = .none
                                        emailDragOffset = 0
                                    }
                                } else {
                                    if emailDragOffset > 0 {
                                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    }
                                    emailPastThreshold = false
                                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                        emailDragOffset = 0
                                    }
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                                        emailRefocusTrigger += 1
                                    }
                                }
                            }
                        : nil
                )

                // Page 3: Get Started Onboarding Screen (Pushes welcome view entirely up, follows in lockstep, draggable back down only from root)
                MailboxOnboardingView(
                    initialTrack: .select,
                    onDismiss: {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        auth.errorMessage = nil
                        withAnimation(subscreenTransitionAnimation) {
                            activeSubscreen = .none
                            onboardingDragOffset = 0
                        }
                    },
                    showsDragHandle: true,
                    safeAreaTop: safeArea.top,
                    isAtRoot: $isOnboardingAtRoot
                )
                .frame(width: geometry.size.width, height: screenHeight)
                .background(AppTheme.surface)
                .offset(y: onboardingPageOffsetY)
                .simultaneousGesture(
                    isOnboardingAtRoot ?
                        DragGesture(minimumDistance: 4)
                            .onChanged { value in
                                if value.translation.height > 0 && abs(value.translation.height) >= abs(value.translation.width) * 0.8 {
                                    if value.translation.height > 30 {
                                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                                    }
                                    let rawOffset = value.translation.height * 0.85
                                    onboardingDragOffset = rawOffset
                                    let isPast = rawOffset >= 90
                                    if isPast != onboardingPastThreshold {
                                        onboardingPastThreshold = isPast
                                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    }
                                }
                            }
                            .onEnded { value in
                                let distance = value.translation.height * 0.85
                                let flicked: Bool
                                if #available(iOS 18.0, *) {
                                    flicked = value.velocity.height > 350
                                } else {
                                    flicked = value.predictedEndTranslation.height > 100
                                }
                                if distance >= 90 || flicked {
                                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                                    auth.errorMessage = nil
                                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                                    onboardingPastThreshold = false
                                    withAnimation(subscreenTransitionAnimation) {
                                        activeSubscreen = .none
                                        onboardingDragOffset = 0
                                    }
                                } else {
                                    if onboardingDragOffset > 0 {
                                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    }
                                    onboardingPastThreshold = false
                                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                        onboardingDragOffset = 0
                                    }
                                }
                            }
                        : nil
                )

                #if DEBUG
                if showDevConfig {
                    VStack {
                        Spacer()
                        devConfigView
                            .background(AppTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .shadow(color: Color.black.opacity(0.12), radius: 16, y: 4)
                            .padding(.horizontal, 24)
                            .padding(.bottom, 32)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                #endif
            }
        }
        .ignoresSafeArea()
        .ignoresSafeArea(.keyboard, edges: .bottom)

        if let error = auth.errorMessage {
            AuthToastBanner(message: error) {
                toastDismissTask?.cancel()
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    auth.errorMessage = nil
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
    .animation(.spring(response: 0.32, dampingFraction: 0.86), value: auth.errorMessage)
    .sheet(isPresented: $showTermsBrowser) {
        if let termsURL = URL(string: "https://inboxies.email/terms") {
            SafariView(url: termsURL)
                .ignoresSafeArea()
        }
    }
    .onChange(of: auth.isAuthenticated) { _, authed in
        if authed {
            activeSubscreen = .none
        }
    }
    .task {
        #if DEBUG
        if expandPasswordForm || ProcessInfo.processInfo.arguments.contains("-previewPasswordSignIn") {
            hasStartedTransition = true
            isAuthRevealed = true
            try? await Task.sleep(nanoseconds: 300_000_000)
            withAnimation(subscreenTransitionAnimation) {
                activeSubscreen = .email
            }
        } else if ProcessInfo.processInfo.arguments.contains("-previewForgotPassword") {
            hasStartedTransition = true
            isAuthRevealed = true
            try? await Task.sleep(nanoseconds: 300_000_000)
            withAnimation(subscreenTransitionAnimation) {
                activeSubscreen = .email
            }
        } else if ProcessInfo.processInfo.arguments.contains("-previewAuthOptions") {
            hasStartedTransition = true
            try? await Task.sleep(nanoseconds: 150_000_000)
            withAnimation(authRevealAnimation) {
                isAuthRevealed = true
            }
        }
        #endif
    }
    .onAppear {
        if apiBase.contains("localhost") || apiBase.contains("127.0.0.1") || apiBase.contains("10.0.2.2") {
            UserDefaults.standard.removeObject(forKey: "apiBaseURL")
            apiBase = "https://inboxies.email"
        }
        if !isShowingSplash {
            triggerEntranceAnimation()
        }
    }
    .onChange(of: isShowingSplash) { _, showing in
        if !showing {
            triggerEntranceAnimation()
        }
    }
    .onChange(of: auth.errorMessage) { _, newError in
        toastDismissTask?.cancel()
        if newError != nil {
            toastDismissTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                    auth.errorMessage = nil
                }
                toastDismissTask = nil
            }
        }
    }
    .onDisappear {
        toastDismissTask?.cancel()
        toastDismissTask = nil
    }
}

    private func triggerEntranceAnimation() {
        guard !hasStartedTransition else { return }
        Task {
            try? await Task.sleep(nanoseconds: 120_000_000)
            withAnimation(.spring(response: 0.58, dampingFraction: 0.82)) {
                hasStartedTransition = true
            }
        }
    }

    private func commitAPIBaseURL() {
        let value = apiBase.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty || value.contains("localhost") || value.contains("127.0.0.1") || value.contains("10.0.2.2") {
            apiBase = "https://inboxies.email"
            UserDefaults.standard.removeObject(forKey: "apiBaseURL")
            return
        }
        if let url = AppConfig.parseAPIBaseURL(value) {
            apiBase = url.absoluteString
            UserDefaults.standard.set(apiBase, forKey: "apiBaseURL")
        } else {
            UserDefaults.standard.set(value, forKey: "apiBaseURL")
        }
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                return
            }
            auth.errorMessage = error.localizedDescription
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                auth.errorMessage = "Apple Sign In failed"
                return
            }
            await auth.signInWithApple(identityToken: token, email: credential.email)
        }
    }

    private func handleGoogle() async {
        #if DEBUG
        if AppConfig.isLocalDevelopmentAPI {
            await auth.signInDev()
            return
        }
        #endif
        auth.errorMessage = "Google sign-in is managed via Web/Android. Please use Email or Apple sign-in."
    }

    #if DEBUG
    private var devConfigView: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("API base URL (Dev)")
                    .font(.inter(.caption))
                    .foregroundStyle(AppTheme.muted)
                Spacer()
                Button("Reset") {
                    UserDefaults.standard.removeObject(forKey: "apiBaseURL")
                    apiBase = "https://inboxies.email"
                }
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.accent)
                Button("Done") {
                    withAnimation { showDevConfig = false }
                }
                .font(.inter(size: 12, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
            }
            TextField("api.example.com", text: $apiBase)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(size: 13, design: .monospaced))
                .padding(10)
                .background(AppTheme.pillFill)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .onChange(of: apiBase) { _, value in
                    UserDefaults.standard.set(value, forKey: "apiBaseURL")
                }
                .onSubmit { commitAPIBaseURL() }
        }
        .padding(16)
    }
    #endif
}

/// Bottom Auth Section containing:
/// 1. "Get started" (fully rounded primary pill)
/// 2. "or" divider
/// 3. "Continue with Email" (liquid glass capsule)
/// 4. Side-by-side Apple and Google buttons as fully rounded liquid glass buttons
/// 5. Terms of Use fine print
private struct AuthButtonsSection: View {
    var onGetStarted: () -> Void
    var onContinueWithEmail: () -> Void
    var onAppleSignIn: () -> Void
    var onGoogleSignIn: () -> Void
    var onOpenTerms: () -> Void
    var commitAPIBaseURL: () -> Void

    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(spacing: 12) {
            // Primary: Get started (Fully rounded capsule)
            Button(action: onGetStarted) {
                Text("Get started")
                    .font(.inter(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(AppTheme.ink)
                    .foregroundStyle(AppTheme.surface)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)

            // Divider: or text
            HStack(spacing: 12) {
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(height: 0.5)
                Text("or")
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                Rectangle()
                    .fill(AppTheme.line)
                    .frame(height: 0.5)
            }
            .padding(.vertical, 2)

            // Continue with Email (Liquid glass capsule)
            Button(action: onContinueWithEmail) {
                Text("Continue with Email")
                    .font(.inter(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .liquidGlass(in: Capsule())
                    .foregroundStyle(AppTheme.ink)
            }
            .buttonStyle(.plain)

            // Secondary: Apple & Google side-by-side as liquid glass capsule buttons
            HStack(spacing: 12) {
                // Apple button (Black logo only, liquid glass capsule)
                Button(action: onAppleSignIn) {
                    Image(systemName: "apple.logo")
                        .font(.system(size: 22))
                        .foregroundStyle(AppTheme.ink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .liquidGlass(in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sign in with Apple")
                .frame(maxWidth: .infinity)
                .frame(height: 50)

                // Google button (Black 'G' logo only, liquid glass capsule)
                Button(action: onGoogleSignIn) {
                    GoogleLogoShape()
                        .fill(AppTheme.ink)
                        .frame(width: 20, height: 20)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .liquidGlass(in: Capsule())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
            }

            #if DEBUG
            if AppConfig.isLocalDevelopmentAPI {
                Button {
                    Task {
                        commitAPIBaseURL()
                        await auth.signInDev()
                    }
                } label: {
                    Text("Continue with Dev Login")
                        .font(.inter(size: 14, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.vertical, 2)
                }
            }
            #endif

            // Fine print: Terms of Use
            HStack(spacing: 3) {
                Text("By continuing, you agree to Inboxies'")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)

                Button(action: onOpenTerms) {
                    Text("Terms of Use")
                        .font(.inter(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                        .underline()
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 2)
        }
    }
}

/// Two-step email login screen presented as a continuous vertical page:
/// Step 1: User enters email address, taps Next.
/// Step 2: User enters password, taps Continue to authenticate.
/// Supports interactive drag-down return to the welcome screen.
private struct EmailLoginScreen: View {
    var safeAreaTop: CGFloat = 0
    var isPresented: Bool = false
    var refocusTrigger: Int = 0
    var isAtRoot: Binding<Bool> = .constant(true)
    var onDismiss: () -> Void
    var commitAPIBaseURL: () -> Void

    enum Step: Hashable {
        case password
        case forgotPassword
        case resetPassword
    }

    @Environment(AuthStore.self) private var auth
    @State private var navigationPath: [Step] = {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewPasswordSignIn") {
            return [.password]
        }
        if ProcessInfo.processInfo.arguments.contains("-previewForgotPassword") {
            return [.forgotPassword]
        }
        #endif
        return []
    }()
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var resetCode: String = ""
    @State private var isPasswordVisible: Bool = false
    @State private var isResetPasswordVisible: Bool = false
    @State private var isSendingReset: Bool = false
    @State private var isResetting: Bool = false
    @FocusState private var isFieldFocused: Bool

    private var isValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".") && trimmed.count >= 5
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            emailStepView
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .password:
                        passwordStepView
                    case .forgotPassword:
                        forgotPasswordStepView
                    case .resetPassword:
                        resetPasswordStepView
                    }
                }
                .toolbar(.hidden, for: .navigationBar)
        }
        .background(AppTheme.surface)
        .onChange(of: isPresented) { _, presented in
            if presented {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.42) {
                    isFieldFocused = true
                }
            } else {
                isFieldFocused = false
            }
        }
        .onChange(of: refocusTrigger) { _, _ in
            isFieldFocused = true
        }
        .onChange(of: navigationPath) { _, newPath in
            isAtRoot.wrappedValue = newPath.isEmpty
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                isFieldFocused = true
            }
        }
        .onAppear {
            isAtRoot.wrappedValue = navigationPath.isEmpty
            if isPresented {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.42) {
                    isFieldFocused = true
                }
            }
        }
    }

    private var subsequentStepToolbar: some View {
        HStack {
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                auth.errorMessage = nil
                if !navigationPath.isEmpty {
                    navigationPath.removeLast()
                }
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 42, height: 42)
                    .liquidGlass(in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")

            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    private var emailStepView: some View {
        VStack(spacing: 0) {
            // Drag handle pill placed comfortably below Dynamic Island / notch (initial screen only)
            Color.clear
                .frame(height: 24)
                .overlay {
                    Capsule()
                        .fill(AppTheme.line)
                        .frame(width: 36, height: 5)
                }
                .contentShape(Rectangle())
                .padding(.top, max(safeAreaTop, 44) + 12)

            // Header bar for initial screen: right side close button only (goes back to welcome screen)
            HStack {
                Spacer()

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
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)

            ScrollView {
                VStack(spacing: 0) {
                    ZStack {
                        Circle()
                            .fill(AppTheme.pillFill)
                            .frame(width: 52, height: 52)

                        Image(systemName: "envelope.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.top, 12)

                    Text("Continue with Email")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                        .padding(.top, 14)

                    Text("Sign in or sign up with your email.")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .padding(.top, 4)

                    TextField("Email Address", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.inter(size: 15))
                        .padding(14)
                        .background(AppTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(AppTheme.line, lineWidth: 1)
                        )
                        .focused($isFieldFocused)
                        .padding(.horizontal, 24)
                        .padding(.top, 24)
                        .onSubmit {
                            if isValidEmail {
                                navigationPath.append(.password)
                            }
                        }

                    HStack {
                        Spacer()
                        Button {
                            auth.errorMessage = nil
                            navigationPath.append(.forgotPassword)
                        } label: {
                            Text("Forgot password?")
                                .font(.inter(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 10)

                    Spacer()
                        .frame(height: 16)

                    Button {
                        navigationPath.append(.password)
                    } label: {
                        Text("Next")
                            .font(.inter(size: 16, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(isValidEmail ? AppTheme.ink : AppTheme.pillActive)
                            .foregroundStyle(isValidEmail ? AppTheme.surface : AppTheme.muted)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(!isValidEmail)
                    .padding(.horizontal, 24)

                    Spacer()
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(AppTheme.surface)
        .ignoresSafeArea(.container, edges: .top)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var passwordStepView: some View {
        VStack(spacing: 0) {
            subsequentStepToolbar

            ScrollView {
                VStack(spacing: 0) {
                    ZStack {
                        Circle()
                            .fill(AppTheme.pillFill)
                            .frame(width: 52, height: 52)

                        Image(systemName: "key.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.top, 16)

                    Text("Enter your password")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                        .padding(.top, 14)

                    Text("Sign in with your email \(email.trimmingCharacters(in: .whitespacesAndNewlines))")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .padding(.top, 4)

                    HStack(spacing: 8) {
                        if isPasswordVisible {
                            TextField("Password", text: $password)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.inter(size: 15))
                                .focused($isFieldFocused)
                        } else {
                            SecureField("Password", text: $password)
                                .font(.inter(size: 15))
                                .focused($isFieldFocused)
                        }

                        Button {
                            isPasswordVisible.toggle()
                        } label: {
                            Image(systemName: isPasswordVisible ? "eye.slash" : "eye")
                                .font(.system(size: 15))
                                .foregroundStyle(AppTheme.muted)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isPasswordVisible ? "Hide password" : "Show password")
                    }
                    .padding(14)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(AppTheme.line, lineWidth: 1)
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 24)
                    .onSubmit {
                        if !password.isEmpty && !auth.isBusy {
                            submitPassword()
                        }
                    }

                    HStack {
                        Spacer()
                        Button {
                            auth.errorMessage = nil
                            navigationPath.append(.forgotPassword)
                        } label: {
                            Text("Forgot password?")
                                .font(.inter(size: 13, weight: .medium))
                                .foregroundStyle(AppTheme.accent)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 10)

                    Spacer()
                        .frame(height: 16)

                    Button(action: submitPassword) {
                        HStack {
                            if auth.isBusy {
                                ProgressView()
                                    .tint(AppTheme.surface)
                                    .scaleEffect(0.9)
                            } else {
                                Text("Sign In")
                                    .font(.inter(size: 16, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(!password.isEmpty && !auth.isBusy ? AppTheme.ink : AppTheme.pillActive)
                        .foregroundStyle(!password.isEmpty && !auth.isBusy ? AppTheme.surface : AppTheme.muted)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(password.isEmpty || auth.isBusy)
                    .padding(.horizontal, 24)

                    Spacer()
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(AppTheme.surface)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var forgotPasswordStepView: some View {
        VStack(spacing: 0) {
            subsequentStepToolbar

            ScrollView {
                VStack(spacing: 0) {
                    ZStack {
                        Circle()
                            .fill(AppTheme.pillFill)
                            .frame(width: 52, height: 52)

                        Image(systemName: "envelope.badge.shield.half.filled")
                            .font(.system(size: 22))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.top, 16)

                    Text("Forgot password?")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                        .padding(.top, 14)

                    Text("Enter your email to receive a 6-digit reset code.")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .padding(.top, 4)

                    TextField("Email Address", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.inter(size: 15))
                        .padding(14)
                        .background(AppTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(AppTheme.line, lineWidth: 1)
                        )
                        .focused($isFieldFocused)
                        .padding(.horizontal, 24)
                        .padding(.top, 24)
                        .onSubmit {
                            if isValidEmail && !isSendingReset {
                                sendResetCode()
                            }
                        }

                    Spacer()
                        .frame(height: 20)

                    Button(action: sendResetCode) {
                        HStack {
                            if isSendingReset {
                                ProgressView()
                                    .tint(AppTheme.surface)
                                    .scaleEffect(0.9)
                            } else {
                                Text("Send Reset Code")
                                    .font(.inter(size: 16, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(isValidEmail && !isSendingReset ? AppTheme.ink : AppTheme.pillActive)
                        .foregroundStyle(isValidEmail && !isSendingReset ? AppTheme.surface : AppTheme.muted)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(!isValidEmail || isSendingReset)
                    .padding(.horizontal, 24)

                    Spacer()
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(AppTheme.surface)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var resetPasswordStepView: some View {
        VStack(spacing: 0) {
            subsequentStepToolbar

            ScrollView {
                VStack(spacing: 0) {
                    ZStack {
                        Circle()
                            .fill(AppTheme.pillFill)
                            .frame(width: 52, height: 52)

                        Image(systemName: "lock.rotation")
                            .font(.system(size: 22))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.top, 16)

                    Text("Reset your password")
                        .font(.inter(size: 22, weight: .bold))
                        .foregroundStyle(AppTheme.ink)
                        .padding(.top, 14)

                    Text("Enter the code sent to \(email.trimmingCharacters(in: .whitespacesAndNewlines))")
                        .font(.inter(size: 14))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .padding(.top, 4)

                    VStack(spacing: 14) {
                        TextField("6-digit code", text: $resetCode)
                            .keyboardType(.numberPad)
                            .font(.inter(size: 20, weight: .bold))
                            .multilineTextAlignment(.center)
                            .padding(14)
                            .background(AppTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .stroke(AppTheme.line, lineWidth: 1)
                            )
                            .focused($isFieldFocused)

                        HStack(spacing: 8) {
                            if isResetPasswordVisible {
                                TextField("New password (min 10 chars)", text: $password)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .font(.inter(size: 15))
                            } else {
                                SecureField("New password (min 10 chars)", text: $password)
                                    .font(.inter(size: 15))
                            }

                            Button {
                                isResetPasswordVisible.toggle()
                            } label: {
                                Image(systemName: isResetPasswordVisible ? "eye.slash" : "eye")
                                    .font(.system(size: 15))
                                    .foregroundStyle(AppTheme.muted)
                                    .frame(width: 32, height: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(isResetPasswordVisible ? "Hide password" : "Show password")
                        }
                        .padding(14)
                        .background(AppTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(AppTheme.line, lineWidth: 1)
                        )

                        if !password.isEmpty && password.count < 10 {
                            HStack {
                                Text("\(10 - password.count) more characters needed")
                                    .font(.inter(size: 12))
                                    .foregroundStyle(AppTheme.muted)
                                Spacer()
                            }
                            .padding(.horizontal, 4)
                        }

                        Button(action: submitResetPassword) {
                            HStack {
                                if isResetting {
                                    ProgressView()
                                        .tint(AppTheme.surface)
                                        .scaleEffect(0.9)
                                } else {
                                    Text("Reset and Sign In")
                                        .font(.inter(size: 16, weight: .semibold))
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(resetCode.count >= 6 && password.count >= 10 && !isResetting ? AppTheme.ink : AppTheme.pillActive)
                            .foregroundStyle(resetCode.count >= 6 && password.count >= 10 && !isResetting ? AppTheme.surface : AppTheme.muted)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(resetCode.count < 6 || password.count < 10 || isResetting)
                        .padding(.top, 4)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 24)

                    Spacer()
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(AppTheme.surface)
        .toolbar(.hidden, for: .navigationBar)
    }

    private func submitPassword() {
        Task {
            commitAPIBaseURL()
            await auth.signInWithPassword(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password
            )
            if auth.isAuthenticated {
                onDismiss()
            }
        }
    }

    private func sendResetCode() {
        isSendingReset = true
        auth.errorMessage = nil
        Task {
            commitAPIBaseURL()
            defer { isSendingReset = false }
            do {
                let res = try await auth.forgotPassword(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
                #if DEBUG
                if let code = res.devResetCode {
                    resetCode = code
                }
                #endif
                navigationPath.append(.resetPassword)
            } catch {
                // error set in auth.errorMessage
            }
        }
    }

    private func submitResetPassword() {
        isResetting = true
        auth.errorMessage = nil
        Task {
            commitAPIBaseURL()
            defer { isResetting = false }
            do {
                try await auth.resetPassword(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    code: resetCode.trimmingCharacters(in: .whitespacesAndNewlines),
                    newPassword: password
                )
                if auth.isAuthenticated {
                    onDismiss()
                }
            } catch {
                // error set in auth.errorMessage
            }
        }
    }
}

/// Native SFSafariViewController wrapper to display dummy link in-app.
private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(AppTheme.accent)
        return vc
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

/// Clean official single-color Google "G" brand icon shape.
private struct GoogleLogoShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let sx = rect.width / 24.0
        let sy = rect.height / 24.0

        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }

        // Subpath 1: Horizontal crossbar and right arc
        path.move(to: p(22.56, 12.25))
        path.addCurve(to: p(22.36, 10), control1: p(22.56, 11.47), control2: p(22.49, 10.72))
        path.addLine(to: p(12, 10))
        path.addLine(to: p(12, 14.26))
        path.addLine(to: p(17.92, 14.26))
        path.addCurve(to: p(15.71, 17.57), control1: p(17.66, 15.63), control2: p(16.88, 16.79))
        path.addLine(to: p(15.71, 20.34))
        path.addLine(to: p(19.28, 20.34))
        path.addCurve(to: p(22.56, 12.25), control1: p(21.36, 18.42), control2: p(22.56, 15.6))
        path.closeSubpath()

        // Subpath 2: Bottom arc
        path.move(to: p(12, 23))
        path.addCurve(to: p(19.28, 20.34), control1: p(14.97, 23), control2: p(17.46, 22.02))
        path.addLine(to: p(15.71, 17.57))
        path.addCurve(to: p(12, 18.63), control1: p(14.73, 18.23), control2: p(13.48, 18.63))
        path.addCurve(to: p(5.84, 14.1), control1: p(9.14, 18.63), control2: p(6.71, 16.7))
        path.addLine(to: p(2.18, 14.1))
        path.addLine(to: p(2.18, 16.94))
        path.addCurve(to: p(12, 23), control1: p(3.99, 20.53), control2: p(7.7, 23))
        path.closeSubpath()

        // Subpath 3: Left arc
        path.move(to: p(5.84, 14.1))
        path.addCurve(to: p(5.49, 12.01), control1: p(5.62, 13.44), control2: p(5.49, 12.74))
        path.addCurve(to: p(5.84, 9.92), control1: p(5.49, 11.28), control2: p(5.62, 10.58))
        path.addLine(to: p(5.84, 7.08))
        path.addLine(to: p(2.18, 7.08))
        path.addCurve(to: p(1, 12.01), control1: p(1.43, 8.57), control2: p(1, 10.24))
        path.addCurve(to: p(2.18, 16.94), control1: p(1, 13.78), control2: p(1.43, 15.45))
        path.addLine(to: p(5.84, 14.1))
        path.closeSubpath()

        // Subpath 4: Top arc
        path.move(to: p(12, 5.38))
        path.addCurve(to: p(16.21, 7.02), control1: p(13.62, 5.38), control2: p(15.06, 5.94))
        path.addLine(to: p(19.36, 3.87))
        path.addCurve(to: p(12, 1), control1: p(17.45, 2.09), control2: p(14.97, 1))
        path.addCurve(to: p(2.18, 7.08), control1: p(7.7, 1), control2: p(3.99, 3.47))
        path.addLine(to: p(5.84, 9.92))
        path.addCurve(to: p(12, 5.38), control1: p(6.71, 7.32), control2: p(9.14, 5.38))
        path.closeSubpath()

        return path
    }
}

/// Coordinates native Apple Sign In authorization using ASAuthorizationController.
@MainActor
final class AppleAuthCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<Result<ASAuthorization, Error>, Never>?

    func authenticate() async -> Result<ASAuthorization, Error> {
        if continuation != nil {
            return .failure(ASAuthorizationError(.canceled))
        }

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            let provider = ASAuthorizationAppleIDProvider()
            let request = provider.createRequest()
            request.requestedScopes = [.fullName, .email]

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow)
        return window ?? scenes.first?.windows.first ?? UIWindow()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        continuation?.resume(returning: .success(authorization))
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(returning: .failure(error))
        continuation = nil
    }
}

private struct AuthToastBanner: View {
    let message: String
    var onDismiss: () -> Void

    var body: some View {
        Button(action: onDismiss) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(.red)

                Text(message)
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial, in: Capsule())
            .overlay {
                Capsule()
                    .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
            }
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        }
        .buttonStyle(.plain)
    }
}

private struct ArrowBounceButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.86 : 1.0)
            .opacity(configuration.isPressed ? 0.88 : 1.0)
            .animation(.spring(duration: 0.32, bounce: 0.45), value: configuration.isPressed)
    }
}



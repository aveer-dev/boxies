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

    @Environment(AuthStore.self) private var auth
    @State private var hasStartedTransition: Bool = false
    @State private var isAuthRevealed: Bool = false
    @State private var showEmailScreen: Bool = false
    @State private var welcomeDragOffset: CGFloat = 0
    @State private var emailDragOffset: CGFloat = 0
    @State private var showTermsBrowser = false

    @State private var apiBase = AppConfig.apiBaseURL.absoluteString
    @State private var appleCoordinator = AppleAuthCoordinator()
    #if DEBUG
    @State private var showDevConfig = ProcessInfo.processInfo.arguments.contains("-showApiBase")
    @State private var devTapCount = 0
    #endif

    private let authRevealHeightBase: CGFloat = 250

    var body: some View {
        GeometryReader { geometry in
            let screenHeight = geometry.size.height
            let safeArea = geometry.safeAreaInsets
            let authRevealHeight = authRevealHeightBase + safeArea.bottom

            let page1OffsetY: CGFloat = (showEmailScreen ? -screenHeight : 0) + emailDragOffset
            let page2OffsetY: CGFloat = (showEmailScreen ? 0 : screenHeight) + emailDragOffset

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
                            onContinueWithEmail: {
                                withAnimation(.spring(response: 0.40, dampingFraction: 0.86)) {
                                    showEmailScreen = true
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
                        Spacer()

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
                                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
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
                            .buttonStyle(.plain)
                            .padding(.top, 36)
                            .opacity(hasStartedTransition ? 1 : 0)
                            .scaleEffect(hasStartedTransition ? 1 : 0.8)
                            .transition(.scale.combined(with: .opacity))
                        } else {
                            Spacer()
                                .frame(height: 20)
                        }

                        Spacer()

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
                    .background(AppTheme.surface)
                    .clipShape(
                        UnevenRoundedRectangle(
                            bottomLeadingRadius: isAuthRevealed ? 36 : 0,
                            bottomTrailingRadius: isAuthRevealed ? 36 : 0
                        )
                    )
                    .shadow(
                        color: Color.black.opacity(isAuthRevealed ? 0.08 : 0),
                        radius: 16,
                        x: 0,
                        y: 6
                    )
                    .offset(y: (isAuthRevealed ? -authRevealHeight : 0) + welcomeDragOffset)
                    .gesture(
                        isAuthRevealed && !showEmailScreen ?
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
                                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                            welcomeDragOffset = 0
                                        }
                                    }
                                }
                            : nil
                    )
                    .onTapGesture {
                        if isAuthRevealed && !showEmailScreen {
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

                // Page 2: Email Onboarding Screen (Pushes welcome view entirely up, follows in lockstep, draggable back down)
                EmailLoginScreen(
                    safeAreaTop: safeArea.top,
                    isPresented: showEmailScreen,
                    onDismiss: {
                        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                            showEmailScreen = false
                            emailDragOffset = 0
                        }
                    },
                    commitAPIBaseURL: commitAPIBaseURL
                )
                .frame(width: geometry.size.width, height: screenHeight)
                .background(AppTheme.surface)
                .offset(y: page2OffsetY)
                .gesture(
                    DragGesture(minimumDistance: 15)
                        .onChanged { value in
                            if value.translation.height > 0 {
                                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                                emailDragOffset = value.translation.height
                            }
                        }
                        .onEnded { value in
                            if value.translation.height > 120 || value.velocity.height > 350 {
                                withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                                    showEmailScreen = false
                                    emailDragOffset = 0
                                }
                            } else {
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                    emailDragOffset = 0
                                }
                            }
                        }
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
        .sheet(isPresented: $showTermsBrowser) {
            if let termsURL = URL(string: "https://inboxies.email/terms") {
                SafariView(url: termsURL)
                    .ignoresSafeArea()
            }
        }
        .task {
            #if DEBUG
            if expandPasswordForm || ProcessInfo.processInfo.arguments.contains("-previewPasswordSignIn") {
                hasStartedTransition = true
                isAuthRevealed = true
                try? await Task.sleep(nanoseconds: 300_000_000)
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    showEmailScreen = true
                }
            } else if ProcessInfo.processInfo.arguments.contains("-previewAuthOptions") {
                hasStartedTransition = true
                try? await Task.sleep(nanoseconds: 150_000_000)
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    isAuthRevealed = true
                }
            }
            #endif
        }
        .onAppear {
            if !isShowingSplash {
                triggerEntranceAnimation()
            }
        }
        .onChange(of: isShowingSplash) { _, showing in
            if !showing {
                triggerEntranceAnimation()
            }
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
                    apiBase = AppConfig.apiBaseURL.absoluteString
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
/// 1. "Continue with Email" (fully rounded primary pill)
/// 2. Side-by-side Apple and Google buttons as fully rounded liquid glass buttons
/// 3. Terms of Use fine print
private struct AuthButtonsSection: View {
    var onContinueWithEmail: () -> Void
    var onAppleSignIn: () -> Void
    var onGoogleSignIn: () -> Void
    var onOpenTerms: () -> Void
    var commitAPIBaseURL: () -> Void

    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(spacing: 12) {
            if let error = auth.errorMessage {
                Text(error)
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.deepDarkRed)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 2)
            }

            // Primary: Continue with Email (Fully rounded capsule)
            Button(action: onContinueWithEmail) {
                HStack(spacing: 10) {
                    Image(systemName: "envelope.fill")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Continue with Email")
                        .font(.inter(size: 16, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(AppTheme.ink)
                .foregroundStyle(AppTheme.surface)
                .clipShape(Capsule())
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
    var onDismiss: () -> Void
    var commitAPIBaseURL: () -> Void

    enum Step {
        case email
        case password
    }

    @Environment(AuthStore.self) private var auth
    @State private var step: Step = .email
    @State private var email: String = ""
    @State private var password: String = ""
    @FocusState private var isFieldFocused: Bool

    private var isValidEmail: Bool {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.contains("@") && trimmed.contains(".") && trimmed.count >= 5
    }

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle pill placed comfortably below Dynamic Island / notch
            Capsule()
                .fill(AppTheme.line)
                .frame(width: 36, height: 5)
                .padding(.top, max(safeAreaTop, 44) + 16)

            // Header bar with navigation controls
            HStack {
                if step == .password {
                    Button {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                            step = .email
                        }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(AppTheme.ink)
                            .frame(width: 42, height: 42)
                            .liquidGlass(in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Back")
                }

                Spacer()

                // Bigger liquid glass close button
                Button(action: onDismiss) {
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

            VStack(spacing: 0) {
                // Header icon in circle - gray colored, just deeper than pillFill
                ZStack {
                    Circle()
                        .fill(AppTheme.pillFill)
                        .frame(width: 52, height: 52)

                    Image(systemName: step == .email ? "envelope.fill" : "key.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(.top, 24)

                // Title & Subtitle
                Text(step == .email ? "Continue with Email" : "Enter your password")
                    .font(.inter(size: 22, weight: .bold))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.top, 14)

                Text(step == .email ? "Sign in or sign up with your email." : "Sign in with your email \(email.trimmingCharacters(in: .whitespacesAndNewlines))")
                    .font(.inter(size: 14))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                    .padding(.top, 4)

                // Form Fields
                if step == .email {
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
                                withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                                    step = .password
                                }
                            }
                        }

                    Button {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                            step = .password
                        }
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
                    .padding(.top, 16)
                } else {
                    SecureField("Password", text: $password)
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
                            if !password.isEmpty && !auth.isBusy {
                                submitPassword()
                            }
                        }

                    if let error = auth.errorMessage {
                        Text(error)
                            .font(.inter(size: 13))
                            .foregroundStyle(AppTheme.deepDarkRed)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                            .padding(.top, 10)
                    }

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
                    .padding(.top, 16)
                }

                Spacer()
            }
        }
        .safeAreaPadding(.top)
        .background(AppTheme.surface)
        .onChange(of: isPresented) { _, presented in
            if presented {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    isFieldFocused = true
                }
            } else {
                isFieldFocused = false
            }
        }
        .onAppear {
            if isPresented {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    isFieldFocused = true
                }
            }
        }
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

import SwiftUI

extension View {
    /// Lets this screen show "Confirm it's you" when a request inside it hits the
    /// `reauth_required` gate (AVE-170). Attach once per presented surface that
    /// makes sensitive account changes (the settings sheet); the innermost
    /// mounted host presents.
    func reauthPromptHost() -> some View {
        modifier(ReauthPromptHost())
    }
}

private struct ReauthPromptHost: ViewModifier {
    @State private var hostID = UUID()
    private var coordinator: ReauthCoordinator { ReauthCoordinator.shared }

    func body(content: Content) -> some View {
        content
            .onAppear { coordinator.register(host: hostID) }
            .onDisappear { coordinator.unregister(host: hostID) }
            .sheet(isPresented: Binding(
                get: { coordinator.challenge != nil && coordinator.activeHost == hostID },
                // Swiped down or closed: the waiting request gives up.
                set: { if !$0 { coordinator.finish(false) } }
            )) {
                if let challenge = coordinator.challenge {
                    ReauthSheetView(challenge: challenge) { ok in
                        coordinator.finish(ok)
                    }
                    .id(coordinator.promptID)
                }
            }
    }
}

/// "Confirm it's you" (AVE-170): the iOS twin of the web `ReauthDialog`.
/// Offers what the account has (password + 2FA code, passkey, emailed code)
/// and always falls back to signing in again. `onFinish(true)` once
/// `POST /api/v1/me/reauth` accepted the proof; the caller retries its request.
struct ReauthSheetView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth

    let challenge: ReauthChallenge
    var onFinish: (Bool) -> Void

    @State private var method: ReauthMethod?
    @State private var password = ""
    @State private var showPassword = false
    @State private var code = ""
    @State private var useBackupCode = false
    @State private var codeSentTo: String?
    @State private var isBusy = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case password, code
    }

    init(challenge: ReauthChallenge, initialMethod: ReauthMethod? = nil, onFinish: @escaping (Bool) -> Void) {
        self.challenge = challenge
        self.onFinish = onFinish
        _method = State(initialValue: initialMethod ?? challenge.usableMethods.first)
    }

    private var otherMethods: [ReauthMethod] {
        challenge.usableMethods.filter { $0 != method }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    onFinish(false)
                } label: {
                    Image(systemName: "xmark")
                        .font(.inter(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                .disabled(isBusy)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)

            ScrollView {
                VStack(spacing: 0) {
                    header

                    VStack(spacing: 12) {
                        methodContent

                        if let errorMessage {
                            SettingsFormErrorBanner(message: errorMessage)
                                .padding(.horizontal, 4)
                                .transition(.opacity)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 22)

                    if !otherMethods.isEmpty || method != nil {
                        footerLinks
                            .padding(.horizontal, 24)
                            .padding(.top, 20)
                    }
                }
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(AppTheme.background)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
        .interactiveDismissDisabled(isBusy)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: method)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: errorMessage)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: codeSentTo)
        .tint(AppTheme.accent)
        .onAppear {
            if method == .password { focusedField = .password }
        }
    }

    // MARK: - Sections

    private var header: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle()
                    .fill(AppTheme.pillFill)
                    .frame(width: 52, height: 52)
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(AppTheme.muted)
            }

            Text("Confirm it's you")
                .font(.inter(size: AppTheme.FontSize.largeTitle, weight: .bold))
                .foregroundStyle(AppTheme.ink)
                .padding(.top, 14)

            Text("You're changing how your account signs in or recovers. Confirm it's you to continue.")
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 24)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var methodContent: some View {
        switch method {
        case .password:
            passwordForm
        case .passkey:
            primaryButton("Use a passkey", systemImage: "person.badge.key.fill", enabled: true) {
                Task { await usePasskey() }
            }
        case .emailCode:
            emailCodeForm
        case .signIn, .none:
            Text("Sign out and sign back in, then try again within 5 minutes.")
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            primaryButton("Sign out", systemImage: nil, enabled: true) {
                signOut()
            }
        }
    }

    private var passwordReady: Bool {
        !password.isEmpty && (!challenge.twoFactor || !code.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    private var passwordForm: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Group {
                    if showPassword {
                        TextField("Password", text: $password)
                    } else {
                        SecureField("Password", text: $password)
                    }
                }
                .font(.inter(size: SettingsFormChrome.rowFontSize))
                .foregroundStyle(AppTheme.ink)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(challenge.twoFactor ? .next : .go)
                .focused($focusedField, equals: .password)
                .onSubmit {
                    if challenge.twoFactor {
                        focusedField = .code
                    } else if passwordReady {
                        Task { await submitPassword() }
                    }
                }

                Button {
                    showPassword.toggle()
                } label: {
                    Image(systemName: showPassword ? "eye.slash" : "eye")
                        .font(.system(size: 15))
                        .foregroundStyle(AppTheme.muted)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showPassword ? "Hide password" : "Show password")
            }
            .padding(.leading, 14)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .reauthFieldChrome()

            if challenge.twoFactor {
                VStack(alignment: .trailing, spacing: 8) {
                    Group {
                        if useBackupCode {
                            TextField("Backup code", text: $code)
                                .keyboardType(.asciiCapable)
                        } else {
                            TextField("Authenticator code", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                        }
                    }
                    .font(.inter(size: SettingsFormChrome.rowFontSize))
                    .foregroundStyle(AppTheme.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .code)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 13)
                    .reauthFieldChrome()

                    quietLink(useBackupCode ? "Use your authenticator app" : "Use a backup code", accent: true) {
                        useBackupCode.toggle()
                        code = ""
                        errorMessage = nil
                        focusedField = .code
                    }
                }
            }

            primaryButton("Confirm", systemImage: nil, enabled: passwordReady) {
                Task { await submitPassword() }
            }
        }
    }

    @ViewBuilder
    private var emailCodeForm: some View {
        if let codeSentTo {
            Text("Enter the 6-digit code we sent to \(Text(codeSentTo).font(.inter(size: 14, weight: .semibold))).")
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            TextField("6-digit code", text: $code)
                .font(.inter(size: 20, weight: .bold))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focusedField, equals: .code)
                .padding(13)
                .reauthFieldChrome()
                .onChange(of: code) { _, next in
                    if next.count > 6 { code = String(next.prefix(6)) }
                }
            primaryButton("Confirm", systemImage: nil, enabled: code.trimmingCharacters(in: .whitespaces).count >= 6) {
                Task { await submitEmailCode() }
            }
        } else {
            Text("We'll email a 6-digit code to \(Text(challenge.emailCodeTo ?? "your recovery email").font(.inter(size: 14, weight: .semibold))).")
                .font(.inter(size: 14))
                .foregroundStyle(AppTheme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            primaryButton("Send code", systemImage: nil, enabled: true) {
                Task { await sendEmailCode() }
            }
        }
    }

    private var footerLinks: some View {
        VStack(spacing: 14) {
            Rectangle()
                .fill(AppTheme.line)
                .frame(height: 0.5)
            VStack(spacing: 12) {
                ForEach(otherMethods, id: \.self) { other in
                    quietLink(switchLabel(other), systemImage: switchIcon(other)) {
                        switchTo(other)
                    }
                }
                if method != nil {
                    quietLink("Sign in again instead") {
                        signOut()
                    }
                }
            }
        }
        .disabled(isBusy)
    }

    // MARK: - Pieces

    private func primaryButton(
        _ title: String,
        systemImage: String?,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let active = enabled && !isBusy
        return Button(action: action) {
            HStack(spacing: 8) {
                if isBusy {
                    ProgressView()
                        .tint(AppTheme.surface)
                        .scaleEffect(0.9)
                } else {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .font(.system(size: 15, weight: .semibold))
                    }
                    Text(title)
                        .font(.inter(size: 16, weight: .semibold))
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(active || isBusy ? AppTheme.ink : AppTheme.pillActive)
            .foregroundStyle(active ? AppTheme.surface : AppTheme.muted)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!active)
    }

    private func quietLink(
        _ title: String,
        systemImage: String? = nil,
        accent: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 13))
                }
                Text(title)
                    .font(.inter(size: 13, weight: .medium))
            }
            .foregroundStyle(accent ? AppTheme.accent : AppTheme.muted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func switchLabel(_ method: ReauthMethod) -> String {
        switch method {
        case .password: return "Use your password"
        case .passkey: return "Use a passkey"
        case .emailCode: return "Email me a code"
        case .signIn: return "Sign in again instead"
        }
    }

    private func switchIcon(_ method: ReauthMethod) -> String {
        switch method {
        case .password: return "key"
        case .passkey: return "person.badge.key"
        case .emailCode: return "envelope"
        case .signIn: return "arrow.right.circle"
        }
    }

    // MARK: - Actions

    private func switchTo(_ next: ReauthMethod) {
        method = next
        code = ""
        errorMessage = nil
        focusedField = next == .password ? .password : nil
    }

    private func run(_ fallback: String, _ work: () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            try await work()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onFinish(true)
        } catch Passkeys.Failure.cancelled {
            // A dismissed passkey sheet isn't worth an error.
            return
        } catch {
            let text = error.localizedDescription
            errorMessage = text.isEmpty ? fallback : text
        }
    }

    private func submitPassword() async {
        guard passwordReady else { return }
        await run("Couldn't confirm it's you.") {
            #if DEBUG
            if app.isDebugPreview { return }
            #endif
            _ = try await APIClient.shared.reauthWithPassword(
                password: password,
                code: challenge.twoFactor ? code : nil,
                useBackupCode: useBackupCode
            )
        }
    }

    private func usePasskey() async {
        await run("That passkey couldn't confirm it's you.") {
            #if DEBUG
            if app.isDebugPreview { return }
            #endif
            try await Passkeys.reauthenticate()
        }
    }

    private func sendEmailCode() async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        #if DEBUG
        if app.isDebugPreview {
            codeSentTo = challenge.emailCodeTo
            return
        }
        #endif
        do {
            let res = try await APIClient.shared.sendReauthEmailCode()
            codeSentTo = res.sentTo ?? challenge.emailCodeTo ?? "your email"
            #if DEBUG
            if let devCode = res.devCode { code = devCode }
            #endif
            focusedField = .code
        } catch {
            errorMessage = error.localizedDescription.isEmpty ? "Couldn't send the code." : error.localizedDescription
        }
    }

    private func submitEmailCode() async {
        await run("Invalid or expired code.") {
            #if DEBUG
            if app.isDebugPreview { return }
            #endif
            _ = try await APIClient.shared.reauthWithEmailCode(code)
        }
    }

    private func signOut() {
        onFinish(false)
        app.signOut(auth: auth)
    }
}

private extension View {
    /// Settings field surface: `surface` fill, continuous 12pt corners, `line` hairline.
    func reauthFieldChrome() -> some View {
        self
            .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(AppTheme.line, lineWidth: 1)
            )
    }
}

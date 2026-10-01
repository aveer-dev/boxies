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
                        MailboxOnboardingView()
                    } else {
                        HomeShellView()
                            .task(id: auth.token) {
                                #if DEBUG
                                if ProcessInfo.processInfo.arguments.contains("-previewMailbox")
                                    || ProcessInfo.processInfo.arguments.contains("-previewDetail")
                                    || ProcessInfo.processInfo.arguments.contains("-previewCompose")
                                    || ProcessInfo.processInfo.arguments.contains("-previewScreener")
                                    || ProcessInfo.processInfo.arguments.contains("-previewReplyLater") {
                                    return
                                }
                                #endif
                                await app.bootstrap(authToken: auth.token)
                            }
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

struct MailboxOnboardingView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth

    enum OnboardingTrack: Equatable {
        case select
        case personal
        case domain
        case dnsWizard(domain: String, nameservers: [String])
    }

    @State private var track: OnboardingTrack = {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-previewDomainOnboarding") {
            return .domain
        }
        #endif
        return .personal
    }()
    @State private var devTapCount = 0
    @State private var personalName = ""
    @State private var personalUsername = ""
    @State private var customDomain = ""
    @State private var customUsername = ""
    @State private var customPassword = ""
    @State private var customName = ""
    @State private var availability: DomainAvailabilityResponse?
    @State private var isCheckingDomain = false
    @State private var domainAction = "purchase"
    @State private var checkTask: Task<Void, Never>?
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if app.isAdmin && track == .personal && ProcessInfo.processInfo.arguments.contains("-previewDomainAdmin") {
                    DomainAdminSettingsView(showsDismiss: false)
                } else {
                    Form {
                        switch track {
                        case .select:
                            Section {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Welcome to Inboxies")
                                        .font(.inter(size: 24, weight: .bold))
                                        .foregroundStyle(AppTheme.ink)
                                    Text("Choose how you would like to set up your email.")
                                        .font(.inter(size: 15))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.vertical, 8)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                            }

                            Section {
                                Button {
                                    track = .personal
                                } label: {
                                    HStack(spacing: 14) {
                                        Image(systemName: "envelope.fill")
                                            .font(.system(size: 20))
                                            .foregroundStyle(Color.green)
                                            .frame(width: 36, height: 36)
                                            .background(Color.green.opacity(0.12))
                                            .clipShape(RoundedRectangle(cornerRadius: 8))

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Personal Address")
                                                .font(.inter(size: 16, weight: .semibold))
                                                .foregroundStyle(AppTheme.ink)
                                            Text("Instant @\(app.mailDomain) email. No setup required.")
                                                .font(.inter(size: 13))
                                                .foregroundStyle(AppTheme.muted)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(AppTheme.muted)
                                    }
                                    .padding(.vertical, 4)
                                }

                                Button {
                                    track = .domain
                                } label: {
                                    HStack(spacing: 14) {
                                        Image(systemName: "globe")
                                            .font(.system(size: 20))
                                            .foregroundStyle(AppTheme.accent)
                                            .frame(width: 36, height: 36)
                                            .background(AppTheme.accent.opacity(0.12))
                                            .clipShape(RoundedRectangle(cornerRadius: 8))

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Custom Domain")
                                                .font(.inter(size: 16, weight: .semibold))
                                                .foregroundStyle(AppTheme.ink)
                                            Text("Automate Cloudflare setup with your own domain.")
                                                .font(.inter(size: 13))
                                                .foregroundStyle(AppTheme.muted)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(AppTheme.muted)
                                    }
                                    .padding(.vertical, 4)
                                }
                            }

                        case .personal:
                            Section {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Welcome to Inboxies")
                                        .font(.inter(size: 24, weight: .bold))
                                        .foregroundStyle(AppTheme.ink)
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            #if DEBUG
                                            devTapCount += 1
                                            if devTapCount >= 5 {
                                                track = .domain
                                                devTapCount = 0
                                            }
                                            #endif
                                        }
                                    Text("Choose your address on @\(app.mailDomain).")
                                        .font(.inter(size: 14))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.vertical, 4)
                            }
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)

                            if let errorMessage {
                                Section {
                                    Text(errorMessage)
                                        .font(.inter(size: 13))
                                        .foregroundStyle(AppTheme.deepDarkRed)
                                }
                            }

                            Section {
                                TextField("Full Name (optional)", text: $personalName)
                                HStack {
                                    TextField("Username", text: $personalUsername)
                                        .keyboardType(.emailAddress)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                        .focused($isFocused)
                                    Text("@\(app.mailDomain)")
                                        .foregroundStyle(AppTheme.muted)
                                }
                            }

                            Section {
                                Button {
                                    Task { await createPersonal() }
                                } label: {
                                    HStack {
                                        Spacer()
                                        if isSubmitting { ProgressView() }
                                        else { Text("Create Address").font(.inter(size: 16, weight: .medium)) }
                                        Spacer()
                                    }
                                }
                                .disabled(personalUsername.isEmpty || isSubmitting)

                                #if DEBUG
                                Button {
                                    track = .domain
                                } label: {
                                    HStack {
                                        Spacer()
                                        Text("🧪 Test Domain Onboarding (Dev only)")
                                            .font(.inter(size: 12))
                                            .foregroundStyle(AppTheme.muted.opacity(0.7))
                                        Spacer()
                                    }
                                }
                                #endif
                            }

                        case .domain:
                            Section {
                                Text("Connect Custom Domain")
                                    .font(.inter(size: 20, weight: .bold))
                                    .foregroundStyle(AppTheme.ink)
                                Text("We will automatically provision the Cloudflare zone and email routing.")
                                    .font(.inter(size: 14))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)

                            if let errorMessage {
                                Section {
                                    Text(errorMessage)
                                        .font(.inter(size: 13))
                                        .foregroundStyle(AppTheme.deepDarkRed)
                                }
                            }

                            Section("Domain") {
                                TextField("e.g. acme.corp", text: $customDomain)
                                    .keyboardType(.URL)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .onChange(of: customDomain) { _, newDomain in
                                        handleDomainChange(newDomain)
                                    }

                                if isCheckingDomain {
                                    HStack(spacing: 8) {
                                        ProgressView()
                                            .controlSize(.small)
                                        Text("Checking domain availability...")
                                            .font(.inter(size: 12))
                                            .foregroundStyle(AppTheme.muted)
                                    }
                                    .padding(.vertical, 2)
                                } else if let avail = availability {
                                    if avail.alreadyInInboxies == true {
                                        Text("This domain is already registered with Inboxies. Please sign in or use another domain.")
                                            .font(.inter(size: 12))
                                            .foregroundStyle(AppTheme.deepDarkRed)
                                    } else if avail.available {
                                        VStack(alignment: .leading, spacing: 8) {
                                            HStack {
                                                Label("Available for $\(String(format: "%.2f", avail.retailPriceUsd))/yr", systemImage: "checkmark.circle.fill")
                                                    .font(.inter(size: 13, weight: .semibold))
                                                    .foregroundStyle(Color.green)
                                                Spacer()
                                            }

                                            Picker("Setup Mode", selection: $domainAction) {
                                                Text("Register ($\(String(format: "%.0f", avail.retailPriceUsd))/yr)").tag("purchase")
                                                Text("I already own it").tag("connect")
                                            }
                                            .pickerStyle(.segmented)
                                        }
                                        .padding(.vertical, 4)
                                    } else {
                                        HStack {
                                            Label("Registered elsewhere", systemImage: "info.circle")
                                                .font(.inter(size: 13))
                                                .foregroundStyle(AppTheme.muted)
                                        }
                                    }
                                }
                            }

                            // Powered by Cloudflare Service Extension Card
                            Section {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "shield.checkered")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Color.orange)
                                        Text("Powered by Cloudflare")
                                            .font(.inter(size: 13, weight: .semibold))
                                            .foregroundStyle(AppTheme.ink)
                                    }
                                    Text("Anycast DNS • Universal SSL • DMARC Email Routing • DDoS Protection")
                                        .font(.inter(size: 11))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .padding(.vertical, 2)
                            }

                            Section("Admin Credentials") {
                                HStack {
                                    TextField("Username", text: $customUsername)
                                        .keyboardType(.emailAddress)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                    Text("@\(customDomain.isEmpty ? "yourdomain.com" : customDomain)")
                                        .foregroundStyle(AppTheme.muted)
                                }
                                TextField("Full Name (optional)", text: $customName)
                                SecureField("Password (min 10 chars)", text: $customPassword)
                            }

                            Section {
                                if domainAction == "purchase" && (availability?.available == true) {
                                    Button {
                                        Task { await purchaseCustomDomain() }
                                    } label: {
                                        HStack {
                                            Spacer()
                                            if isSubmitting { ProgressView() }
                                            else {
                                                Text("Continue to Checkout ($\(String(format: "%.2f", availability?.retailPriceUsd ?? 14.0))/yr)")
                                                    .font(.inter(size: 16, weight: .medium))
                                            }
                                            Spacer()
                                        }
                                    }
                                    .disabled(customDomain.isEmpty || customUsername.isEmpty || customPassword.count < 10 || isSubmitting || availability?.alreadyInInboxies == true)
                                } else {
                                    Button {
                                        Task { await createCustomDomain() }
                                    } label: {
                                        HStack {
                                            Spacer()
                                            if isSubmitting { ProgressView() }
                                            else { Text("Connect & Provision Domain").font(.inter(size: 16, weight: .medium)) }
                                            Spacer()
                                        }
                                    }
                                    .disabled(customDomain.isEmpty || customUsername.isEmpty || customPassword.count < 10 || isSubmitting || availability?.alreadyInInboxies == true)
                                }

                                Button("← Back to Personal Address") {
                                    track = .personal
                                }
                                .foregroundStyle(AppTheme.muted)
                            }

                        case .dnsWizard(let domain, let nameservers):
                            Section {
                                VStack(alignment: .leading, spacing: 8) {
                                    Label("Domain Registered!", systemImage: "checkmark.circle.fill")
                                        .font(.inter(size: 20, weight: .bold))
                                        .foregroundStyle(Color.green)
                                    Text("Cloudflare Email Routing is ready for \(domain).")
                                        .font(.inter(size: 14))
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                            }

                            if let statusMessage {
                                Section {
                                    Text(statusMessage)
                                        .font(.inter(size: 13))
                                        .foregroundStyle(AppTheme.accent)
                                }
                            }

                            Section("Update Registrar Nameservers") {
                                Text("Point your nameservers to Cloudflare at your registrar (GoDaddy, Namecheap, etc.):")
                                    .font(.inter(size: 13))
                                    .foregroundStyle(AppTheme.muted)

                                ForEach(nameservers, id: \.self) { ns in
                                    HStack {
                                        Text(ns)
                                            .font(.system(size: 13, design: .monospaced))
                                            .foregroundStyle(AppTheme.ink)
                                        Spacer()
                                        Button {
                                            UIPasteboard.general.string = ns
                                            statusMessage = "Copied \(ns)"
                                        } label: {
                                            Image(systemName: "doc.on.doc")
                                                .foregroundStyle(AppTheme.accent)
                                        }
                                        .buttonStyle(.borderless)
                                    }
                                }
                            }

                            Section {
                                Button {
                                    Task {
                                        await app.refreshMailboxes(showLoading: true)
                                    }
                                } label: {
                                    HStack {
                                        Spacer()
                                        Text("Go to Inbox")
                                            .font(.inter(size: 16, weight: .semibold))
                                            .foregroundStyle(AppTheme.accent)
                                        Spacer()
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sign out", role: .destructive) {
                        auth.signOut()
                    }
                    .foregroundStyle(.red)
                }
            }
        }
    }

    private func createPersonal() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let fullEmail = "\(personalUsername)@\(app.mailDomain)"
            await app.createMailbox(name: personalName.isEmpty ? personalUsername : personalName, email: fullEmail)
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

    private func purchaseCustomDomain() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let domain = customDomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let username = customUsername.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let returnUrl = "inboxies://onboarding/domain-ready"
            let res = try await APIClient.shared.createDomainCheckout(
                domain: domain,
                username: username,
                password: customPassword,
                displayName: customName.isEmpty ? nil : customName,
                returnUrl: returnUrl
            )
            if let url = URL(string: res.checkoutUrl) {
                await UIApplication.shared.open(url)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func createCustomDomain() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let res = try await APIClient.shared.signupDomain(
                domain: customDomain.trimmingCharacters(in: .whitespacesAndNewlines),
                username: customUsername.trimmingCharacters(in: .whitespacesAndNewlines),
                password: customPassword,
                displayName: customName.isEmpty ? nil : customName
            )
            auth.applySession(token: res.token, email: res.mailbox.email)
            await app.bootstrap(authToken: res.token)
            track = .dnsWizard(domain: res.domain.domain, nameservers: res.domain.nameservers)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

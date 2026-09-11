import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if auth.isAuthenticated {
                if !app.isMailboxLoading && app.mailboxes.isEmpty {
                    MailboxOnboardingView()
                } else {
                    HomeShellView()
                        .task(id: auth.token) {
                            await app.bootstrap(authToken: auth.token)
                        }
                }
            } else {
                SignInView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isAuthenticated)
        .font(.inter(size: 14))
    }
}

struct MailboxOnboardingView: View {
    @Environment(AppModel.self) private var app
    @Environment(AuthStore.self) private var auth

    @State private var newMailboxName = ""
    @State private var newMailboxEmail = ""
    @State private var isCreating = false
    @FocusState private var isNameFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Welcome to Inboxies")
                            .font(.inter(size: 24, weight: .bold))
                            .foregroundStyle(AppTheme.ink)
                        Text("Create your first email address to start using the platform.")
                            .font(.inter(size: 15))
                            .foregroundStyle(AppTheme.muted)
                    }
                    .padding(.vertical, 16)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }

                Section {
                    TextField("Full Name", text: $newMailboxName)
                        .focused($isNameFocused)
                    HStack {
                        TextField("Username", text: $newMailboxEmail)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .onChange(of: newMailboxEmail) { _, newValue in
                                if let atIndex = newValue.firstIndex(of: "@") {
                                    newMailboxEmail = String(newValue[..<atIndex])
                                }
                            }
                        Text("@inboxies.email")
                            .foregroundStyle(AppTheme.muted)
                    }
                } footer: {
                    Text("This will be your primary email address.")
                }
                
                Section {
                    Button(action: {
                        Task {
                            isCreating = true
                            let fullEmail = "\(newMailboxEmail)@inboxies.email"
                            await app.createMailbox(name: newMailboxName, email: fullEmail)
                            isCreating = false
                        }
                    }) {
                        HStack {
                            Spacer()
                            if isCreating {
                                ProgressView()
                            } else {
                                Text("Create Email")
                                    .font(.inter(size: 16, weight: .medium))
                            }
                            Spacer()
                        }
                    }
                    .disabled(newMailboxEmail.isEmpty || newMailboxName.isEmpty || isCreating)
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
            .onAppear {
                isNameFocused = true
            }
        }
    }
}


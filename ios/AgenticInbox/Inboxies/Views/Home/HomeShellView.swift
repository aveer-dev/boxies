import SwiftUI
import UIKit

/// Main shell: native large-title toolbar, content list, floating action bar.
struct HomeShellView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager

    @State private var showSearch = false
    @State private var showChat = false
    @State private var chatSeedPrompt: String?
    @State private var tabNavigatingForward = true
    @State private var registeredUndoID: UUID?
    @State private var showSettings = false
    @State private var isSelectMode = false
    @State private var selectedEmailIDs: Set<String> = []
    @State private var filterState = EmailFilterState()
    @State private var showAddMailboxSheet = false
    @State private var newMailboxName = ""
    @State private var newMailboxEmail = ""
    @FocusState private var isNameFocused: Bool
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system
    @Namespace private var barNamespace
    @State private var composeMorphsFromBar = false
    @State private var showComposeSheet = false
    @State private var showComposeActions = false
    @State private var highlightedComposeAction: ComposeActionItem.ID?
    @State private var composeActionRowFrames: [ComposeActionItem.ID: CGRect] = [:]
    @State private var composeTouchBeganAt: Date?
    @State private var composeDidTriggerCompose = false
    @State private var composePressToken = UUID()
    @State private var composeLastTapAt: Date?
    @State private var composeDoubleTapArmed = false

    static let askAITransitionID = "ai-chat-button"
    static let composeTransitionID = "compose-button"

    private let folderTabs: [HomeTab] = [
        .aiInbox,
//        .chats,
        .folder("inbox"),
        .folder("screener"),
        .folder("promotions"),
        .folder("updates"),
        .folder("sent"),
        .folder("draft"),
        .folder("archive"),
        .folder("spam"),
        .folder("trash")
    ]

    private var tabSpring: Animation {
        .spring(duration: 0.42, bounce: 0.18)
    }

    private var hasMinimizedCompose: Bool {
        app.composeSession?.isMinimized == true
    }

    private var listBottomInset: CGFloat {
        HomeChromeMetrics.listBottomInset(hasMinimizedCompose: hasMinimizedCompose)
    }

    var body: some View {
        shell
            .animation(.spring(response: 0.32, dampingFraction: 0.88), value: isComposeExpanded)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: hasMinimizedCompose)
            .sheet(item: selectedEmailItem) { _ in
                EmailDetailView()
            }
            .fullScreenCover(isPresented: $showComposeSheet, onDismiss: {
                composeMorphsFromBar = false
                if app.composeSession?.isExpanded == true {
                    app.minimizeCompose()
                }
            }) {
                expandedComposeSheet
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheetView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $showChat, onDismiss: {
                dismissChat()
            }) {
                chatSheet
            }
            .onChange(of: isComposeExpanded) { _, expanded in
                showComposeSheet = expanded
            }
            .onAppear {
                if isComposeExpanded {
                    showComposeSheet = true
                }
            }
            .onChange(of: app.pendingUndoAction?.id) { _, newID in
                registerUndoIfNeeded(newID)
            }
            .sensoryFeedback(.success, trigger: app.pendingUndoAction?.id)
            .sensoryFeedback(.selection, trigger: highlightedComposeAction)
    }

    private var shell: some View {
        ZStack {
            homeNavigation
                .opacity(showSearch ? 0 : 1)
                .allowsHitTesting(!showSearch)
                .accessibilityHidden(showSearch)

            if showSearch {
                SearchView(onClose: closeSearch)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.28), value: showSearch)
        .background(alignment: .top) {
            ProgressiveBlurBackground()
                .opacity(showSearch ? 0 : 1)
        }
        .tint(AppTheme.ink)
        .animation(tabSpring, value: app.selectedTab)
        .background(AppTheme.background.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            if !showSearch {
                composeChrome
            }
        }
        .overlay {
            if showComposeActions {
                ComposeActionListOverlay(
                    highlightedID: highlightedComposeAction,
                    onSelect: { item in
                        performComposeAction(item)
                    },
                    onDismiss: {
                        dismissComposeActions()
                    },
                    onRowFramesChange: { frames in
                        composeActionRowFrames = frames
                    }
                )
            }
        }
        // Instant present — spring lives inside overlay rows, not a delayed container fade.
        .animation(nil, value: showComposeActions)
        .overlay(alignment: .bottomTrailing) {
            if showComposeActions && composeDoubleTapArmed {
                Color.clear
                    .frame(
                        width: HomeChromeMetrics.actionBarHeight,
                        height: HomeChromeMetrics.composeStackHeight()
                    )
                    .contentShape(Rectangle())
                    .padding(.trailing, 24)
                    .padding(.bottom, HomeChromeMetrics.chromeBottomPadding)
                    .onTapGesture {
                        composeDoubleTapArmed = false
                        composeLastTapAt = nil
                        dismissComposeActions()
                        startComposeFromBar()
                    }
            }
        }
    }

    private var homeNavigation: some View {
        NavigationStack {
            tabContent
                .background(AppTheme.background)
                .background(HomeNavigationTitleFont())
                .navigationTitle(navigationTitleText)
                .navigationBarTitleDisplayMode(.large)
                .toolbarRole(.editor)
                .modifier(HomeNavigationSubtitle(subtitle: navigationSubtitleText, fontWeight: .regular))
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        mailboxControl
                    }
                    if case .folder = app.selectedTab {
                        // Trailing items are placed outside-in: declare rightmost first.
                        ToolbarItem(placement: .topBarTrailing) {
                            searchToolbarButton
                        }
                        if #available(iOS 26.0, *) {
                            ToolbarSpacer(.fixed, placement: .topBarTrailing)
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            HStack(spacing: 8) {
                                selectButton
                                filterButton
                            }
                        }
                    } else {
                        ToolbarItem(placement: .topBarTrailing) {
                            trailingToolbarItems
                        }
                    }
                }
                .toolbarBackground(.hidden, for: .navigationBar)
        }
    }

    private var isComposeExpanded: Bool {
        app.composeSession?.isExpanded == true
    }

    private func openChat(seedPrompt: String? = nil, conversationId: String? = nil, resumeActive: Bool = true) {
        chatSeedPrompt = seedPrompt
        if let conversationId {
            app.openChatSession(existingId: conversationId)
        } else if seedPrompt != nil {
            app.openChatSession(forceNew: true)
        } else {
            app.openChatSession(resumeActive: resumeActive, forceNew: !resumeActive)
        }
        showChat = true
    }

    @ViewBuilder
    private var chatSheet: some View {
        ChatSheetView(
            seedPrompt: chatSeedPrompt,
            initialConversationId: app.chatSession.conversationId
        )
        .modifier(CoverDragIndicator())
        .modifier(BarSheetZoom(enabled: true, id: Self.askAITransitionID, namespace: barNamespace))
        .presentationBackground(AppTheme.background)
    }

    @ViewBuilder
    private var expandedComposeSheet: some View {
        if let session = app.composeSession {
            ComposeSheetView(session: session)
                .modifier(CoverDragIndicator())
                .modifier(BarSheetZoom(
                    enabled: composeMorphsFromBar,
                    id: Self.composeTransitionID,
                    namespace: barNamespace
                ))
                .presentationBackground(AppTheme.background)
        }
    }

    @ViewBuilder
    private var composeChrome: some View {
        VStack(spacing: 0) {
            VStack(spacing: HomeChromeMetrics.chromeSpacing) {
                if let toast = app.toast {
                    HStack(spacing: 8) {
                        if toast.isLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                                .font(.inter(size: 13, weight: .semibold))
                                .foregroundStyle(toast.isError ? .red : AppTheme.ink)
                        }

                        Text(toast.message)
                            .font(.inter(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.ink)
                            
                        if toast.isUndo {
                            Spacer(minLength: 8)
                            Button("Undo") {
                                app.undoPendingAction()
                            }
                            .font(.inter(size: 13, weight: .semibold))
                            .foregroundStyle(AppTheme.accent)
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.regularMaterial, in: Capsule())
                    .overlay {
                        Capsule()
                            .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
                    }
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                    .padding(.horizontal, HomeChromeMetrics.chromeHorizontalPadding)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                if isSelectMode {
                    selectionActionBar
                        .padding(.horizontal, 16)
                        .padding(.bottom, HomeChromeMetrics.chromeBottomPadding)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    bottomBar
                        .padding(.horizontal, 24)
                        .padding(.bottom, HomeChromeMetrics.chromeBottomPadding)
                }
            }

            if let session = app.composeSession, session.isMinimized, !isSelectMode {
                ComposeDockBar(session: session)
                    .ignoresSafeArea(edges: .bottom)
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.pendingUndoAction?.id)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.toast?.id)
        .animation(tabSpring, value: app.selectedTab)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: isSelectMode)
        .padding(.bottom, -12)
    }

    private func registerUndoIfNeeded(_ newID: UUID?) {
        guard let newID, let action = app.pendingUndoAction, action.id == newID else {
            if newID == nil {
                registeredUndoID = nil
            }
            return
        }
        guard registeredUndoID != newID else { return }
        registeredUndoID = newID
        undoManager?.registerUndo(withTarget: app) { model in
            model.undoPendingAction()
        }
        undoManager?.setActionName("Action")
    }

    private var selectedEmailItem: Binding<IdentifiedEmail?> {
        Binding(
            get: {
                guard let email = app.selectedEmail else { return nil }
                return IdentifiedEmail(email: email)
            },
            set: { newValue in
                if newValue == nil {
                    app.selectedEmail = nil
                }
            }
        )
    }

    private func dismissChat() {
        app.dismissChatSession()
        chatSeedPrompt = nil
    }

    /// Pull-down menu from the avatar, no popover arrow.
    private var mailboxButton: some View {
        Menu {
            ForEach(app.mailboxes) { mailbox in
                Button {
                    Task { await app.loadMailbox(mailbox.id) }
                } label: {
                    let displayName = self.displayName(for: mailbox)
                    if mailbox.id == app.selectedMailboxId {
                        Label(displayName, systemImage: "checkmark")
                    } else {
                        Text(displayName)
                    }
                }
            }
            Divider()
            Button("Add another email", systemImage: "plus") {
                showAddMailboxSheet = true
            }
            Button("Settings", systemImage: "gearshape") {
                showSettings = true
            }
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                auth.signOut()
            }
        } label: {
            mailboxAvatar(initials: initials)
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityLabel("Mailbox")
        .accessibilityValue("\(mailboxName), \(mailboxTitle)")
        .sheet(isPresented: $showAddMailboxSheet) {
            NavigationStack {
                Form {
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
                            Text("@\(app.mailDomain)")
                                .foregroundStyle(AppTheme.muted)
                        }
                    } footer: {
                        Text("Create a new email address for this workspace.")
                    }
                }
                .onAppear {
                    isNameFocused = true
                }
                .navigationTitle("Add Mailbox")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button { showAddMailboxSheet = false }
                        label: {
                            Image(systemName: "xmark")
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Create") {
                            Task {
                                let fullEmail = "\(newMailboxEmail)@\(app.mailDomain)"
                                await app.createMailbox(name: newMailboxName, email: fullEmail)
                                showAddMailboxSheet = false
                                newMailboxName = ""
                                newMailboxEmail = ""
                            }
                        }
                        .disabled(newMailboxEmail.isEmpty || newMailboxName.isEmpty)
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func mailboxAvatar(initials: String) -> some View {
        Text(initials)
            .font(.inter(size: initials.count > 1 ? 13 : 15, weight: .semibold))
            .foregroundStyle(AppTheme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: Self.mailboxAvatarSize, height: Self.mailboxAvatarSize)
            .background(AppTheme.pillFill, in: Circle())
    }

    private var navigationTitleText: String {
        if case .aiInbox = app.selectedTab {
            if let name = app.inboxDigest?.greetingName, !name.isEmpty {
                return "Hi \(name) 👋"
            }
            return "Hi 👋"
        }
        return app.selectedTab.title
    }

    private var filteredEmails: [Email] {
        filterState.filter(app.emails, userEmail: mailboxTitle)
    }

    private var navigationSubtitleText: String {
        if case .aiInbox = app.selectedTab {
            if let digest = app.inboxDigest {
                let count = digest.todos.count
                if count == 0 { return "You’re all caught up on suggested to-dos" }
                return "You have \(count) suggested to-do\(count == 1 ? "" : "s")"
            }
            return app.isDigestLoading ? "Loading…" : ""
        }
        if case .replyLater = app.selectedTab {
            let count = app.replyLaterCount
            if count == 0 { return "Nothing queued" }
            if count == 1 { return "1 to reply" }
            return "\(count) to reply"
        }
        guard case .folder = app.selectedTab else { return "" }
        if isSelectMode {
            return selectedEmailIDs.isEmpty ? "Select emails" : "\(selectedEmailIDs.count) selected"
        }
        if filterState.isActive {
            return "\(filteredEmails.count) filtered · \(filterState.activeCount) active"
        }
        return activeFolderUnreadLabel
    }

    private var activeFolderUnreadCount: Int {
        guard case let .folder(folderId) = app.selectedTab else { return 0 }
        return app.unreadCount(forFolderId: folderId)
    }

    private var activeFolderUnreadLabel: String {
        let count = activeFolderUnreadCount
        if count == 0 { return "No unread" }
        if count == 1 { return "1 unread" }
        return "\(count) unread"
    }

    /// Same circle whether the menu is ready or still a skeleton.
    @ViewBuilder
    private var mailboxControl: some View {
        ZStack {
            mailboxButton
                .opacity(app.isMailboxLoading ? 0 : 1)
                .allowsHitTesting(!app.isMailboxLoading)
                .accessibilityHidden(app.isMailboxLoading)
            if app.isMailboxLoading {
                Circle()
                    .fill(AppTheme.pillFill)
                    .frame(width: Self.mailboxAvatarSize, height: Self.mailboxAvatarSize)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: Self.mailboxAvatarSize, height: Self.mailboxAvatarSize)
        .skeletonPulse(app.isMailboxLoading)
        .modifier(MailboxLoadingAccessibility(isLoading: app.isMailboxLoading))
    }

    @ViewBuilder
    private var tabContent: some View {
        Group {
            switch app.selectedTab {
            case .folder:
                EmailListView(
                    emails: filteredEmails,
                    isLoading: app.isLoading,
                    fallbackFolderId: currentFolderId,
                    bottomInset: listBottomInset,
                    onRefresh: { await app.refreshCurrentTab() },
                    isSelectMode: isSelectMode,
                    selectedEmailIDs: $selectedEmailIDs,
                    isFiltered: filterState.isActive,
                    onClearFilters: {
                        withAnimation {
                            filterState.reset()
                        }
                    },
                    filterChipsBar: filterState.isActive ? AnyView(activeFilterChipsBar) : nil
                ) { email in
                    Task { await app.openEmail(email) }
                }
            case .aiInbox:
                InboxDigestView(
                    bottomInset: listBottomInset,
                    onRefresh: { await app.refreshCurrentTab() }
                )
            case .replyLater:
                EmailListView(
                    emails: filteredEmails,
                    isLoading: app.isLoading,
                    fallbackFolderId: nil,
                    bottomInset: listBottomInset,
                    onRefresh: { await app.refreshCurrentTab() },
                    isSelectMode: isSelectMode,
                    selectedEmailIDs: $selectedEmailIDs,
                    isFiltered: false,
                    onClearFilters: nil,
                    filterChipsBar: nil
                ) { email in
                    Task { await app.openEmail(email) }
                }
            case .chats:
                ContentUnavailableView(
                    "AI chats",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Open Ask AI from the bottom bar.")
                )
            }
        }
        .id(app.selectedTab)
        .contentShape(Rectangle())
        .gesture(tabSwipeGesture)
        .transition(
            .asymmetric(
                insertion: .offset(x: tabNavigatingForward ? 28 : -28).combined(with: .opacity),
                removal: .offset(x: tabNavigatingForward ? -18 : 18).combined(with: .opacity)
            )
        )
    }

    private var currentFolderId: String? {
        if case let .folder(folderId) = app.selectedTab {
            return folderId
        }
        return nil
    }

    private func selectTab(_ tab: HomeTab) {
        guard app.selectedTab != tab else { return }
        if isSelectMode {
            isSelectMode = false
            selectedEmailIDs.removeAll()
        }
        let current = folderTabs.firstIndex(of: app.selectedTab) ?? 0
        let next = folderTabs.firstIndex(of: tab) ?? 0
        tabNavigatingForward = next > current
        Task { await app.selectTab(tab) }
    }

    private func selectAdjacentTab(forward: Bool) {
        guard let current = folderTabs.firstIndex(of: app.selectedTab) else { return }
        let next = forward ? current + 1 : current - 1
        guard folderTabs.indices.contains(next) else { return }
        selectTab(folderTabs[next])
    }

    private var tabSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let threshold: CGFloat = 40
                if value.translation.width < -threshold {
                    selectAdjacentTab(forward: true)
                } else if value.translation.width > threshold {
                    selectAdjacentTab(forward: false)
                }
            }
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            if app.replyLaterCount > 0 || app.selectedTab == .replyLater {
                replyLaterPileButton
            }
            askAIButton
            composeButton
        }
    }

    private var replyLaterPileButton: some View {
        Button {
            if app.selectedTab == .replyLater, let first = app.emails.first {
                Task {
                    await app.openEmail(first)
                    await app.startCompose(mode: .reply, original: first)
                }
            } else {
                selectTab(.replyLater)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.inter(size: 15, weight: .medium))
                if app.replyLaterCount > 0 {
                    Text("\(app.replyLaterCount)")
                        .font(.inter(size: 13, weight: .semibold))
                }
            }
            .foregroundStyle(app.selectedTab == .replyLater ? AppTheme.accent : AppTheme.ink)
            .padding(.horizontal, 14)
            .frame(height: HomeChromeMetrics.actionBarHeight)
            .liquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Reply Later")
        .accessibilityValue("\(app.replyLaterCount) queued")
        .accessibilityHint(app.selectedTab == .replyLater ? "Opens Focus and Reply" : "Opens Reply Later pile")
    }

    private var composeButton: some View {
        ComposeStackButton(isExpanded: showComposeActions)
            .contentShape(Rectangle())
            .gesture(composePressGesture)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Compose menu")
            .accessibilityHint("Tap for folders and actions. Double tap or press briefly to compose.")
            .accessibilityAddTraits(.isButton)
            .modifier(BarZoomSource(id: Self.composeTransitionID, namespace: barNamespace))
            .modifier(BarZoomSourceHidden(hidden: showComposeSheet && composeMorphsFromBar))
            .opacity(showComposeActions ? 0 : 1)
            .allowsHitTesting(!showComposeActions)
    }

    private var composePressGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { _ in
                guard composeTouchBeganAt == nil else { return }
                let now = Date()

                // Double-tap → compose (menu may already be open from the first tap).
                if let last = composeLastTapAt,
                   now.timeIntervalSince(last) < HomeChromeMetrics.composeDoubleTapWindow {
                    composeDoubleTapArmed = false
                    composeLastTapAt = nil
                    composeTouchBeganAt = now
                    composeDidTriggerCompose = true
                    if showComposeActions {
                        dismissComposeActions()
                    }
                    startComposeFromBar()
                    return
                }

                let token = UUID()
                composePressToken = token
                composeTouchBeganAt = now
                composeDidTriggerCompose = false
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + HomeChromeMetrics.composeLongPressDuration
                ) {
                    guard composePressToken == token,
                          composeTouchBeganAt != nil,
                          !composeDidTriggerCompose else { return }
                    composeDidTriggerCompose = true
                    composeDoubleTapArmed = false
                    composeLastTapAt = nil
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    startComposeFromBar()
                }
            }
            .onEnded { _ in
                let triggeredCompose = composeDidTriggerCompose
                composeTouchBeganAt = nil
                composeDidTriggerCompose = false

                guard !triggeredCompose else { return }

                // Single tap → open the stack immediately (no debounce / double-tap wait).
                composeLastTapAt = Date()
                composeDoubleTapArmed = true
                openComposeActions()
                DispatchQueue.main.asyncAfter(
                    deadline: .now() + HomeChromeMetrics.composeDoubleTapWindow
                ) {
                    composeDoubleTapArmed = false
                }
            }
    }

    private func openComposeActions() {
        guard !showComposeActions else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            showComposeActions = true
        }
    }

    private func dismissComposeActions() {
        composeDoubleTapArmed = false
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            showComposeActions = false
            highlightedComposeAction = nil
        }
    }

    private func startComposeFromBar() {
        composeMorphsFromBar = true
        Task { await app.startCompose(mode: .new) }
    }

    private func performComposeAction(_ item: ComposeActionItem) {
        dismissComposeActions()
        switch item {
        case .compose:
            startComposeFromBar()
        case .settings:
            showSettings = true
        case .forYou, .inbox, .sent, .drafts, .archive, .trash:
            if let tab = item.folderTab {
                selectTab(tab)
            }
        }
    }

    private func closeSearch() {
        withAnimation(.easeInOut(duration: 0.28)) {
            showSearch = false
        }
    }

    private func openSearch() {
        if isSelectMode {
            isSelectMode = false
            selectedEmailIDs.removeAll()
        }
        withAnimation(.easeInOut(duration: 0.28)) {
            showSearch = true
        }
    }

    private var mailboxTitle: String {
        app.selectedMailbox?.email ?? auth.userEmail ?? ""
    }

    private var mailboxName: String {
        guard let mailbox = app.selectedMailbox else {
            if let local = mailboxTitle.split(separator: "@").first, !local.isEmpty {
                return String(local)
            }
            return mailboxTitle
        }
        return displayName(for: mailbox)
    }

    private func displayName(for mailbox: Mailbox) -> String {
        if let local = mailbox.email.split(separator: "@").first, !local.isEmpty {
            return String(local)
        }
        return mailbox.email
    }

    private var initials: String {
        let source = mailboxName.isEmpty ? (mailboxTitle.isEmpty ? "A" : mailboxTitle) : mailboxName
        return AvatarInitials.from(source)
    }

    private static let mailboxAvatarSize: CGFloat = 38

    @ViewBuilder
    private var trailingToolbarItems: some View {
        if case .chats = app.selectedTab {
            Button {
                openChat(resumeActive: false)
            } label: {
                Image(systemName: "plus")
                    .font(.inter(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New chat")
        }
    }

    private var searchToolbarButton: some View {
        Button {
            if showSearch {
                closeSearch()
            } else {
                openSearch()
            }
        } label: {
            Image(systemName: showSearch ? "magnifyingglass.circle.fill" : "magnifyingglass")
        }
        .accessibilityLabel(showSearch ? "Close search" : "Search")
    }

    private var selectButton: some View {
        Button {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                isSelectMode.toggle()
                if !isSelectMode {
                    selectedEmailIDs.removeAll()
                }
            }
        } label: {
            if isSelectMode {
                Image(systemName: "xmark")
                    .font(.inter(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            } else {
                Text("Select")
                    .font(.inter(size: 14, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSelectMode ? "Cancel selection" : "Select emails")
    }

    private var filterButton: some View {
        Menu {
            filterMenu
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: filterState.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .font(.inter(size: 17, weight: .medium))
                    .foregroundStyle(filterState.isActive ? AppTheme.accent : AppTheme.ink)
                    .frame(width: 36, height: 36)

                if filterState.isActive {
                    Circle()
                        .fill(AppTheme.accent)
                        .frame(width: 8, height: 8)
                        .offset(x: 1, y: -1)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Filter menu")
        .accessibilityValue(filterState.isActive ? "\(filterState.activeCount) active" : "None")
    }

    @ViewBuilder
    private var filterMenu: some View {
        Section("Status") {
            Toggle(isOn: $filterState.unreadOnly) {
                Label(
                    currentFolderId == "inbox" ? "New only" : "Unread",
                    systemImage: "envelope.badge"
                )
            }

            Toggle(isOn: $filterState.starredOnly) {
                Label("Starred", systemImage: "star")
            }

            Toggle(isOn: $filterState.replyLaterOnly) {
                Label("Reply later", systemImage: "clock.arrow.circlepath")
            }
        }

        Section("Recipients") {
            Toggle(isOn: $filterState.toMeOnly) {
                Label("To me", systemImage: "person")
            }

            Toggle(isOn: $filterState.ccOrBccMeOnly) {
                Label("Cc / Bcc me", systemImage: "person.2")
            }
        }

        Section("Attachments") {
            Toggle(isOn: $filterState.withAttachmentsOnly) {
                Label("With attachments", systemImage: "paperclip")
            }
        }

        Section("Date") {
            Toggle(
                isOn: Binding(
                    get: { filterState.dateFilter == .today },
                    set: { filterState.dateFilter = $0 ? .today : .any }
                )
            ) {
                Label("Only today", systemImage: "calendar")
            }

            Toggle(
                isOn: Binding(
                    get: { filterState.dateFilter == .lastThreeDays },
                    set: { filterState.dateFilter = $0 ? .lastThreeDays : .any }
                )
            ) {
                Label("Last three days", systemImage: "calendar.badge.clock")
            }

            Toggle(
                isOn: Binding(
                    get: { filterState.dateFilter == .thisWeek },
                    set: { filterState.dateFilter = $0 ? .thisWeek : .any }
                )
            ) {
                Label("This week", systemImage: "calendar.day.timeline.left")
            }
        }

        Section("More") {
            Toggle(isOn: $filterState.needsReplyOnly) {
                Label("Needs reply", systemImage: "arrowshape.turn.up.left")
            }
        }

        if filterState.isActive {
            Divider()
            Button(role: .destructive) {
                withAnimation {
                    filterState.reset()
                }
            } label: {
                Label("Clear all filters", systemImage: "xmark.circle")
            }
        }
    }

    @ViewBuilder
    private var activeFilterChipsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if filterState.unreadOnly {
                    filterChip(title: currentFolderId == "inbox" ? "New only" : "Unread") {
                        filterState.unreadOnly = false
                    }
                }
                if filterState.starredOnly {
                    filterChip(title: "Starred") { filterState.starredOnly = false }
                }
                if filterState.replyLaterOnly {
                    filterChip(title: "Reply later") { filterState.replyLaterOnly = false }
                }
                if filterState.toMeOnly {
                    filterChip(title: "To me") { filterState.toMeOnly = false }
                }
                if filterState.ccOrBccMeOnly {
                    filterChip(title: "Cc/Bcc me") { filterState.ccOrBccMeOnly = false }
                }
                if filterState.withAttachmentsOnly {
                    filterChip(title: "Attachments") { filterState.withAttachmentsOnly = false }
                }
                if filterState.dateFilter != .any {
                    filterChip(title: filterState.dateFilter.rawValue) { filterState.dateFilter = .any }
                }
                if filterState.needsReplyOnly {
                    filterChip(title: "Needs reply") { filterState.needsReplyOnly = false }
                }

                Button {
                    withAnimation {
                        filterState.reset()
                    }
                } label: {
                    Text("Clear all")
                        .font(.inter(size: 11, weight: .semibold))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }

    private func filterChip(title: String, onRemove: @escaping () -> Void) -> some View {
        Button {
            withAnimation {
                onRemove()
            }
        } label: {
            HStack(spacing: 4) {
                Text(title)
                    .font(.inter(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                Image(systemName: "xmark")
                    .font(.inter(size: 9, weight: .bold))
                    .foregroundStyle(AppTheme.muted)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(AppTheme.pillActive, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var areAllVisibleSelected: Bool {
        let list = filteredEmails
        return !list.isEmpty && list.allSatisfy { selectedEmailIDs.contains($0.id) }
    }

    private var areSelectedMostlyUnread: Bool {
        let selected = app.emails.filter { selectedEmailIDs.contains($0.id) }
        guard !selected.isEmpty else { return true }
        let unreadCount = selected.filter(\.isUnread).count
        return unreadCount >= max(1, selected.count - unreadCount)
    }

    private var areSelectedMostlyStarred: Bool {
        let selected = app.emails.filter { selectedEmailIDs.contains($0.id) }
        guard !selected.isEmpty else { return false }
        let starredCount = selected.filter(\.starred).count
        return starredCount >= max(1, selected.count - starredCount)
    }

    private func toggleSelectAll() {
        if areAllVisibleSelected {
            selectedEmailIDs.removeAll()
        } else {
            selectedEmailIDs = Set(filteredEmails.map(\.id))
        }
    }

    private var selectionActionBar: some View {
        HStack(spacing: 0) {
            Button {
                toggleSelectAll()
            } label: {
                Text(areAllVisibleSelected ? "Deselect All" : "Select All")
                    .font(.inter(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(AppTheme.pillFill, in: Capsule())
            }
            .buttonStyle(.plain)

            Spacer(minLength: 8)

            Text("\(selectedEmailIDs.count)")
                .font(.inter(size: 14, weight: .bold))
                .foregroundStyle(selectedEmailIDs.isEmpty ? AppTheme.muted : AppTheme.ink)
                .frame(minWidth: 26, minHeight: 26)
                .padding(.horizontal, 6)
                .background(AppTheme.pillFill, in: Capsule())
                .accessibilityLabel("\(selectedEmailIDs.count) selected")

            Spacer(minLength: 8)

            HStack(spacing: 8) {
                // Read/Unread
                Button {
                    let targetRead = areSelectedMostlyUnread
                    let ids = selectedEmailIDs
                    Task { await app.markEmailsRead(ids, read: targetRead) }
                } label: {
                    Image(systemName: areSelectedMostlyUnread ? "envelope.open" : "envelope.badge")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 38, height: 38)
                        .background(AppTheme.pillFill, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(selectedEmailIDs.isEmpty)
                .accessibilityLabel("Mark as read or unread")

                // Star/Unstar
                Button {
                    let targetStarred = !areSelectedMostlyStarred
                    let ids = selectedEmailIDs
                    Task { await app.starEmails(ids, starred: targetStarred) }
                } label: {
                    Image(systemName: areSelectedMostlyStarred ? "star.slash" : "star")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 38, height: 38)
                        .background(AppTheme.pillFill, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(selectedEmailIDs.isEmpty)
                .accessibilityLabel("Star or unstar")

                // Archive
                Button {
                    let ids = selectedEmailIDs
                    Task {
                        await app.archiveEmails(ids)
                        selectedEmailIDs.removeAll()
                    }
                } label: {
                    Image(systemName: "archivebox")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .frame(width: 38, height: 38)
                        .background(AppTheme.pillFill, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(selectedEmailIDs.isEmpty)
                .accessibilityLabel("Archive")

                // Delete
                Button {
                    let ids = selectedEmailIDs
                    Task {
                        await app.deleteEmails(ids)
                        selectedEmailIDs.removeAll()
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.inter(size: 15, weight: .medium))
                        .foregroundStyle(Color.red)
                        .frame(width: 38, height: 38)
                        .background(AppTheme.pillFill, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(selectedEmailIDs.isEmpty)
                .accessibilityLabel("Delete")
            }
            .opacity(selectedEmailIDs.isEmpty ? 0.35 : 1)
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
        .liquidGlass(in: RoundedRectangle(cornerRadius: HomeChromeMetrics.chromeCornerRadius, style: .continuous))
    }

    private var askAIButton: some View {
        Button {
            openChat()
        } label: {
            AskAIButtonLabel()
                .padding(.horizontal, 14)
                .frame(height: HomeChromeMetrics.actionBarHeight)
                .frame(maxWidth: .infinity, alignment: .leading)
                .liquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ask AI")
        .modifier(BarZoomSource(id: Self.askAITransitionID, namespace: barNamespace))
        .modifier(BarZoomSourceHidden(hidden: showChat))
    }
}

private struct IdentifiedEmail: Identifiable {
    /// Stable id so prev/next email swaps don't dismiss and re-present the sheet.
    var id: String { "email-detail" }
    let email: Email
}

private struct HomeNavigationSubtitle: ViewModifier {
    var subtitle: String
    var fontSize: CGFloat = AppTheme.FontSize.homeSubtitle
    var fontWeight: Font.Weight = .regular

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            if !subtitle.isEmpty {
                content.navigationSubtitle(
                    Text(subtitle)
                        .font(.inter(size: fontSize, weight: fontWeight))
                        .foregroundStyle(AppTheme.muted)
                )
            } else {
                content
            }
        } else {
            content
        }
    }
}

private struct MailboxLoadingAccessibility: ViewModifier {
    var isLoading: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isLoading {
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Loading mailbox")
        } else {
            content
        }
    }
}

private struct AskAIButtonLabel: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .foregroundStyle(AppTheme.muted)
            Text("Ask AI")
                .font(.inter(size: 16, weight: .medium))
                .foregroundStyle(AppTheme.muted)
            Spacer(minLength: 0)
        }
    }
}

/// Grabber + drag-to-dismiss for compose / Ask AI fullScreenCovers.
///
/// The grabber sits *above* the navigation content (not via UIKit
/// `additionalSafeAreaInsets`). Mutating safe-area after the first
/// fullScreenCover layout pass collapsed ScrollView content to
/// title-only until remount; keeping chrome in the SwiftUI hierarchy
/// avoids that race. Interactive dismiss was never wired — only a
/// visual handle with an accessibility label — so drag is implemented here.
private struct CoverDragIndicator: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var dragOffset: CGFloat = 0

    private let handleTop: CGFloat = 12
    private let handleHeight: CGFloat = 5
    private let handleBottom: CGFloat = 10
    private let hitExtension: CGFloat = 36
    private let dismissThreshold: CGFloat = 96
    private let dismissVelocity: CGFloat = 900

    private var chromeHeight: CGFloat { handleTop + handleHeight + handleBottom }

    private var coverSpring: Animation {
        .spring(response: 0.32, dampingFraction: 0.86)
    }

    func body(content: Content) -> some View {
        VStack(spacing: 0) {
            dragChrome
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .offset(y: max(0, dragOffset))
        // Keep the cover background glued to the dragged chrome.
        .background(AppTheme.background.ignoresSafeArea())
    }

    private var dragChrome: some View {
        Color.clear
            .frame(height: chromeHeight + hitExtension)
            .overlay(alignment: .top) {
                Capsule()
                    .fill(AppTheme.muted.opacity(0.45))
                    .frame(width: 36, height: handleHeight)
                    .padding(.top, handleTop)
                    .frame(maxWidth: .infinity)
            }
            .contentShape(Rectangle())
            .highPriorityGesture(dragGesture)
            .accessibilityLabel("Drag to close")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: "Close") { dismiss() }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .onChanged { value in
                let dy = value.translation.height
                dragOffset = dy > 0 ? dy : dy * 0.12
            }
            .onEnded { value in
                let dy = value.translation.height
                let projected = value.predictedEndTranslation.height
                let shouldDismiss = dy > dismissThreshold
                    || projected > dismissThreshold * 1.35
                    || value.velocity.height > dismissVelocity
                if shouldDismiss {
                    if reduceMotion {
                        dismiss()
                        dragOffset = 0
                    } else {
                        withAnimation(coverSpring) {
                            dragOffset = UIScreen.main.bounds.height
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                            dismiss()
                            dragOffset = 0
                        }
                    }
                } else if reduceMotion {
                    dragOffset = 0
                } else {
                    withAnimation(coverSpring) {
                        dragOffset = 0
                    }
                }
            }
    }
}

private struct BarSheetZoom: ViewModifier {
    var enabled: Bool
    var id: String
    var namespace: Namespace.ID

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *), enabled {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}

private struct BarZoomSource: ViewModifier {
    var id: String
    var namespace: Namespace.ID

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: id, in: namespace)
        } else {
            content
        }
    }
}

/// Hide the real button while its sheet is up so the zoom replica is the only copy.
private struct BarZoomSourceHidden: ViewModifier {
    var hidden: Bool

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .animation(nil, value: hidden)
            .accessibilityHidden(hidden)
            .allowsHitTesting(!hidden)
    }
}

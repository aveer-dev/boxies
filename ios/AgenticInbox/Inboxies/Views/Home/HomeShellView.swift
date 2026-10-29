import SwiftUI
import UIKit

/// Main shell: native large-title toolbar, content list, floating action bar.
struct HomeShellView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var app
    @Environment(\.undoManager) private var undoManager
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var showSearch = false
    /// Inbox "Show N more new" pushed the All new screen (AVE-23).
    @State private var showAllNew = false
    @State private var showChat = false
    @State private var chatSeedPrompt: String?
    @State private var tabNavigatingForward = true
    @State private var previousTabBeforeReplyLater: HomeTab = .folder("inbox")
    /// Entering or leaving Reply Later or the Screening room is a push, not a folder-tab slide.
    @State private var isPushTransition = false
    @State private var tabContentWidth: CGFloat = 390
    @State private var registeredUndoID: UUID?
    @State private var showSettings = false
    @State private var isSelectMode = false
    @State private var selectedEmailIDs: Set<String> = []
    @State private var filterState = EmailFilterState()
    @State private var showAddMailboxSheet = false
    @State private var newMailboxName = ""
    @State private var newMailboxEmail = ""
    @State private var isCreatingMailbox = false
    @FocusState private var isNameFocused: Bool
    @AppStorage("app_theme") private var appTheme: ThemeMode = .system
    @State private var showComposeSheet = false
    @State private var showComposeActions = false
    @State private var isClosingComposeActions = false
    @State private var highlightedComposeAction: ComposeActionItem.ID?
    @State private var composeActionRowFrames: [ComposeActionItem.ID: CGRect] = [:]
    @State private var composeTouchBeganAt: Date?
    @State private var composeDidTriggerCompose = false
    @State private var composePressToken = UUID()
    @State private var composeLastTapAt: Date?
    @State private var composeDoubleTapArmed = false
    @State private var serviceBannerHeight: CGFloat = 0
    /// Window width; with the size class it picks two- vs three-column (AVE-73).
    @State private var windowWidth: CGFloat = 0
    /// Folder column toggle on wide iPads. Persists; off keeps the two-pane layout.
    @AppStorage("home_folder_column_visible") private var showsFolderColumn = true
    @GestureState private var isComposePressed = false

    /// Swipe / folder-column order. No Screener: the Screening room is a subpage pushed
    /// from the Inbox "N waiting to be screened" row (AVE-136).
    private let folderTabs: [HomeTab] = [
//        .aiInbox,
//        .chats,
        .folder("inbox"),
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

    /// Standard push spring (Android twin: `dampingRatio = 0.86f` + `StiffnessMediumLow`).
    private static let pushSpring = Animation.spring(response: 0.32, dampingFraction: 0.86)

    /// The implicit tab animations override `withAnimation`, so pick the push spring here too.
    private var tabAnimation: Animation {
        isPushTransition ? Self.pushSpring : tabSpring
    }

    /// The Screener folder, shown as the Screening room subpage of Inbox (AVE-136).
    private static let screeningRoomTab: HomeTab = .folder("screener")

    private var isScreeningRoom: Bool {
        app.selectedTab == Self.screeningRoomTab
    }

    /// Tabs that push over the list instead of sliding between folders.
    private static func isPushedTab(_ tab: HomeTab) -> Bool {
        tab == .replyLater || tab == screeningRoomTab
    }

    private var hasMinimizedCompose: Bool {
        app.composeSession?.isMinimized == true
    }

    private var isInboxTab: Bool {
        app.selectedTab == .folder("inbox") || app.selectedTab == .aiInbox
    }

    /// Read-only (service ended) or, for admins, set-to-end notice for the active mailbox.
    private var serviceNotice: ServiceNotice? {
        ServiceNotice.make(mailbox: app.selectedMailbox, service: app.selectedDomainService)
    }

    private var hasServiceBanner: Bool {
        serviceNotice != nil && !isSelectMode && !showComposeActions
    }

    /// Inbox row count; 0 hides the row (Screener off or nobody waiting).
    private var screeningRoomCount: Int {
        app.isScreenerEnabled ? app.screenerSenderCount : 0
    }

    private var listBottomInset: CGFloat {
        HomeChromeMetrics.listBottomInset(hasMinimizedCompose: hasMinimizedCompose)
            + (hasServiceBanner ? serviceBannerHeight + 8 : 0)
    }

    /// Regular width (full-screen iPad, wide Split View) reads mail in a side pane;
    /// compact width keeps the phone layout with the detail sheet. Wide regular windows
    /// add the leading folder column unless the user hid it.
    private var layoutMode: HomeLayoutMode {
        HomeLayoutMode(
            horizontalSizeClass: horizontalSizeClass,
            width: windowWidth,
            showsFolderColumn: showsFolderColumn
        )
    }

    private var allowsFolderColumn: Bool {
        HomeLayoutMode.allowsFolderColumn(horizontalSizeClass: horizontalSizeClass, width: windowWidth)
    }

    var body: some View {
        splitLayout
            .animation(.spring(response: 0.32, dampingFraction: 0.88), value: isComposeExpanded)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: hasMinimizedCompose)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: hasServiceBanner)
            .sheet(item: selectedEmailItem) { _ in
                EmailDetailView()
            }
            .sheet(isPresented: $showComposeSheet, onDismiss: {
                if app.composeSession?.isExpanded == true {
                    app.minimizeCompose()
                }
            }) {
                expandedComposeSheet
            }
            .sheet(item: reminderPickerItem) { email in
                ReplyLaterReminderSheet(email: email)
                    .formSheetSizing()
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheetView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .formSheetSizing()
            }
            .sheet(isPresented: $showChat, onDismiss: {
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
                if ProcessInfo.processInfo.arguments.contains("-previewChat") {
                    openChat()
                }
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-previewReplyLater") {
                    return
                }
                #endif
                Task { await app.refreshReplyLaterCount() }
            }
            .onChange(of: app.pendingUndoAction?.id) { _, newID in
                registerUndoIfNeeded(newID)
            }
            .onChange(of: scenePhase) { _, phase in
                // Leaving the app ends the undo window: send now rather than risk a kill.
                if phase == .background {
                    app.commitPendingActionForBackground()
                }
            }
            .sensoryFeedback(.success, trigger: app.pendingUndoAction?.id)
            .sensoryFeedback(.selection, trigger: highlightedComposeAction)
    }

    /// List column (everything the phone shows) + reading pane at regular width, plus
    /// the folder column on wide windows.
    private var splitLayout: some View {
        HomeSplitLayout(mode: layoutMode) {
            HomeFolderColumn(
                title: mailboxName,
                subtitle: mailboxTitle,
                folders: folderTabs,
                selected: app.selectedTab,
                onSelect: selectTab,
                onHide: { setFolderColumnVisible(false) }
            )
        } list: {
            shell
        } detail: {
            HomeReadingPane()
        }
        .background(AppTheme.background.ignoresSafeArea())
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            windowWidth = width
        }
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
        .animation(tabAnimation, value: app.selectedTab)
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
                    isClosing: isClosingComposeActions,
                    hidesCompose: app.isReadOnly,
                    onSelect: { item in
                        performComposeAction(item)
                    },
                    onDismiss: {
                        showComposeActions = false
                        isClosingComposeActions = false
                        highlightedComposeAction = nil
                    },
                    onRowFramesChange: { frames in
                        composeActionRowFrames = frames
                    },
                    onDismissStarted: {
                        isClosingComposeActions = true
                        composeDoubleTapArmed = false
                        highlightedComposeAction = nil
                    }
                )
            }
        }
        // Instant present — spring lives inside overlay rows, not a delayed container fade.
        .animation(nil, value: showComposeActions)
        .overlay(alignment: .bottomTrailing) {
            if showComposeActions && composeDoubleTapArmed && !app.isReadOnly {
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
                        if isScreeningRoom {
                            screeningRoomBackButton
                        } else {
                            mailboxControl
                        }
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
                .listColumnNavigationBarMargins(layoutMode)
                .navigationDestination(isPresented: $showAllNew) {
                    InboxNewListView(bottomInset: listBottomInset)
                }
        }
        .onChange(of: showAllNew) { _, isShowing in
            // Back from All new: re-sync so the capped New preview reflects what was read.
            if !isShowing, currentFolderId == "inbox" {
                Task { await app.refreshCurrentTab() }
            }
        }
        .onChange(of: app.selectedMailboxId) { _, _ in
            showAllNew = false
            // The room belongs to the mailbox it was opened from (and may be off in the next).
            if isScreeningRoom {
                popScreeningRoom()
            }
        }
        .onChange(of: app.screenerQueue.isEmpty) { _, isEmpty in
            // Screened the last sender: nothing left in the room, back to Inbox.
            if isEmpty, isScreeningRoom, !app.isLoading {
                popScreeningRoom()
            }
        }
        .onChange(of: app.isScreenerEnabled) { _, enabled in
            if !enabled, isScreeningRoom {
                popScreeningRoom()
            }
        }
        .onChange(of: app.selectedTab) { _, _ in
            showAllNew = false
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
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(AppTheme.background)
        .formSheetSizing()
    }

    @ViewBuilder
    private var expandedComposeSheet: some View {
        if let session = app.composeSession {
            ComposeSheetView(session: session)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(AppTheme.background)
                .formSheetSizing()
        }
    }

    @ViewBuilder
    private var composeChrome: some View {
        VStack(spacing: 0) {
            VStack(spacing: HomeChromeMetrics.chromeSpacing) {
                if let toast = app.toast {
                    InboxiesToast(
                        message: toast.message,
                        icon: toast.toastIcon,
                        action: toast.isUndo
                            ? ToastAction(title: "Undo", accessibilityHint: "Reverses the last action") {
                                app.undoPendingAction()
                            }
                            : toast.action,
                        onDismiss: { app.hideToast() }
                    )
                    .padding(.horizontal, ToastMetrics.screenInset)
                    .padding(.bottom, ToastMetrics.barGap)
                }

                if hasServiceBanner, let serviceNotice {
                    ServiceStatusBanner(notice: serviceNotice)
                        .background {
                            GeometryReader { proxy in
                                Color.clear.preference(key: ServiceBannerHeightKey.self, value: proxy.size.height)
                            }
                        }
                        .onPreferenceChange(ServiceBannerHeightKey.self) { height in
                            serviceBannerHeight = height
                        }
                        .padding(.horizontal, 24)
                        .padding(.bottom, 8)
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
                        .padding(
                            .bottom,
                            hasMinimizedCompose ? HomeChromeMetrics.minimizedComposeGap : HomeChromeMetrics.chromeBottomPadding
                        )
                }
            }

            if let session = app.composeSession, session.isMinimized, !isSelectMode {
                ComposeDockBar(session: session)
                    .ignoresSafeArea(edges: .bottom)
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: app.pendingUndoAction?.id)
        .animation(ToastMetrics.animation, value: app.toast?.id)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: hasServiceBanner)
        .animation(tabAnimation, value: app.selectedTab)
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: isSelectMode)
        .padding(.bottom, -12)
    }

    /// Leading toolbar control inside the Screening room: back to Inbox.
    private var screeningRoomBackButton: some View {
        Button {
            popScreeningRoom()
        } label: {
            Image(systemName: "chevron.left")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
                .frame(width: Self.mailboxAvatarSize, height: Self.mailboxAvatarSize)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back to Inbox")
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

    /// Detail sheet binding — compact width only. In the two-pane layout the email
    /// shows in the reading pane, so the sheet reads nil; when the window widens with
    /// the sheet up, its dismissal must not clear the selection the pane now shows.
    private var selectedEmailItem: Binding<IdentifiedEmail?> {
        let isStacked = layoutMode == .stacked
        return Binding(
            get: {
                guard isStacked, let email = app.selectedEmail else { return nil }
                return IdentifiedEmail(email: email)
            },
            set: { newValue in
                if newValue == nil && isStacked {
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
            // Not a toolbar item: an extra leading item crowds the list column's toolbar.
            if allowsFolderColumn {
                Button(
                    showsFolderColumn ? "Hide folders" : "Show folders",
                    systemImage: "sidebar.left"
                ) {
                    setFolderColumnVisible(!showsFolderColumn)
                }
            }
            Button("Add another email", systemImage: "plus") {
                showAddMailboxSheet = true
            }
            Button("Settings", systemImage: "gearshape") {
                showSettings = true
            }
            Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                app.signOut(auth: auth)
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
                        Button {
                            UIImpactFeedbackGenerator(style: .light).impactOccurred()
                            showAddMailboxSheet = false
                        } label: {
                            Image(systemName: "xmark")
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { await createMailbox() }
                        } label: {
                            if isCreatingMailbox {
                                ProgressView()
                            } else {
                                Text("Create")
                            }
                        }
                        .disabled(isCreatingMailbox || newMailboxEmail.isEmpty || newMailboxName.isEmpty)
                        .accessibilityLabel(isCreatingMailbox ? "Creating mailbox" : "Create")
                    }
                }
                .disabled(isCreatingMailbox)
            }
            .presentationDetents([.medium, .large])
            .formSheetSizing()
            .interactiveDismissDisabled(isCreatingMailbox)
        }
    }

    private func createMailbox() async {
        // A second tap while the request is in flight would create (or 409 on) the same address.
        guard !isCreatingMailbox else { return }
        isCreatingMailbox = true
        defer { isCreatingMailbox = false }
        let fullEmail = "\(newMailboxEmail)@\(app.mailDomain)"
        do {
            try await app.createMailbox(name: newMailboxName, email: fullEmail)
            showAddMailboxSheet = false
            newMailboxName = ""
            newMailboxEmail = ""
        } catch {
            // Toast already presented by AppModel
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
        if isScreeningRoom {
            return ScreeningRoom.title
        }
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
        if isScreeningRoom, !isSelectMode, !filterState.isActive {
            let count = app.screenerSenderCount
            return count == 0 ? "Nobody waiting" : ScreeningRoom.waitingLabel(count: count)
        }
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
                    filterChipsBar: filterState.isActive ? AnyView(activeFilterChipsBar) : nil,
                    showsTags: true,
                    loadError: app.emailListError,
                    paging: app.visibleListPaging,
                    onLoadMore: { await app.loadMoreEmails() },
                    inboxNewCount: currentFolderId == "inbox" ? app.inboxNewCount : nil,
                    onShowAllNew: currentFolderId == "inbox" ? { showAllNew = true } : nil,
                    screeningRoomCount: currentFolderId == "inbox" && !filterState.isActive ? screeningRoomCount : 0,
                    screeningRoomSenders: app.screenerSenders,
                    onOpenScreeningRoom: currentFolderId == "inbox" ? { openScreeningRoom() } : nil
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
                    filterChipsBar: nil,
                    showsTags: false,
                    loadError: app.emailListError,
                    paging: app.visibleListPaging,
                    onLoadMore: { await app.loadMoreEmails() }
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
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            tabContentWidth = width
        }
        .id(app.selectedTab)
        .contentShape(Rectangle())
        .gesture(tabSwipeGesture)
        .transition(tabTransition(for: app.selectedTab))
    }

    /// Folder tabs slide a short distance. Reply Later is a push, matching the Android
    /// settings/Reply Later push: in from a quarter width, the page underneath shifts a sixth.
    /// The Reply Later page's own transition doesn't depend on direction state, so it pushes
    /// in and pops back out toward the trailing edge either way.
    private func tabTransition(for tab: HomeTab) -> AnyTransition {
        let width = max(tabContentWidth, 1)
        if Self.isPushedTab(tab) {
            return .offset(x: width / 4).combined(with: .opacity)
        }
        if isPushTransition {
            return .offset(x: -width / 6).combined(with: .opacity)
        }
        return .asymmetric(
            insertion: .offset(x: tabNavigatingForward ? 28 : -28).combined(with: .opacity),
            removal: .offset(x: tabNavigatingForward ? -18 : 18).combined(with: .opacity)
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
        isPushTransition = Self.isPushedTab(tab) || Self.isPushedTab(app.selectedTab)
        if tab == .replyLater {
            if app.selectedTab != .replyLater {
                previousTabBeforeReplyLater = app.selectedTab
            }
            tabNavigatingForward = true
        } else if app.selectedTab == .replyLater {
            tabNavigatingForward = false
        } else if tab == Self.screeningRoomTab {
            tabNavigatingForward = true
        } else if isScreeningRoom {
            tabNavigatingForward = false
        } else {
            let current = folderTabs.firstIndex(of: app.selectedTab) ?? 0
            let next = folderTabs.firstIndex(of: tab) ?? 0
            tabNavigatingForward = next > current
        }
        withAnimation(Self.pushSpring) {
            app.selectTab(tab)
        }
    }

    /// Back out of Reply Later to the folder it was opened from (Android: system back).
    private func popReplyLater() {
        guard app.selectedTab == .replyLater else { return }
        let target = previousTabBeforeReplyLater == .replyLater ? .folder("inbox") : previousTabBeforeReplyLater
        selectTab(target)
    }

    /// Inbox row → Screening room, pushed over the list (AVE-136).
    private func openScreeningRoom() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        selectTab(Self.screeningRoomTab)
    }

    /// Back out of the Screening room to Inbox, its only parent.
    private func popScreeningRoom() {
        guard isScreeningRoom else { return }
        selectTab(.folder("inbox"))
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
                if app.selectedTab == .replyLater {
                    // Reply Later is pushed over a folder: swipe right pops back.
                    if value.translation.width > threshold { popReplyLater() }
                    return
                }
                if isScreeningRoom {
                    // The Screening room is pushed over Inbox: swipe right pops back.
                    if value.translation.width > threshold { popScreeningRoom() }
                    return
                }
                if value.translation.width < -threshold {
                    selectAdjacentTab(forward: true)
                } else if value.translation.width > threshold {
                    selectAdjacentTab(forward: false)
                }
            }
    }

    private var showReplyLaterButton: Bool {
        app.replyLaterCount > 0 || app.selectedTab == .replyLater
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            if showReplyLaterButton {
                replyLaterPileButton
                    .transition(.scale.combined(with: .opacity))
            }
            // The AI agent is part of the service; a read-only mailbox has no Ask AI.
            if app.isReadOnly {
                Spacer(minLength: 0)
            } else {
                askAIButton
            }
            composeButton
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: showReplyLaterButton)
    }

    /// A Reply Later reminder fired on mail that's still unread (AVE-86).
    private var replyLaterIsDue: Bool {
        app.replyLaterDueCount > 0
    }

    private var replyLaterTint: Color {
        if app.selectedTab == .replyLater { return AppTheme.accent }
        return replyLaterIsDue ? AppTheme.attention : AppTheme.ink
    }

    private var replyLaterAccessibilityValue: String {
        let count = app.replyLaterCount
        let queued = count == 0 ? "No queued emails" : "\(count) queued"
        return replyLaterIsDue ? "\(queued), \(app.replyLaterDueCount) due" : queued
    }

    private var replyLaterPileButton: some View {
        Button {
            if showComposeActions {
                dismissComposeActions()
                return
            }
            if app.selectedTab == .replyLater {
                popReplyLater()
            } else if app.replyLaterCount == 0 {
                app.showToast("There is no reply later mail")
                Task { await app.refreshReplyLaterCount() }
            } else {
                previousTabBeforeReplyLater = app.selectedTab
                selectTab(.replyLater)
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: replyLaterIsDue ? "alarm.fill" : "clock.arrow.circlepath")
                    .font(.inter(size: 15, weight: .medium))
                    .contentTransition(.symbolEffect(.replace))
                if app.replyLaterCount > 0 {
                    Text("\(app.replyLaterCount)")
                        .font(.inter(size: 13, weight: .semibold))
                        .contentTransition(.numericText())
                }
            }
            .foregroundStyle(replyLaterTint)
            .padding(.horizontal, 14)
            .frame(height: HomeChromeMetrics.actionBarHeight)
            .liquidGlass(in: Capsule())
            .overlay {
                if replyLaterIsDue {
                    Capsule()
                        .strokeBorder(AppTheme.attention.opacity(0.55), lineWidth: 1)
                        .allowsHitTesting(false)
                }
            }
            .background {
                if replyLaterIsDue {
                    ReplyLaterAttentionGlow()
                        .transition(.opacity)
                }
            }
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: replyLaterIsDue)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Reply Later")
        .accessibilityValue(replyLaterAccessibilityValue)
        .accessibilityHint(app.selectedTab == .replyLater ? "Returns to previous folder" : (app.replyLaterCount == 0 ? "Shows status toast when empty" : "Opens Reply Later pile"))
        .accessibilityIdentifier("replyLaterPileButton")
    }

    /// Presents the reminder picker for `app.reminderPickerEmail` (toast "Add reminder",
    /// list context menu).
    private var reminderPickerItem: Binding<Email?> {
        Binding(
            get: { app.reminderPickerEmail },
            set: { app.reminderPickerEmail = $0 }
        )
    }

    private var composeButton: some View {
        ComposeStackButton(
            isExpanded: showComposeActions && !isClosingComposeActions,
            isPressed: isComposePressed
        )
            .contentShape(Rectangle())
            .gesture(composePressGesture)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(app.isReadOnly ? "Folders menu" : "Compose menu")
            .accessibilityHint(app.isReadOnly
                ? "Tap for folders and settings."
                : "Tap for folders and actions. Double tap or press briefly to compose.")
            .accessibilityAddTraits(.isButton)
            .opacity(showComposeActions && !isClosingComposeActions ? 0 : 1)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: showComposeActions && !isClosingComposeActions)
            .allowsHitTesting(!showComposeActions)
    }

    private var composePressGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .updating($isComposePressed) { _, pressed, _ in
                pressed = true
            }
            .onChanged { _ in
                if showComposeActions {
                    dismissComposeActions()
                    return
                }
                guard composeTouchBeganAt == nil else { return }
                let now = Date()

                // Double-tap → compose (menu may already be open from the first tap).
                // Read-only mailboxes can't compose: every press just opens the menu.
                if !app.isReadOnly,
                   let last = composeLastTapAt,
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
                          !composeDidTriggerCompose,
                          !app.isReadOnly else { return }
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
        isClosingComposeActions = false
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            showComposeActions = true
        }
    }

    private func dismissComposeActions() {
        guard showComposeActions, !isClosingComposeActions else { return }
        composeDoubleTapArmed = false
        isClosingComposeActions = true
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            highlightedComposeAction = nil
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
            showComposeActions = false
            isClosingComposeActions = false
        }
    }

    private func startComposeFromBar() {
        Task { await app.startCompose(mode: .new) }
    }

    private func performComposeAction(_ item: ComposeActionItem) {
        showComposeActions = false
        isClosingComposeActions = false
        composeDoubleTapArmed = false
        highlightedComposeAction = nil
        switch item {
        case .compose:
            startComposeFromBar()
        case .settings:
            showSettings = true
        default:
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
        if case .chats = app.selectedTab, !app.isReadOnly {
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

    /// Shows / hides the leading folder column (three-column widths only).
    private func setFolderColumnVisible(_ visible: Bool) {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            showsFolderColumn = visible
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
                    // The toolbar can under-measure this on a pushed first render ("…").
                    .fixedSize()
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

                // Read-only mailboxes keep read/star; moving and deleting are blocked.
                if !app.isReadOnly {
                    selectionMoveActions
                }
            }
            .opacity(selectedEmailIDs.isEmpty ? 0.35 : 1)
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
        .liquidGlass(in: RoundedRectangle(cornerRadius: HomeChromeMetrics.chromeCornerRadius, style: .continuous))
    }

    @ViewBuilder
    private var selectionMoveActions: some View {
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

    private var askAIButton: some View {
        Button {
            if showComposeActions {
                dismissComposeActions()
                return
            }
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
    }
}

private struct IdentifiedEmail: Identifiable {
    /// Stable id so prev/next email swaps don't dismiss and re-present the sheet.
    var id: String { "email-detail" }
    let email: Email
}

struct HomeNavigationSubtitle: ViewModifier {
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

/// Soft ink halo behind the Reply Later button while a reminder is due (AVE-86): a
/// slow breath (~1.8s period) of opacity and scale. Reduce Motion keeps a static glow.
/// Android twin: `ReplyLaterAttentionGlow` in HomeChrome.
struct ReplyLaterAttentionGlow: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    /// One inhale or exhale; autoreversed, so a full breath is twice this.
    static let halfPeriod: Double = 0.9

    var body: some View {
        Capsule()
            .fill(AppTheme.attention.opacity(0.22))
            .blur(radius: 9)
            .scaleEffect(reduceMotion ? 1.06 : (breathing ? 1.14 : 1.0))
            .opacity(reduceMotion ? 0.75 : (breathing ? 1 : 0.4))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { startBreathing() }
            .onChange(of: reduceMotion) { _, _ in startBreathing() }
    }

    private func startBreathing() {
        guard !reduceMotion else {
            breathing = false
            return
        }
        breathing = false
        withAnimation(.easeInOut(duration: Self.halfPeriod).repeatForever(autoreverses: true)) {
            breathing = true
        }
    }
}

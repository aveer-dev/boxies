import SwiftUI

private struct ActionsSheetEmail: Identifiable {
    let email: Email
    var id: String { email.id }
}

/// Email rows styled like a mail client:
/// unread dot · sender + time · bold subject · 1-line preview.
struct EmailListView: View {
    @Environment(AppModel.self) private var app

    let emails: [Email]
    var highlightQuery: String = ""
    var isLoading: Bool = false
    var fallbackFolderId: String? = nil
    var bottomInset: CGFloat = HomeChromeMetrics.listBottomInset(hasMinimizedCompose: false)
    var onRefresh: (() async -> Void)? = nil
    var isSelectMode: Bool = false
    var selectedEmailIDs: Binding<Set<String>> = .constant([])
    var isFiltered: Bool = false
    var onClearFilters: (() -> Void)? = nil
    var filterChipsBar: AnyView? = nil
    let onSelect: (Email) -> Void

    @State private var hiddenEmailIDs: Set<String> = []
    @State private var actionsSheetEmail: ActionsSheetEmail?

    private var visibleEmails: [Email] {
        emails.filter { !hiddenEmailIDs.contains($0.id) }
    }

    var body: some View {
        Group {
            if isLoading && visibleEmails.isEmpty {
                skeletonList
            } else if visibleEmails.isEmpty {
                emptyList
            } else {
                emailList
            }
        }
        .animation(nil, value: isLoading)
        .sheet(item: $actionsSheetEmail) { item in
            EmailActionsSheet(email: item.email) { emailId in
                hiddenEmailIDs.insert(emailId)
            }
        }
        .onChange(of: emails.map(\.id)) { _, _ in
            hiddenEmailIDs = hiddenEmailIDs.filter { id in
                emails.contains { $0.id == id }
            }
        }
    }

    /// Empty folders still need a scroll view so pull-to-refresh works.
    private var emptyList: some View {
        ScrollView {
            VStack(spacing: 24) {
                if let filterChipsBar {
                    filterChipsBar
                }

                if isFiltered {
                    ContentUnavailableView {
                        Label("No matching emails", systemImage: "line.3.horizontal.decrease.circle")
                    } description: {
                        Text("No emails match your active filters.")
                    } actions: {
                        if let onClearFilters {
                            Button("Clear Filters", action: onClearFilters)
                                .buttonStyle(.borderedProminent)
                                .tint(AppTheme.ink)
                        }
                    }
                    .padding(.top, 32)
                } else {
                    ContentUnavailableView(
                        "No emails",
                        systemImage: "tray",
                        description: Text("This folder is empty.")
                    )
                    .padding(.top, 48)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .optionalRefreshable(onRefresh)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: bottomInset)
        }
    }

    private var emailList: some View {
        mailList {
            if let filterChipsBar {
                Section {
                    filterChipsBar
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
            }

            if showNewSeenSections {
                newSeenSections
            } else {
                ForEach(visibleEmails) { email in
                    emailRow(for: email)
                }
            }
        }
    }

    private var showNewSeenSections: Bool {
        fallbackFolderId == "inbox"
    }

    /// Prefer sectioned New / Seen when viewing Inbox (even with filters — empty sections hide).
    @ViewBuilder
    private var newSeenSections: some View {
        let newEmails = visibleEmails.filter { $0.resolvedListSection == "new" }
        let seenEmails = visibleEmails.filter { $0.resolvedListSection == "seen" }

        Section {
            sectionHeader(title: "New", count: newEmails.count)
                .listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 4, trailing: 20))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)

            if newEmails.isEmpty {
                Text("You’re caught up")
                    .font(.inter(size: AppTheme.List.preview, weight: .regular))
                    .foregroundStyle(AppTheme.muted)
                    .listRowInsets(EdgeInsets(top: 4, leading: 20, bottom: 12, trailing: 20))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(newEmails) { email in
                    emailRow(for: email)
                }
            }
        }

        if !seenEmails.isEmpty {
            Section {
                sectionHeader(title: "Seen", count: seenEmails.count)
                    .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 4, trailing: 20))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)

                ForEach(seenEmails) { email in
                    emailRow(for: email)
                }
            }
        }
    }

    private func sectionHeader(title: String, count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(.inter(size: AppTheme.List.sectionHeader, weight: .medium))
                .tracking(AppTheme.List.tracking)
                .foregroundStyle(AppTheme.muted)
            Text("· \(count)")
                .font(.inter(size: AppTheme.List.sectionHeader, weight: .regular))
                .foregroundStyle(AppTheme.muted)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func emailRow(for email: Email) -> some View {
                let isSelected = selectedEmailIDs.wrappedValue.contains(email.id)
                Button {
                    if isSelectMode {
                        if isSelected {
                            selectedEmailIDs.wrappedValue.remove(email.id)
                        } else {
                            selectedEmailIDs.wrappedValue.insert(email.id)
                        }
                    } else {
                        onSelect(email)
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isSelectMode {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 20))
                                .foregroundStyle(isSelected ? AppTheme.ink : AppTheme.muted.opacity(0.6))
                                .padding(.leading, 12)
                                .transition(.scale.combined(with: .opacity))
                        }
                        EmailRowView(email: email, highlightQuery: highlightQuery)
                    }
                }
                .buttonStyle(MailRowButtonStyle())
                .mailRowChrome()
                .contextMenu {
                    if !isSelectMode {
                        emailContextMenu(for: email)
                    }
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: isSelectMode ? false : trailingFullSwipe(for: email)) {
                    if !isSelectMode {
                        ForEach(swipeLayout(for: email).trailingActions) { action in
                            swipeButton(action, for: email, removesRow: action == .delete || action == .archive)
                        }
                    }
                }
                .swipeActions(edge: .leading, allowsFullSwipe: isSelectMode ? false : leadingFullSwipe(for: email)) {
                    if !isSelectMode {
                        let layout = swipeLayout(for: email)
                        ForEach(layout.leadingActions) { action in
                            swipeButton(action, for: email, removesRow: action == .delete || action == .archive)
                        }
                        if layout.showsMore {
                            Button {
                                actionsSheetEmail = ActionsSheetEmail(email: email)
                            } label: {
                                Label("More", systemImage: "ellipsis")
                            }
                            .tint(AppTheme.muted)
                        }
                    }
                }
    }

    @ViewBuilder
    private func emailContextMenu(for email: Email) -> some View {
        let availability = EmailActionAvailability(email: email)

        if availability.showsReplyActions {
            Button {
                Task { await app.startCompose(mode: .reply, original: email) }
            } label: {
                Label("Reply", systemImage: "arrowshape.turn.up.left")
            }
            Button {
                Task { await app.startCompose(mode: .replyAll, original: email) }
            } label: {
                Label("Reply All", systemImage: "arrowshape.turn.up.left.2")
            }
            Button {
                Task { await app.startCompose(mode: .forward, original: email) }
            } label: {
                Label("Forward", systemImage: "arrowshape.turn.up.right")
            }
            Divider()
        }

        Button {
            Task { await app.toggleStar(on: email) }
        } label: {
            Label(email.starred ? "Unstar" : "Star", systemImage: email.starred ? "star.fill" : "star")
        }

        Button {
            Task { await app.toggleRead(on: email) }
        } label: {
            Label(email.read ? "Mark as Unread" : "Mark as Read", systemImage: email.read ? "envelope.badge" : "envelope.open")
        }

        Divider()

        Button {
            actionsSheetEmail = ActionsSheetEmail(email: email)
        } label: {
            Label("More Options…", systemImage: "ellipsis.circle")
        }

        if availability.showsDelete {
            Divider()
            Button(role: .destructive) {
                Task {
                    await app.deleteEmail(email, fromList: true)
                    hiddenEmailIDs.insert(email.id)
                }
            } label: {
                Label("Delete Message", systemImage: "trash")
            }
        }
    }

    private func swipeLayout(for email: Email) -> EmailSwipeLayout {
        EmailSwipeLayout.resolve(
            for: email,
            fallbackFolderId: fallbackFolderId,
            preferences: app.swipePreferences
        )
    }

    private func trailingFullSwipe(for email: Email) -> Bool {
        swipeLayout(for: email).trailingAllowsFullSwipe
    }

    private func leadingFullSwipe(for email: Email) -> Bool {
        swipeLayout(for: email).leadingAllowsFullSwipe
    }

    @ViewBuilder
    private func swipeButton(
        _ action: SwipeQuickAction,
        for email: Email,
        removesRow: Bool
    ) -> some View {
        Button {
            Task {
                await app.performSwipeAction(action, on: email)
                if removesRow {
                    hiddenEmailIDs.insert(email.id)
                }
            }
        } label: {
            Label(action.label(for: email), systemImage: action.systemImage(for: email))
        }
        .tint(action.swipeTint)
    }

    private var skeletonList: some View {
        mailList {
            ForEach(0..<Self.skeletonCount, id: \.self) { index in
                EmailRowSkeleton(index: index)
                    .mailRowChrome()
                    .allowsHitTesting(false)
            }
        }
        .skeletonPulse(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading emails")
    }

    private func mailList<Rows: View>(@ViewBuilder rows: () -> Rows) -> some View {
        List {
            rows()
        }
        .listStyle(.plain)
        .contentMargins(.top, 12, for: .scrollContent)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .scrollDisabled(isLoading && visibleEmails.isEmpty)
        .optionalRefreshable(onRefresh)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: bottomInset)
        }
    }

    private static let skeletonCount = 9
}

/// Loading placeholder matching the row geometry.
private struct EmailRowSkeleton: View {
    let index: Int

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.List.dotToText) {
            Circle()
                .fill(AppTheme.pillActive)
                .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotSize)
                .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotLineHeight, alignment: .center)

            VStack(alignment: .leading, spacing: AppTheme.List.rowTextSpacing) {
                HStack(spacing: 8) {
                    bar(width: senderWidth, height: AppTheme.List.sender)
                    Spacer(minLength: 8)
                    bar(width: 44, height: AppTheme.List.date)
                }
                bar(width: subjectWidth, height: AppTheme.List.subject)
                bar(width: previewWidth, height: AppTheme.List.preview)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, AppTheme.List.rowVerticalPadding)
        .padding(.leading, AppTheme.List.rowHorizontalPadding)
        .padding(.trailing, AppTheme.List.rowHorizontalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.List.separatorColor)
                .frame(height: AppTheme.List.separatorHeight)
                .padding(.leading, AppTheme.List.separatorLeadingInset)
                .padding(.trailing, AppTheme.List.rowHorizontalPadding)
                .accessibilityHidden(true)
        }
    }

    private var senderWidth: CGFloat { [128, 156, 112, 140, 168, 120, 148, 104, 136][index % 9] }
    private var subjectWidth: CGFloat { [220, 176, 248, 196, 164, 232, 188, 210, 154][index % 9] }
    private var previewWidth: CGFloat { [260, 210, 284, 198, 246, 172, 268, 224, 190][index % 9] }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(AppTheme.pillActive)
            .frame(width: width, height: height)
    }
}

private struct MailRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

private extension View {
    func mailRowChrome() -> some View {
        self
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(AppTheme.background)
    }

    @ViewBuilder
    func optionalRefreshable(_ action: (() async -> Void)?) -> some View {
        if let action {
            self.refreshable { await action() }
        } else {
            self
        }
    }
}

struct EmailRowView: View {
    let email: Email
    var highlightQuery: String = ""
    var folderLabel: String?

    var body: some View {
        HStack(alignment: .top, spacing: AppTheme.List.dotToText) {
            unreadDot

            VStack(alignment: .leading, spacing: AppTheme.List.rowTextSpacing) {
                headerRow
                subjectRow
                if !previewText.isEmpty {
                    previewRow
                }
                if !rowTags.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(rowTags, id: \.self) { tag in
                            tagRow(tag)
                        }
                    }
                    .padding(.top, 3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, AppTheme.List.rowVerticalPadding)
        .padding(.leading, AppTheme.List.rowHorizontalPadding)
        .padding(.trailing, AppTheme.List.rowHorizontalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.background)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(AppTheme.List.separatorColor)
                .frame(height: AppTheme.List.separatorHeight)
                .padding(.leading, AppTheme.List.separatorLeadingInset)
                .padding(.trailing, AppTheme.List.rowHorizontalPadding)
                .accessibilityHidden(true)
        }
    }

    private var unreadDot: some View {
        Circle()
            .fill(email.isUnread ? AppTheme.unread : AppTheme.pillActive)
            .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotSize)
            .frame(width: AppTheme.List.unreadDotSize, height: AppTheme.List.unreadDotLineHeight, alignment: .center)
            .accessibilityLabel(email.isUnread ? "Unread" : "Read")
    }

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            highlighted(email.displaySender, size: AppTheme.List.sender, weight: email.isUnread ? .medium : .regular)
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)
                .tracking(AppTheme.List.tracking)

            if (email.threadCount ?? 1) > 1 {
                Text("\(email.threadCount!)")
                    .font(.inter(size: AppTheme.List.badge, weight: .medium))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(AppTheme.pillFill)
                    .clipShape(Capsule())
                    .foregroundStyle(AppTheme.muted)
            }

            if email.hasDraft == true {
                Text("Draft")
                    .font(.inter(size: AppTheme.List.badge, weight: .medium))
                    .foregroundStyle(AppTheme.deepDarkRed)
            }

            if email.isSpoofed {
                Text("Spoofed")
                    .font(.inter(size: AppTheme.List.badge, weight: .medium))
                    .foregroundStyle(AppTheme.deepDarkRed)
            }

            Spacer(minLength: 8)

            HStack(alignment: .center, spacing: 4) {
                if email.hasFileAttachment {
                    Image(systemName: "paperclip")
                        .font(.inter(size: AppTheme.List.badge, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .accessibilityLabel("Has attachment")
                }

                if email.replyLater {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.inter(size: AppTheme.List.badge, weight: .medium))
                        .foregroundStyle(AppTheme.accent)
                        .accessibilityLabel("Reply later")
                }
                
                if email.starred {
                    Image(systemName: "star.fill")
                        .font(.inter(size: AppTheme.List.badge, weight: .medium))
                        .foregroundStyle(Color.yellow)
                        .accessibilityLabel("Starred")
                }

                Text(Self.formatDate(email.date))
                    .font(.inter(size: AppTheme.List.date))
                    .foregroundStyle(AppTheme.muted)
            }
        }
    }

    private var subjectRow: some View {
        highlighted(
            email.subject.isEmpty ? "(no subject)" : email.subject,
            size: AppTheme.List.subject,
            weight: email.isUnread ? .medium : .regular
        )
        .foregroundStyle(AppTheme.ink)
        .lineLimit(1)
        .tracking(AppTheme.List.tracking)
        
    }

    private var previewRow: some View {
        highlighted(previewText, size: AppTheme.List.preview, weight: .regular)
            .foregroundStyle(AppTheme.muted)
            .lineLimit(1)
            .tracking(AppTheme.List.tracking)
    }

    private func tagRow(_ tag: String) -> some View {
        Text(tag)
            .font(.inter(size: AppTheme.List.badge, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(AppTheme.pillFill)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .foregroundStyle(tag == "Spoofed" ? AppTheme.deepDarkRed : AppTheme.muted)
            .lineLimit(1)
    }

    private var previewText: String {
        email.previewText
    }

    private var rowTags: [String] {
        var tags: [String] = []
        if let folderLabel, !folderLabel.isEmpty {
            tags.append(folderLabel)
        } else {
            let query = highlightQuery.trimmingCharacters(in: .whitespacesAndNewlines)
            if !query.isEmpty {
                if let folderName = email.folderName, !folderName.isEmpty {
                    tags.append(folderName.capitalized)
                }
            }
        }
        if email.needsReply == true { tags.append("Needs reply") }
        if email.isSpoofed { tags.append("Spoofed") }
        return tags
    }

    private func highlighted(_ text: String, size: CGFloat, weight: Font.Weight) -> Text {
        let query = highlightQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty {
            return Text(text).font(.inter(size: size, weight: weight))
        }
        return Text(Self.attributed(text, highlight: query, size: size, weight: weight))
    }

    private static func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "" }

        let calendar = Calendar.current
        let out = DateFormatter()
        if calendar.isDateInToday(date) {
            out.timeStyle = .short
            out.dateStyle = .none
            return out.string(from: date)
        }
        if calendar.component(.year, from: date) == calendar.component(.year, from: Date()) {
            out.setLocalizedDateFormatFromTemplate("MMMd")
        } else {
            out.setLocalizedDateFormatFromTemplate("MMMdyyyy")
        }
        return out.string(from: date)
    }

    private static func attributed(
        _ text: String,
        highlight: String,
        size: CGFloat,
        weight: Font.Weight
    ) -> AttributedString {
        var result = AttributedString(text)
        result.font = .inter(size: size, weight: weight)
        let lower = text.lowercased()
        let needle = highlight.lowercased()
        var searchStart = lower.startIndex
        while let range = lower.range(of: needle, range: searchStart..<lower.endIndex) {
            if let start = AttributedString.Index(range.lowerBound, within: result),
               let end = AttributedString.Index(range.upperBound, within: result) {
                result[start..<end].font = .inter(size: size, weight: .bold)
                result[start..<end].foregroundColor = AppTheme.ink
            }
            searchStart = range.upperBound
        }
        return result
    }
}

#Preview("Inbox") {
    PreviewHost {
        EmailListView(
            emails: PreviewSupport.emails,
            fallbackFolderId: "inbox"
        ) { _ in }
    }
}

#Preview("Loading") {
    PreviewHost {
        EmailListView(emails: [], isLoading: true) { _ in }
    }
}

#Preview("Empty") {
    PreviewHost {
        EmailListView(emails: []) { _ in }
    }
}

#Preview("Row") {
    EmailRowView(email: PreviewSupport.emails[0])
        .padding(.horizontal, 8)
        .background(AppTheme.background)
}

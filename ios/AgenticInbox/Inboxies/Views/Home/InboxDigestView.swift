import SwiftUI

/// Gmail-style For You page: greeting, suggested to-dos, and topic catch-up cards.
struct InboxDigestView: View {
    @Environment(AppModel.self) private var app

    var bottomInset: CGFloat = HomeChromeMetrics.listBottomInset(hasMinimizedCompose: false)
    var onRefresh: (() async -> Void)? = nil

    @State private var showAllTodos = false

    private var digest: InboxDigest? { app.inboxDigest }
    private var isLoading: Bool { app.isDigestLoading && digest == nil }

    private var visibleTodos: [InboxDigestTodo] {
        guard let todos = digest?.todos else { return [] }
        if showAllTodos || todos.count <= 3 { return todos }
        return Array(todos.prefix(3))
    }

    private var hiddenTodoCount: Int {
        max(0, (digest?.todos.count ?? 0) - 3)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let digest {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        todosSection(digest)
                        topicsSection(digest)
                            .padding(.horizontal, 16)
                            .padding(.top, digest.todos.isEmpty ? 8 : 20)
                    }
                    .padding(.top, 4)
                    .padding(.bottom, bottomInset + 24)
                }
                .refreshable {
                    if let onRefresh {
                        await onRefresh()
                    } else {
                        await app.refreshCurrentTab()
                    }
                }
            } else {
                ContentUnavailableView(
                    "For you",
                    systemImage: "sparkles",
                    description: Text("Pull to refresh suggested to-dos and topics.")
                )
                .refreshable {
                    await app.refreshCurrentTab()
                }
            }
        }
        .background(AppTheme.background)
    }

    @ViewBuilder
    private func todosSection(_ digest: InboxDigest) -> some View {
        if !digest.todos.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(visibleTodos.enumerated()), id: \.element.id) { index, todo in
                    todoRow(todo, showSeparator: index < visibleTodos.count - 1 || (!showAllTodos && hiddenTodoCount > 0))
                }

                if !showAllTodos && hiddenTodoCount > 0 {
                    Button {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                            showAllTodos = true
                        }
                    } label: {
                        Text("Show \(hiddenTodoCount) more")
                            .font(.inter(size: AppTheme.List.subject, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .tracking(AppTheme.List.tracking)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 14)
                            .padding(.leading, AppTheme.List.separatorLeadingInset)
                            .padding(.trailing, AppTheme.List.rowHorizontalPadding)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private static let checkboxSize: CGFloat = 20

    private func todoRow(_ todo: InboxDigestTodo, showSeparator: Bool) -> some View {
        HStack(alignment: .top, spacing: AppTheme.List.dotToText) {
            Button {
                Task { await app.completeDigestTodo(id: todo.id) }
            } label: {
                Image(systemName: "circle")
                    .font(.system(size: 18, weight: .regular))
                    .foregroundStyle(AppTheme.muted.opacity(0.85))
                    .frame(width: Self.checkboxSize, height: Self.checkboxSize)
                    .frame(width: Self.checkboxSize, height: AppTheme.List.unreadDotLineHeight, alignment: .center)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Mark to-do done")

            Button {
                Task { await openTodo(todo) }
            } label: {
                VStack(alignment: .leading, spacing: AppTheme.List.rowTextSpacing) {
                    Text(todo.title.isEmpty ? "(no subject)" : todo.title)
                        .font(.inter(size: AppTheme.List.sender, weight: .medium))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .tracking(AppTheme.List.tracking)

                    if !todo.summary.isEmpty {
                        Text(todo.summary)
                            .font(.inter(size: AppTheme.List.preview, weight: .regular))
                            .foregroundStyle(AppTheme.muted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .tracking(AppTheme.List.tracking)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(todo.title)
            .accessibilityHint("Opens email")
        }
        .padding(.vertical, AppTheme.List.rowVerticalPadding)
        .padding(.horizontal, AppTheme.List.rowHorizontalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.background)
        .overlay(alignment: .bottom) {
            if showSeparator {
                Rectangle()
                    .fill(AppTheme.List.separatorColor)
                    .frame(height: AppTheme.List.separatorHeight)
                    .padding(.leading, AppTheme.List.rowHorizontalPadding + Self.checkboxSize + AppTheme.List.dotToText)
                    .padding(.trailing, AppTheme.List.rowHorizontalPadding)
                    .accessibilityHidden(true)
            }
        }
    }

    @ViewBuilder
    private func topicsSection(_ digest: InboxDigest) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Topics to catch up on")
                    .font(.inter(size: 20, weight: .bold))
                    .foregroundStyle(AppTheme.ink)

                Text(topicsSubtitle(digest.unreadCount))
                    .font(.inter(size: 13, weight: .regular))
                    .foregroundStyle(AppTheme.muted)
            }

            if digest.topics.isEmpty {
                Text("No topics yet. New mail will show up here.")
                    .font(.inter(size: 14, weight: .regular))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.vertical, 8)
            } else {
                ForEach(digest.topics) { topic in
                    topicCard(topic)
                }
            }
        }
    }

    private func topicsSubtitle(_ unread: Int) -> String {
        if unread == 0 {
            return "You’re caught up on unread email"
        }
        if unread == 1 {
            return "Your latest updates from 1 unread email"
        }
        return "Your latest updates from \(unread) unread emails"
    }

    private func topicCard(_ topic: InboxDigestTopic) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(topic.emoji)
                    .font(.system(size: 18))
                Text(topic.title)
                    .font(.inter(size: 16, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                Spacer(minLength: 8)
                if !topic.caughtUp {
                    Button {
                        Task {
                            await app.markDigestTopicRead(
                                topicId: topic.id,
                                emailIds: topic.items.map(\.emailId)
                            )
                        }
                    } label: {
                        Image(systemName: "envelope.open")
                            .font(.inter(size: 13, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Mark topic read")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 10)

            if topic.caughtUp {
                Text("You are caught up on emails!")
                    .font(.inter(size: 13, weight: .regular))
                    .foregroundStyle(AppTheme.muted)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
            } else if let featured = topic.items.first {
                topicItemRow(featured)
                if let remaining = topic.remainingSummary, topic.items.count > 1 {
                    Divider()
                        .padding(.leading, 16)
                    Text(remaining)
                        .font(.inter(size: 13, weight: .regular))
                        .foregroundStyle(AppTheme.muted)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
            }
        }
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(AppTheme.line.opacity(0.7), lineWidth: 0.5)
        }
    }

    private func topicItemRow(_ item: InboxDigestTopicItem) -> some View {
        Button {
            Task { await openTopicItem(item) }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.subject.isEmpty ? "(no subject)" : item.subject)
                        .font(.inter(size: 14, weight: .semibold))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Text(Self.relativeDate(item.date))
                        .font(.inter(size: 11, weight: .regular))
                        .foregroundStyle(AppTheme.muted)
                }

                if !item.summary.isEmpty {
                    Text(item.summary)
                        .font(.inter(size: 13, weight: .regular))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }

                HStack(spacing: 8) {
                    if item.attachmentCount > 0 {
                        Label("\(item.attachmentCount)", systemImage: "paperclip")
                            .font(.inter(size: 11, weight: .medium))
                            .foregroundStyle(AppTheme.muted)
                            .labelStyle(.titleAndIcon)
                    }
                    Spacer(minLength: 0)
                    if item.unread {
                        Circle()
                            .fill(AppTheme.accent)
                            .frame(width: 8, height: 8)
                            .accessibilityLabel("Unread")
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func openTodo(_ todo: InboxDigestTodo) async {
        await openEmailId(todo.emailId)
    }

    private func openTopicItem(_ item: InboxDigestTopicItem) async {
        await openEmailId(item.emailId)
    }

    private func openEmailId(_ emailId: String) async {
        if let email = app.emails.first(where: { $0.id == emailId }) {
            await app.openEmail(email)
            return
        }
        guard let mailboxId = app.selectedMailboxId else { return }
        do {
            let email = try await APIClient.shared.getEmail(mailboxId: mailboxId, id: emailId)
            await app.openEmail(email)
        } catch {
            app.showToast("Couldn’t open email", isError: true)
        }
    }

    private static func relativeDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "" }
        let rel = RelativeDateTimeFormatter()
        rel.unitsStyle = .full
        return rel.localizedString(for: date, relativeTo: Date())
    }
}

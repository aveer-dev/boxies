import SwiftUI
import UIKit

/// State for one AutoFill request: pick an existing private email or create
/// one, then hand the address back to fill the focused field.
@Observable
@MainActor
final class PrivateEmailRequest {
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
        case signedOut
    }

    /// The site being filled, when iOS says (password-list flow only).
    private(set) var host: String?
    private(set) var matcher: PrivateEmailMatcher?
    private(set) var state: LoadState = .loading
    private(set) var emails: [PrivateEmail] = []
    private(set) var isCreating = false
    /// Transient explanation when an action can't go ahead (signed out, create failed).
    private(set) var toast: Toast?
    private var toastDismissTask: Task<Void, Never>?
    var query = ""

    var onFill: ((String) -> Void)?
    var onCancel: (() -> Void)?

    func configure(host: String?) {
        self.host = host
        matcher = PrivateEmailMatcher(host: host)
        load()
    }

    func load() {
        guard PrivateEmailClient.isSignedIn else {
            state = .signedOut
            return
        }
        state = .loading
        Task {
            do {
                let now = Date()
                let all = try await PrivateEmailClient.listAliases()
                emails = all.filter { $0.isUsable(now: now) }
                state = .loaded
                // Fresh list in hand: resync the QuickType suggestions too.
                await PrivateEmailIdentities.replace(with: all)
            } catch PrivateEmailClient.Failure.signedOut {
                state = .signedOut
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }

    private var searched: [PrivateEmail] {
        PrivateEmailSearch.filter(emails, query: query)
    }

    /// Emails that belong to the site being filled.
    var suggested: [PrivateEmail] {
        guard let matcher else { return [] }
        return searched.filter(matcher.matches)
    }

    /// Everything else, in server order (newest first).
    var others: [PrivateEmail] {
        guard let matcher else { return searched }
        return searched.filter { !matcher.matches($0) }
    }

    var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func select(_ email: PrivateEmail) {
        onFill?(email.address)
    }

    func create() {
        guard !isCreating else { return }
        guard PrivateEmailClient.isSignedIn else {
            showSignedOutToast()
            return
        }
        isCreating = true
        Task {
            defer { isCreating = false }
            do {
                let created = try await PrivateEmailClient.createAlias(label: host)
                // Before filling: completing the request ends the extension.
                await PrivateEmailIdentities.add(created)
                onFill?(created.address)
            } catch PrivateEmailClient.Failure.signedOut {
                state = .signedOut
                showSignedOutToast()
            } catch {
                showToast(Toast(title: "Couldn’t create a private email", message: error.localizedDescription))
            }
        }
    }

    private func showSignedOutToast() {
        showToast(Toast(
            title: "You’re signed out of Inboxies",
            message: "Open the Inboxies app and sign in, then try again."
        ))
    }

    private func showToast(_ toast: Toast) {
        toastDismissTask?.cancel()
        self.toast = toast
        toastDismissTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    func cancel() {
        onCancel?()
    }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let message: String
}

/// AutoFill sheet in the app's chrome: Inter, AppTheme tokens, xmark close.
/// iOS always presents credential-provider UI as a full-height card, so the
/// content is a searchable list of card sections rather than a short panel.
struct PrivateEmailRequestView: View {
    @Bindable var model: PrivateEmailRequest
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppTheme.background)
                // Inside the search inset, so the toast sits just above the bar.
                .overlay(alignment: .bottom) {
                    if let toast = model.toast {
                        toastView(toast)
                    }
                }
                .animation(.spring(response: 0.32, dampingFraction: 0.86), value: model.toast?.id)
                .sensoryFeedback(.warning, trigger: model.toast?.id) { _, new in new != nil }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if model.state != .signedOut {
                        searchBar
                            .padding(.horizontal, HomeChromeMetrics.chromeHorizontalPadding)
                            .padding(.top, 8)
                            .padding(.bottom, 8)
                    }
                }
                .navigationTitle("Inboxies: Private email")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            model.cancel()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.inter(size: 13, weight: .semibold))
                                .foregroundStyle(AppTheme.ink)
                                .frame(width: 32, height: 32)
                        }
                        .accessibilityLabel("Close")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        createButton
                    }
                }
        }
        .font(.inter(size: 14))
        .tint(AppTheme.accent)
    }

    // MARK: - Toolbar

    private var createButton: some View {
        Button {
            searchFocused = false
            model.create()
        } label: {
            ZStack {
                Image(systemName: "plus")
                    .font(.inter(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                    .opacity(model.isCreating ? 0 : 1)
                if model.isCreating {
                    ProgressView()
                }
            }
            .frame(width: 32, height: 32)
        }
        // Never disabled while signed out: tapping explains why it can't create.
        .disabled(model.isCreating)
        .accessibilityLabel(model.isCreating ? "Creating private email" : "Create new private email")
        .accessibilityHint(model.host.map { "Labelled \($0), then filled in" } ?? "Creates an address and fills it in")
    }

    // MARK: - Toast

    /// Same chrome as the app's toasts (material, hairline, soft shadow), two
    /// lines so it can say what to do next.
    private func toastView(_ toast: Toast) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.inter(size: 15, weight: .semibold))
                .foregroundStyle(AppTheme.ink)
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.inter(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
                Text(toast.message)
                    .font(.inter(size: 13))
                    .foregroundStyle(AppTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(AppTheme.line.opacity(0.6), lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    // MARK: - Search

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(AppTheme.muted)
            TextField("Search private emails", text: $model.query)
                .font(.inter(size: 15))
                .foregroundStyle(AppTheme.ink)
                .focused($searchFocused)
                .submitLabel(.search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.none)
            if model.isSearching {
                Button {
                    model.query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: HomeChromeMetrics.actionBarHeight)
        .liquidGlass(in: RoundedRectangle(cornerRadius: HomeChromeMetrics.chromeCornerRadius, style: .continuous))
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .signedOut:
            ContentUnavailableView {
                Label("Sign in to Inboxies", systemImage: "person.crop.circle.badge.exclamationmark")
                    .font(.inter(size: 17, weight: .semibold))
            } description: {
                Text("Open Inboxies and sign in first, then come back here.")
                    .font(.inter(size: 13))
            }
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn’t load private emails", systemImage: "exclamationmark.triangle")
                    .font(.inter(size: 17, weight: .semibold))
            } description: {
                Text(message)
                    .font(.inter(size: 13))
            } actions: {
                Button("Retry") { model.load() }
                    .font(.inter(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.ink)
            }
        case .loading, .loaded:
            list
        }
    }

    private var list: some View {
        List {
            if model.state == .loading {
                Section {
                    ForEach(0..<5, id: \.self) { index in
                        PrivateEmailRowSkeleton(index: index)
                            .cardRow()
                    }
                } header: {
                    sectionHeader("Private emails")
                }
                .skeletonPulse(true)
            } else if model.suggested.isEmpty && model.others.isEmpty {
                Section {
                    Text(model.isSearching
                         ? "No private emails match “\(model.query.trimmingCharacters(in: .whitespacesAndNewlines))”."
                         : "No private emails yet. Tap + to create one.")
                        .font(.inter(size: 13))
                        .foregroundStyle(AppTheme.muted)
                        .cardRow()
                } footer: {
                    copyNote
                }
            } else {
                if !model.suggested.isEmpty, let matcher = model.matcher {
                    Section {
                        ForEach(model.suggested) { email in
                            row(email)
                        }
                    } header: {
                        sectionHeader("For \(matcher.domain)")
                    } footer: {
                        if model.others.isEmpty { copyNote }
                    }
                }
                if !model.others.isEmpty {
                    Section {
                        ForEach(model.others) { email in
                            row(email)
                        }
                    } header: {
                        sectionHeader(model.suggested.isEmpty ? "Private emails" : "Other private emails")
                    } footer: {
                        copyNote
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .listSectionSpacing(20)
        .contentMargins(.top, 8, for: .scrollContent)
    }

    private func row(_ email: PrivateEmail) -> some View {
        Button {
            model.select(email)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(email.label?.isEmpty == false ? email.label! : email.address)
                    .font(.inter(size: AppTheme.List.title, weight: .medium))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                if email.label?.isEmpty == false {
                    Text(email.address)
                        .font(.inter(size: AppTheme.List.subject))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressedRowStyle())
        .cardRow()
        .accessibilityLabel(email.label.map { "\($0), \(email.address)" } ?? email.address)
        .accessibilityHint("Fills this address")
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.inter(size: AppTheme.List.sectionHeader, weight: .medium))
            .tracking(AppTheme.List.tracking)
            .foregroundStyle(AppTheme.muted)
            .accessibilityAddTraits(.isHeader)
    }

    /// iOS 17 can't type into the field, so picking an email copies it instead.
    @ViewBuilder
    private var copyNote: some View {
        if #unavailable(iOS 18.0) {
            Text("Choosing an email copies it. Paste it into the field.")
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
        }
    }
}

/// Pressed rows dim to 0.55, as elsewhere in the app.
private struct PressedRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/// Loading placeholder matching the private email row geometry.
private struct PrivateEmailRowSkeleton: View {
    let index: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            bar(width: [132, 168, 112, 150, 124][index % 5], height: AppTheme.List.title)
            bar(width: [210, 236, 188, 224, 200][index % 5], height: AppTheme.List.subject)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(AppTheme.pillActive)
            .frame(width: width, height: height)
    }
}

private extension View {
    /// A row in an inset-grouped card: surface fill, hairline separators.
    func cardRow() -> some View {
        listRowInsets(EdgeInsets(top: 11, leading: 16, bottom: 11, trailing: 16))
            .listRowBackground(AppTheme.surface)
            .listRowSeparatorTint(AppTheme.line)
    }
}

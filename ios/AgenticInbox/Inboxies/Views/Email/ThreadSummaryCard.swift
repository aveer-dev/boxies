import SwiftUI

/// Summaries already fetched this session, so reopening a thread or paging back
/// doesn't flash the skeleton. The server caches too; this only saves the round trip.
@MainActor
enum AISummaryMemoryCache {
    private static var entries: [String: AISummary] = [:]

    static func key(mailboxId: String, threadId: String) -> String { "\(mailboxId)|\(threadId)" }
    static func get(_ key: String) -> AISummary? { entries[key] }
    static func set(_ summary: AISummary, for key: String) {
        if entries.count > 200 { entries.removeAll() }
        entries[key] = summary
    }
}

/// AI summary at the top of the reader (AVE-218), twin of web `AISummaryCard` and the
/// Android `ThreadSummaryCard`. Loads lazily when a qualifying thread opens, renders
/// nothing while the mail isn't eligible, and shows a calm note at the daily AI limit.
struct ThreadSummaryCard: View {
    let mailboxId: String?
    let threadId: String
    /// `AISummaryEligibility.isEnabled`; false skips the request entirely.
    let enabled: Bool
    var isDebugPreview: Bool = false

    private enum Phase: Equatable {
        case idle
        case loading
        case ready(AISummary)
        /// Nothing to show (not eligible, or nothing to ask).
        case hidden
        case failed(quota: Bool)
    }

    @State private var phase: Phase = .idle
    @State private var regenerating = false
    /// Set when Regenerate failed; the previous summary stays on screen.
    @State private var regenerateError: String?
    @State private var expanded = false
    @State private var fullTextHeight: CGFloat = 0
    @State private var clampedTextHeight: CGFloat = 0

    private static let spring = Animation.spring(response: 0.32, dampingFraction: 0.86)
    private static let textSize: CGFloat = 13
    private static let lineSpacing: CGFloat = 3

    private var taskKey: String { "\(mailboxId ?? "")|\(threadId)|\(enabled)" }

    var body: some View {
        VStack(spacing: 0) {
            // Always present, so `.task` runs while the card itself is hidden.
            Color.clear.frame(height: 0)
            switch phase {
            case .idle, .hidden:
                EmptyView()
            case .loading, .ready, .failed:
                card
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
        .animation(Self.spring, value: phase)
        .task(id: taskKey) { await load() }
    }

    // MARK: - Layout

    private var card: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.muted)
                .frame(width: 16, height: 18)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if case .ready = phase {
                Button {
                    Task { await regenerate() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .rotationEffect(.degrees(regenerating ? 360 : 0))
                        .animation(
                            regenerating ? .linear(duration: 0.9).repeatForever(autoreverses: false) : .default,
                            value: regenerating
                        )
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(regenerating)
                .padding(.top, -5)
                .padding(.trailing, -6)
                .accessibilityLabel("Regenerate summary")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 0.5)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("AI summary")
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .ready(let summary) where !regenerating:
            summaryText(summary)
            if let regenerateError {
                Text("\(regenerateError) The previous summary is shown.")
                    .font(.inter(size: 12))
                    .foregroundStyle(AppTheme.muted)
            }
        case .failed(let quota):
            failedText(quota: quota)
        default:
            skeleton
        }
    }

    private func summaryText(_ summary: AISummary) -> some View {
        let hasMore = fullTextHeight > clampedTextHeight + 1 || !summary.keyPoints.isEmpty
        return VStack(alignment: .leading, spacing: 4) {
            Text(summary.summary)
                .font(.inter(size: Self.textSize))
                .lineSpacing(Self.lineSpacing)
                .foregroundStyle(AppTheme.ink)
                .lineLimit(expanded ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
                .background {
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear { if !expanded { clampedTextHeight = proxy.size.height } }
                            .onChange(of: proxy.size.height) { _, height in
                                if !expanded { clampedTextHeight = height }
                            }
                    }
                }
                .background {
                    // Unclamped twin, measured to know whether "Show more" has anything to show.
                    Text(summary.summary)
                        .font(.inter(size: Self.textSize))
                        .lineSpacing(Self.lineSpacing)
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .background {
                            GeometryReader { proxy in
                                Color.clear
                                    .onAppear { fullTextHeight = proxy.size.height }
                                    .onChange(of: proxy.size.height) { _, height in fullTextHeight = height }
                            }
                        }
                }

            if expanded, !summary.keyPoints.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(summary.keyPoints.enumerated()), id: \.offset) { _, point in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("•")
                            Text(point)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.inter(size: Self.textSize))
                        .lineSpacing(Self.lineSpacing)
                        .foregroundStyle(AppTheme.ink)
                    }
                }
                .padding(.top, 2)
                .transition(.opacity)
            }

            if hasMore {
                Button {
                    withAnimation(Self.spring) { expanded.toggle() }
                } label: {
                    Text(expanded ? "Show less" : "Show more")
                        .font(.inter(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.muted)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isButton)
            }
        }
    }

    @ViewBuilder
    private func failedText(quota: Bool) -> some View {
        if quota {
            Text(AISummaryQuota.text())
                .font(.inter(size: 12))
                .foregroundStyle(AppTheme.muted)
        } else {
            HStack(spacing: 4) {
                Text("Couldn’t summarize this email.")
                    .foregroundStyle(AppTheme.muted)
                Button("Try again") {
                    Task { await load(force: true) }
                }
                .buttonStyle(.plain)
                .foregroundStyle(AppTheme.accent)
            }
            .font(.inter(size: 12))
        }
    }

    /// Two muted bars, the height of the clamped text, while the model works.
    private var skeleton: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.pillActive)
                    .frame(width: proxy.size.width, height: 8)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(AppTheme.pillActive)
                    .frame(width: proxy.size.width * 0.6, height: 8)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 34)
        .skeletonPulse(true)
        .accessibilityLabel("Summarizing…")
    }

    // MARK: - Loading

    private func load(force: Bool = false) async {
        expanded = false
        regenerateError = nil
        #if DEBUG
        if let fixture = Self.previewPhase() {
            phase = fixture
            return
        }
        #endif
        guard enabled, let mailboxId, !isDebugPreview else {
            phase = .hidden
            return
        }
        let key = AISummaryMemoryCache.key(mailboxId: mailboxId, threadId: threadId)
        if !force, let cached = AISummaryMemoryCache.get(key) {
            phase = .ready(cached)
            return
        }
        phase = .loading
        // One quiet retry for a model failure, none at the quota limit (web `retrySummaryOnce`).
        for attempt in 0..<2 {
            do {
                let response = try await APIClient.shared.getThreadSummary(mailboxId: mailboxId, threadId: threadId)
                guard !Task.isCancelled else { return }
                if let summary = response.summary {
                    AISummaryMemoryCache.set(summary, for: key)
                    phase = .ready(summary)
                } else {
                    phase = .hidden
                }
                return
            } catch {
                guard !Task.isCancelled, !(error is CancellationError) else { return }
                if AISummaryQuota.isQuotaError(error) {
                    phase = .failed(quota: true)
                    return
                }
                if case APIError.http(404, _) = error {
                    phase = .hidden
                    return
                }
                if attempt == 1 { phase = .failed(quota: false) }
            }
        }
    }

    private func regenerate() async {
        guard let mailboxId, !regenerating else { return }
        regenerateError = nil
        regenerating = true
        defer { regenerating = false }
        #if DEBUG
        if Self.previewPhase() != nil {
            try? await Task.sleep(nanoseconds: 900_000_000)
            return
        }
        #endif
        do {
            let response = try await APIClient.shared.regenerateThreadSummary(mailboxId: mailboxId, threadId: threadId)
            if let summary = response.summary {
                AISummaryMemoryCache.set(summary, for: AISummaryMemoryCache.key(mailboxId: mailboxId, threadId: threadId))
                expanded = false
                phase = .ready(summary)
            }
        } catch {
            regenerateError = AISummaryQuota.isQuotaError(error) ? AISummaryQuota.text() : "Couldn’t regenerate."
        }
    }

    #if DEBUG
    /// `-previewSummary [quota|loading]` (with `-previewDetail`): a fixture card, no API.
    private static func previewPhase() -> Phase? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-previewSummary") else { return nil }
        let mode = args.indices.contains(index + 1) ? args[index + 1] : ""
        switch mode {
        case "quota": return .failed(quota: true)
        case "loading": return .loading
        default: return .ready(PreviewAISummary.fixture)
        }
    }
    #endif
}

#if DEBUG
enum PreviewAISummary {
    static let fixture = AISummary(
        targetId: "preview-thread",
        summary: "Dana shared the Q3 planning notes and wants owners for the three launch workstreams by Friday. Marcus already took onboarding; pricing and the partner pilot are still open.",
        keyPoints: [
            "Pick an owner for pricing or the partner pilot",
            "Reply to Dana by Friday",
        ],
        model: "preview",
        messageCount: 2
    )
}
#endif

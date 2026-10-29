import SwiftUI

/// Daily AI quota UI (AVE-45): web twin of `app/components/AiUsageMeter.tsx`.
/// Calm accent under 80%, warning tint from 80%, red at the limit.
enum AIUsageLevel {
    case normal, warning, exhausted

    init(_ counter: AIUsage.Counter) {
        if counter.limit <= 0 || counter.used >= counter.limit {
            self = .exhausted
        } else if Double(counter.used) / Double(counter.limit) >= 0.8 {
            self = .warning
        } else {
            self = .normal
        }
    }

    var fill: Color {
        switch self {
        case .normal: AppTheme.accent
        case .warning: AppTheme.Usage.warning
        case .exhausted: AppTheme.Usage.danger
        }
    }
}

enum AIUsageFormat {
    /// "under a minute", "42m", "5h", "1h 40m" — matches `formatAiUsageReset` on web.
    static func remaining(until resetsAt: Date, now: Date = .now) -> String {
        let ms = max(0, resetsAt.timeIntervalSince(now) * 1000)
        if ms <= 60_000 { return "under a minute" }
        let minutes = Int((ms / 60_000).rounded(.up))
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let rest = minutes % 60
        if rest == 0 || hours >= 3 { return "\(hours)h" }
        return "\(hours)h \(rest)m"
    }

    static func resetLabel(_ resetsAt: Date?, now: Date = .now) -> String {
        guard let resetsAt else { return "Resets at midnight UTC" }
        return "Resets in \(remaining(until: resetsAt, now: now))"
    }
}

/// "12 / 50 AI chats today · Resets in 6h" over a thin capsule bar.
struct AIUsageMeter: View {
    let counter: AIUsage.Counter
    /// Plural noun, e.g. "AI chats".
    let noun: String
    let resetsAt: Date?

    private var level: AIUsageLevel { AIUsageLevel(counter) }

    private var fraction: CGFloat {
        guard counter.limit > 0 else { return 1 }
        return min(1, max(0, CGFloat(counter.used) / CGFloat(counter.limit)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(Text("\(counter.used) / \(counter.limit)").monospacedDigit()) \(noun) today")
                    .font(.inter(size: AppTheme.Chat.meta, weight: level == .normal ? .regular : .medium))
                    .foregroundStyle(level == .normal ? AppTheme.muted : AppTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                TimelineView(.everyMinute) { context in
                    Text(AIUsageFormat.resetLabel(resetsAt, now: context.date))
                        .font(.inter(size: AppTheme.Chat.meta))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            GeometryReader { proxy in
                Capsule()
                    .fill(AppTheme.pillFill)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(level.fill)
                            .frame(width: proxy.size.width * fraction)
                    }
            }
            .frame(height: 4)
            .animation(.spring(response: 0.32, dampingFraction: 0.86), value: fraction)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(noun) used today")
        .accessibilityValue("\(counter.used) of \(counter.limit). \(AIUsageFormat.resetLabel(resetsAt))")
    }
}

/// Red-tinted box above the chat composer once today's chat limit is spent.
struct AIUsageLimitNotice: View {
    let resetsAt: Date?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.inter(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.Usage.danger)
                .padding(.top, 1)
            TimelineView(.everyMinute) { context in
                Text("\(Text("Daily AI chat limit reached.").font(.inter(size: AppTheme.Chat.toolAction, weight: .semibold)))\(Text(detail(now: context.date)))")
                    .font(.inter(size: AppTheme.Chat.toolAction))
                    .foregroundStyle(AppTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background {
            // Opaque surface under the tint: the notice floats over the transcript.
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(AppTheme.surface)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(AppTheme.Usage.danger.opacity(0.10))
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppTheme.Usage.danger.opacity(0.28), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
    }

    private func detail(now: Date) -> String {
        guard let resetsAt else { return " You can chat again after midnight UTC." }
        let time = resetsAt.formatted(date: .omitted, time: .shortened)
        return " You can chat again at \(time) (in \(AIUsageFormat.remaining(until: resetsAt, now: now)))."
    }
}

extension AppModel {
    /// Today's AI usage for the selected mailbox; nil when unavailable
    /// (offline, older Worker). DEBUG previews return the fixture instead.
    func loadAIUsage() async -> AIUsage? {
        #if DEBUG
        if let fixture = PreviewSupport.aiUsageFixture { return fixture }
        if isDebugPreview { return nil }
        #endif
        guard let mailboxId = selectedMailboxId else { return nil }
        return try? await APIClient.shared.fetchAIUsage(mailboxId: mailboxId)
    }
}

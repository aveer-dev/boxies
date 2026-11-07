import AppIntents
import SwiftUI
import WidgetKit

/// "Today's inbox" (AVE-149, design AVE-138 round 2 "Depth"): New count, a deck of the
/// newest New threads you flip with ›, and Reply later. Small and medium. Grey-scale,
/// Inter; the views are the shared `InboxWidgetDepthContent` the gallery shows.
struct TodayInboxWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: InboxWidgetKind.todayInbox,
            intent: SelectMailboxIntent.self,
            provider: TodayInboxProvider()
        ) { entry in
            TodayInboxWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's inbox")
        .description("New conversations and Reply later, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TodayInboxEntry: TimelineEntry {
    let date: Date
    /// Nil when the app hasn't written anything for this mailbox (signed out, first run).
    let snapshot: InboxWidgetSnapshot?
    let frontIndex: Int
    let relevance: TimelineEntryRelevance?

    static func sample(_ snapshot: InboxWidgetSnapshot = .sampleHasMail, date: Date = Date()) -> TodayInboxEntry {
        TodayInboxEntry(date: date, snapshot: snapshot, frontIndex: 0, relevance: nil)
    }
}

struct TodayInboxProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TodayInboxEntry {
        .sample()
    }

    func snapshot(for configuration: SelectMailboxIntent, in context: Context) async -> TodayInboxEntry {
        // The widget gallery shows sample mail; a placed widget shows the real thing.
        if context.isPreview { return .sample() }
        return entry(for: configuration, now: Date())
    }

    func timeline(for configuration: SelectMailboxIntent, in context: Context) async -> Timeline<TodayInboxEntry> {
        let now = Date()
        let current = entry(for: configuration, now: now)
        // The app reloads on every change; the only scheduled refresh is midnight, for the
        // inbox-zero line of the day.
        let midnight = Calendar.current.nextDate(
            after: now,
            matching: DateComponents(hour: 0, minute: 0),
            matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(24 * 60 * 60)
        return Timeline(entries: [current], policy: .after(midnight))
    }

    private func entry(for configuration: SelectMailboxIntent, now: Date) -> TodayInboxEntry {
        let store = InboxWidgetStore.shared
        guard let store,
              let mailboxId = configuration.resolvedMailboxId(in: store),
              let snapshot = store.snapshot(mailboxId: mailboxId) else {
            return TodayInboxEntry(date: now, snapshot: nil, frontIndex: 0, relevance: nil)
        }
        let relevance = InboxWidgetRelevance.score(
            newCount: snapshot.newCount,
            roseAt: store.newCountRoseAt(mailboxId: mailboxId),
            now: now
        )
        return TodayInboxEntry(
            date: now,
            snapshot: snapshot,
            frontIndex: store.frontIndex(mailboxId: mailboxId, threadCount: snapshot.threads.count),
            relevance: TimelineEntryRelevance(score: relevance.score, duration: relevance.duration)
        )
    }
}

struct TodayInboxWidgetView: View {
    let entry: TodayInboxEntry
    @Environment(\.widgetFamily) private var widgetFamily

    private var family: InboxWidgetFamily {
        widgetFamily == .systemSmall ? .small : .medium
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .environment(\.font, .inter(size: 13))
            // Anywhere that isn't a card opens the Inbox.
            .widgetURL(InboxWidgetLink.inbox(mailboxId: entry.snapshot?.mailboxId).url)
            // The bloom is the container background so tinted / clear home screens (iOS 26)
            // can drop it.
            .containerBackground(for: .widget) {
                InboxWidgetAmbientBackground(newCount: entry.snapshot?.newCount ?? 0)
            }
    }

    @ViewBuilder
    private var content: some View {
        if let snapshot = entry.snapshot {
            InboxWidgetDepthContent(
                family: family,
                snapshot: snapshot,
                front: entry.frontIndex,
                now: entry.date,
                live: InboxWidgetLive(mailboxId: snapshot.mailboxId)
            )
        } else {
            VStack(alignment: .leading, spacing: 0) {
                InboxWidgetHeader(isLive: false)
                Spacer(minLength: 0)
                Text("Open Inboxies to see today's inbox.")
                    .font(.inter(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(3)
            }
        }
    }
}

#Preview("Small", as: .systemSmall) {
    TodayInboxWidget()
} timeline: {
    TodayInboxEntry.sample()
    TodayInboxEntry(date: Date(), snapshot: .sampleHasMail, frontIndex: 1, relevance: nil)
    TodayInboxEntry.sample(.sampleInboxZero)
}

#Preview("Medium", as: .systemMedium) {
    TodayInboxWidget()
} timeline: {
    TodayInboxEntry.sample()
    TodayInboxEntry(date: Date(), snapshot: .sampleHasMail, frontIndex: 1, relevance: nil)
    TodayInboxEntry.sample(.sampleInboxZero)
}

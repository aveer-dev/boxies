import SwiftUI
import WidgetKit

/// "Inbox" complication + Smart Stack widget (AVE-146): the watch's active mailbox's
/// Inbox unread count and who sent the newest unread conversation. Reads the snapshot
/// the watch app writes to the App Group (`WatchGlanceStore`); never touches the
/// network or the session. The app reloads it on a phone push, on its background
/// refresh and whenever the count changes on the watch.
struct InboxGlanceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WatchGlanceKind.inbox, provider: InboxGlanceProvider()) { entry in
            InboxGlanceView(entry: entry)
        }
        .configurationDisplayName("Inbox")
        .description("New mail in your Inbox and who sent the latest.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
    }
}

struct InboxGlanceEntry: TimelineEntry {
    let date: Date
    /// Nil when the watch app hasn't written anything (not connected, signed out).
    let snapshot: WatchGlanceSnapshot?
    let relevance: TimelineEntryRelevance?

    static let sample = InboxGlanceEntry(
        date: Date(),
        snapshot: WatchGlanceSnapshot(mailboxId: "sample", unreadCount: 3, newestSender: "Maya Chen"),
        relevance: nil
    )
}

struct InboxGlanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> InboxGlanceEntry {
        .sample
    }

    func getSnapshot(in context: Context, completion: @escaping (InboxGlanceEntry) -> Void) {
        // The face / Smart Stack gallery shows sample mail; a placed widget the real thing.
        completion(context.isPreview ? .sample : entry(now: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<InboxGlanceEntry>) -> Void) {
        let now = Date()
        // The app reloads on every change; the hourly re-read only recovers a missed reload.
        completion(Timeline(entries: [entry(now: now)], policy: .after(now.addingTimeInterval(60 * 60))))
    }

    private func entry(now: Date) -> InboxGlanceEntry {
        let snapshot = WatchGlanceStore.shared?.read()
        return InboxGlanceEntry(
            date: now,
            snapshot: snapshot,
            relevance: snapshot.map { TimelineEntryRelevance(score: $0.relevanceScore) }
        )
    }
}

/// Grey-scale on every face: in full color the count is `accent` only while there is
/// unread mail (the house rule: accent for unread), everything else `ink` / `muted`.
/// In the accented and vibrant (tinted / grey-scale) modes it falls back to the
/// system's primary / secondary, and only the unread count is `widgetAccentable`.
struct InboxGlanceView: View {
    let entry: InboxGlanceEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode

    private var unread: Int { entry.snapshot?.unreadCount ?? 0 }
    private var hasUnread: Bool { unread > 0 }
    private var isFullColor: Bool { renderingMode == .fullColor }

    private var countText: String {
        guard entry.snapshot != nil else { return "–" }
        return unread > 99 ? "99+" : String(unread)
    }

    private var primary: AnyShapeStyle {
        isFullColor ? AnyShapeStyle(WatchPalette.ink) : AnyShapeStyle(.primary)
    }

    private var secondary: AnyShapeStyle {
        isFullColor ? AnyShapeStyle(WatchPalette.muted) : AnyShapeStyle(.secondary)
    }

    private var countStyle: AnyShapeStyle {
        isFullColor && hasUnread ? AnyShapeStyle(WatchPalette.accent) : primary
    }

    var body: some View {
        content
            .containerBackground(for: .widget) { WatchPalette.background }
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular: circular
        case .accessoryInline: inline
        case .accessoryCorner: corner
        default: rectangular
        }
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: "tray.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(secondary)
                Text(countText)
                    .font(WatchType.inter(20, .semibold))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .foregroundStyle(countStyle)
                    .widgetAccentable(hasUnread)
            }
            .padding(.horizontal, 4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label {
                Text("Inbox")
            } icon: {
                Image(systemName: "tray.fill")
            }
            .font(WatchType.inter(13, .medium))
            .foregroundStyle(secondary)
            if entry.snapshot != nil {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(countText)
                        .font(WatchType.inter(24, .semibold))
                        .foregroundStyle(countStyle)
                        .widgetAccentable(hasUnread)
                    Text("new")
                        .font(WatchType.inter(13))
                        .foregroundStyle(secondary)
                }
                Text(entry.snapshot?.newestSender ?? "No new mail")
                    .font(WatchType.inter(13, .medium))
                    .foregroundStyle(hasUnread ? primary : secondary)
                    .lineLimit(1)
                    .privacySensitive()
            } else {
                Text("Open Inboxies to connect.")
                    .font(WatchType.inter(13, .medium))
                    .foregroundStyle(primary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// One line of system text (inline complications don't take custom fonts or color).
    private var inline: some View {
        Label {
            if let snapshot = entry.snapshot, let sender = snapshot.newestSender {
                Text("\(countText) new · \(sender)")
            } else if entry.snapshot != nil {
                Text(hasUnread ? "\(countText) new" : "No new mail")
            } else {
                Text("Inboxies")
            }
        } icon: {
            Image(systemName: "tray.fill")
        }
    }

    private var corner: some View {
        Text(countText)
            .font(WatchType.inter(20, .semibold))
            .foregroundStyle(countStyle)
            .widgetAccentable(hasUnread)
            .widgetLabel {
                Text(entry.snapshot?.newestSender ?? "Inbox")
            }
            .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        guard entry.snapshot != nil else { return "Inboxies, not connected" }
        return hasUnread ? "Inbox, \(unread) new" : "Inbox, no new mail"
    }
}

#Preview("Rectangular", as: .accessoryRectangular) {
    InboxGlanceWidget()
} timeline: {
    InboxGlanceEntry.sample
    InboxGlanceEntry(date: Date(), snapshot: WatchGlanceSnapshot(mailboxId: "sample", unreadCount: 0, newestSender: nil), relevance: nil)
    InboxGlanceEntry(date: Date(), snapshot: nil, relevance: nil)
}

#Preview("Circular", as: .accessoryCircular) {
    InboxGlanceWidget()
} timeline: {
    InboxGlanceEntry.sample
    InboxGlanceEntry(date: Date(), snapshot: WatchGlanceSnapshot(mailboxId: "sample", unreadCount: 0, newestSender: nil), relevance: nil)
}

import Foundation
import WatchKit
import WidgetKit

/// Watch app side of the Inbox complication / Smart Stack widget (AVE-146): writes
/// `WatchGlanceSnapshot` to the App Group and reloads the widget's timelines when the
/// content changed. Mirrors the phone's `InboxWidgetPublisher`.
enum WatchGlancePublisher {
    /// From a loaded Inbox: the server's unread total when the folders call answered,
    /// else the unread rows on the page; the sender of the newest unread row.
    static func snapshot(mailboxId: String, inboxFolderUnread: Int?, emails: [WatchEmail], now: Date = Date()) -> WatchGlanceSnapshot {
        let unreadRows = emails.filter(\.isUnread)
        return WatchGlanceSnapshot(
            mailboxId: mailboxId,
            unreadCount: inboxFolderUnread ?? unreadRows.count,
            newestSender: unreadRows.first?.displaySender,
            updatedAt: now
        )
    }

    static func publish(_ snapshot: WatchGlanceSnapshot) {
        guard let store = WatchGlanceStore.shared, store.write(snapshot) else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: WatchGlanceKind.inbox)
    }

    /// Sign-out / wipe: the complication goes back to "Open Inboxies".
    static func clear() {
        guard let store = WatchGlanceStore.shared, store.clear() else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: WatchGlanceKind.inbox)
    }
}

/// The complication's timeline budget (AVE-146): a background app refresh about every
/// 30 minutes re-reads the Inbox with the watch session, so the count stays close
/// even without a push. watchOS decides the real cadence.
enum WatchBackgroundRefresh {
    static let identifier = "co.inboxies.watch.glance-refresh"
    static let interval: TimeInterval = 30 * 60

    static func schedule(after interval: TimeInterval = WatchBackgroundRefresh.interval) {
        WKApplication.shared().scheduleBackgroundRefresh(
            withPreferredDate: Date().addingTimeInterval(interval),
            userInfo: identifier as NSString
        ) { _ in }
    }
}

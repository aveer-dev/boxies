import Foundation

/// Infinite-scroll bookkeeping for one email list (a folder or the Reply Later pile).
/// Pure value type so the paging rules are unit-testable without the network.
struct EmailListPaging: Equatable {
    /// Matches the `limit` the list endpoints are called with.
    static let pageSize = 25
    /// Rows shown from the local cache before the first page lands.
    static let initialCacheLimit = 50
    /// Inbox shows at most this many New rows; the rest open on the "All new" screen so Seen
    /// always stays in view right below (AVE-23). Sent to the server as `new_limit`.
    static let inboxNewPreviewLimit = 5

    /// `mailboxId|folderId` (or `mailboxId|reply_later`). Results for any other key are stale.
    let key: String
    private(set) var loadedPages = 0
    private(set) var hasMore = false
    /// Oldest row date across loaded pages; the cache read shows everything at or after it.
    private(set) var oldestLoadedDate: String?
    /// Oldest row of page 1. Only that window is split into New / Seen.
    private(set) var firstPageOldestDate: String?
    /// Ids page 1 returned last time (Reply Later merges a background refresh by id).
    private(set) var firstPageIds: Set<String> = []
    var isLoadingMore = false
    /// The last "load more" failed; the footer offers Retry instead of spinning.
    var loadMoreFailed = false

    init(key: String) {
        self.key = key
    }

    static func key(mailboxId: String, listId: String) -> String {
        "\(mailboxId)|\(listId)"
    }

    /// Page to request next, or nil when there is nothing more (or a load is in flight).
    var nextPage: Int? {
        guard loadedPages > 0, hasMore, !isLoadingMore else { return nil }
        return loadedPages + 1
    }

    /// Records a fetched page. Page 1 restarts the window (refresh); later pages must be
    /// the next one in sequence, so a late duplicate response is ignored.
    @discardableResult
    mutating func apply(
        page: Int,
        receivedCount: Int,
        totalCount: Int,
        oldestDate: String?,
        ids: [String] = []
    ) -> Bool {
        if page == 1 {
            loadedPages = 1
            oldestLoadedDate = oldestDate
            firstPageOldestDate = oldestDate
            firstPageIds = Set(ids)
        } else {
            guard page == loadedPages + 1 else { return false }
            loadedPages = page
            if let oldestDate, oldestLoadedDate.map({ oldestDate < $0 }) ?? true {
                oldestLoadedDate = oldestDate
            }
        }
        hasMore = Self.hasMore(page: page, receivedCount: receivedCount, totalCount: totalCount)
        loadMoreFailed = false
        return true
    }

    /// A short page always ends the list. Otherwise trust `totalCount` (threads for
    /// threaded folders) when the server sent one.
    static func hasMore(page: Int, receivedCount: Int, totalCount: Int) -> Bool {
        guard receivedCount >= pageSize else { return false }
        guard totalCount > 0 else { return true }
        return page * pageSize < totalCount
    }

    /// How to read this list from SQLite. Before any page: the newest 50 cached rows.
    /// After: every row in the loaded date window (all rows once the list is exhausted),
    /// so loaded pages are never cut off by a fixed limit.
    var cacheWindow: (limit: Int?, since: String?) {
        guard loadedPages > 0 else { return (Self.initialCacheLimit, nil) }
        guard hasMore else { return (nil, nil) }
        return (nil, oldestLoadedDate)
    }

    mutating func refreshFirstPageIds(_ ids: [String]) {
        firstPageIds = Set(ids)
    }

    /// Inbox New / Seen only splits the first page's window. Once later pages load,
    /// their rows stay below it in date order, so unread mail from page 2 never jumps
    /// above what the reader is looking at.
    var sectionFloor: String? {
        loadedPages > 1 ? firstPageOldestDate : nil
    }

    /// Inbox display order: page-1 window as New then Seen, later rows after it by date.
    static func inboxOrder(_ rows: [Email], sectionFloor: String?) -> [Email] {
        let sections = inboxSections(rows, sectionFloor: sectionFloor)
        return sections.new + sections.seen
    }

    static func inboxSections(_ rows: [Email], sectionFloor: String?) -> (new: [Email], seen: [Email]) {
        let head = rows.filter { email in sectionFloor.map { email.date >= $0 } ?? true }
        let tail = rows.filter { email in sectionFloor.map { email.date < $0 } ?? false }
        let byDate: (Email, Email) -> Bool = { $0.date > $1.date }
        let new = head.filter { $0.resolvedListSection == "new" }.sorted(by: byDate)
        let seen = head.filter { $0.resolvedListSection != "new" }.sorted(by: byDate)
        return (new, seen + tail.sorted(by: byDate))
    }

    /// Inbox New preview: the newest `limit` New rows, plus how many New conversations sit
    /// behind "Show all" (`serverNewCount` when known — the page only holds a few).
    static func inboxNewPreview(
        _ newRows: [Email],
        serverNewCount: Int?,
        limit: Int = inboxNewPreviewLimit
    ) -> (shown: [Email], hiddenCount: Int) {
        let sorted = newRows.sorted { $0.date > $1.date }
        let shown = Array(sorted.prefix(limit))
        let total = max(serverNewCount ?? 0, sorted.count)
        return (shown, max(0, total - shown.count))
    }

    /// Date range to prune after fetching page N > 1: rows strictly older than the pages
    /// before it and at/after this page's oldest row. A short (final) page prunes
    /// everything older. Nil when there is no safe upper bound.
    static func pruneWindow(
        receivedCount: Int,
        oldestDate: String?,
        previousOldestDate: String?
    ) -> (olderThan: String, notOlderThan: String?)? {
        guard let previousOldestDate else { return nil }
        if receivedCount >= pageSize {
            guard let oldestDate else { return nil }
            return (previousOldestDate, oldestDate)
        }
        return (previousOldestDate, nil)
    }

    /// Reply Later background refresh: the fresh first page, then rows from later pages
    /// (anything on screen that wasn't on the previous first page), matched by id.
    static func mergingFirstPage(
        _ fresh: [Email],
        into existing: [Email],
        previousFirstPageIds: Set<String>
    ) -> [Email] {
        let later = existing.filter { !previousFirstPageIds.contains($0.id) }
        return appending(later, to: fresh)
    }

    /// Appends rows from a later page, skipping ids already on screen.
    static func appending(_ page: [Email], to existing: [Email]) -> [Email] {
        var seen = Set(existing.map(\.id))
        var merged = existing
        for email in page where seen.insert(email.id).inserted {
            merged.append(email)
        }
        return merged
    }
}

/// Inbox page 1's New window: server New total plus the New row ids it returned.
struct InboxNewWindow: Equatable {
    let key: String
    var count: Int?
    var ids: [String]
}

/// What the signed-in root shows once mailboxes have been requested.
enum MailboxGate: Equatable {
    /// Home shell (or its skeleton while the first load runs).
    case home
    /// The server answered with zero mailboxes: set one up.
    case onboarding
    /// The first load failed and nothing is cached: error with Retry, never onboarding.
    case loadFailed

    static func resolve(isMailboxLoading: Bool, hasMailboxes: Bool, loadFailed: Bool) -> MailboxGate {
        if hasMailboxes { return .home }
        if loadFailed { return .loadFailed }
        return isMailboxLoading ? .home : .onboarding
    }
}

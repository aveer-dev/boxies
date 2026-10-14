import Foundation

/// Infinite-scroll bookkeeping for one email list (a folder or the Reply Later pile).
/// Pure value type so the paging rules are unit-testable without the network.
struct EmailListPaging: Equatable {
    /// Matches the `limit` the list endpoints are called with.
    static let pageSize = 25
    /// Rows shown from the local cache before the first page lands.
    static let initialCacheLimit = 50

    /// `mailboxId|folderId` (or `mailboxId|reply_later`). Results for any other key are stale.
    let key: String
    private(set) var loadedPages = 0
    private(set) var hasMore = false
    /// Oldest row date across loaded pages; the cache read shows everything at or after it.
    private(set) var oldestLoadedDate: String?
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
    mutating func apply(page: Int, receivedCount: Int, totalCount: Int, oldestDate: String?) -> Bool {
        if page == 1 {
            loadedPages = 1
            oldestLoadedDate = oldestDate
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

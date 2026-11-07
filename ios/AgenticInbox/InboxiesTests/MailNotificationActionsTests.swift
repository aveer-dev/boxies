import XCTest
import UserNotifications
@testable import Inboxies

/// Watch phase 1b (AVE-141): the INBOXIES_MAIL category and action → request mapping.
final class MailNotificationActionsTests: XCTestCase {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/New_York")!
        return cal
    }

    func testCategoryMatchesWorkerAndHasNoTrash() {
        let category = MailNotificationActions.category()
        XCTAssertEqual(category.identifier, "INBOXIES_MAIL")
        XCTAssertEqual(
            Set(category.actions.map(\.identifier)),
            ["ARCHIVE", "MARK_READ", "REPLY_LATER", "REPLY", "SPAM"]
        )
        XCTAssertFalse(category.actions.contains { $0.title.localizedCaseInsensitiveContains("trash") })
    }

    func testOnlyReplyAndSpamNeedUnlockAndNoneOpenTheApp() {
        for action in MailNotificationActions.category().actions {
            let needsUnlock = action.options.contains(.authenticationRequired)
            XCTAssertEqual(needsUnlock, ["REPLY", "SPAM"].contains(action.identifier), action.identifier)
            XCTAssertFalse(action.options.contains(.foreground), action.identifier)
        }
        let reply = MailNotificationActions.category().actions.first { $0.identifier == "REPLY" }
        XCTAssertTrue(reply is UNTextInputNotificationAction)
    }

    func testCannedRepliesAreFourFixed() {
        XCTAssertEqual(MailNotificationActions.cannedReplies.count, 4)
    }

    func testActionToRequestMapping() {
        XCTAssertEqual(
            MailNotificationActions.request(for: .archive, replyText: nil),
            .move(folderId: "archive", setSenderPreference: false)
        )
        XCTAssertEqual(
            MailNotificationActions.request(for: .spam, replyText: nil),
            .move(folderId: "spam", setSenderPreference: true)
        )
        XCTAssertEqual(MailNotificationActions.request(for: .markRead, replyText: nil), .markRead)
        XCTAssertEqual(
            MailNotificationActions.request(for: .reply, replyText: "  On it  "),
            .quickReply(text: "On it")
        )
        XCTAssertNil(MailNotificationActions.request(for: .reply, replyText: "   "))
        XCTAssertNil(MailNotificationActions.request(for: .reply, replyText: nil))
    }

    func testReplyLaterRemindsTomorrowMorning() {
        // Thu 2026-10-29 15:20 New York → Fri 09:00 New York = 13:00Z (EDT).
        let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 29, hour: 15, minute: 20))!
        XCTAssertEqual(
            MailNotificationActions.request(for: .replyLater, replyText: nil, now: now, calendar: calendar),
            .replyLater(remindAtISO: "2026-10-30T13:00:00.000Z")
        )
    }

    func testTargetFromPayload() {
        XCTAssertEqual(
            MailNotificationTarget(userInfo: ["mailboxId": "a@b.co", "emailId": "e1", "threadId": "t1", "folderId": "inbox"]),
            MailNotificationTarget(mailboxId: "a@b.co", emailId: "e1", threadId: "t1")
        )
        XCTAssertEqual(
            MailNotificationTarget(userInfo: ["mailboxId": "a@b.co", "emailId": "e1"])?.threadId,
            nil
        )
        XCTAssertNil(MailNotificationTarget(userInfo: ["mailboxId": "a@b.co"]))
        XCTAssertNil(MailNotificationTarget(userInfo: ["mailboxId": "", "emailId": "e1"]))
    }
}

/**
 * Web Reply Later reminder presets and labels (AVE-86, app/lib/reply-later-reminders).
 * Same rules as iOS ReplyLaterReminder and Android ReplyLaterReminders.
 * Run: TZ=America/New_York pnpm test:unit reply-later-reminder-presets
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatReminderShort,
	fromDateTimeLocalValue,
	isReplyLaterDue,
	laterToday,
	nextWeekMorning,
	pendingReminder,
	reminderPresets,
	toDateTimeLocalValue,
	tomorrowMorning,
} from "../../app/lib/reply-later-reminders.ts";

const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0);
const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];

describe("Later today", () => {
	it("adds 3h and rounds minutes up to a multiple of 5", () => {
		assert.deepEqual(parts(laterToday(local(2026, 10, 28, 13, 7, 30))), [2026, 10, 28, 16, 10, 0]);
	});
	it("keeps an exact 5-minute mark after zeroing seconds", () => {
		assert.deepEqual(parts(laterToday(local(2026, 10, 28, 13, 5, 20))), [2026, 10, 28, 16, 5, 0]);
	});
	it("rolls over the hour and the day", () => {
		assert.deepEqual(parts(laterToday(local(2026, 10, 28, 22, 58))), [2026, 10, 29, 2, 0, 0]);
	});
});

describe("Tomorrow and next week", () => {
	it("tomorrow is 9:00 the next day, across month ends", () => {
		assert.deepEqual(parts(tomorrowMorning(local(2026, 10, 31, 23, 30))), [2026, 11, 1, 9, 0, 0]);
	});
	it("next week is the next Monday strictly after today", () => {
		// Wed Oct 28 2026 → Mon Nov 2
		assert.deepEqual(parts(nextWeekMorning(local(2026, 10, 28, 10))), [2026, 11, 2, 9, 0, 0]);
		// Mon Nov 2 → Mon Nov 9
		assert.deepEqual(parts(nextWeekMorning(local(2026, 11, 2, 8))), [2026, 11, 9, 9, 0, 0]);
		// Sun Nov 1 → Mon Nov 2
		assert.deepEqual(parts(nextWeekMorning(local(2026, 11, 1, 20))), [2026, 11, 2, 9, 0, 0]);
	});
	it("lists presets in order", () => {
		assert.deepEqual(reminderPresets(local(2026, 10, 28, 10)).map((p) => p.label), [
			"Later today",
			"Tomorrow",
			"Next week",
		]);
	});
});

describe("labels and fields", () => {
	it("short label says Today / Tomorrow", () => {
		const now = local(2026, 10, 28, 10);
		assert.match(formatReminderShort(local(2026, 10, 28, 16), now, "en-US"), /^Today 4:00\sPM$/);
		assert.match(formatReminderShort(local(2026, 10, 29, 9), now, "en-US"), /^Tomorrow 9:00\sAM$/);
		assert.match(formatReminderShort(local(2026, 11, 2, 9), now, "en-US"), /^Mon 9:00\sAM$/);
		assert.match(formatReminderShort(local(2026, 11, 9, 9), now, "en-US"), /^Nov 9, 9:00\sAM$/);
	});
	it("datetime-local round-trips in local time", () => {
		const d = local(2026, 10, 30, 7, 45);
		assert.equal(toDateTimeLocalValue(d), "2026-10-30T07:45");
		assert.equal(fromDateTimeLocalValue("2026-10-30T07:45").getTime(), d.getTime());
		assert.equal(fromDateTimeLocalValue(""), null);
	});
	it("pending and due follow the contract", () => {
		assert.equal(pendingReminder({ reply_later: false, reply_later_remind_at: "2026-10-29T13:00:00.000Z" }), null);
		assert.equal(
			pendingReminder({ reply_later: true, reply_later_remind_at: "2026-10-29T13:00:00.000Z" }).toISOString(),
			"2026-10-29T13:00:00.000Z",
		);
		assert.equal(isReplyLaterDue({ reply_later: true, read: false, reply_later_reminded_at: "x" }), true);
		assert.equal(isReplyLaterDue({ reply_later: true, read: true, reply_later_reminded_at: "x" }), false);
		assert.equal(isReplyLaterDue({ reply_later: true, read: false, reply_later_reminded_at: null }), false);
	});
});

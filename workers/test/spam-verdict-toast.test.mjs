/**
 * AVE-98: web toast copy for Not spam / Report spam
 * (docs/spam-management-plan.md §6). iOS SpamVerdictToast and Android
 * spamVerdictToastTitle use the same strings.
 * Run: pnpm test:unit spam-verdict-toast
 */

import assert from "node:assert/strict";
import { spamVerdictToastTitle } from "../../app/lib/spam-verdict.ts";

assert.equal(spamVerdictToastTitle({}, { folderId: "inbox" }), null, "a move that taught nothing");
assert.equal(
	spamVerdictToastTitle({ senderStatus: "allowed", rescuedCount: 3 }, { folderId: "inbox", sender: "ada@x.example" }),
	"Moved to Inbox · future mail from ada@x.example will skip Spam · 3 more moved",
);
assert.equal(
	spamVerdictToastTitle({ senderStatus: "allowed", rescuedCount: 0 }, { folderId: "promotions", sender: "ada@x.example" }),
	"Moved to Promotions · future mail from ada@x.example will skip Spam",
);
assert.equal(
	spamVerdictToastTitle({ senderStatus: "allowed" }, { folderId: "custom-1" }),
	"Moved out of Spam",
);
assert.equal(spamVerdictToastTitle({ senderStatus: "rejected", rescuedCount: 2 }, { folderId: "spam" }), "Reported as spam · 2 more moved");
assert.equal(
	spamVerdictToastTitle({ senderStatus: "rejected", unsubscribe: "sent", rescuedCount: 1 }, { folderId: "spam" }),
	"Reported as spam and unsubscribed · 1 more moved",
);
assert.equal(
	spamVerdictToastTitle({ senderStatus: "rejected", unsubscribe: "failed" }, { folderId: "spam" }),
	"Reported as spam · couldn't unsubscribe",
);

console.log("spam-verdict-toast tests passed");

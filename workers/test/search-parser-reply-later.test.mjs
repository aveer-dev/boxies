// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSearchQuery } from "../../app/lib/search-parser.ts";

describe("parseSearchQuery reply-later", () => {
	it("parses is:reply-later", () => {
		const parsed = parseSearchQuery("is:reply-later meeting");
		assert.equal(parsed.is_reply_later, true);
		assert.equal(parsed.query, "meeting");
	});

	it("parses is:reply_later alias", () => {
		const parsed = parseSearchQuery("is:reply_later");
		assert.equal(parsed.is_reply_later, true);
		assert.equal(parsed.query, "");
	});

	it("keeps starred independent", () => {
		const parsed = parseSearchQuery("is:starred is:reply-later");
		assert.equal(parsed.is_starred, true);
		assert.equal(parsed.is_reply_later, true);
	});
});

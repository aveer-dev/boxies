/**
 * Web client Idempotency-Key helpers (AVE-64): keys the server accepts, the
 * header shape, and one key per scope until a successful send releases it.
 * Run: pnpm test:unit web-send-idempotency
 */

import assert from "node:assert/strict";
import {
	IDEMPOTENCY_KEY_HEADER,
	createSendKeyStore,
	idempotencyHeaders,
	newIdempotencyKey,
} from "../../app/lib/send-idempotency.ts";
import {
	IDEMPOTENCY_KEY_HEADER as SERVER_HEADER,
	parseIdempotencyKey,
} from "../lib/outbound-idempotency.ts";

// Same header name the Worker reads.
assert.equal(IDEMPOTENCY_KEY_HEADER, SERVER_HEADER);

// Generated keys pass the server's validation and differ per compose.
{
	const a = newIdempotencyKey();
	const b = newIdempotencyKey();
	assert.notEqual(a, b);
	for (const key of [a, b]) {
		assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		assert.deepEqual(parseIdempotencyKey(key), { ok: true, key });
	}
}

// Header present only when there is a key.
assert.deepEqual(idempotencyHeaders("k-1"), { "Idempotency-Key": "k-1" });
assert.deepEqual(idempotencyHeaders(undefined), {});
assert.deepEqual(idempotencyHeaders(""), {});

// Retries of a scope reuse its key; release gives the next send a new one.
{
	let n = 0;
	const store = createSendKeyStore(() => `key-${++n}`);
	assert.equal(store.keyFor("draft-a"), "key-1");
	assert.equal(store.keyFor("draft-a"), "key-1", "retry reuses the key");
	assert.equal(store.keyFor("draft-b"), "key-2", "other draft, other key");
	store.release("draft-a");
	assert.equal(store.keyFor("draft-a"), "key-3", "after success: fresh key");
	assert.equal(store.keyFor("draft-b"), "key-2");
}

console.log("web-send-idempotency: ok");

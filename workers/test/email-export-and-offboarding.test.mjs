/**
 * Tests for Email Data Export (.mbox RFC 4155), Decommission Safeguards, and EPP Transfer.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/email-export-and-offboarding.test.mjs
 */

import assert from "node:assert/strict";
import { app as apiApp } from "../index.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import {
	formatAsctime,
	fromQuote,
	formatMboxEntry,
	runMailboxExportJob,
	runDomainExportJob,
	runExportInline,
	runExportSlice,
	createExportJob,
	failExportJob,
	MboxBodyEncoder,
	hasRecentExportForDomain,
	exportDataKey,
	getExportJob,
} from "../lib/email-exporter.ts";
import { getFolderDisplayName } from "../../shared/folders.ts";
import {
	saveDomainMetadata,
	getDomainMetadata,
} from "../lib/domain-registry.ts";
import { eq } from "drizzle-orm";
import { authDb } from "../auth/authz.ts";
import * as schema from "../auth/schema.ts";
import { createTestD1 } from "./d1-shim.mjs";

/** Users are AUTH_DB rows; tests name them by id (an email string here). */
async function ensureUser(env, id) {
	const db = authDb(env.AUTH_DB);
	await db
		.insert(schema.user)
		.values({ id, email: id.includes("@") ? id : `${id}@example.com`, name: id, emailVerified: true })
		.onConflictDoNothing();
}

async function addDomainRow(env, domain, ownerUserId) {
	await ensureUser(env, ownerUserId);
	await authDb(env.AUTH_DB).insert(schema.domain).values({ domain, ownerUserId, status: "active" }).onConflictDoNothing();
}

async function addMailboxRow(env, mailboxId, ownerUserId) {
	await ensureUser(env, ownerUserId);
	const db = authDb(env.AUTH_DB);
	await db.insert(schema.mailbox).values({ id: mailboxId, domain: mailboxId.split("@")[1] }).onConflictDoNothing();
	await db.insert(schema.mailboxMember).values({ mailboxId, userId: ownerUserId, role: "owner" }).onConflictDoNothing();
}

const te = new TextEncoder();
const td = new TextDecoder();

function toBytes(value) {
	if (typeof value === "string") return te.encode(value);
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	return te.encode(JSON.stringify(value));
}

/** Stream bytes in small chunks so readers see realistic chunk boundaries. */
function chunkedStream(bytes, chunkSize = 7) {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) return controller.close();
			controller.enqueue(bytes.slice(offset, offset + chunkSize));
			offset += chunkSize;
		},
	});
}

/**
 * In-memory R2 stand-in, including multipart uploads with R2's part rules
 * (non-final parts >= minPartSize and all the same size).
 */
function mockBucket(initial = {}, { minPartSize = 1 } = {}) {
	const store = new Map(Object.entries(initial).map(([key, value]) => [key, toBytes(value)]));
	const uploads = new Map();
	const multipartCompletes = [];
	let nextUpload = 1;

	const bucket = {
		store,
		uploads,
		multipartCompletes,
		async get(key) {
			if (!store.has(key)) return null;
			const bytes = store.get(key);
			return {
				size: bytes.length,
				text: async () => td.decode(bytes),
				json: async () => JSON.parse(td.decode(bytes)),
				arrayBuffer: async () => bytes.slice().buffer,
				get body() {
					return chunkedStream(bytes);
				},
			};
		},
		async put(key, value) {
			store.set(key, toBytes(value));
			return { key };
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async list({ prefix = "" } = {}) {
			return {
				objects: [...store.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
				truncated: false,
			};
		},
		async delete(key) {
			store.delete(key);
		},
		async createMultipartUpload(key) {
			const uploadId = `upload-${nextUpload++}`;
			uploads.set(uploadId, { key, parts: new Map(), aborted: false });
			return bucket.resumeMultipartUpload(key, uploadId);
		},
		resumeMultipartUpload(key, uploadId) {
			return {
				key,
				uploadId,
				async uploadPart(partNumber, value) {
					const upload = uploads.get(uploadId);
					if (!upload || upload.aborted) throw new Error("NoSuchUpload");
					const bytes = toBytes(value);
					upload.parts.set(partNumber, bytes);
					return { partNumber, etag: `etag-${partNumber}-${bytes.length}` };
				},
				async abort() {
					const upload = uploads.get(uploadId);
					if (upload) upload.aborted = true;
				},
				async complete(parts) {
					const upload = uploads.get(uploadId);
					if (!upload || upload.aborted) throw new Error("NoSuchUpload");
					const sorted = [...parts].sort((x, y) => x.partNumber - y.partNumber);
					const chunks = sorted.map((p, i) => {
						assert.equal(p.partNumber, i + 1, "parts are numbered 1..n");
						const bytes = upload.parts.get(p.partNumber);
						assert.ok(bytes, `part ${p.partNumber} was uploaded`);
						assert.equal(p.etag, `etag-${p.partNumber}-${bytes.length}`, "etag matches the uploaded part");
						return bytes;
					});
					for (let i = 0; i < chunks.length - 1; i++) {
						assert.ok(chunks[i].length >= minPartSize, "non-final parts meet the minimum size");
						assert.equal(chunks[i].length, chunks[0].length, "non-final parts are the same size");
					}
					const total = chunks.reduce((n, c) => n + c.length, 0);
					const out = new Uint8Array(total);
					let offset = 0;
					for (const c of chunks) {
						out.set(c, offset);
						offset += c.length;
					}
					store.set(key, out);
					multipartCompletes.push({ key, parts: chunks.map((c) => c.length) });
					return { key, size: total };
				},
			};
		},
	};
	return bucket;
}

/** Rows as `MailboxDO.getExportPage` returns them: rowid keyset order. */
function exportRows(emails) {
	return emails.map((email, i) => ({ rowid: email.rowid ?? i + 1, ...email }));
}

function mockEnv(bucket, sampleEmails = [], { runExports = true } = {}) {
	const startedExports = [];
	const env = {
		BUCKET: bucket,
		EMAIL_ADDRESSES: [],
		DOMAINS: "inboxies.email",
		AUTH_DB: createTestD1(),
		BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
		APP_BASE_URL: "https://inboxies.email",
		WORKER_NAME: "agentic-inbox",
		EMAIL: {
			send: async () => ({ messageId: "msg-1" }),
		},
		MAILBOX: {
			idFromName(name) {
				return name;
			},
			get(id) {
				return {
					id,
					reviveMailbox: async () => {},
					getExportPage: async (afterRowId = 0, limit = 100) =>
						exportRows(sampleEmails)
							.filter((row) => row.rowid > afterRowId)
							.sort((x, y) => x.rowid - y.rowid)
							.slice(0, limit),
					getEmails: async () => sampleEmails,
					getTotalEmailCountForExport: async () => sampleEmails.length,
				};
			},
		},
		EMAIL_AGENT: {
			idFromName(name) {
				return name;
			},
			get() {
				return { purge: async () => {} };
			},
		},
		// ExportJobDO stand-in: records the start and (by default) runs the
		// export to completion, standing in for the alarm loop.
		EXPORT_JOBS: {
			startedExports,
			idFromName(name) {
				return name;
			},
			get(id) {
				return {
					start: async (state) => {
						startedExports.push({ id, state });
						if (runExports) await runExportInline(env, state);
					},
					kick: async () => true,
				};
			},
		},
	};
	return env;
}

import { Hono } from "hono";

// These suites drive the in-memory Cloudflare / registrar mocks, which are
// dev-only (production fails closed without credentials). Opt in explicitly.
setDevRuntimeForTesting(true);

function harness(env, defaultPrincipal = null) {
	const parent = new Hono();
	parent.use("*", async (c, next) => {
		const override = c.req.header("x-test-user");
		if (override) {
			await ensureUser(env, override);
			c.set("principal", { userId: override, sessionId: `sess-${override}`, email: override, scope: null });
		} else if (defaultPrincipal) {
			c.set("principal", defaultPrincipal);
		}
		return next();
	});
	parent.route("/", apiApp);
	return {
		async request(path, init = {}) {
			const url = path.startsWith("http") ? path : `http://localhost${path}`;
			const req = new Request(url, init);
			return parent.fetch(req, env);
		},
	};
}

async function runTests() {
	console.log("Starting Email Export Engine & Offboarding Safeguard tests...\n");

	// ---------------------------------------------------------
	// 1. Unit Tests: RFC 4155 Formatting & From-Quoting
	// ---------------------------------------------------------
	console.log("1. Testing RFC 4155 MBOX formatting...");

	const asctime = formatAsctime(new Date("2026-10-01T12:00:00Z"));
	assert.ok(asctime.length >= 24, "Asctime format should be at least 24 chars");
	assert.match(asctime, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) /);

	// Test From-Quoting
	const rawBody = "Hello world\nFrom the other side\nFrom here";
	const quoted = fromQuote(rawBody);
	assert.equal(quoted, "Hello world\n>From the other side\n>From here", "Body lines starting with From must be escaped to >From");

	// Test formatMboxEntry
	const entry = formatMboxEntry("alice@example.com", "2026-10-01T12:00:00Z", "Subject: Hi\r\n\r\nHello!", "Archive");
	assert.ok(entry.startsWith("From alice@example.com "), "Entry must start with From <sender> <date>");
	assert.ok(entry.includes("X-Folder: Archive\r\n"), "Entry should include folder metadata");
	assert.ok(entry.endsWith("\r\n\r\n"), "Entry must terminate with blank line");

	console.log("✔ RFC 4155 unit tests passed");

	// ---------------------------------------------------------
	// 2. Unit Tests: Mailbox & Domain Export Execution
	// ---------------------------------------------------------
	console.log("\n2. Testing Mailbox & Domain MBOX export execution...");

	const bucket = mockBucket();
	const sampleEmails = [
		{
			id: "email-1",
			subject: "First email",
			sender: "bob@example.com",
			sender_name: "Bob Jones",
			recipient: "you@acme.com",
			date: "2026-09-15T10:00:00Z",
			folder_id: "inbox",
		},
		{
			id: "email-2",
			subject: "Second email",
			sender: "carol@example.com",
			sender_name: "Carol Smith",
			recipient: "you@acme.com",
			date: "2026-09-16T11:00:00Z",
			folder_id: "sent",
		},
	];

	// Store raw eml for email-1
	await bucket.put(
		"emails/email-1/raw.eml",
		"From: \"Bob Jones\" <bob@example.com>\r\nTo: you@acme.com\r\nSubject: First email\r\n\r\nHello Bob",
	);

	// Store body.html for email-2 (fallback test)
	await bucket.put(
		"emails/email-2/body.html",
		"<p>Hello Carol</p>",
	);

	const env = mockEnv(bucket, sampleEmails);

	// Run export job packaged to R2
	const job = await runMailboxExportJob(env, "you@acme.com");
	assert.equal(job.status, "completed");
	assert.equal(job.totalEmails, 2);
	assert.ok(job.downloadUrl.includes(job.id));
	assert.ok(job.fileSizeBytes > 0);

	// Verify MBOX file stored in R2
	const storedMbox = await bucket.get(job.downloadKey);
	assert.ok(storedMbox, "MBOX file must exist in R2");
	const storedText = await storedMbox.text();
	assert.ok(storedText.includes("From bob@example.com "), "MBOX should contain Bob's message");
	assert.ok(storedText.includes("From carol@example.com "), "MBOX should contain Carol's reconstructed message");
	assert.equal(job.fileSizeBytes, storedMbox.size, "fileSizeBytes is the archive size");
	assert.equal(
		[...bucket.store.keys()].filter((k) => k.startsWith("exports/tmp/")).length,
		0,
		"no scratch data is left behind",
	);

	const mailboxOnlyCheck = await hasRecentExportForDomain(bucket, "acme.com");
	assert.equal(mailboxOnlyCheck.hasExport, false, "A single-mailbox export must not count as a domain backup");
	assert.equal(mailboxOnlyCheck.lastExport, undefined);

	// Setup multiple mailboxes for acme.com domain
	await bucket.put("mailboxes/you@acme.com.json", JSON.stringify({ fromName: "You" }));
	await bucket.put("mailboxes/support@acme.com.json", JSON.stringify({ fromName: "Support" }));

	// hasRecentExportForDomain picks the job with the latest createdAt (ms precision).
	// Let the clock tick past the mailbox job so the domain job is strictly newer;
	// on a tie the winner depends on R2 key order and the assertion below flakes.
	while (Date.now() <= Date.parse(job.createdAt)) {
		await new Promise((resolve) => setTimeout(resolve, 1));
	}

	const domainJob = await runDomainExportJob(env, "acme.com");
	assert.equal(domainJob.status, "completed");
	assert.equal(domainJob.targetType, "domain");
	assert.ok(domainJob.totalEmails >= 2);

	const recentCheck = await hasRecentExportForDomain(bucket, "acme.com");
	assert.equal(recentCheck.hasExport, true, "Should report recent export exists");
	assert.equal(recentCheck.lastExport?.id, domainJob.id);

	// Same-millisecond domain jobs are broken deterministically by id.
	const tieBucket = mockBucket();
	const tieCreatedAt = "2026-10-01T12:00:00.000Z";
	const tieExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	const tieJob = (id, targetType, targetId) => ({
		id,
		targetType,
		targetId,
		status: "completed",
		progress: 100,
		totalEmails: 0,
		processedEmails: 0,
		createdAt: tieCreatedAt,
		expiresAt: tieExpiresAt,
	});
	for (const job of [
		tieJob("exp_mbx_1791000000000_ffffffff", "mailbox", "you@acme.com"),
		tieJob("exp_dom_1791000000000_aaaaaaaa", "domain", "acme.com"),
		tieJob("exp_dom_1791000000000_bbbbbbbb", "domain", "acme.com"),
		tieJob("exp_dom_1791000000000_zzzzzzzz", "domain", "notacme.com"),
	]) {
		await tieBucket.put(`exports/jobs/${job.id}.json`, JSON.stringify(job));
	}
	const tieCheck = await hasRecentExportForDomain(tieBucket, "acme.com");
	assert.equal(tieCheck.lastExport?.id, "exp_dom_1791000000000_bbbbbbbb");

	console.log("✔ Mailbox & Domain export execution tests passed");

	// ---------------------------------------------------------
	// 2b. Streaming export: chunked From-quoting, multipart, resumable slices
	// ---------------------------------------------------------
	console.log("\n2b. Testing streaming export engine...");

	assert.equal(bucket.multipartCompletes.length, 0, "small archives are a single put, not a multipart upload");

	// The byte encoder matches fromQuote(...).trimEnd() for every chunking.
	const encoderCases = [
		"",
		"From start of message\r\nbody\r\n",
		"Subject: x\r\n\r\nFrom here\r\n>From quoted\r\n>>From twice\r\nFromage\r\nFrom\r\n",
		"a\rFrom lone CR\nFrom LF\r\nnot From mid-line\r\n",
		"trailing whitespace\r\n \t \r\n\r\n",
		">>>",
		"line\nFro",
		"x\n>>>>From deep\n",
	];
	for (const text of encoderCases) {
		const expected = fromQuote(text).trimEnd();
		const input = te.encode(text);
		for (const chunkSize of [1, 2, 3, 5, 7, 64]) {
			const out = [];
			const enc = new MboxBodyEncoder(async (bytes) => {
				out.push(bytes.slice());
			});
			for (let i = 0; i < input.length; i += chunkSize) await enc.write(input.subarray(i, i + chunkSize));
			await enc.end();
			const got = td.decode(Buffer.concat(out));
			assert.equal(got, expected, `encoder output for ${JSON.stringify(text)} in ${chunkSize}-byte chunks`);
		}
	}

	// A mailbox exported over many slices with a tiny part size is byte-identical
	// to the classic in-memory formatter, even when a slice is retried.
	const PART = 64;
	const streamBucket = mockBucket({}, { minPartSize: PART });
	const streamEmails = [];
	const addEmail = (n, size, folder = "inbox") => {
		const id = `stream-${n}`;
		const raw =
			`From: sender${n}@example.com\r\nSubject: Message ${n}\r\n\r\n` +
			`From the body of ${n}\r\n` +
			"x".repeat(size) +
			"\r\n\r\n";
		streamBucket.store.set(`emails/${id}/raw.eml`, te.encode(raw));
		const row = {
			rowid: n,
			id,
			subject: `Message ${n}`,
			sender: `sender${n}@example.com`,
			sender_name: null,
			recipient: "big@acme.com",
			date: `2026-09-${String(n).padStart(2, "0")}T10:00:00Z`,
			folder_id: folder,
		};
		streamEmails.push(row);
		return { row, raw };
	};
	const expectedEntry = ({ row, raw }) =>
		formatMboxEntry(row.sender, row.date, raw, getFolderDisplayName(row.folder_id));

	const e1 = addEmail(1, 10);
	const e2 = addEmail(2, 300, "sent");
	const e3 = addEmail(3, 0);
	const e4 = addEmail(4, 129, "archive");
	const streamEnv = mockEnv(streamBucket, streamEmails, { runExports: false });

	const created = await createExportJob(streamEnv, { targetType: "mailbox", targetId: "big@acme.com" }, { partSize: PART });
	assert.equal(created.job.status, "pending");
	let state = created.state;
	let slices = 0;
	let sawCarry = false;
	let retried = false;
	let mutated = false;
	let e5;
	while (true) {
		let result = await runExportSlice(streamEnv, state, { deadline: Date.now() + 60_000, maxEmails: 1 });
		if (!retried && result.state.parts.length > 0 && !result.done) {
			// Crash before the state was persisted: run the same slice again.
			retried = true;
			result = await runExportSlice(streamEnv, state, { deadline: Date.now() + 60_000, maxEmails: 1 });
		}
		assert.notEqual(result.state, state, "slices never mutate their input state");
		state = result.state;
		if (result.obsoleteCarryKey) await streamBucket.delete(result.obsoleteCarryKey);
		slices++;
		if (state.carryKey) {
			sawCarry = true;
			assert.ok(streamBucket.store.has(state.carryKey), "the persisted carry exists");
			assert.ok(streamBucket.store.get(state.carryKey).length < PART, "carry is less than one part");
		}
		if (result.done) break;
		if (!mutated && state.processedEmails === 2) {
			// Mail moves on mid-export: an exported email is deleted and a new one
			// arrives. Keyset paging neither skips nor duplicates.
			mutated = true;
			streamEmails.splice(0, 1);
			e5 = addEmail(5, 70);
			const mid = await getExportJob(streamBucket, state.jobId);
			assert.equal(mid.status, "processing");
			assert.equal(mid.processedEmails, 2);
			assert.equal(mid.totalEmails, 4);
			assert.ok(mid.progress > 0 && mid.progress < 100);
		}
		assert.ok(slices < 50, "export terminates");
	}
	assert.ok(retried, "the retry path was exercised");
	assert.ok(sawCarry, "a part tail was carried between slices");
	assert.ok(slices >= 5, "one email per slice");

	const streamJob = await getExportJob(streamBucket, state.jobId);
	assert.equal(streamJob.status, "completed");
	assert.equal(streamJob.processedEmails, 5);
	const archiveBytes = streamBucket.store.get(streamJob.downloadKey);
	const expectedArchive = [e1, e2, e3, e4, e5].map(expectedEntry).join("");
	assert.equal(td.decode(archiveBytes), expectedArchive, "streamed archive is byte-identical to formatMboxEntry");
	assert.equal(streamJob.fileSizeBytes, archiveBytes.length);
	const completed = streamBucket.multipartCompletes.at(-1);
	assert.ok(completed.parts.length > 3, "large archives use a multipart upload");
	assert.ok(completed.parts.slice(0, -1).every((n) => n === PART), "non-final parts are exactly one part size");
	assert.ok(Date.parse(streamJob.expiresAt) > Date.parse(streamJob.completedAt), "download window starts at completion");

	// 8-bit message bytes survive untouched (no UTF-8 decode/re-encode).
	const binBucket = mockBucket();
	const binRaw = new Uint8Array([...te.encode("Subject: caf"), 0xe9, 0xff, 0x0d, 0x0a, 0x0d, 0x0a, 0x80, 0x41]);
	binBucket.store.set("emails/bin-1/raw.eml", binRaw);
	const binEnv = mockEnv(binBucket, [{ id: "bin-1", sender: "a@b.c", date: "2026-01-01T00:00:00Z", folder_id: "inbox" }]);
	const binJob = await runMailboxExportJob(binEnv, "bin@acme.com");
	const binArchive = binBucket.store.get(binJob.downloadKey);
	const needle = Buffer.from([0xe9, 0xff, 0x0d, 0x0a, 0x0d, 0x0a, 0x80, 0x41]);
	assert.ok(Buffer.from(binArchive).includes(needle), "raw 8-bit bytes are preserved");

	// A failed export aborts its upload, drops scratch data and says why.
	const failBucket = mockBucket();
	const failEnv = mockEnv(failBucket, streamEmails, { runExports: false });
	for (const e of streamEmails) failBucket.store.set(`emails/${e.id}/raw.eml`, streamBucket.store.get(`emails/${e.id}/raw.eml`));
	const failCreated = await createExportJob(failEnv, { targetType: "mailbox", targetId: "big@acme.com" }, { partSize: PART });
	const firstSlice = await runExportSlice(failEnv, failCreated.state, { deadline: Date.now() + 60_000, maxEmails: 2 });
	assert.ok(firstSlice.state.uploadId, "multipart upload started");
	assert.ok(firstSlice.state.carryKey, "carry written");
	await failExportJob(failEnv, firstSlice.state, new Error("boom"));
	const failedJob = await getExportJob(failBucket, failCreated.job.id);
	assert.equal(failedJob.status, "failed");
	assert.equal(failedJob.error, "boom");
	assert.equal(failBucket.uploads.get(firstSlice.state.uploadId).aborted, true, "multipart upload aborted");
	assert.equal([...failBucket.store.keys()].filter((k) => k.startsWith("exports/tmp/")).length, 0, "scratch removed");
	const afterFail = await runExportSlice(failEnv, firstSlice.state, { deadline: Date.now() + 60_000 });
	assert.equal(afterFail.done, true, "a failed job is never resumed");

	console.log("✔ Streaming export engine tests passed");

	// ---------------------------------------------------------
	// 3. HTTP Endpoints: Export API & Download
	// ---------------------------------------------------------
	console.log("\n3. Testing Export API & Download streaming...");

	// Register domain in R2
	await saveDomainMetadata(bucket, {
		domain: "acme.com",
		zoneId: "zone-acme",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
		emailRoutingEnabled: true,
		registration: {
			provider: "cloudflare_registrar",
			registeredAt: new Date().toISOString(),
			autoRenew: true,
			whoisPrivacy: true,
			locked: true,
			retailPriceUsd: 14.0,
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	await addDomainRow(env, "acme.com", "admin-user");
	const adminPrincipal = { userId: "admin-user", sessionId: "sess-admin", email: "admin-user@example.com", scope: null };
	const client = harness(env, adminPrincipal);

	// Domain export via admin endpoint
	const adminDomainExportRes = await client.request(
		"/api/v1/admin/domains/acme.com/export",
		{
			method: "POST",
		},
	);

	assert.equal(adminDomainExportRes.status, 200);
	const exportData = await adminDomainExportRes.json();
	assert.equal(exportData.status, "pending", "POST answers immediately with the queued job");
	assert.ok(exportData.exportId);
	assert.equal(exportData.id, exportData.exportId);
	assert.equal(env.EXPORT_JOBS.startedExports.at(-1).id, exportData.id, "the background runner was started");

	// Polling reports completion once the runner is done.
	const polled = await (await client.request(`/api/v1/exports/${exportData.exportId}`)).json();
	assert.equal(polled.status, "completed");
	assert.equal(polled.progress.percent, 100);
	assert.ok(polled.downloadUrl.endsWith(`/api/v1/exports/${exportData.exportId}/download`));

	// Download exported .mbox stream
	const downloadRes = await client.request(
		`/api/v1/exports/${exportData.exportId}/download`,
	);
	assert.equal(downloadRes.status, 200);
	assert.equal(downloadRes.headers.get("Content-Type"), "application/mbox; charset=utf-8");
	assert.ok(downloadRes.headers.get("Content-Disposition").includes(".mbox"));

	// Another signed-in user can neither read the job nor download the archive.
	const strangerHeaders = { headers: { "x-test-user": "stranger@other.com" } };
	const strangerJob = await client.request(`/api/v1/exports/${exportData.exportId}`, strangerHeaders);
	assert.equal(strangerJob.status, 404);
	const strangerDownload = await client.request(
		`/api/v1/exports/${exportData.exportId}/download`,
		strangerHeaders,
	);
	assert.equal(strangerDownload.status, 404);

	// Expired exports are refused and their archive deleted.
	const jobKey = `exports/jobs/${exportData.exportId}.json`;
	const storedJob = await (await bucket.get(jobKey)).json();
	await bucket.put(jobKey, JSON.stringify({ ...storedJob, expiresAt: new Date(Date.now() - 1000).toISOString() }));
	const expiredRes = await client.request(`/api/v1/exports/${exportData.exportId}/download`);
	assert.equal(expiredRes.status, 410);
	assert.equal(await bucket.get(storedJob.downloadKey), null);
	await bucket.put(jobKey, JSON.stringify(storedJob));
	// Domain admin can read the domain export job status
	const domainJobRes = await client.request(`/api/v1/exports/${exportData.exportId}`);
	assert.equal(domainJobRes.status, 200);
	const domainJobData = await domainJobRes.json();
	assert.equal(domainJobData.id, exportData.exportId);
	assert.equal(domainJobData.targetType, "domain");

	// Unrelated user gets 404 (not 403) for domain export status and download
	const outsider = { "x-test-user": "mallory@evil.example" };
	const outsiderDomainJobRes = await client.request(
		`/api/v1/exports/${exportData.exportId}`,
		{ headers: outsider },
	);
	assert.equal(outsiderDomainJobRes.status, 404, "Outsider must not read domain export status");
	const outsiderDomainDownloadRes = await client.request(
		`/api/v1/exports/${exportData.exportId}/download`,
		{ headers: outsider },
	);
	assert.equal(outsiderDomainDownloadRes.status, 404, "Outsider must not download domain export");

	// Mailbox export: owner can read status and download
	await bucket.put("mailboxes/you@acme.com.json", JSON.stringify({ fromName: "You" }));
	await addMailboxRow(env, "you@acme.com", "you@acme.com");
	const owner = { "x-test-user": "you@acme.com" };
	const mailboxExportRes = await client.request(
		"/api/v1/mailboxes/you@acme.com/export",
		{ method: "POST", headers: owner },
	);
	assert.equal(mailboxExportRes.status, 200);
	const mailboxExport = await mailboxExportRes.json();
	assert.equal(mailboxExport.status, "pending");
	assert.equal(mailboxExport.mailboxId, "you@acme.com");

	const ownerJobRes = await client.request(
		`/api/v1/exports/${mailboxExport.exportId}`,
		{ headers: owner },
	);
	assert.equal(ownerJobRes.status, 200);
	const ownerJobData = await ownerJobRes.json();
	assert.equal(ownerJobData.status, "completed");
	assert.equal(ownerJobData.targetType, "mailbox");
	assert.equal(ownerJobData.targetId, "you@acme.com");

	const ownerDownloadRes = await client.request(
		`/api/v1/exports/${mailboxExport.exportId}/download`,
		{ headers: owner },
	);
	assert.equal(ownerDownloadRes.status, 200);
	assert.equal(ownerDownloadRes.headers.get("Content-Type"), "application/mbox; charset=utf-8");
	assert.ok((await ownerDownloadRes.text()).includes("From bob@example.com "));

	// Unrelated user gets 404 for mailbox export status and download
	const outsiderMailboxJobRes = await client.request(
		`/api/v1/exports/${mailboxExport.exportId}`,
		{ headers: outsider },
	);
	assert.equal(outsiderMailboxJobRes.status, 404, "Outsider must not read mailbox export status");
	const outsiderMailboxDownloadRes = await client.request(
		`/api/v1/exports/${mailboxExport.exportId}/download`,
		{ headers: outsider },
	);
	assert.equal(outsiderMailboxDownloadRes.status, 404, "Outsider must not download mailbox export");

	// Unauthenticated callers get 404 too
	const anonymous = harness(env);
	assert.equal((await anonymous.request(`/api/v1/exports/${exportData.exportId}`)).status, 404);
	assert.equal(
		(await anonymous.request(`/api/v1/exports/${mailboxExport.exportId}/download`)).status,
		404,
	);

	// Unknown job ids are 404
	assert.equal((await client.request("/api/v1/exports/exp_mbx_0_missing")).status, 404);

	// An archive with no job metadata is never served (no exportDataKey fallback)
	await bucket.put(exportDataKey("exp_mbx_0_orphan1"), "From x@example.com Thu Jan  1 00:00:00 1970\r\n\r\n");
	const orphanRes = await client.request("/api/v1/exports/exp_mbx_0_orphan1/download");
	assert.equal(orphanRes.status, 404, "Archives without job metadata must not be downloadable");

	console.log("✔ Export API & Download tests passed");

	// ---------------------------------------------------------
	// 4. HTTP Endpoints: Decommission Preflight & Safeguards
	// ---------------------------------------------------------
	console.log("\n4. Testing Decommission Preflight & Safeguards...");

	// Preflight check
	const preflightRes = await client.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	assert.equal(preflightRes.status, 200);
	const preflightData = await preflightRes.json();
	assert.equal(preflightData.domain, "acme.com");
	assert.equal(preflightData.hasRecentExport, true);
	assert.equal(preflightData.isRegistrarDomain, true);

	// Rejection when confirmation domain doesn't match
	const mismatchRes = await client.request(
		"/api/v1/admin/domains/acme.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "wrong-domain.com" }),
		},
	);
	assert.equal(mismatchRes.status, 400);
	assert.ok((await mismatchRes.json()).error.includes("mismatch"));

	// Domain without export requiring explicit skip
	await saveDomainMetadata(bucket, {
		domain: "no-export.com",
		zoneId: "zone-no-export",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com"],
		emailRoutingEnabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	await addDomainRow(env, "no-export.com", "admin-user");

	const blockedRes = await client.request(
		"/api/v1/admin/domains/no-export.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "no-export.com", skipExportAcknowledged: false }),
		},
	);
	assert.equal(blockedRes.status, 400);
	const blockedData = await blockedRes.json();
	assert.equal(blockedData.requiresExportOrSkip, true);

	// Successful decommission when skipExportAcknowledged: true
	const decommRes = await client.request(
		"/api/v1/admin/domains/no-export.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "no-export.com", skipExportAcknowledged: true }),
		},
	);
	assert.equal(decommRes.status, 200);
	const decommData = await decommRes.json();
	assert.equal(decommData.status, "offboarding");

	// Verify domain status in R2
	const updatedMeta = await getDomainMetadata(bucket, "no-export.com");
	assert.equal(updatedMeta.status, "offboarding");
	assert.equal(updatedMeta.emailRoutingEnabled, false);

	// Decommissioned: admin rights are gone, the owner keeps offboarding routes.
	const decommRow = await authDb(env.AUTH_DB)
		.select({ status: schema.domain.status })
		.from(schema.domain)
		.where(eq(schema.domain.domain, "no-export.com"))
		.get();
	assert.equal(decommRow.status, "decommissioned");
	await ensureUser(env, "helper-admin");
	await authDb(env.AUTH_DB).insert(schema.domainAdmin).values({ domain: "no-export.com", userId: "helper-admin" });
	const helper = { "x-test-user": "helper-admin" };
	assert.equal(
		(await client.request("/api/v1/admin/domains/no-export.com/dns/records", { headers: helper })).status,
		403,
		"a decommissioned domain grants its admins nothing",
	);
	assert.equal(
		(await client.request("/api/v1/admin/domains/no-export.com/epp-code", { headers: helper })).status,
		403,
		"offboarding routes are the owner's alone",
	);
	assert.equal(
		(await client.request("/api/v1/admin/domains/no-export.com/dns/records")).status,
		403,
		"the owner loses admin routes too",
	);
	assert.equal(
		(await client.request("/api/v1/admin/domains/no-export.com/export", { method: "POST" })).status,
		200,
		"the owner can still export after decommission",
	);

	// ---------------------------------------------------------
	// 5. Registrar EPP Code & Transfer Lock Endpoints
	// ---------------------------------------------------------
	console.log("\n5. Testing EPP Code & Transfer Lock endpoints...");

	const eppRes = await client.request(
		"/api/v1/admin/domains/acme.com/epp-code",
	);
	assert.equal(eppRes.status, 200);
	const eppData = await eppRes.json();
	assert.match(eppData.eppCode, /^EPP-ACME-/);

	const lockRes = await client.request(
		"/api/v1/admin/domains/acme.com/transfer-lock",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ locked: false }),
		},
	);
	assert.equal(lockRes.status, 200);
	const lockData = await lockRes.json();
	assert.equal(lockData.locked, false);

	console.log("✔ Decommission & EPP endpoint tests passed");

	// ---------------------------------------------------------
	// 6. Export matching: look-alike domains & mailbox-only exports
	// ---------------------------------------------------------
	console.log("\n6. Testing export matching for look-alike domains & mailbox-only exports...");

	const isoBucket = mockBucket();
	const isoEnv = mockEnv(isoBucket, sampleEmails);
	const isoClient = harness(isoEnv, adminPrincipal);
	await addDomainRow(isoEnv, "acme.com", "admin-user");

	await saveDomainMetadata(isoBucket, {
		domain: "acme.com",
		zoneId: "zone-acme-iso",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com"],
		emailRoutingEnabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	const completedJob = (id, targetType, targetId, createdAt) => ({
		id,
		targetType,
		targetId,
		status: "completed",
		progress: 100,
		totalEmails: 42,
		processedEmails: 42,
		downloadKey: `exports/data/${id}.mbox`,
		downloadUrl: `/api/v1/exports/${id}/download`,
		filename: `${id}.mbox`,
		createdAt,
		completedAt: createdAt,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	});
	const putJob = (j) => isoBucket.put(`exports/jobs/${j.id}.json`, JSON.stringify(j));

	// Another tenant's domain export, plus mailbox exports on both domains.
	const later = new Date(Date.now() + 60 * 1000).toISOString();
	await putJob(completedJob("exp_dom_notacme", "domain", "notacme.com", later));
	await putJob(completedJob("exp_mbx_notacme", "mailbox", "you@notacme.com", later));
	await putJob(completedJob("exp_mbx_acme", "mailbox", "you@acme.com", later));

	const lookalikeCheck = await hasRecentExportForDomain(isoBucket, "acme.com");
	assert.equal(lookalikeCheck.hasExport, false, "Look-alike suffix and mailbox exports must not count for acme.com");
	assert.equal(lookalikeCheck.lastExport, undefined);

	const lookalikePreflight = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	assert.equal(lookalikePreflight.status, 200);
	const lookalikePreflightData = await lookalikePreflight.json();
	assert.equal(lookalikePreflightData.hasRecentExport, false);
	assert.equal(lookalikePreflightData.lastExport, null, "Preflight must not leak another tenant's export");

	const lookalikeDecomm = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "acme.com", skipExportAcknowledged: false }),
		},
	);
	assert.equal(lookalikeDecomm.status, 400, "Foreign or mailbox-only exports must not satisfy the safeguard");
	assert.equal((await lookalikeDecomm.json()).requiresExportOrSkip, true);
	assert.equal((await getDomainMetadata(isoBucket, "acme.com")).status, "active");

	// The domain's own export is picked even though the other jobs are newer.
	await isoBucket.put("mailboxes/you@acme.com.json", JSON.stringify({ fromName: "You" }));
	const ownDomainJob = await runDomainExportJob(isoEnv, "acme.com");

	const ownCheck = await hasRecentExportForDomain(isoBucket, "ACME.com ");
	assert.equal(ownCheck.hasExport, true);
	assert.equal(ownCheck.lastExport?.id, ownDomainJob.id);

	const ownPreflight = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	const ownPreflightData = await ownPreflight.json();
	assert.equal(ownPreflightData.hasRecentExport, true);
	assert.equal(ownPreflightData.lastExport?.id, ownDomainJob.id);
	assert.equal(ownPreflightData.lastExport?.downloadUrl, ownDomainJob.downloadUrl);

	console.log("✔ Export matching tests passed");

	console.log("\n=========================================");
	console.log("ALL EMAIL EXPORT & OFFBOARDING TESTS PASSED!");
	console.log("=========================================\n");
}

runTests().catch((err) => {
	console.error("\n❌ Test failed:", err);
	process.exit(1);
});

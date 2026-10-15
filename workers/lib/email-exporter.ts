// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * First-Class Email Data Export Engine (.mbox format RFC 4155).
 * Enables seamless email backup and migration for individual mailboxes
 * and entire custom domains, compatible with Apple Mail, Thunderbird, and Gmail.
 *
 * Exports run in the background (`ExportJobDO`, alarm driven) in bounded
 * slices. Each slice pages emails from the mailbox Durable Object, streams
 * every raw message from R2 through a byte-level From-quoter, and writes the
 * archive to R2 with a multipart upload. Memory stays at roughly one part
 * plus one stream chunk no matter how large the mailbox or domain is.
 */

import type { Env } from "../types";
import { emailBodyKey, emailRawKey, buildSimpleMime } from "./email-content";
import { canonicalMailboxId } from "./mailbox-routing";
import { getFolderDisplayName } from "../../shared/folders";
import { listAllR2Objects } from "./r2-list";

export interface ExportJob {
	id: string;
	targetType: "mailbox" | "domain";
	targetId: string;
	status: "pending" | "processing" | "completed" | "failed";
	progress: number; // 0 - 100
	totalEmails: number;
	processedEmails: number;
	downloadKey?: string;
	downloadUrl?: string;
	filename?: string;
	fileSizeBytes?: number;
	createdAt: string;
	/** Last time the background worker touched this job (progress heartbeat). */
	updatedAt?: string;
	completedAt?: string;
	expiresAt: string; // 7 days from creation, reset to 7 days from completion
	error?: string;
}

export const EXPORTS_JOB_PREFIX = "exports/jobs/";
export const EXPORTS_DATA_PREFIX = "exports/data/";
/** In-flight scratch data (the unflushed tail of the current part) between slices. */
export const EXPORTS_TMP_PREFIX = "exports/tmp/";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function exportJobKey(jobId: string): string {
	return `${EXPORTS_JOB_PREFIX}${jobId}.json`;
}

export function exportDataKey(jobId: string, ext = "mbox"): string {
	return `${EXPORTS_DATA_PREFIX}${jobId}.${ext}`;
}

export function exportTmpPrefix(jobId: string): string {
	return `${EXPORTS_TMP_PREFIX}${jobId}/`;
}

/**
 * Format timestamp into RFC 4155 asctime format:
 * "Day Mon DD HH:MM:SS YYYY" (e.g. "Wed Jun 30 21:49:08 1993")
 */
export function formatAsctime(dateInput?: string | Date | null): string {
	const d = dateInput ? new Date(dateInput) : new Date();
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun",
		"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
	];
	const dayName = days[d.getUTCDay()];
	const monthName = months[d.getUTCMonth()];
	const dayNum = String(d.getUTCDate()).padStart(2, " ");
	const hours = String(d.getUTCHours()).padStart(2, "0");
	const mins = String(d.getUTCMinutes()).padStart(2, "0");
	const secs = String(d.getUTCSeconds()).padStart(2, "0");
	const year = d.getUTCFullYear();

	return `${dayName} ${monthName} ${dayNum} ${hours}:${mins}:${secs} ${year}`;
}

/**
 * RFC 4155 "From-quoting": Any line in the message body starting with "From "
 * must be prefixed with ">" to avoid ambiguous message boundaries.
 */
export function fromQuote(rawMessage: string): string {
	return rawMessage.replace(/^(>*From )/gm, ">$1");
}

/**
 * Format a single email message into standard RFC 4155 MBOX format.
 */
export function formatMboxEntry(
	sender: string | null | undefined,
	date: string | null | undefined,
	mimeContent: string,
	folderName?: string,
): string {
	const senderEmail = (sender || "MAILER-DAEMON@localhost").trim();
	const asctime = formatAsctime(date);
	const quoted = fromQuote(mimeContent);

	let entry = `From ${senderEmail} ${asctime}\r\n`;
	if (folderName) {
		entry += `X-Folder: ${folderName}\r\n`;
	}
	entry += quoted.trimEnd() + "\r\n\r\n";
	return entry;
}

/**
 * Retrieve export job metadata from R2.
 */
export async function getExportJob(
	bucket: R2Bucket,
	jobId: string,
): Promise<ExportJob | null> {
	const key = exportJobKey(jobId);
	const obj = await bucket.get(key);
	if (!obj) return null;
	try {
		return (await obj.json()) as ExportJob;
	} catch {
		return null;
	}
}

/**
 * Save export job metadata to R2.
 */
export async function saveExportJob(
	bucket: R2Bucket,
	job: ExportJob,
): Promise<void> {
	const key = exportJobKey(job.id);
	await bucket.put(key, JSON.stringify(job, null, 2), {
		httpMetadata: { contentType: "application/json" },
	});
}

/**
 * Newest first by createdAt, then by id. Ids embed Date.now(), so jobs created
 * in the same millisecond still order deterministically.
 */
function compareExportJobsNewestFirst(a: ExportJob, b: ExportJob): number {
	const byCreatedAt = Date.parse(b.createdAt) - Date.parse(a.createdAt) || 0;
	if (byCreatedAt !== 0) return byCreatedAt;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Check if a domain has a domain-wide export generated in the last 7 days.
 * Single-mailbox exports don't count: they don't back up the whole domain,
 * and the domain admin isn't necessarily allowed to download them.
 */
export async function hasRecentExportForDomain(
	bucket: R2Bucket,
	domain: string,
): Promise<{ hasExport: boolean; lastExport?: ExportJob }> {
	const listed = { objects: await listAllR2Objects(bucket, EXPORTS_JOB_PREFIX) };
	const normalizedDomain = domain.toLowerCase().trim();
	let latestJob: ExportJob | undefined;

	for (const obj of listed.objects) {
		const res = await bucket.get(obj.key);
		if (!res) continue;
		try {
			const job = (await res.json()) as ExportJob;
			if (
				job.targetType === "domain" &&
				job.targetId.toLowerCase().trim() === normalizedDomain &&
				job.status === "completed"
			) {
				const isExpired = new Date(job.expiresAt).getTime() < Date.now();
				if (!isExpired) {
					if (!latestJob || compareExportJobsNewestFirst(job, latestJob) < 0) {
						latestJob = job;
					}
				}
			}
		} catch {
			// ignore malformed jobs
		}
	}

	return {
		hasExport: Boolean(latestJob),
		lastExport: latestJob,
	};
}


// ---------------------------------------------------------------------------
// Streaming .mbox encoding
// ---------------------------------------------------------------------------

const LF = 0x0a;
const CR = 0x0d;
const GT = 0x3e;
const FROM_BYTES = [0x46, 0x72, 0x6f, 0x6d, 0x20]; // "From "
const encoder = new TextEncoder();

type ByteSink = (bytes: Uint8Array) => Promise<void>;

function isTrailingWhitespace(b: number): boolean {
	return b === 0x20 || b === 0x09 || b === LF || b === CR || b === 0x0b || b === 0x0c;
}

/**
 * Byte-level, chunk-boundary-safe version of `fromQuote(...).trimEnd()`:
 * prefixes ">" to every line matching /^>*From / and drops trailing
 * whitespace. Works on raw bytes so 8-bit message bodies survive untouched.
 */
export class MboxBodyEncoder {
	/** The next byte begins a line. */
	private atLineStart = true;
	/** Bytes of a possible /^>*From / match carried over a chunk boundary. */
	private heldPrefix: Uint8Array | null = null;
	/** Trailing whitespace held back until a non-whitespace byte follows. */
	private heldWhitespace: Uint8Array[] = [];

	private readonly sink: ByteSink;

	constructor(sink: ByteSink) {
		this.sink = sink;
	}

	async write(input: Uint8Array): Promise<void> {
		if (input.length === 0) return;
		let chunk = input;
		const held = this.heldPrefix;
		if (held) {
			chunk = new Uint8Array(held.length + input.length);
			chunk.set(held, 0);
			chunk.set(input, held.length);
			this.heldPrefix = null;
		}

		const n = chunk.length;
		let runStart = 0;
		let lineStart = this.atLineStart ? 0 : -1;
		let i = 0;
		while (i <= n) {
			if (lineStart === i && i < n) {
				const match = matchFromLine(chunk, i);
				if (match === "partial") {
					await this.emit(chunk.subarray(runStart, i));
					this.heldPrefix = chunk.slice(i);
					this.atLineStart = true;
					return;
				}
				if (match === "match") {
					await this.emit(chunk.subarray(runStart, i));
					await this.emit(Uint8Array.of(GT));
					runStart = i;
				}
			}
			if (i === n) break;
			const b = chunk[i];
			i++;
			if (b === LF || b === CR) lineStart = i;
		}
		await this.emit(chunk.subarray(runStart, n));
		this.atLineStart = lineStart === n;
	}

	/** Flush an incomplete held prefix; trailing whitespace is dropped. */
	async end(): Promise<void> {
		if (this.heldPrefix) {
			await this.emit(this.heldPrefix);
			this.heldPrefix = null;
		}
		this.heldWhitespace = [];
	}

	private async emit(bytes: Uint8Array): Promise<void> {
		if (bytes.length === 0) return;
		let last = bytes.length - 1;
		while (last >= 0 && isTrailingWhitespace(bytes[last])) last--;
		if (last < 0) {
			this.heldWhitespace.push(bytes.slice());
			return;
		}
		for (const ws of this.heldWhitespace) await this.sink(ws);
		this.heldWhitespace = [];
		await this.sink(bytes.subarray(0, last + 1));
		if (last + 1 < bytes.length) this.heldWhitespace.push(bytes.slice(last + 1));
	}
}

/** Does /^>*From / match at `start`? "partial" when the chunk ends mid-match. */
function matchFromLine(chunk: Uint8Array, start: number): "match" | "none" | "partial" {
	let i = start;
	while (i < chunk.length && chunk[i] === GT) i++;
	for (let k = 0; k < FROM_BYTES.length; k++, i++) {
		if (i >= chunk.length) return "partial";
		if (chunk[i] !== FROM_BYTES[k]) return "none";
	}
	return "match";
}

/** Envelope line + folder header that open one .mbox entry (see `formatMboxEntry`). */
export function mboxEntryHeader(
	sender: string | null | undefined,
	date: string | null | undefined,
	folderName?: string,
): string {
	const senderEmail = (sender || "MAILER-DAEMON@localhost").trim();
	let header = `From ${senderEmail} ${formatAsctime(date)}\r\n`;
	if (folderName) header += `X-Folder: ${folderName}\r\n`;
	return header;
}

const MBOX_ENTRY_TERMINATOR = encoder.encode("\r\n\r\n");

// ---------------------------------------------------------------------------
// R2 multipart writer
// ---------------------------------------------------------------------------

/** R2 parts must be >= 5 MiB and all non-final parts the same size. */
export const EXPORT_PART_SIZE = 8 * 1024 * 1024;

function archiveHttpMetadata(filename: string): R2HTTPMetadata {
	return {
		contentType: "application/mbox; charset=utf-8",
		contentDisposition: `attachment; filename="${filename}"`,
	};
}

/**
 * Fixed-size part buffer over an R2 multipart upload. The multipart upload is
 * only created once a full part exists, so small archives are one plain put.
 * Between slices the unflushed tail lives in a scratch R2 object.
 */
class ExportArchiveWriter {
	private buffer: Uint8Array;
	private length = 0;
	private upload: R2MultipartUpload | null = null;
	private readonly bucket: R2Bucket;
	private readonly state: ExportWorkState;

	constructor(bucket: R2Bucket, state: ExportWorkState) {
		this.bucket = bucket;
		this.state = state;
		this.buffer = new Uint8Array(state.partSize);
		if (state.uploadId) {
			this.upload = bucket.resumeMultipartUpload(state.dataKey, state.uploadId);
		}
	}

	async loadCarry(): Promise<void> {
		if (!this.state.carryKey) return;
		const obj = await this.bucket.get(this.state.carryKey);
		if (!obj) throw new Error("Export scratch data is missing");
		const bytes = new Uint8Array(await obj.arrayBuffer());
		if (bytes.length >= this.state.partSize) throw new Error("Export scratch data is corrupt");
		this.buffer.set(bytes, 0);
		this.length = bytes.length;
	}

	readonly write: ByteSink = async (bytes) => {
		let offset = 0;
		while (offset < bytes.length) {
			const take = Math.min(bytes.length - offset, this.buffer.length - this.length);
			this.buffer.set(bytes.subarray(offset, offset + take), this.length);
			this.length += take;
			offset += take;
			if (this.length === this.buffer.length) await this.flushPart();
		}
		this.state.bytesWritten += bytes.length;
	};

	private async flushPart(): Promise<void> {
		if (!this.upload) {
			this.upload = await this.bucket.createMultipartUpload(this.state.dataKey, {
				httpMetadata: archiveHttpMetadata(this.state.filename),
			});
			this.state.uploadId = this.upload.uploadId;
		}
		const partNumber = this.state.parts.length + 1;
		const part = await this.upload.uploadPart(partNumber, this.buffer.subarray(0, this.length));
		this.state.parts.push({ partNumber: part.partNumber, etag: part.etag });
		this.length = 0;
	}

	/**
	 * Persist the unflushed tail under a key unique to the next slice, so a
	 * retried slice never overwrites the carry its own persisted state points at.
	 */
	async saveCarry(): Promise<void> {
		if (this.length === 0) {
			this.state.carryKey = null;
			return;
		}
		const key = `${exportTmpPrefix(this.state.jobId)}carry-${this.state.slice + 1}`;
		await this.bucket.put(key, this.buffer.slice(0, this.length));
		this.state.carryKey = key;
	}

	async finish(): Promise<void> {
		if (!this.upload) {
			await this.bucket.put(this.state.dataKey, this.buffer.slice(0, this.length), {
				httpMetadata: archiveHttpMetadata(this.state.filename),
			});
			return;
		}
		if (this.length > 0) await this.flushPart();
		await this.upload.complete(this.state.parts);
	}
}

// ---------------------------------------------------------------------------
// Background export jobs
// ---------------------------------------------------------------------------

/** One email row as returned by `MailboxDO.getExportPage`. */
export type ExportEmailRow = {
	rowid: number;
	id: string;
	subject: string | null;
	sender: string | null;
	sender_name: string | null;
	recipient: string | null;
	cc: string | null;
	bcc: string | null;
	date: string | null;
	folder_id: string | null;
	in_reply_to: string | null;
	provider_message_id: string | null;
	snippet: string | null;
};

/**
 * Resumable work state, persisted by `ExportJobDO` between slices. Plain JSON:
 * the cursor is (mailbox index, last exported rowid), so mail arriving or
 * being deleted mid-export never shifts the position.
 */
export interface ExportWorkState {
	jobId: string;
	targetType: "mailbox" | "domain";
	targetId: string;
	dataKey: string;
	filename: string;
	partSize: number;
	/** Mailboxes to export; null until resolved by the first slice. */
	mailboxes: string[] | null;
	/** Mailboxes counted so far (for `totalEmails`). */
	countIndex: number;
	totalEmails: number;
	mailboxIndex: number;
	afterRowId: number;
	processedEmails: number;
	bytesWritten: number;
	uploadId: string | null;
	parts: R2UploadedPart[];
	carryKey: string | null;
	slice: number;
	/** Consecutive slices that failed or never finished. */
	attempts: number;
}

export interface ExportTarget {
	targetType: "mailbox" | "domain";
	targetId: string;
}

export interface ExportSliceOptions {
	/** Epoch ms after which the slice stops at the next email boundary. */
	deadline: number;
	/** Emails per page from the mailbox Durable Object. */
	pageSize?: number;
	/** Minimum gap between progress writes to the job record. */
	progressIntervalMs?: number;
	/** Stop after this many emails (in addition to the deadline). */
	maxEmails?: number;
}

export interface ExportSliceResult {
	done: boolean;
	/** State to persist (a copy; the input state is never mutated). */
	state: ExportWorkState;
	/** Scratch object superseded by `state`; delete it once `state` is persisted. */
	obsoleteCarryKey: string | null;
}

function archiveFilename(target: ExportTarget): string {
	const safe = target.targetId.replace(/[^a-z0-9]/gi, "_");
	return target.targetType === "domain" ? `${safe}-all-mailboxes.mbox` : `${safe}-archive.mbox`;
}

/**
 * Record a new pending export job and return the work state to hand to the
 * background runner. Does no mail I/O, so the API can answer immediately.
 */
export async function createExportJob(
	env: Env,
	target: ExportTarget,
	options: { partSize?: number; now?: Date } = {},
): Promise<{ job: ExportJob; state: ExportWorkState }> {
	const targetId =
		target.targetType === "mailbox"
			? canonicalMailboxId(target.targetId) || target.targetId
			: target.targetId.toLowerCase().trim();
	const prefix = target.targetType === "domain" ? "exp_dom" : "exp_mbx";
	const id = `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
	const now = options.now ?? new Date();
	// Only tests shrink the part size; R2 rejects non-final parts under 5 MiB.
	const partSize = options.partSize ?? EXPORT_PART_SIZE;
	if (!(partSize > 0)) throw new Error("Invalid export part size");

	const job: ExportJob = {
		id,
		targetType: target.targetType,
		targetId,
		status: "pending",
		progress: 0,
		totalEmails: 0,
		processedEmails: 0,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + SEVEN_DAYS_MS).toISOString(),
	};
	await saveExportJob(env.BUCKET, job);

	const state: ExportWorkState = {
		jobId: id,
		targetType: target.targetType,
		targetId,
		dataKey: exportDataKey(id, "mbox"),
		filename: archiveFilename({ targetType: target.targetType, targetId }),
		partSize,
		mailboxes: target.targetType === "mailbox" ? [targetId] : null,
		countIndex: 0,
		totalEmails: 0,
		mailboxIndex: 0,
		afterRowId: 0,
		processedEmails: 0,
		bytesWritten: 0,
		uploadId: null,
		parts: [],
		carryKey: null,
		slice: 0,
		attempts: 0,
	};
	return { job, state };
}

async function listDomainMailboxes(env: Env, domain: string): Promise<string[]> {
	const suffix = `@${domain}.json`;
	return (await listAllR2Objects(env.BUCKET, "mailboxes/"))
		.filter((obj) => obj.key.endsWith(suffix))
		.map((obj) => obj.key.replace(/^mailboxes\//, "").replace(/\.json$/, ""));
}

function mailboxStub(env: Env, mailboxId: string) {
	const canonical = canonicalMailboxId(mailboxId);
	if (!canonical) throw new Error(`Invalid mailbox ID: ${mailboxId}`);
	return env.MAILBOX.get(env.MAILBOX.idFromName(canonical));
}

function progressPercent(state: ExportWorkState): number {
	if (state.totalEmails <= 0) return 0;
	return Math.min(99, Math.floor((state.processedEmails / state.totalEmails) * 100));
}

async function writeProgress(env: Env, state: ExportWorkState, job: ExportJob): Promise<void> {
	job.status = "processing";
	job.totalEmails = Math.max(state.totalEmails, state.processedEmails);
	job.processedEmails = state.processedEmails;
	job.progress = progressPercent(state);
	job.fileSizeBytes = state.bytesWritten;
	job.updatedAt = new Date().toISOString();
	await saveExportJob(env.BUCKET, job);
}

/** Stream one email into the archive as an RFC 4155 entry. */
async function writeMboxEntry(env: Env, email: ExportEmailRow, sink: ByteSink): Promise<void> {
	const folderName = email.folder_id ? getFolderDisplayName(email.folder_id) : "Inbox";
	await sink(encoder.encode(mboxEntryHeader(email.sender, email.date, folderName)));

	const body = new MboxBodyEncoder(sink);
	const rawObj = await env.BUCKET.get(emailRawKey(email.id));
	if (rawObj) {
		const reader = rawObj.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			await body.write(value);
		}
	} else {
		// No raw RFC822 stored: rebuild a simple MIME message from the body.
		const bodyObj = await env.BUCKET.get(emailBodyKey(email.id));
		const bodyText = bodyObj ? await bodyObj.text() : email.snippet || "";
		const mime = buildSimpleMime(
			{
				from: email.sender_name ? `"${email.sender_name}" <${email.sender}>` : email.sender,
				to: email.recipient,
				cc: email.cc,
				bcc: email.bcc,
				subject: email.subject,
				date: email.date,
				messageId: email.provider_message_id,
				inReplyTo: email.in_reply_to,
			},
			bodyText,
		);
		await body.write(encoder.encode(mime));
	}
	await body.end();
	await sink(MBOX_ENTRY_TERMINATOR);
}

/**
 * Advance an export by one bounded slice. Returns `done` once the archive is
 * complete and the job record says so. Throws on failure; the caller retries
 * from the last persisted state (re-uploading a part number simply replaces it).
 */
export async function runExportSlice(
	env: Env,
	input: ExportWorkState,
	options: ExportSliceOptions,
): Promise<ExportSliceResult> {
	const state: ExportWorkState = structuredClone(input);
	const previousCarry = input.carryKey;
	const pageSize = options.pageSize ?? 100;
	const progressIntervalMs = options.progressIntervalMs ?? 5_000;
	const startProcessed = input.processedEmails;
	const outOfTime = () =>
		Date.now() >= options.deadline ||
		(options.maxEmails !== undefined && state.processedEmails - startProcessed >= options.maxEmails);

	const job = await getExportJob(env.BUCKET, state.jobId);
	if (!job) throw new Error("Export job record is missing");
	if (job.status === "completed" || job.status === "failed") {
		return { done: true, state, obsoleteCarryKey: null };
	}

	if (!state.mailboxes) {
		state.mailboxes = await listDomainMailboxes(env, state.targetId);
	}
	const mailboxes = state.mailboxes;

	while (state.countIndex < mailboxes.length) {
		if (outOfTime()) {
			await writeProgress(env, state, job);
			return { done: false, state, obsoleteCarryKey: null };
		}
		state.totalEmails += Number(
			await mailboxStub(env, mailboxes[state.countIndex]).getTotalEmailCountForExport(),
		);
		state.countIndex++;
	}

	const writer = new ExportArchiveWriter(env.BUCKET, state);
	await writer.loadCarry();
	let lastProgressAt = Date.now();

	outer: while (state.mailboxIndex < mailboxes.length) {
		if (outOfTime()) break;
		const stub = mailboxStub(env, mailboxes[state.mailboxIndex]);
		const page = await stub.getExportPage(state.afterRowId, pageSize);
		if (!page || page.length === 0) {
			state.mailboxIndex++;
			state.afterRowId = 0;
			continue;
		}
		for (const email of page) {
			if (outOfTime()) break outer;
			await writeMboxEntry(env, email, writer.write);
			state.afterRowId = Number(email.rowid);
			state.processedEmails++;
		}
		if (Date.now() - lastProgressAt >= progressIntervalMs) {
			await writeProgress(env, state, job);
			lastProgressAt = Date.now();
		}
	}

	if (state.mailboxIndex < mailboxes.length) {
		await writer.saveCarry();
		state.slice++;
		await writeProgress(env, state, job);
		return {
			done: false,
			state,
			obsoleteCarryKey: previousCarry && previousCarry !== state.carryKey ? previousCarry : null,
		};
	}

	await writer.finish();
	const completedAt = new Date();
	job.status = "completed";
	job.progress = 100;
	job.totalEmails = state.processedEmails;
	job.processedEmails = state.processedEmails;
	job.downloadKey = state.dataKey;
	job.downloadUrl = `/api/v1/exports/${state.jobId}/download`;
	job.filename = state.filename;
	job.fileSizeBytes = state.bytesWritten;
	job.completedAt = completedAt.toISOString();
	job.updatedAt = job.completedAt;
	// The download window starts when the archive exists, not when it was requested.
	job.expiresAt = new Date(completedAt.getTime() + SEVEN_DAYS_MS).toISOString();
	delete job.error;
	await saveExportJob(env.BUCKET, job);
	state.carryKey = null;
	return { done: true, state, obsoleteCarryKey: previousCarry };
}

/** Delete an export's scratch objects (best effort). */
export async function deleteExportScratch(bucket: R2Bucket, jobId: string): Promise<void> {
	for (const obj of await listAllR2Objects(bucket, exportTmpPrefix(jobId))) {
		await bucket.delete(obj.key);
	}
}

/** Give up on an export: abort the multipart upload, drop scratch data, mark failed. */
export async function failExportJob(env: Env, state: ExportWorkState, err: unknown): Promise<void> {
	if (state.uploadId) {
		try {
			await env.BUCKET.resumeMultipartUpload(state.dataKey, state.uploadId).abort();
		} catch {
			// already aborted or completed; R2 also expires abandoned uploads after 7 days
		}
	}
	try {
		await deleteExportScratch(env.BUCKET, state.jobId);
	} catch {
		// the maintenance cron removes scratch data of expired jobs
	}
	const job = await getExportJob(env.BUCKET, state.jobId);
	if (!job || job.status === "completed") return;
	job.status = "failed";
	job.error = err instanceof Error ? err.message : "Export failed";
	job.updatedAt = new Date().toISOString();
	await saveExportJob(env.BUCKET, job);
}

/**
 * Run an export to completion in-process, slice after slice. For tests and
 * tooling only: production exports run in `ExportJobDO`.
 */
export async function runExportInline(
	env: Env,
	initial: ExportWorkState,
	options: Omit<ExportSliceOptions, "deadline"> & { sliceMs?: number } = {},
): Promise<ExportJob> {
	let state = initial;
	try {
		while (true) {
			const result = await runExportSlice(env, state, {
				...options,
				deadline: Date.now() + (options.sliceMs ?? 60_000),
			});
			state = result.state;
			if (result.obsoleteCarryKey) await env.BUCKET.delete(result.obsoleteCarryKey);
			if (result.done) break;
		}
	} catch (err) {
		await failExportJob(env, state, err);
		throw err;
	}
	const job = await getExportJob(env.BUCKET, state.jobId);
	if (!job) throw new Error("Export job record is missing");
	return job;
}

/** Create and run a single-mailbox export inline (tests and tooling). */
export async function runMailboxExportJob(env: Env, mailboxId: string): Promise<ExportJob> {
	const { state } = await createExportJob(env, { targetType: "mailbox", targetId: mailboxId });
	return runExportInline(env, state);
}

/** Create and run a domain-wide export inline (tests and tooling). */
export async function runDomainExportJob(env: Env, domain: string): Promise<ExportJob> {
	const { state } = await createExportJob(env, { targetType: "domain", targetId: domain });
	return runExportInline(env, state);
}

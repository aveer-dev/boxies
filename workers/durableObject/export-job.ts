// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Background runner for mailbox / domain .mbox exports.
 *
 * One instance per export job (`idFromName(jobId)`). `start()` stores the work
 * state and sets an alarm; each alarm runs one bounded slice
 * (`runExportSlice`), persists the cursor and re-arms until the archive is
 * complete. All progress clients see lives in the R2 job record.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import {
	deleteExportScratch,
	failExportJob,
	runExportSlice,
	type ExportWorkState,
} from "../lib/email-exporter";

const STATE_KEY = "state";
/** Wall-clock budget per alarm slice; alarms may run 15 min, we stay well under. */
const SLICE_MS = 30_000;
/** Slices in a row that may fail (or crash before finishing) before the job fails. */
const MAX_ATTEMPTS = 5;

export class ExportJobDO extends DurableObject<Env> {
	/** Begin an export. Idempotent: a job that is already running is left alone. */
	async start(state: ExportWorkState): Promise<void> {
		const existing = await this.ctx.storage.get<ExportWorkState>(STATE_KEY);
		if (existing) return;
		await this.ctx.storage.put(STATE_KEY, state);
		await this.ctx.storage.setAlarm(Date.now());
	}

	/** Re-arm a job whose alarm was lost (e.g. the runtime gave up retrying). */
	async kick(): Promise<boolean> {
		const state = await this.ctx.storage.get<ExportWorkState>(STATE_KEY);
		if (!state) return false;
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now());
		}
		return true;
	}

	async alarm(): Promise<void> {
		const stored = await this.ctx.storage.get<ExportWorkState>(STATE_KEY);
		if (!stored) return;

		// Count the attempt before working, so slices that crash the isolate
		// (and never reach the catch below) still use up the retry budget.
		const attempt = { ...stored, attempts: stored.attempts + 1 };
		if (attempt.attempts > MAX_ATTEMPTS) {
			await this.finishWithError(attempt, new Error("Export stopped making progress"));
			return;
		}
		await this.ctx.storage.put(STATE_KEY, attempt);

		try {
			const result = await runExportSlice(this.env, attempt, { deadline: Date.now() + SLICE_MS });
			if (result.done) {
				await this.ctx.storage.deleteAlarm();
				await this.ctx.storage.deleteAll();
				// Includes carries orphaned by slices that crashed before persisting.
				await deleteExportScratch(this.env.BUCKET, attempt.jobId).catch(() => {});
				return;
			}
			await this.ctx.storage.put(STATE_KEY, { ...result.state, attempts: 0 });
			await this.ctx.storage.setAlarm(Date.now());
			if (result.obsoleteCarryKey) {
				await this.env.BUCKET.delete(result.obsoleteCarryKey).catch(() => {});
			}
		} catch (err) {
			console.error("[export] slice failed", attempt.jobId, (err as Error)?.message);
			if (attempt.attempts >= MAX_ATTEMPTS) {
				await this.finishWithError(attempt, err);
				return;
			}
			// Retry from the last persisted cursor with a short backoff.
			await this.ctx.storage.setAlarm(Date.now() + 2_000 * 2 ** (attempt.attempts - 1));
		}
	}

	private async finishWithError(state: ExportWorkState, err: unknown): Promise<void> {
		try {
			await failExportJob(this.env, state, err);
		} finally {
			await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.deleteAll();
		}
	}
}

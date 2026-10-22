// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hourly upkeep (the `scheduled` handler in app.ts):
 * - Bring-your-own domains go `pending` → `active` once their Cloudflare
 *   zone is active (the owner moved the nameservers).
 * - Domain claims still pending after CLAIM_TTL with no mailboxes are
 *   released (zone, rows, metadata), so the domain can be claimed again.
 *   Older pending claims that do have mailboxes are left for an operator and
 *   logged.
 * - Expired sessions are deleted through Better Auth (their device tokens
 *   go with them), and so are expired codes and reset links.
 * - Expired mailbox/domain exports are deleted from R2.
 * - Billed domains get their due emails (charge notices, end of service,
 *   renewal countdown), and released domains past their 30-day retention have
 *   their mail deleted (see service-reminders.ts, domain-purge.ts).
 * - Decommissioned domains get their admins warned 7 days before finalize,
 *   and are finalized once their 30-day grace period ends: mailboxes,
 *   aliases, access, subscription and registry entry deleted, then the
 *   Cloudflare zone deleted and registrar auto-renew turned off
 *   (domain-offboarding.ts). An interrupted finalize resumes here.
 *
 * Each step is independent: one failing doesn't stop the others.
 */

import { and, eq, lt } from "drizzle-orm";
import { getAuth } from "../auth";
import { authDb, listMailboxesOnDomain } from "../auth/authz";
import { deleteExpiredVerifications } from "../auth/otp";
import * as schema from "../auth/schema";
import type { Env } from "../types";
import { deleteZone, getZone } from "./cloudflare-client";
import { runDomainOffboarding } from "./domain-offboarding";
import { deleteDomainMetadata, getDomainMetadata, saveDomainMetadata } from "./domain-registry";
import { EXPORTS_JOB_PREFIX, deleteExportScratch, type ExportJob } from "./email-exporter";
import { listAllR2Objects } from "./r2-list";
import { sendServiceReminders } from "./service-reminders";

const CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_SWEEP_BATCH = 200;

export type MaintenanceReport = {
	domainsActivated: string[];
	claimsReleased: string[];
	staleClaims: string[];
	sessionsDeleted: number;
	exportsDeleted: number;
	serviceReminders: string[];
	domainsPurged: string[];
	offboardingWarned: string[];
	offboardingFinalized: string[];
	offboardingCloudflareCleaned: string[];
	errors: string[];
};

async function step(report: MaintenanceReport, name: string, fn: () => Promise<void>) {
	try {
		await fn();
	} catch (e) {
		report.errors.push(`${name}: ${(e as Error).message}`);
		console.error(`[Maintenance] ${name} failed:`, (e as Error).message);
	}
}

export async function runScheduledMaintenance(env: Env, now = new Date()): Promise<MaintenanceReport> {
	const report: MaintenanceReport = {
		domainsActivated: [],
		claimsReleased: [],
		staleClaims: [],
		sessionsDeleted: 0,
		exportsDeleted: 0,
		serviceReminders: [],
		domainsPurged: [],
		offboardingWarned: [],
		offboardingFinalized: [],
		offboardingCloudflareCleaned: [],
		errors: [],
	};
	const db = authDb(env.AUTH_DB);

	await step(report, "domains", async () => {
		const pending = await db.select().from(schema.domain).where(eq(schema.domain.status, "pending")).all();
		for (const row of pending) {
			const meta = await getDomainMetadata(env.BUCKET, row.domain);
			let zoneActive = false;
			if (meta?.zoneId) {
				try {
					zoneActive = (await getZone(env, meta.zoneId)).status === "active";
				} catch (e) {
					report.errors.push(`zone ${row.domain}: ${(e as Error).message}`);
					continue;
				}
			}
			if (zoneActive) {
				await db.update(schema.domain).set({ status: "active" }).where(eq(schema.domain.domain, row.domain));
				if (meta && meta.status !== "active") {
					await saveDomainMetadata(env.BUCKET, { ...meta, status: "active", updatedAt: now.toISOString() });
				}
				report.domainsActivated.push(row.domain);
				continue;
			}
			if (now.getTime() - row.createdAt.getTime() < CLAIM_TTL_MS) continue;
			if ((await listMailboxesOnDomain(db, row.domain)).length > 0) {
				report.staleClaims.push(row.domain);
				continue;
			}
			if (meta?.zoneId) await deleteZone(env, meta.zoneId);
			await db.delete(schema.domain).where(eq(schema.domain.domain, row.domain));
			await deleteDomainMetadata(env.BUCKET, row.domain);
			await db.insert(schema.auditLog).values({
				id: crypto.randomUUID(),
				actorUserId: null,
				action: "domain.claim_expired",
				target: row.domain,
				detail: JSON.stringify({ ownerUserId: row.ownerUserId }),
			});
			report.claimsReleased.push(row.domain);
		}
	});

	await step(report, "sessions", async () => {
		const ctx = await getAuth(env).$context;
		for (;;) {
			const expired = await db
				.select({ token: schema.session.token })
				.from(schema.session)
				.where(lt(schema.session.expiresAt, now))
				.limit(SESSION_SWEEP_BATCH)
				.all();
			if (expired.length === 0) break;
			await ctx.internalAdapter.deleteSessions(expired.map((s) => s.token));
			report.sessionsDeleted += expired.length;
			if (expired.length < SESSION_SWEEP_BATCH) break;
		}
		await deleteExpiredVerifications(db, now.getTime());
		// Invites past expiry stay as history for a while, then go.
		await db
			.delete(schema.invite)
			.where(and(lt(schema.invite.expiresAt, new Date(now.getTime() - CLAIM_TTL_MS))));
	});

	await step(report, "service reminders", async () => {
		const { reminded, purged } = await sendServiceReminders(env, now);
		report.serviceReminders = reminded;
		report.domainsPurged = purged;
	});

	await step(report, "domain offboarding", async () => {
		const offboarding = await runDomainOffboarding(env, now);
		report.offboardingWarned = offboarding.warned;
		report.offboardingFinalized = offboarding.finalized;
		report.offboardingCloudflareCleaned = offboarding.cloudflareCleaned;
		report.errors.push(...offboarding.errors);
	});

	await step(report, "exports", async () => {
		for (const obj of await listAllR2Objects(env.BUCKET, EXPORTS_JOB_PREFIX)) {
			const blob = await env.BUCKET.get(obj.key);
			if (!blob) continue;
			let job: ExportJob;
			try {
				job = (await blob.json()) as ExportJob;
			} catch {
				continue;
			}
			if (new Date(job.expiresAt).getTime() >= now.getTime()) continue;
			if (job.downloadKey) await env.BUCKET.delete(job.downloadKey);
			// Scratch data a stalled background export left behind.
			if (job.status !== "completed") await deleteExportScratch(env.BUCKET, job.id);
			await env.BUCKET.delete(obj.key);
			report.exportsDeleted++;
		}
	});

	if (
		report.domainsActivated.length ||
		report.claimsReleased.length ||
		report.staleClaims.length ||
		report.offboardingWarned.length ||
		report.offboardingFinalized.length ||
		report.offboardingCloudflareCleaned.length
	) {
		console.log("[Maintenance]", JSON.stringify(report));
	}
	return report;
}

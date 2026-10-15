/**
 * Copy identity and permissions from R2 into AUTH_DB (workers/auth/migrate.ts).
 *
 *   pnpm auth:migrate-data                    dry run, local dev state
 *   pnpm auth:migrate-data --apply            write, local dev state
 *   pnpm auth:migrate-data --remote           dry run, production R2 + D1
 *   pnpm auth:migrate-data --remote --apply   write, production
 *
 *
 * After the migration is applied and verified, delete the legacy R2 identity
 * records (contact/recovery emails, password hashes, sign-in links, invites):
 *
 *   pnpm auth:migrate-data --cleanup-legacy [--remote]           dry run
 *   pnpm auth:migrate-data --cleanup-legacy [--remote] --apply   delete
 *
 * Cleanup refuses to delete while any legacy user is missing from AUTH_DB.
 *
 * Always dry-run first and read the report. Apply the D1 schema before
 * writing (`pnpm auth:migrate:local` / `pnpm auth:migrate:remote`).
 * Remote runs use your `wrangler login` and touch only BUCKET and AUTH_DB.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { cleanupLegacyIdentity, migrateAuthFromR2 } from "../workers/auth/migrate.ts";

const args = new Set(process.argv.slice(2));
const remote = args.has("--remote");
const apply = args.has("--apply");
const cleanup = args.has("--cleanup-legacy");

// A throwaway config with only the two bindings involved. The real config
// also has AI, which always opens a remote session; and keeping BUCKET /
// AUTH_DB remote only here leaves `wrangler dev` on local state.
const config = unstable_readConfig({ config: "wrangler.jsonc" }, { hideWarnings: true });
const bucket = config.r2_buckets.find((b) => b.binding === "BUCKET");
const db = config.d1_databases.find((d) => d.binding === "AUTH_DB");
if (!bucket || !db) throw new Error("wrangler.jsonc needs BUCKET and AUTH_DB bindings");
if (remote && (!db.database_id || db.database_id.startsWith("REPLACE_"))) {
	throw new Error("Set the real AUTH_DB database_id in wrangler.jsonc first");
}
const configPath = join(mkdtempSync(join(tmpdir(), "inboxies-migrate-")), "wrangler.json");
writeFileSync(
	configPath,
	JSON.stringify({
		name: `${config.name}-auth-migration`,
		compatibility_date: config.compatibility_date,
		r2_buckets: [{ binding: "BUCKET", bucket_name: bucket.bucket_name, remote }],
		d1_databases: [
			{ binding: "AUTH_DB", database_name: db.database_name, database_id: db.database_id, remote },
		],
	}),
);

async function runCleanup() {
	const result = await cleanupLegacyIdentity(env.BUCKET, env.AUTH_DB, { dryRun: !apply });
	console.log(`\nLegacy identity cleanup: ${remote ? "production" : "local dev state"}`);
	console.table(result.byPrefix);
	if (result.unmigratedUserIds.length) {
		console.log(`\nNot in AUTH_DB (${result.unmigratedUserIds.length}); run the migration first. Nothing deleted.`);
		for (const id of result.unmigratedUserIds.slice(0, 20)) console.log(`  - ${id}`);
	} else {
		console.log(result.deleted ? `\nDeleted ${result.keys} objects.` : `\nDry run: would delete ${result.keys} objects.`);
	}
	process.exitCode = result.unmigratedUserIds.length ? 1 : 0;
}

async function runMigration() {
	const report = await migrateAuthFromR2(env.BUCKET, env.AUTH_DB, { dryRun: !apply });
	const reportPath = join(tmpdir(), `inboxies-auth-migration-${remote ? "remote" : "local"}-${Date.now()}.json`);
	writeFileSync(reportPath, JSON.stringify(report, null, 2));

	console.log(`\n${apply ? "Migrated" : "Dry run (nothing written)"}: ${remote ? "production" : "local dev state"}`);
	console.table(report.counts);
	const byKind = new Map();
	for (const i of report.issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i.detail]);
	for (const [kind, details] of byKind) {
		console.log(`\n${kind} (${details.length})`);
		for (const d of details.slice(0, 20)) console.log(`  - ${d}`);
		if (details.length > 20) console.log(`  … ${details.length - 20} more in the report file`);
	}
	console.log(`\nFull report: ${reportPath}`);
}

const { env, dispose } = await getPlatformProxy({
	configPath,
	remoteBindings: remote,
	// Local runs read and write the same state as `wrangler dev`.
	persist: { path: resolve(".wrangler/state/v3") },
});
try {
	try {
		await env.AUTH_DB.prepare("select count(*) from user").first();
	} catch {
		throw new Error(`AUTH_DB has no schema yet. Run: pnpm auth:migrate:${remote ? "remote" : "local"}`);
	}

	await (cleanup ? runCleanup() : runMigration());
} finally {
	await dispose();
}

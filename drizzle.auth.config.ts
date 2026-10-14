// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Generates SQL migrations for the AUTH_DB D1 database from workers/auth/schema.ts.
// Applied with `wrangler d1 migrations apply AUTH_DB` (see wrangler.jsonc migrations_dir).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./workers/auth/schema.ts",
	out: "./migrations/auth",
});

/// <reference types="astro/client" />

interface Window {
	// Set by the boot script in Base.astro: points art-directed <source data-theme-media> at a theme.
	__themeMedia?: (theme: "dark" | "light" | null, root?: ParentNode) => void;
}

// The Linear key for /api/roadmap, a Worker secret (`wrangler secret put LINEAR_ROADMAP_API_KEY`).
// Optional: the endpoint answers "unconfigured" without it, so it's declared here rather than
// as `secrets.required` in wrangler.jsonc, which would treat a missing key as a misconfiguration.
declare namespace Cloudflare {
	interface Env {
		LINEAR_ROADMAP_API_KEY?: string;
		// /api/requests (AVE-81; README, Request forms). All optional for the same reason:
		// without the first three the form says it's offline instead of the Worker failing.
		// A Linear key that can create issues, labels and attachments (not the roadmap's read-only one).
		LINEAR_REQUESTS_API_KEY?: string;
		// Turnstile: the site key is public (the page fetches it from GET /api/requests), the secret isn't.
		TURNSTILE_SITE_KEY?: string;
		TURNSTILE_SECRET_KEY?: string;
		// The Linear team requests are filed in; "AVE" when unset.
		LINEAR_REQUESTS_TEAM_KEY?: string;
	}
}

// The adapter puts the request's ExecutionContext on locals (for ctx.waitUntil in API routes).
declare namespace App {
	interface Locals {
		cfContext?: ExecutionContext;
	}
}

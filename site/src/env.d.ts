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
	}
}

// The adapter puts the request's ExecutionContext on locals (for ctx.waitUntil in API routes).
declare namespace App {
	interface Locals {
		cfContext?: ExecutionContext;
	}
}

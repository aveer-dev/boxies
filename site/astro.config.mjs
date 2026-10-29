import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://inboxies.co",
	output: "static", // every page prerendered; only src/pages/api/contact.ts and roadmap.ts opt out
	// "compile": stills are optimised with sharp at build (AVIF/WebP); no IMAGES binding.
	adapter: cloudflare({ imageService: "compile" }),
	session: false, // stops the adapter auto-adding a SESSION KV binding
	trailingSlash: "never",
	build: { format: "file" }, // /support/sent.html is served at /support/sent with no redirect hop
	prefetch: false, // speculation rules in Base.astro do this
	image: { responsiveStyles: false },
	devToolbar: { enabled: false },
	// Stable URLs for the apps and store listings (the iPhone and Android sign-in
	// screens link a Terms of Use); both land on the matching part of /legal.
	redirects: { "/privacy": "/legal#privacy", "/terms": "/legal#terms" },
});

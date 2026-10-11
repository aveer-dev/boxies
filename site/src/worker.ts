// The Worker entry (wrangler.jsonc "main"). Astro's handler does the work;
// this adds two things around it:
//
// - Byte ranges for /media. The static asset server answers a Range request
//   with the whole file and a 200, and Safari and every iOS browser won't play
//   a video without 206 answers. wrangler.jsonc sends /media/* here first
//   (assets.run_worker_first), and the file is cut to the range asked for.
//   A route under src/pages can't do this: the adapter serves any path that
//   matches a built file before it looks at routes.
// - The security headers. public/_headers only applies to responses the asset
//   server sends itself, so the 404 page, /api/contact and /media get them here.
import { handle } from "@astrojs/cloudflare/handler";

// Keep in step with the /* and /media/* blocks in public/_headers.
const SECURITY: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
	"Strict-Transport-Security": "max-age=31536000",
};
// Media names aren't fingerprinted, so a re-shoot has to reach returning visitors within the hour.
const MEDIA_CACHE = "public, max-age=3600, stale-while-revalidate=604800";

// One flat file name under /media: no folders, no dots but the extension, so nothing outside it.
const MEDIA_FILE = /^\/media\/[a-z0-9]+(?:-[a-z0-9]+)*\.(?:mp4|webm|jpg|jpeg|png|webp|avif)$/;

export default {
	async fetch(request, env, ctx) {
		const { pathname } = new URL(request.url);
		const isMedia = MEDIA_FILE.test(pathname);
		if (isMedia && request.method !== "GET" && request.method !== "HEAD") {
			return withHeaders(new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }), SECURITY);
		}
		// Anything that isn't a media file (a missing one included) gets Astro's answer, so a 404 is the site's 404 page.
		const response = (isMedia && (await media(request, env))) || (await handle(request, env, ctx));
		return withHeaders(response, SECURITY);
	},
} satisfies ExportedHandler<Env>;

async function media(request: Request, env: Env): Promise<Response | null> {
	const range = request.headers.get("Range");
	// The asset server sees a plain request: no Range (it would be ignored anyway), and
	// the validators only when the whole file is wanted, so it can still answer 304.
	const upstream = new Headers();
	if (!range) {
		for (const name of ["If-None-Match", "If-Modified-Since"]) {
			const value = request.headers.get(name);
			if (value) upstream.set(name, value);
		}
	}
	const asset = await env.ASSETS.fetch(new Request(request.url, { headers: upstream }));
	if (asset.status === 404) return null;

	const headers = new Headers(asset.headers);
	headers.set("Accept-Ranges", "bytes");
	if (asset.ok || asset.status === 304) headers.set("Cache-Control", MEDIA_CACHE);
	const whole = async () => {
		if (request.method !== "HEAD") return new Response(asset.body, { status: asset.status, headers });
		// A HEAD answer drops the body, and the length with it unless it's set by hand.
		if (asset.ok && !headers.has("Content-Length")) headers.set("Content-Length", String((await asset.arrayBuffer()).byteLength));
		return new Response(null, { status: asset.status, headers });
	};

	if (!range || !asset.ok) return whole();
	// If-Range: a range only of the version the browser already holds part of; otherwise the whole file.
	const ifRange = request.headers.get("If-Range");
	if (ifRange && ifRange !== asset.headers.get("ETag") && ifRange !== asset.headers.get("Last-Modified")) return whole();

	const bytes = await asset.arrayBuffer(); // clips are under 450KB
	const size = bytes.byteLength;
	const span = parseRange(range, size);
	if (span === "ignore") {
		headers.set("Content-Length", String(size));
		return new Response(request.method === "HEAD" ? null : bytes, { status: 200, headers });
	}
	if (span === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes", "Cache-Control": "no-store" },
		});
	}
	const [start, end] = span;
	headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
	headers.set("Content-Length", String(end - start + 1));
	return new Response(request.method === "HEAD" ? null : bytes.slice(start, end + 1), { status: 206, headers });
}

// One range only: "bytes=a-b", "bytes=a-" or "bytes=-n". Anything else (several
// ranges, another unit, bad syntax) is ignored and the whole file goes out, as
// RFC 9110 allows.
function parseRange(value: string, size: number): [number, number] | "ignore" | "unsatisfiable" {
	const m = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!m || (!m[1] && !m[2])) return "ignore";
	if (!m[1]) {
		const suffix = Number(m[2]);
		return suffix === 0 || size === 0 ? "unsatisfiable" : [Math.max(0, size - suffix), size - 1];
	}
	const start = Number(m[1]);
	if (m[2] && Number(m[2]) < start) return "ignore";
	if (start >= size) return "unsatisfiable";
	return [start, m[2] ? Math.min(Number(m[2]), size - 1) : size - 1];
}

function withHeaders(response: Response, extra: Record<string, string>): Response {
	// Responses from fetch() and the asset binding have read-only headers.
	const out = new Response(response.body, response);
	for (const [name, value] of Object.entries(extra)) {
		if (!out.headers.has(name)) out.headers.set(name, value);
	}
	return out;
}

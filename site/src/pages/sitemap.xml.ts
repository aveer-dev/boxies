// The four public pages. Result pages (/support/sent, /support/unavailable)
// and the 404 are noindex, so they're left out.
import type { APIRoute } from "astro";
import { SITE_URL, asOf } from "../config";

export const prerender = true;

const PATHS = ["/", "/pricing", "/roadmap", "/support"];

export const GET: APIRoute = () => {
	const urls = PATHS.map(
		(path) => `  <url>\n    <loc>${new URL(path, SITE_URL).href}</loc>\n    <lastmod>${asOf}</lastmod>\n  </url>`,
	).join("\n");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};

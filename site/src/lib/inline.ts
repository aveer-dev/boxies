// Markdown-lite for data copy: [text](href) links and `code`, nothing else.
// Everything is HTML-escaped first, so copy can never inject markup; the
// result is meant for set:html.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Only links the site means to make: other sites, mail, its own pages and anchors.
// Anything else (javascript:, data:, a typo) fails the build instead of shipping.
// "//host" and "/\host" leave the site too, so an on-site path is one slash only.
function safeHref(href: string): string {
	if (/^(https?:\/\/|mailto:|#|\/(?![\/\\]))/.test(href)) return href;
	throw new Error(`renderInline: refusing link "${href}"`);
}

// One pass over both forms, so a link inside `code` stays literal.
const TOKEN = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function renderInline(s: string): string {
	let out = "";
	let last = 0;
	for (const m of s.matchAll(TOKEN)) {
		out += escapeHtml(s.slice(last, m.index));
		if (m[1] !== undefined) {
			out += `<code>${escapeHtml(m[1])}</code>`;
		} else {
			const href = safeHref(m[3]);
			// Leaving the site gets the small arrow (decorative, global .arrow-out,
			// held to the last word) and noopener; mailto and on-site links don't.
			// Same tab either way, as in the portfolio.
			const external = /^https?:\/\//.test(href);
			out +=
				`<a class="inline-link" href="${escapeHtml(href)}"${external ? ' rel="noopener"' : ""}>` +
				escapeHtml(m[2]) +
				(external ? '&#8288;<span class="arrow-out" aria-hidden="true">↗</span>' : "") +
				"</a>";
		}
		last = m.index + m[0].length;
	}
	return out + escapeHtml(s.slice(last));
}

/** The same copy with the markup removed: link text kept, backticks dropped (search indexes, meta). */
export function plainInline(s: string): string {
	return s.replace(TOKEN, (_, code: string | undefined, text: string | undefined) => code ?? text ?? "");
}

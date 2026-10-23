/**
 * Does an email paint its own colours?
 *
 * Dark mode follows the Gmail / Apple Mail / Hey pattern:
 * - Simple mail (plain text, or HTML that sets no colours) takes the app
 *   theme: dark background, light text, links in the accent colour.
 * - Designed mail (it sets its own backgrounds or text colours) is shown as
 *   it was designed, on a light "paper" card inside the dark reader.
 *   Darkening it would risk dark-on-dark text and broken brand art.
 *
 * Every client runs the same rules on the SANITIZED body (web
 * `shared/email-colors.ts`, iOS `EmailHTMLSanitizer.hasOwnColors`, Android
 * `EmailHtmlSanitizer.hasOwnColors`), checked against the shared fixtures in
 * `shared/email-colors.fixtures.json`. The sanitizers drop `<style>` and
 * `<meta>`, so only attributes and inline styles can carry colours:
 *
 * 1. a non-empty `bgcolor` or `background` attribute on any tag;
 * 2. a `color` attribute on `<font>`;
 * 3. an inline `style` declaring `color`, `background`, `background-color` or
 *    `background-image` with a real value (not transparent / inherit /
 *    initial / unset / revert / currentcolor / none).
 *
 * Border and outline colours don't count: they don't decide whether text
 * is readable on a dark background.
 */

const TAG = /<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const COLOR_PROPERTIES = new Set(["color", "background", "background-color", "background-image"]);
const NEUTRAL_VALUES = new Set([
	"",
	"transparent",
	"inherit",
	"initial",
	"unset",
	"revert",
	"currentcolor",
	"none",
]);

function isNeutral(value: string): boolean {
	return NEUTRAL_VALUES.has(
		value
			.replace(/!\s*important\s*$/i, "")
			.trim()
			.toLowerCase(),
	);
}

function styleSetsColors(style: string): boolean {
	for (const declaration of style.split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const property = declaration.slice(0, colon).trim().toLowerCase();
		if (COLOR_PROPERTIES.has(property) && !isNeutral(declaration.slice(colon + 1))) return true;
	}
	return false;
}

/** True when sanitized email HTML sets its own background or text colours. */
export function emailHasOwnColors(html: string): boolean {
	if (!html) return false;
	for (const tag of html.matchAll(TAG)) {
		const tagName = tag[1].toLowerCase();
		for (const attr of tag[2].matchAll(ATTRIBUTE)) {
			const name = attr[1].toLowerCase();
			const value = attr[2] ?? attr[3] ?? attr[4] ?? "";
			if ((name === "bgcolor" || name === "background") && !isNeutral(value)) return true;
			if (name === "color" && tagName === "font" && !isNeutral(value)) return true;
			if (name === "style" && styleSetsColors(value)) return true;
		}
	}
	return false;
}

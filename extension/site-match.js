// Inboxies Private Email — which private emails belong to a site.
//
// Private emails carry a free-text label. The extension writes the page's
// hostname ("www.github.com"); people type "github.com" or "GitHub" in the app.
//
// Sites are compared by registrable domain (eTLD+1) from the Public Suffix List,
// the way browsers scope cookies and password managers scope logins, so
// foo.pages.dev and attacker.pages.dev are different sites while gist.github.com
// is still github.com. A plain name ("GitHub") only matches <name>.com/.org/…
// so it is never offered to github.ru, evil.github.io or other look-alikes.
//
// Needs psl-data.js loaded first (globalThis.InboxiesPSL).
// Loaded by the background worker (importScripts) and by the unit test.
(function (root) {
	// Generic TLDs a bare name may stand for. Country codes are left out on
	// purpose: "PayPal" must not reach paypal.ru.
	const BARE_NAME_TLDS = new Set(["com", "org", "net", "io", "app", "co", "dev"]);

	const rules = new Map(); // "co.uk" → { private }
	const wildcards = new Map(); // "*.ck" stored as "ck"
	const exceptions = new Map(); // "!www.ck" stored as "www.ck"
	const psl = root.InboxiesPSL;
	if (!psl) throw new Error("site-match.js needs psl-data.js loaded first");
	for (const [section, isPrivate] of [
		[psl.icann, false],
		[psl.private, true],
	]) {
		for (const rule of section.split(" ")) {
			if (!rule) continue;
			if (rule.startsWith("!")) exceptions.set(rule.slice(1), { private: isPrivate });
			else if (rule.startsWith("*.")) wildcards.set(rule.slice(2), { private: isPrivate });
			else rules.set(rule, { private: isPrivate });
		}
	}

	/** "https://www.Shop.com:443/signup" → "shop.com" */
	function hostFrom(value) {
		const host = String(value ?? "")
			.trim()
			.toLowerCase()
			.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
			.split(/[/?#]/)[0]
			.replace(/:\d+$/, "")
			.replace(/\.$/, "")
			.replace(/^www\d*\./, "");
		// Typed Unicode names ("bücher.de") → punycode, as URL.hostname gives pages.
		if (/[^\x00-\x7f]/.test(host)) {
			try {
				return new URL(`http://${host}`).hostname;
			} catch {
				return host;
			}
		}
		return host;
	}

	/**
	 * Public suffix of a lowercase punycode hostname, per the PSL algorithm
	 * (longest matching rule wins; "!" exceptions beat everything; default "*").
	 */
	function publicSuffixOf(labels) {
		let best = { length: 1, private: false };
		for (let i = 0; i < labels.length; i++) {
			const candidate = labels.slice(i).join(".");
			const exception = exceptions.get(candidate);
			if (exception) return { length: labels.length - i - 1, private: exception.private };
			const rule = rules.get(candidate);
			if (rule && labels.length - i > best.length) best = { length: labels.length - i, private: rule.private };
			const wildcard = i > 0 ? wildcards.get(candidate) : null;
			if (wildcard && labels.length - i + 1 > best.length) {
				best = { length: labels.length - i + 1, private: wildcard.private };
			}
		}
		return best;
	}

	/**
	 * "accounts.google.co.uk" → { domain: "google.co.uk", suffix: "co.uk", private: false }.
	 * null for anything without a registrable domain: plain names, localhost,
	 * IP addresses, bare public suffixes (github.io, co.uk).
	 */
	function siteOf(value) {
		const host = hostFrom(value);
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
		if (/^\d+(\.\d+){3}$/.test(host)) return null;
		const labels = host.split(".");
		const suffix = publicSuffixOf(labels);
		if (labels.length <= suffix.length) return null;
		return {
			domain: labels.slice(-(suffix.length + 1)).join("."),
			suffix: labels.slice(-suffix.length).join("."),
			private: suffix.private,
		};
	}

	function labelMatchesSite(label, site) {
		if (!site) return false;
		const text = String(label ?? "").trim().toLowerCase();
		if (!text) return false;
		if (text.includes(".")) return siteOf(text)?.domain === site.domain;
		// A plain name: only <name>.<generic TLD>, never a tenant of shared hosting.
		if (site.private || !BARE_NAME_TLDS.has(site.suffix)) return false;
		const name = site.domain.slice(0, -(site.suffix.length + 1));
		return text.replace(/[\s_-]+/g, "") === name.replace(/-/g, "");
	}

	root.InboxiesSiteMatch = { hostFrom, siteOf, labelMatchesSite };
})(globalThis);

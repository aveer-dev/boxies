// Inboxies Private Email — which private emails belong to a site.
//
// Private emails carry a free-text label. The extension writes the page's
// hostname ("www.github.com"); people type "github.com" or "GitHub" in the
// app. A label matches a site when it names the same registrable domain, or,
// for a plain name, the site's name ("GitHub" ↔ gist.github.com).
//
// Loaded by the background worker (importScripts) and by the unit test.
(function (root) {
	// Second-level labels under a ccTLD that act as public suffixes (co.uk, com.au, ne.jp …).
	const TWO_LEVEL_SUFFIX = /^(?:ac|co|com|edu|gov|go|ne|net|or|org)$/;

	/** "https://www.Shop.com:443/signup" → "shop.com" */
	function hostFrom(value) {
		return String(value ?? "")
			.trim()
			.toLowerCase()
			.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
			.split(/[/?#]/)[0]
			.replace(/:\d+$/, "")
			.replace(/\.$/, "")
			.replace(/^www\d*\./, "");
	}

	/** "accounts.google.co.uk" → { domain: "google.co.uk", name: "google" }; null if not a hostname. */
	function siteOf(value) {
		const host = hostFrom(value);
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
		if (/^\d+(\.\d+){3}$/.test(host)) return { domain: host, name: host };
		const parts = host.split(".");
		const suffixLabels =
			parts.length >= 3 && parts.at(-1).length === 2 && TWO_LEVEL_SUFFIX.test(parts.at(-2)) ? 2 : 1;
		const domain = parts.slice(-(suffixLabels + 1));
		return { domain: domain.join("."), name: domain[0] };
	}

	function labelMatchesSite(label, site) {
		if (!site) return false;
		const text = String(label ?? "").trim().toLowerCase();
		if (!text) return false;
		const labelSite = siteOf(text);
		if (labelSite) return labelSite.domain === site.domain;
		if (text.includes(".")) return false;
		return text.replace(/[\s_-]+/g, "") === site.name.replace(/-/g, "");
	}

	root.InboxiesSiteMatch = { hostFrom, siteOf, labelMatchesSite };
})(globalThis);

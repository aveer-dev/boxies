// Live filter over the answers on /support. An answer matches when its
// question and text hold every word of the query; matches open, the rest
// hide, and a group with nothing left hides with its heading. Changes are
// instant on purpose, so it reads as filtering rather than animation.
// Without JS the box isn't shown and every answer is on the page.

const input = document.getElementById("faq-search") as HTMLInputElement | null;
const statusLine = document.querySelector<HTMLElement>(".faq-status");
const scope = document.querySelector<HTMLElement>("[data-faq-scope]");
const topics = document.querySelector<HTMLElement>("[data-support-topics]");

if (input && statusLine && scope) {
	// Lowercase, no quotes or apostrophes (so “isn’t” finds isn't), single spaces.
	const normalise = (s: string) =>
		s.toLowerCase().replace(/["'`‘’“”«»]/g, "").replace(/\s+/g, " ").trim();

	const answers = [...scope.querySelectorAll<HTMLDetailsElement>("details[data-faq]")].map((details) => ({
		details,
		text: normalise(details.textContent ?? ""),
	}));
	const groups = [...scope.querySelectorAll<HTMLElement>("[data-faq-section]")];
	let active = false;
	let timer = 0;

	// Blocks that rise in on load or on scroll would replay that rise each time
	// a filter shows them again. Once searching starts, they just appear.
	const settleReveals = () => {
		for (const root of [scope, topics]) {
			if (!root) continue;
			for (const el of [root, ...root.querySelectorAll<HTMLElement>("[data-reveal], [data-reveal-on-scroll]")]) {
				el.setAttribute("data-reveal", "");
				el.style.animation = "none";
			}
		}
	};

	// A hash like #100% isn't valid percent-encoding: use it as typed rather than throw.
	const idFrom = (hash: string) => {
		try {
			return decodeURIComponent(hash.slice(1));
		} catch {
			return hash.slice(1);
		}
	};

	const hashTarget = () => {
		const id = idFrom(location.hash);
		return id ? document.getElementById(id)?.closest("details") ?? null : null;
	};

	// Back to the page as it loaded: everything shown, everything closed except
	// an answer the URL points at.
	const reset = () => {
		const keep = hashTarget();
		for (const { details } of answers) {
			details.hidden = false;
			details.open = details === keep;
		}
		groups.forEach((g) => (g.hidden = false));
		if (topics) topics.hidden = false;
		statusLine.textContent = "";
		active = false;
		// Flush the closes while toggles can't animate, then let them animate again.
		void scope.offsetHeight;
		scope.removeAttribute("data-searching");
	};

	const run = () => {
		// What the visitor typed, for the status line (without wrapping quotes, which the line adds).
		const shown = input.value.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
		const query = normalise(shown);
		if (!query) {
			if (active) reset();
			return;
		}
		if (!active) settleReveals();
		active = true;
		scope.setAttribute("data-searching", "");

		const words = query.split(" ");
		let n = 0;
		for (const { details, text } of answers) {
			const hit = words.every((w) => text.includes(w));
			details.hidden = !hit;
			details.open = hit;
			if (hit) n++;
		}
		groups.forEach((g) => (g.hidden = !g.querySelector("details[data-faq]:not([hidden])")));
		if (topics) topics.hidden = true;

		if (n === 0) {
			const ask = document.createElement("a");
			ask.className = "inline-link";
			ask.href = "#contact";
			ask.textContent = "Ask us below ↓";
			statusLine.replaceChildren(`Nothing matches “${shown}”. `, ask);
		} else {
			statusLine.textContent = n === 1 ? `1 answer matches “${shown}”` : `${n} answers match “${shown}”`;
		}
	};

	input.addEventListener("input", () => {
		clearTimeout(timer);
		timer = window.setTimeout(run, 120);
	});

	input.addEventListener("keydown", (e) => {
		if (e.key !== "Escape" || !input.value) return;
		e.preventDefault();
		clearTimeout(timer);
		input.value = "";
		run();
	});

	// A link to an answer the filter has hidden (a chip, or "How the Screener
	// works" inside another answer) clears the search first, so the answer is
	// there to open when the hash changes.
	document.addEventListener("click", (e) => {
		if (!active) return;
		const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
		const id = link ? idFrom(link.hash) : "";
		const target = id ? document.getElementById(id) : null;
		if (!target || !scope.contains(target) || target.closest("[hidden]") === null) return;
		clearTimeout(timer);
		input.value = "";
		reset();
	});
}

// A module, not a global script, so these names stay local to this file.
export {};

// The hero's rotating word. The pill swaps yes → reply → sign-off on a timer,
// twice round, then rests on "yes"; the lede sentence for the word on show
// inks while it's there. It's the only text on the site that changes by
// itself, so it holds while it's off screen or the tab is hidden, stops for
// good at the visitor's first key, click or wheel, and never runs with
// reduced motion (turning it on mid-rotation stops it too).
const FIRST = 3200; // ms after load
const HOLD = 2600;
const STOP_ON = ["keydown", "pointerdown", "wheel"] as const;

const pill = document.querySelector<HTMLElement>("[data-rw]");
const heading = pill?.closest<HTMLElement>("h1");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

if (pill && heading && !reduced.matches) rotate(pill, heading);

function rotate(pill: HTMLElement, h1: HTMLElement) {
	const words = (pill.dataset.words ?? "").split("|").filter(Boolean);
	if (words.length < 2) return;
	const rest = words[0];
	// Two full cycles from the second word: reply, sign-off, yes, reply, sign-off, yes.
	const order = [...words.slice(1), rest, ...words.slice(1), rest];
	const sentences = [...document.querySelectorAll<HTMLElement>("[data-k]")];

	const widths = new Map<string, number>();
	let current = rest;
	let sized = false; // --rw-w is set; until the first swap the pill keeps its natural width
	let fits = true; // false while the widest word would move any other text
	let step = 0;
	let timer = 0;
	let due = 0;
	let remaining = FIRST;
	let beat = 0;
	let started = false;
	let offscreen = false;
	let stopped = false;

	const px = (word: string) => `${widths.get(word) ?? 0}px`;
	const ink = (word: string | null) => sentences.forEach((s) => s.classList.toggle("is-inked", s.dataset.k === word));

	// Each word's width, taken from a hidden copy in the heading (so the Aa
	// slider and the web font are both accounted for). The dot and its gap sit
	// inside the pill's content box too, so they're added to every width.
	function measure() {
		const probe = document.createElement("span");
		probe.className = "rw-word";
		probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
		// appendChild, not append: the Workers types redeclare Element.append for HTMLRewriter.
		h1.appendChild(probe);
		const dot = getComputedStyle(pill, "::before");
		const extra = parseFloat(dot.width) + parseFloat(dot.marginRight) || 0;
		for (const word of words) {
			probe.textContent = word;
			widths.set(word, probe.getBoundingClientRect().width + extra);
		}
		probe.remove();

		// Try the widest word in place, with the spring off. If the heading
		// gains a line or the pill moves, a swap would shift text: don't rotate
		// at this size (a resize checks again).
		const widest = words.reduce((a, b) => ((widths.get(b) ?? 0) > (widths.get(a) ?? 0) ? b : a));
		pill.style.transition = "none";
		pill.style.setProperty("--rw-w", px(rest));
		const before = [h1.offsetHeight, pill.offsetTop, pill.offsetLeft];
		pill.style.setProperty("--rw-w", px(widest));
		const after = [h1.offsetHeight, pill.offsetTop, pill.offsetLeft];
		fits = before.every((v, i) => v === after[i]);
		if (sized) pill.style.setProperty("--rw-w", px(current));
		else pill.style.removeProperty("--rw-w");
		void pill.offsetWidth;
		pill.style.transition = "";
		if (!fits) swap(rest, false);
	}

	function swap(word: string, withInk = true) {
		if (word !== current) {
			// The first move starts from the measured width, so it springs instead of jumping from auto.
			if (!sized) {
				pill.style.transition = "none";
				pill.style.setProperty("--rw-w", px(current));
				void pill.offsetWidth;
				pill.style.transition = "";
				sized = true;
			}
			pill.querySelectorAll<HTMLElement>(".rw-word:not([data-state='out'])").forEach((el) => {
				el.dataset.state = "out";
				setTimeout(() => el.remove(), 180);
			});
			const next = document.createElement("span");
			next.className = "rw-word";
			next.dataset.state = "in";
			next.textContent = word;
			pill.appendChild(next);
			pill.style.setProperty("--rw-w", px(word));
			current = word;
			pill.classList.remove("is-beat");
			void pill.offsetWidth;
			pill.classList.add("is-beat");
			clearTimeout(beat);
			beat = window.setTimeout(() => pill.classList.remove("is-beat"), 320);
		}
		ink(withInk ? word : null);
	}

	// One timer at a time; holding keeps what's left of it.
	const held = () => !started || stopped || offscreen || document.visibilityState !== "visible";
	function run() {
		if (timer || held()) return;
		due = performance.now() + remaining;
		timer = window.setTimeout(tick, remaining);
	}
	function hold() {
		if (!timer) return;
		clearTimeout(timer);
		timer = 0;
		remaining = Math.max(0, due - performance.now());
	}
	function tick() {
		timer = 0;
		remaining = HOLD;
		// The last word has had its hold: clear the ink and rest.
		if (step === order.length) return stop();
		if (fits) swap(order[step++]);
		run();
	}

	function stop() {
		if (stopped) return;
		stopped = true;
		clearTimeout(timer);
		timer = 0;
		io.disconnect();
		STOP_ON.forEach((type) => removeEventListener(type, stop));
		document.removeEventListener("visibilitychange", onVisibility);
		reduced.removeEventListener("change", onMotion);
		swap(rest, false);
		// Once the last move settles, back to the natural width, so later text-size changes need nothing from here.
		setTimeout(() => {
			ro.disconnect();
			sized = false;
			pill.style.removeProperty("--rw-w");
		}, 480);
	}

	const onVisibility = () => (document.visibilityState === "visible" ? run() : hold());
	const onMotion = (event: MediaQueryListEvent) => event.matches && stop();

	const io = new IntersectionObserver(([entry]) => {
		offscreen = !entry.isIntersecting;
		if (offscreen) hold();
		else run();
	});
	const ro = new ResizeObserver(() => measure());

	io.observe(h1);
	ro.observe(h1);
	document.fonts?.ready.then(() => measure());
	document.addEventListener("visibilitychange", onVisibility);
	reduced.addEventListener("change", onMotion);
	STOP_ON.forEach((type) => addEventListener(type, stop, { passive: true }));

	const begin = () => {
		started = true;
		run();
	};
	if (document.readyState === "complete") begin();
	else addEventListener("load", begin, { once: true });
}

export {}; // a module, so its names stay its own

// The pinned tour. Layout is all CSS (a sticky stage beside the chapters);
// this only marks which chapter is current and swaps the stage's screen,
// rail stop and clip to match, and only while the pinned layout applies. It
// starts again whenever the window crosses into or out of that size.
import { clips } from "../../scripts/clips";

const MQ = matchMedia("(min-width: 1024px) and (min-height: 680px)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const tour = document.getElementById("tour");
const stage = tour?.querySelector<HTMLElement>(".tour-stage");

if (tour && stage) pin(tour, stage);

function pin(tour: HTMLElement, stage: HTMLElement) {
	const layers = [...stage.querySelectorAll<HTMLElement>(".phone-layer")];
	const chapters = [...tour.querySelectorAll<HTMLElement>(".chapter")];
	const rail = [...stage.querySelectorAll<HTMLButtonElement>("[data-goto]")];
	const videoOf = (i: number) => layers[i]?.querySelector<HTMLVideoElement>("video") ?? null;
	let active = -1;
	let bandIO: IntersectionObserver | null = null;
	let sectionIO: IntersectionObserver | null = null;

	function setActive(i: number) {
		if (i === active || i < 0) return;
		const prev = active;
		stage.dataset.dir = i > prev ? "down" : "up";
		// Let the waiting screens take the new direction's offset first, so the
		// incoming one moves in from the side the visitor is scrolling toward.
		void stage.offsetWidth;
		layers.forEach((l, k) => {
			l.classList.toggle("is-active", k === i);
			l.classList.toggle("is-leaving", k === prev);
		});
		chapters.forEach((c, k) => c.classList.toggle("is-active", k === i));
		rail.forEach((b, k) => (k === i ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
		active = i;
		const out = videoOf(prev);
		setTimeout(() => {
			// A quick scroll back can make the old chapter current again; leave it be then.
			if (active === prev) return;
			if (out) clips.pause(out);
			layers[prev]?.classList.remove("is-leaving");
		}, 200);
		const v = videoOf(i);
		// clips.play applies every autoplay gate (motion, data, session pause, on screen).
		if (v) setTimeout(() => active === i && clips.play(v, { restart: true }), 120);
	}

	// Safety net for fast scrolls and jumps: whatever chapter spans the
	// window's centre line wins.
	const settle = () => {
		const y = innerHeight / 2;
		setActive(
			chapters.findIndex((c) => {
				const r = c.getBoundingClientRect();
				return r.top <= y && r.bottom >= y;
			}),
		);
	};
	// Where scrollend isn't supported, settle 150ms after scrolling stops.
	let quiet = 0;
	const settleSoon = () => {
		clearTimeout(quiet);
		quiet = window.setTimeout(settle, 150);
	};
	const END = "onscrollend" in window ? "scrollend" : "scroll";
	const onEnd = END === "scrollend" ? settle : settleSoon;

	function enable() {
		// A 10% band across the middle of the window; chapters are at least
		// 70svh tall, so one crosses it at a time.
		bandIO = new IntersectionObserver(
			(entries) => {
				const hit = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.chapter));
				if (hit.length) setActive(hit[hit.length - 1]);
			},
			{ rootMargin: "-45% 0px -45% 0px", threshold: 0 },
		);
		chapters.forEach((c) => bandIO!.observe(c));
		// Pause the stage clip while the tour is off screen; resume the current one when it's back.
		sectionIO = new IntersectionObserver(([entry]) => {
			const v = videoOf(active);
			if (!v) return;
			if (entry.isIntersecting) clips.play(v);
			else clips.pause(v);
		});
		sectionIO.observe(tour);
		addEventListener(END, onEnd, { passive: true });
		setActive(0);
	}

	function disable() {
		bandIO?.disconnect();
		sectionIO?.disconnect();
		bandIO = sectionIO = null;
		removeEventListener(END, onEnd);
		clearTimeout(quiet);
		layers.forEach((_, k) => {
			const v = videoOf(k);
			if (v) clips.pause(v);
		});
		// Stacked chapters have no current one.
		chapters.forEach((c) => c.classList.remove("is-active"));
		active = -1;
	}

	rail.forEach((button, i) => {
		button.addEventListener("click", () => {
			chapters[i].scrollIntoView({ block: "center", behavior: reduced.matches ? "auto" : "smooth" });
			chapters[i].querySelector<HTMLElement>(".chapter-title")?.focus({ preventScroll: true });
		});
		// Arrows move focus along the rail; Enter and Space press the button.
		button.addEventListener("keydown", (event) => {
			const step =
				event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
				: event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
				: 0;
			const to =
				event.key === "Home" ? 0
				: event.key === "End" ? rail.length - 1
				: step ? (i + step + rail.length) % rail.length
				: -1;
			if (to < 0) return;
			event.preventDefault();
			// The rail is pinned on screen; focusing must never scroll the tour along.
			rail[to].focus({ preventScroll: true });
		});
	});

	MQ.addEventListener("change", () => (MQ.matches ? enable() : disable()));
	if (MQ.matches) enable();
}

export {}; // a module, so its names stay its own

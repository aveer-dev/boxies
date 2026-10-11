// Clip policy for every video.clip-video (Clip.astro).
//
// - Nothing downloads at render. A clip gets its <source>s on its first play,
//   for the theme it's shown in, and only after the page has loaded.
// - Clips play only while motion and data allow, and while the tab is visible.
//   "inview" clips play at half visible and pause below that; the tour stage
//   ("manual") is driven by tour.ts through play() and pause(), and still
//   only plays while it's on screen.
// - One tour or inline clip at a time; the hero is independent.
// - No light media on a dark page: a clip without a dark encode never plays in
//   the dark theme, so its dark still stays.
// - The pause button holds for the whole session, across pages. With reduced
//   motion or data saving, posters only, and the button plays a clip once.
type Theme = "dark" | "light";
type PlayOptions = { restart?: boolean; user?: boolean };

const KEY = "inboxies:clips-paused";
const root = document.documentElement;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const data = matchMedia("(prefers-reduced-data: reduce)");
const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;

const videos = () => [...document.querySelectorAll<HTMLVideoElement>("video.clip-video")];
// Clips that should be playing whenever the gate allows: in view, or the tour's
// active one. Kept in the order they were asked for, so the newest is last.
const wanted = new Set<HTMLVideoElement>();
const inView = new Set<HTMLVideoElement>();
// Manual (tour stage) clips whose frame is on screen: tour.ts picks which one
// plays, but nothing plays, or downloads, off screen.
const onScreen = new Set<HTMLVideoElement>();
let ready = false;

const sessionPaused = () => {
	try {
		return sessionStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
};
const setSessionPaused = (on: boolean) => {
	try {
		if (on) sessionStorage.setItem(KEY, "1");
		else sessionStorage.removeItem(KEY);
	} catch {}
};

// Posters only: reduced motion, reduced data or Save-Data.
const postersOnly = () => motion.matches || data.matches || connection?.saveData === true;
const canAutoplay = () => !postersOnly() && !sessionPaused() && document.visibilityState === "visible";

const themeOf = (v: HTMLVideoElement): Theme =>
	(v.closest<HTMLElement>("[data-scope-theme]")?.dataset.scopeTheme ?? root.dataset.theme) === "dark" ? "dark" : "light";
const baseFor = (v: HTMLVideoElement, theme: Theme) => (theme === "dark" ? v.dataset.dark : v.dataset.light);
const frameOf = (el: Element) => el.closest<HTMLElement>("[data-phone]");
const isTour = (v: HTMLVideoElement) => v.dataset.group !== "hero";

// The encodes, in the order the browser tries them. The H.264 MP4 plays
// everywhere and is the smaller file for all but one clip, so it goes first;
// VP9 WebM is the fallback. The codecs let a browser skip one it can't play
// without downloading it.
const ENCODES = [
	{ ext: "mp4", type: 'video/mp4; codecs="avc1.64001F"' },
	{ ext: "webm", type: 'video/webm; codecs="vp9"' },
];

// Point the video at this theme's encode.
// False when the theme has none: the still for that theme shows instead.
function ensure(v: HTMLVideoElement, theme: Theme) {
	const base = baseFor(v, theme);
	if (!base) return false;
	if (v.dataset.src !== base) {
		v.dataset.src = base;
		v.replaceChildren(
			...ENCODES.map(({ ext, type }) => Object.assign(document.createElement("source"), { src: `${base}.${ext}`, type })),
		);
		v.load();
	}
	return true;
}

// Start a clip if everything allows it. A press on the button (user) skips the gate.
function start(v: HTMLVideoElement, { restart = false, user = false }: PlayOptions = {}) {
	if (!user && (!ready || !canAutoplay() || (v.dataset.autoplay === "manual" && !onScreen.has(v)))) return;
	if (!ensure(v, themeOf(v))) return;
	if (isTour(v)) {
		for (const other of wanted) {
			if (other !== v && isTour(other)) {
				wanted.delete(other);
				other.pause();
			}
		}
	}
	// In posters-only mode a pressed clip plays once, then the poster comes back.
	v.loop = !postersOnly();
	if (restart && v.readyState > 0) v.currentTime = 0;
	v.play().catch((error: DOMException) => {
		// AbortError just means it was paused again before it started.
		if (error.name !== "NotAllowedError") return;
		// Refused (Low Power Mode, autoplay policy): stay on the poster and show the button.
		frameOf(v)?.querySelector("[data-clip-toggle]")?.classList.add("is-forced");
		sync();
	});
}

function play(v: HTMLVideoElement, options: PlayOptions = {}) {
	wanted.delete(v);
	wanted.add(v);
	start(v, options);
}

function pause(v: HTMLVideoElement) {
	wanted.delete(v);
	v.pause();
}

// Pause everything but remember what was wanted, so resume() can pick it up.
const halt = () => videos().forEach((v) => v.pause());

function resume() {
	if (!ready || !canAutoplay()) return;
	let tour: HTMLVideoElement | undefined;
	for (const v of [...wanted]) {
		if (isTour(v)) tour = v;
		else start(v);
	}
	if (tour) start(tour);
}

// Each button shows play (pressed) while its frame isn't playing and clips are
// held back: by the session pause, posters-only mode or a refused autoplay.
function sync() {
	document.querySelectorAll<HTMLButtonElement>("[data-clip-toggle]").forEach((button) => {
		const playing = !!frameOf(button)?.querySelector(".phone-layer.is-playing");
		if (playing) button.classList.remove("is-forced");
		const held = sessionPaused() || postersOnly() || button.classList.contains("is-forced");
		button.setAttribute("aria-pressed", String(!playing && held));
	});
}

function press(button: HTMLButtonElement) {
	const v = frameOf(button)?.querySelector<HTMLVideoElement>(".phone-layer.is-active video.clip-video");
	if (button.getAttribute("aria-pressed") === "true") {
		setSessionPaused(false);
		if (v) play(v, { user: true });
		resume();
	} else {
		setSessionPaused(true);
		halt();
	}
	sync();
}

// The poster shows until the video is really playing, and again whenever it stops.
function wire(v: HTMLVideoElement) {
	const layer = v.closest(".phone-layer");
	let stall = 0;
	const off = () => {
		clearTimeout(stall);
		layer?.classList.remove("is-playing");
		sync();
	};
	v.addEventListener("playing", () => {
		clearTimeout(stall);
		layer?.classList.add("is-playing");
		sync();
	});
	// "emptied": load() swapped the sources (a theme change), so the frame on show is gone.
	for (const type of ["pause", "ended", "emptied"]) v.addEventListener(type, off);
	// A failed <source> fires "error" on itself, not on the video, so listen in
	// the capture phase; only the last one failing means nothing can play.
	v.addEventListener("error", (event) => (event.target === v || event.target === v.lastElementChild) && off(), true);
	// Stalled for more than 4s counts as an error.
	v.addEventListener("stalled", () => {
		clearTimeout(stall);
		stall = window.setTimeout(() => {
			v.pause();
			off();
		}, 4000);
	});
	v.addEventListener("progress", () => clearTimeout(stall));
}

// A theme change (the page's, or a scoped region's): playing clips carry on
// from the same point in the new theme's encode, or stop on that theme's
// still if it has none. Others just forget their sources, so their next play
// loads the right ones.
function retheme() {
	for (const v of videos()) {
		const loaded = v.dataset.src;
		const theme = themeOf(v);
		if (!loaded || loaded === baseFor(v, theme)) continue;
		if (v.paused || !baseFor(v, theme)) {
			v.pause();
			delete v.dataset.src;
			continue;
		}
		const at = v.duration ? v.currentTime / v.duration : 0;
		v.addEventListener("loadedmetadata", () => (v.currentTime = at * v.duration), { once: true });
		ensure(v, theme);
	}
	resume();
}

// Half visible or more plays; less pauses and hands over to another inline
// clip that's still in view.
const io = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			const v = entry.target as HTMLVideoElement;
			if (entry.intersectionRatio >= 0.49) {
				inView.add(v);
				play(v);
			} else if (inView.delete(v)) {
				pause(v);
				const next = isTour(v) ? [...inView].find(isTour) : undefined;
				if (next) play(next);
			}
		}
	},
	{ threshold: [0, 0.5] },
);

const stageIO = new IntersectionObserver((entries) => {
	for (const entry of entries) {
		const v = entry.target as HTMLVideoElement;
		if (entry.isIntersecting) {
			onScreen.add(v);
			if (wanted.has(v)) start(v);
		} else {
			onScreen.delete(v);
			v.pause();
		}
	}
});

// Re-check the gate whenever one of its inputs changes.
const recheck = () => {
	if (canAutoplay()) resume();
	else if (postersOnly()) halt();
	sync();
};

videos().forEach(wire);
document.querySelectorAll<HTMLButtonElement>("[data-clip-toggle]").forEach((button) => {
	if (!frameOf(button)?.querySelector("video.clip-video")) return;
	button.hidden = false;
	button.addEventListener("click", () => press(button));
});
sync();

// Nothing competes with the hero poster (the LCP): clips wait for load + 200ms.
const begin = () =>
	setTimeout(() => {
		ready = true;
		videos().forEach((v) => (v.dataset.autoplay === "manual" ? stageIO : io).observe(v));
		resume();
	}, 200);
if (document.readyState === "complete") begin();
else addEventListener("load", begin, { once: true });

motion.addEventListener("change", recheck);
data.addEventListener("change", recheck);
connection?.addEventListener?.("change", recheck);
document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? resume() : halt()));
addEventListener("pagehide", halt);
addEventListener("pageshow", (event) => event.persisted && resume());
addEventListener("theme-change", retheme);
addEventListener("scope-theme-change", retheme);

export const clips = { play, pause, canAutoplay };

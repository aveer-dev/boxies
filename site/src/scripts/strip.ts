// The screen strip (ScreenStrip.astro).
// - Drag to scroll with a mouse, ported from the run timeline: a 4px
//   threshold before it counts as a drag, and the click that ends a drag is
//   swallowed. Touch and trackpads scroll natively.
// - ←/→ move one frame, Home/End go to the ends.
// - Light · Dark puts the band in its own theme (data-scope-theme). It follows
//   the page until the visitor picks one, then keeps that pick until reload.
type Theme = "dark" | "light";

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const pageTheme = (): Theme => (root.dataset.theme === "dark" ? "dark" : "light");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

document.querySelectorAll<HTMLElement>("[data-strip]").forEach((strip) => {
	const scroller = strip.querySelector<HTMLElement>(".strip-scroll");
	const track = strip.querySelector<HTMLElement>(".strip-track");
	if (!scroller || !track) return;
	const buttons = [...(strip.closest("section") ?? document).querySelectorAll<HTMLButtonElement>("[data-strip-theme]")];

	// Drag
	let drag: { x: number; left: number; moved: boolean } | null = null;
	let suppressClick = false;

	scroller.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "mouse" || event.button !== 0) return;
		drag = { x: event.clientX, left: scroller.scrollLeft, moved: false };
	});

	scroller.addEventListener("pointermove", (event) => {
		if (!drag) return;
		const dx = event.clientX - drag.x;
		if (!drag.moved && Math.abs(dx) > 4) {
			drag.moved = true;
			strip.classList.add("is-dragging");
		}
		if (drag.moved) scroller.scrollLeft = drag.left - dx;
	});

	window.addEventListener("pointerup", () => {
		if (drag?.moved) suppressClick = true;
		drag = null;
		strip.classList.remove("is-dragging");
	});

	scroller.addEventListener(
		"click",
		(event) => {
			if (!suppressClick) return;
			suppressClick = false;
			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);

	// Screens are images: stop the browser's own image drag from cancelling ours.
	scroller.addEventListener("dragstart", (event) => event.preventDefault());

	// Keys
	scroller.addEventListener("keydown", (event) => {
		const behavior: ScrollBehavior = reduced.matches ? "auto" : "smooth";
		const frame = track.querySelector<HTMLElement>(".strip-frame");
		if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
			const step = (frame?.offsetWidth ?? 0) + (parseFloat(getComputedStyle(track).columnGap) || 0);
			scroller.scrollBy({ left: event.key === "ArrowRight" ? step : -step, behavior });
		} else if (event.key === "Home" || event.key === "End") {
			scroller.scrollTo({ left: event.key === "Home" ? 0 : scroller.scrollWidth, behavior });
		} else return;
		event.preventDefault();
	});

	// Theme
	let chosen: Theme | null = null;
	let swaps = 0;

	const sync = () => {
		const shown = chosen ?? pageTheme();
		buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stripTheme === shown)));
	};

	// Decode the screens now in view in the new theme, so they appear with the fade-in
	// (at most 300ms, as the page's theme toggle does).
	const decode = (theme: Theme) => {
		const imgs = [...strip.querySelectorAll<HTMLImageElement>(`.tw-${theme} img`)].filter((img) => {
			const r = img.getBoundingClientRect();
			return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
		});
		imgs.forEach((img) => (img.loading = "eager"));
		return Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), wait(300)]);
	};

	const apply = (theme: Theme) => {
		strip.dataset.scopeTheme = theme;
		window.dispatchEvent(new CustomEvent("scope-theme-change", { detail: { root: strip, theme } }));
	};

	// A newer pick cancels a swap still in flight.
	const swap = async (theme: Theme) => {
		const id = ++swaps;
		const before = strip.dataset.scopeTheme ?? pageTheme();
		if (before === theme || reduced.matches) {
			strip.classList.remove("is-swapping");
			return apply(theme);
		}
		strip.classList.add("is-swapping");
		await wait(120);
		if (id !== swaps) return;
		apply(theme);
		await decode(theme);
		if (id === swaps) strip.classList.remove("is-swapping");
	};

	buttons.forEach((b) =>
		b.addEventListener("click", () => {
			chosen = b.dataset.stripTheme === "dark" ? "dark" : "light";
			sync();
			swap(chosen);
		}),
	);

	// Until the visitor picks, the band simply follows the page.
	window.addEventListener("theme-change", () => {
		if (!chosen) sync();
	});
	sync();
});

export {}; // a module, so its names stay its own

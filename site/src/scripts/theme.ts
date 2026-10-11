// Theme toggle. Ported from the portfolio's Base.astro with a few fixes: an OS
// theme switch never becomes a stored choice, on-screen images for the next
// theme decode before the cross-fade starts, and every way the theme can
// change (the toggle, the OS, another tab, a page back from the bfcache) runs
// the same apply(), so the media always follows the page.
type Theme = "dark" | "light";
const root = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const stored = (): Theme | null => { try { const v = localStorage.getItem("theme"); return v === "dark" || v === "light" ? v : null; } catch { return null; } };
const active = (): Theme => stored() ?? (system.matches ? "dark" : "light");

function apply(theme: Theme) {                       // never writes storage
	root.setAttribute("data-theme", theme);
	root.classList.toggle("dark", theme === "dark");
	root.classList.toggle("light", theme === "light");
	root.classList.toggle("theme-override", !!stored() && (theme === "dark") !== system.matches);
	// Point the art-directed hero poster at the theme outright. Left to its media query,
	// a browser may keep the old poster when the OS theme flips under an open page.
	window.__themeMedia?.(theme);
	window.dispatchEvent(new CustomEvent("theme-change", { detail: { theme } }));
}
const persist = (theme: Theme) => { try { localStorage.setItem("theme", theme); } catch {} };
const onScreen = (el: Element | null | undefined) => {
	const r = el?.getBoundingClientRect();
	return !!r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
};

// Load and decode the other theme's twins that are on screen, so they swap inside the cross-fade.
async function prepare(next: Theme) {
	const imgs = [...document.querySelectorAll<HTMLImageElement>(`.tw-${next} img`)].filter((img) => {
		if (img.closest("[data-scope-theme]")) return false;
		const twin = img.closest(`.tw-${next}`)!;
		return onScreen(next === "dark" ? twin.previousElementSibling : twin.nextElementSibling);
	});
	imgs.forEach((img) => (img.loading = "eager"));
	// The art-directed hero poster: fetch and decode the next theme's file too, if it's in view.
	document.querySelectorAll<HTMLSourceElement>("source[data-theme-media]").forEach((s) => {
		if (!onScreen(s.parentElement)) return;
		const pre = new Image();
		// The light poster is the picture's unconditional <source> (see Clip.astro).
		pre.src = s.dataset.themeMedia === next ? s.srcset : s.parentElement!.querySelector<HTMLSourceElement>("source:not([data-theme-media])")!.srcset;
		imgs.push(pre);
	});
	if (!imgs.length) return;
	await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 200))]);
}

document.getElementById("theme-toggle")?.addEventListener("click", async () => {
	const next: Theme = active() === "dark" ? "light" : "dark";
	persist(next);
	if (!document.startViewTransition || reduced.matches) return apply(next);
	await prepare(next);
	document.startViewTransition(() => apply(next)).ready.catch(() => {});
});
// The OS switched themes: follow it, unless the visitor picked one (it never becomes sticky).
system.addEventListener("change", () => { if (!stored()) apply(active()); });
// Picked in another tab, or changed while this page sat in the back/forward cache.
addEventListener("storage", (event) => { if (event.key === "theme" || event.key === null) apply(active()); });
addEventListener("pageshow", (event) => { if (event.persisted && root.dataset.theme !== active()) apply(active()); });

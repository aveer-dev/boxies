// Name the outgoing page body so it can dissolve on its own while the
// incoming page's blocks rise in underneath (see global.css). Only the
// old side is named, so nothing ever slides between scroll positions.
const pageMain = () => document.querySelector<HTMLElement>(".page-main");

// A named element is drawn over the rest of the page while it
// transitions, so on desktop the outgoing body would cross the fixed
// header and footer sharp. Fade it out under their blurred edges instead.
const fadeUnderBars = (main: HTMLElement) => {
	const [top, bottom] = [".site-header", ".site-footer"].map((bar) =>
		document.querySelector<HTMLElement>(`${bar} .progressive-blur`),
	);
	if (!top?.checkVisibility() || !bottom?.checkVisibility()) return;
	const y = main.getBoundingClientRect().top;
	const t = top.getBoundingClientRect();
	const b = bottom.getBoundingClientRect();
	const mask = `linear-gradient(transparent ${t.top - y}px, #000 ${t.bottom - y}px, #000 ${b.top - y}px, transparent ${b.bottom - y}px)`;
	main.style.setProperty("-webkit-mask-image", mask);
	main.style.setProperty("mask-image", mask);
};

window.addEventListener("pageswap", (event) => {
	const main = pageMain();
	if (!event.viewTransition || !main) return;
	main.style.setProperty("view-transition-name", "page");
	fadeUnderBars(main);
});
// Restored from the back/forward cache: it's the incoming page now.
window.addEventListener("pagereveal", () => {
	for (const property of ["view-transition-name", "-webkit-mask-image", "mask-image"]) {
		pageMain()?.style.removeProperty(property);
	}
});

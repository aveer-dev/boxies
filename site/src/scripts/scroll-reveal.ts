// Blocks marked [data-reveal-on-scroll] rise in (the load reveal's keyframes)
// the first time they come into view. Those arriving together stagger in
// document order. With reduced motion nothing is hidden, so nothing runs.
if (matchMedia("(prefers-reduced-motion: no-preference)").matches) {
	const io = new IntersectionObserver((entries) => {
		entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)
			.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
			.forEach((el, i) => { el.style.setProperty("--reveal-delay", `${Math.min(i, 5) * 40}ms`); el.setAttribute("data-reveal", ""); io.unobserve(el); });
	}, { rootMargin: "0px 0px -10% 0px" });
	document.querySelectorAll("[data-reveal-on-scroll]:not([data-reveal])").forEach((el) => io.observe(el));
}

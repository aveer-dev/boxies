// One shared tooltip for every small mark with data-tip (the run page's, in
// inverted ink). It shows on hover with a mouse and on keyboard focus, and is
// created the first time it's needed. Its styles are inline so any page can
// import this without a stylesheet of its own.
let tip: HTMLElement | null = null;
let current: HTMLElement | null = null;

const create = () => {
	const el = document.createElement("div");
	el.className = "site-tip";
	el.setAttribute("role", "tooltip");
	// The marks carry their meaning as text already (sr-only), so this is visual only.
	el.setAttribute("aria-hidden", "true");
	el.style.cssText =
		"position:fixed;top:0;left:0;z-index:50;padding:4px 8px;border-radius:4px;" +
		"background:var(--text-primary);color:var(--bg);font:400 0.6875rem/0.875rem var(--mono);" +
		"font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;" +
		"opacity:0;transition:opacity 120ms var(--ease-out)";
	document.body.appendChild(el);
	return el;
};

const show = (el: HTMLElement) => {
	if (el === current) return;
	tip ??= create();
	current = el;
	tip.textContent = el.dataset.tip ?? "";
	const rect = el.getBoundingClientRect();
	const half = tip.offsetWidth / 2;
	const x = Math.min(window.innerWidth - half - 8, Math.max(half + 8, rect.left + rect.width / 2));
	tip.style.transform = `translate(${x}px, ${rect.top - 8}px) translate(-50%, -100%)`;
	tip.style.opacity = "1";
};

const hide = () => {
	current = null;
	if (tip) tip.style.opacity = "0";
};

const markOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null);

document.addEventListener("pointerover", (event) => {
	if (event.pointerType === "touch") return;
	const el = markOf(event.target);
	if (el) show(el);
	else if (current && current !== document.activeElement) hide();
});
document.addEventListener("focusin", (event) => {
	const el = markOf(event.target);
	if (el) show(el);
	else hide();
});
document.addEventListener("focusout", hide);
// Escape dismisses it without moving the pointer or focus (WCAG 1.4.13).
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && current) hide();
});
window.addEventListener("scroll", hide, { passive: true });

export {}; // a module, so its names stay its own

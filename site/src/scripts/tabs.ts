// Tabs (Tabs.astro), ported from the run page's year tabs: one tab in the Tab
// order at a time (roving tabindex), arrows and Home/End move and select, and
// the incoming panel fades in.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// Blocks in a panel that was hidden never scrolled into view, so they're still
// waiting to rise in (scroll-reveal.ts). The panel's fade is the motion here:
// show them as they are, without a second, slower entrance.
const settle = (panel: HTMLElement) =>
	panel.querySelectorAll<HTMLElement>("[data-reveal-on-scroll]:not([data-reveal])").forEach((el) => {
		el.style.animation = "none";
		el.setAttribute("data-reveal", "");
	});

document.querySelectorAll<HTMLElement>("[data-tabs]").forEach((list) => {
	const tabs = [...list.querySelectorAll<HTMLButtonElement>("[role=tab]")];
	const panelOf = (tab: HTMLButtonElement) => document.getElementById(tab.getAttribute("aria-controls")!);

	const choose = (tab: HTMLButtonElement, fade = true) => {
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute("aria-selected", String(on));
			t.tabIndex = on ? 0 : -1;
			const panel = panelOf(t);
			if (!panel) continue;
			if (on && fade) settle(panel);
			panel.hidden = !on;
			panel.removeAttribute("data-initial");
			if (on && fade && !reduced.matches) {
				panel.animate({ opacity: [0, 1] }, { duration: 150, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
			}
		}
	};

	choose(tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0], false);

	tabs.forEach((tab, i) => {
		tab.addEventListener("click", () => {
			if (tab.getAttribute("aria-selected") !== "true") choose(tab);
		});
		tab.addEventListener("keydown", (event) => {
			const n = tabs.length;
			const to =
				event.key === "ArrowRight" ? (i + 1) % n
				: event.key === "ArrowLeft" ? (i - 1 + n) % n
				: event.key === "Home" ? 0
				: event.key === "End" ? n - 1
				: -1;
			if (to < 0) return;
			event.preventDefault();
			tabs[to].focus();
			if (to !== i) choose(tabs[to]);
		});
	});
});

export {}; // a module, so its names stay its own

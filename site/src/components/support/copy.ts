// Copy buttons on the support page: the address in the intro, and the
// contact form's "Copy message". The label says "Copied" for 1.6s.

export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

const timers = new WeakMap<HTMLElement, number>();

export function flashCopied(button: HTMLElement) {
	// Remember the resting label once, so a second click mid-flash can't make "Copied" stick.
	const label = (button.dataset.label ??= button.textContent ?? "");
	button.textContent = "Copied";
	clearTimeout(timers.get(button));
	timers.set(button, window.setTimeout(() => (button.textContent = label), 1600));
}

// Static copy buttons carry their text: <button data-copy="…">.
document.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach((button) => {
	button.addEventListener("click", async () => {
		if (await copyText(button.dataset.copy ?? "")) flashCopied(button);
	});
});

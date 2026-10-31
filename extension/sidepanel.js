// Inboxies Private Email — side panel.
//
// The panel stays open while the user browses, so it follows the active tab
// and re-renders when the background worker's storage changes (pairing
// finished in another tab, a private email created from a sign-up form).

const DEFAULT_API_URL = "https://inboxies.app";
// The web app moved here; inboxies.email pages redirect, so pair with the new home.
const LEGACY_API_URL = "https://inboxies.email";
const $ = (id) => document.getElementById(id);

const COPY_ICON =
	'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.25A.75.75 0 0 0 9.75 2.5h-6.5a.75.75 0 0 0-.75.75v6.5c0 .41.34.75.75.75h.25"/></svg>';
const CHECK_ICON =
	'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

let currentHost = null;
let lastCreated = null;
// A just-created address animates in only on the renders right after creating it.
let lastCreatedAt = 0;
const FRESH_MS = 1500;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
// The native chrome spring, as sampled for CSS in sidepanel.html.
const SPRING = getComputedStyle(document.documentElement).getPropertyValue("--spring").trim() || EASE_OUT;
const canAnimate = () => !reducedMotion.matches && typeof Element.prototype.animate === "function";
let apiUrlEdited = false;
// Undefined until the first status, so opening the panel already connected isn't a "just connected" moment.
let wasConnected;
// The site card shows skeleton bones until it first learns which site the tab is on.
let siteLoaded = false;

function send(message) {
	return chrome.runtime.sendMessage(message);
}

function showText(el, text) {
	el.textContent = text || "";
	el.hidden = !text;
}

async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

/** Replays a one-shot CSS animation class (removing and re-adding it in one frame doesn't restart it). */
function replayClass(el, className) {
	if (!el) return;
	el.classList.remove(className);
	void el.offsetWidth;
	el.classList.add(className);
}

/** The paper-plane mark glides a couple of pixels: something just landed. */
function glideLogo() {
	const logo = document.querySelector(".logo");
	replayClass(logo, "glide");
	logo?.addEventListener("animationend", () => logo.classList.remove("glide"), { once: true });
}

function copyButton(email) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "icon-btn";
	button.innerHTML = COPY_ICON;
	button.setAttribute("aria-label", `Copy ${email}`);
	button.title = "Copy";
	let reset = null;
	button.addEventListener("click", async () => {
		const ok = await copyToClipboard(email);
		clearTimeout(reset);
		button.innerHTML = ok ? CHECK_ICON : COPY_ICON;
		button.classList.toggle("copied", ok);
		button.title = ok ? "Copied" : "Couldn't copy";
		// The address itself answers the click: a brief wash, as if it had just been selected.
		if (ok) replayClass(button.closest("li"), "flash");
		reset = setTimeout(() => {
			button.innerHTML = COPY_ICON;
			button.classList.remove("copied");
			button.closest("li")?.classList.remove("flash");
			button.title = "Copy";
		}, 1400);
	});
	return button;
}

/** Soft opacity crossfade when a value the user is watching changes (e.g. the site on tab switch). */
function setTextSoftly(el, text) {
	if (el.textContent === text) return;
	const hadText = el.textContent !== "";
	el.textContent = text;
	if (hadText && !reducedMotion.matches && el.animate) {
		el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
	}
}

function emailRow(item) {
	const li = document.createElement("li");
	li.dataset.email = item.email;
	if (item.email === lastCreated && Date.now() - lastCreatedAt < FRESH_MS) {
		li.className = "fresh";
		// Drop the class once the entrance and wash have played, so a later move can't replay them.
		setTimeout(() => li.classList.remove("fresh"), 2000);
	}
	const text = document.createElement("div");
	text.className = "text";
	const email = document.createElement("div");
	email.className = "email";
	email.textContent = item.email;
	const sub = document.createElement("div");
	sub.className = "sub";
	text.append(email, sub);
	li.append(text, copyButton(item.email));
	return li;
}

/**
 * Rows of { email, sub } with a copy button each. Rows are kept by address across
 * re-renders (the panel re-renders on every tab switch), so an entrance plays once
 * and a copy button's "copied" check isn't wiped mid-feedback.
 */
function renderEmails(list, items) {
	const existing = new Map([...list.children].map((li) => [li.dataset.email, li]));
	items.forEach((item, index) => {
		const li = existing.get(item.email) || emailRow(item);
		existing.delete(item.email);
		const sub = li.querySelector(".sub");
		sub.textContent = item.sub || "";
		sub.hidden = !item.sub;
		// Only touch the DOM when the row isn't already in place: re-inserting restarts its CSS animations.
		const at = list.children[index];
		if (at !== li) list.insertBefore(li, at || null);
		if (!li.isConnected || li.dataset.grown || !li.classList.contains("fresh")) return;
		li.dataset.grown = "1";
		growIn(li);
	});
	for (const stale of existing.values()) stale.remove();
}

/**
 * A new row opens its own space instead of shoving everything below it down in one frame,
 * so the Create button and the rows beneath glide. Rare (once per created address), so the
 * height animation is worth its layout cost.
 */
function growIn(li) {
	if (!canAnimate() || li.closest("[hidden]")) return;
	const style = getComputedStyle(li);
	const to = {
		height: `${li.offsetHeight}px`,
		paddingTop: style.paddingTop,
		paddingBottom: style.paddingBottom,
	};
	li.style.overflow = "hidden";
	const grow = li.animate([{ height: "0px", paddingTop: "0px", paddingBottom: "0px" }, to], {
		duration: 300,
		easing: SPRING,
	});
	grow.onfinish = grow.oncancel = () => {
		li.style.overflow = "";
	};
}

/** A soft fade for content that changed because the user moved to another tab. */
function fadeIn(...els) {
	if (!canAnimate()) return;
	for (const el of els) {
		if (!el.hidden) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });
	}
}

/** Hostname of the active tab in this window, or null for non-web pages. */
async function activeTabHost() {
	let tab;
	try {
		[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	} catch {
		return null;
	}
	if (!tab?.id) return null;
	// The URL is only visible after the user invokes the extension on a tab
	// (activeTab); otherwise ask the page's content script.
	if (tab.url) {
		try {
			const url = new URL(tab.url);
			return url.protocol === "https:" || url.protocol === "http:" ? url.hostname : null;
		} catch {
			return null;
		}
	}
	try {
		const res = await chrome.tabs.sendMessage(tab.id, { action: "PAGE_HOST" });
		return typeof res?.host === "string" && res.host ? res.host : null;
	} catch {
		return null;
	}
}

let renderToken = 0;
async function render() {
	const token = ++renderToken;
	const status = await send({ action: "STATUS" });
	if (token !== renderToken) return;

	if (wasConnected === false && status.connected) glideLogo();
	wasConnected = status.connected;
	$("connected").hidden = !status.connected;
	$("recentSection").hidden = !status.connected;
	$("footer").hidden = !status.connected;
	$("disconnected").hidden = status.connected;

	if (!status.connected) {
		if (!apiUrlEdited) $("apiUrl").value = status.apiUrl || DEFAULT_API_URL;
		if (status.expired) showText($("connectError"), "Your connection expired. Connect again.");
		return;
	}
	showText($("connectNote"), "");
	showText($("connectError"), "");

	const select = $("mailbox");
	select.replaceChildren(
		...status.mailboxes.map((m) => {
			const option = document.createElement("option");
			option.value = m;
			option.textContent = m;
			option.selected = m === status.mailboxId;
			return option;
		}),
	);
	$("mailboxField").hidden = status.mailboxes.length < 2;
	$("footMailbox").textContent = status.mailboxId;
	$("server").textContent = new URL(status.apiUrl).host;
	renderEmails(
		$("recent"),
		status.recentAliases.map((item) => ({ email: item.email, sub: item.host })),
	);
	$("recentEmpty").hidden = status.recentAliases.length > 0;

	const host = await activeTabHost();
	// Addresses this site already has come first, above creating another.
	const res = host ? await send({ action: "SITE_ALIASES", host }).catch(() => null) : null;
	if (token !== renderToken) return;
	const siteChanged = siteLoaded && host !== currentHost;
	if (host !== currentHost) {
		showText($("createStatus"), "");
		showText($("createError"), "");
	}
	currentHost = host;
	const aliases = res?.ok && Array.isArray(res.aliases) ? res.aliases : [];
	const showMailbox = status.mailboxes.length > 1;

	setTextSoftly($("siteHost"), res?.site || host || "No website open");
	showText(
		$("siteEmpty"),
		aliases.length ? "" : host ? "No private email for this site yet." : "Open a website to create a private email for it.",
	);
	// Unhide before rendering, so a new row can measure the height it grows into.
	$("siteAliases").hidden = aliases.length === 0;
	renderEmails(
		$("siteAliases"),
		aliases.map((alias) => ({ email: alias.email, sub: showMailbox ? alias.mailboxId : "" })),
	);
	if (!siteLoaded) {
		// Bones give way to the real site: the content fades up where they were.
		siteLoaded = true;
		$("siteSkeleton").hidden = true;
		fadeIn($("siteHost"), $("siteAliases"), $("siteEmpty"));
	} else if (siteChanged) {
		// The name already crossfades; its addresses (or empty note) come along with it.
		fadeIn($("siteAliases"));
	}
	if (!$("create").disabled) {
		$("create").textContent = aliases.length ? "Create another private email" : "Create private email";
	}
}

let renderTimer = null;
function scheduleRender() {
	clearTimeout(renderTimer);
	renderTimer = setTimeout(render, 60);
}

$("apiUrl").addEventListener("input", () => {
	apiUrlEdited = true;
});

$("connect").addEventListener("click", async () => {
	showText($("connectError"), "");
	showText($("connectNote"), "");
	let origin;
	try {
		origin = new URL($("apiUrl").value.trim() || DEFAULT_API_URL).origin;
		if (origin === LEGACY_API_URL) origin = DEFAULT_API_URL;
	} catch {
		showText($("connectError"), "Enter your Inboxies server address.");
		return;
	}
	// Self-hosted servers need host access; ask while we still have the click.
	if (origin !== DEFAULT_API_URL) {
		const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
		if (!granted) {
			showText($("connectError"), `The extension needs access to ${origin} to create private emails there.`);
			return;
		}
	}
	const res = await send({ action: "START_PAIR", apiUrl: origin });
	if (!res?.ok) showText($("connectError"), res?.error || "Couldn't start connecting.");
	else showText($("connectNote"), "Finish connecting in the tab that just opened.");
});

$("mailbox").addEventListener("change", (event) => {
	send({ action: "SELECT_MAILBOX", mailboxId: event.target.value });
});

$("create").addEventListener("click", async () => {
	const button = $("create");
	button.disabled = true;
	button.setAttribute("aria-busy", "true");
	button.textContent = "Creating…";
	showText($("createError"), "");
	showText($("createStatus"), "");
	const res = await send({ action: "CREATE_ALIAS", host: currentHost });
	button.disabled = false;
	button.removeAttribute("aria-busy");
	// Keep the label the site already had, so it doesn't flick back before render() catches up.
	button.textContent = $("siteAliases").children.length ? "Create another private email" : "Create private email";
	if (res?.ok) {
		lastCreated = res.email;
		lastCreatedAt = Date.now();
		glideLogo();
		const copied = await copyToClipboard(res.email);
		showText($("createStatus"), copied ? `Created and copied ${res.email}` : `Created ${res.email}`);
	} else if (res?.error !== "session_expired" && res?.error !== "not_connected") {
		showText($("createError"), res?.error === "network_error" ? "Couldn't reach Inboxies." : res?.error);
	}
	render();
});

$("disconnect").addEventListener("click", async () => {
	await send({ action: "DISCONNECT" });
	apiUrlEdited = false;
	render();
});

chrome.tabs.onActivated.addListener(scheduleRender);
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
	if (tab.active && (info.status === "complete" || info.url)) scheduleRender();
});
chrome.windows.onFocusChanged.addListener(scheduleRender);
chrome.storage.onChanged.addListener((_changes, area) => {
	if (area === "local") scheduleRender();
});

render();

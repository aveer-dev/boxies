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
	'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';

let currentHost = null;
let lastCreated = null;
let apiUrlEdited = false;

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
		reset = setTimeout(() => {
			button.innerHTML = COPY_ICON;
			button.classList.remove("copied");
			button.title = "Copy";
		}, 1400);
	});
	return button;
}

/** Rows of { email, sub } with a copy button each. */
function renderEmails(list, items) {
	list.replaceChildren(
		...items.map((item) => {
			const li = document.createElement("li");
			if (item.email === lastCreated) li.className = "fresh";
			const text = document.createElement("div");
			text.className = "text";
			const email = document.createElement("div");
			email.className = "email";
			email.textContent = item.email;
			text.appendChild(email);
			if (item.sub) {
				const sub = document.createElement("div");
				sub.className = "sub";
				sub.textContent = item.sub;
				text.appendChild(sub);
			}
			li.append(text, copyButton(item.email));
			return li;
		}),
	);
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
	if (host !== currentHost) {
		showText($("createStatus"), "");
		showText($("createError"), "");
	}
	currentHost = host;
	const aliases = res?.ok && Array.isArray(res.aliases) ? res.aliases : [];
	const showMailbox = status.mailboxes.length > 1;

	$("siteHost").textContent = res?.site || host || "No website open";
	showText(
		$("siteEmpty"),
		aliases.length ? "" : host ? "No private email for this site yet." : "Open a website to create a private email for it.",
	);
	renderEmails(
		$("siteAliases"),
		aliases.map((alias) => ({ email: alias.email, sub: showMailbox ? alias.mailboxId : "" })),
	);
	$("siteAliases").hidden = aliases.length === 0;
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
	button.textContent = "Creating…";
	showText($("createError"), "");
	showText($("createStatus"), "");
	const res = await send({ action: "CREATE_ALIAS", host: currentHost });
	button.disabled = false;
	button.textContent = "Create private email";
	if (res?.ok) {
		lastCreated = res.email;
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

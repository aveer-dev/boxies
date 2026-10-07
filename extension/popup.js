// Inboxies Private Email — popup.

const DEFAULT_API_URL = "https://inboxies.email";
const $ = (id) => document.getElementById(id);

function send(message) {
	return chrome.runtime.sendMessage(message);
}

function showError(el, text) {
	el.textContent = text || "";
	el.hidden = !text;
}

async function copy(text, button) {
	try {
		await navigator.clipboard.writeText(text);
		button.textContent = "Copied";
		setTimeout(() => (button.textContent = "Copy"), 1200);
	} catch {
		button.textContent = "Couldn't copy";
	}
}

function renderRecent(items) {
	const list = $("recent");
	list.replaceChildren();
	$("recentEmpty").hidden = items.length > 0;
	for (const item of items) {
		const li = document.createElement("li");
		const text = document.createElement("div");
		text.className = "email";
		text.textContent = item.email;
		if (item.host) {
			const host = document.createElement("div");
			host.className = "host";
			host.textContent = item.host;
			text.appendChild(host);
		}
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = "Copy";
		button.setAttribute("aria-label", `Copy ${item.email}`);
		button.addEventListener("click", () => copy(item.email, button));
		li.append(text, button);
		list.appendChild(li);
	}
}

async function activeTabHost() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		const url = tab?.url ? new URL(tab.url) : null;
		return url && url.protocol.startsWith("http") ? url.hostname : null;
	} catch {
		return null;
	}
}

async function render() {
	const status = await send({ action: "STATUS" });
	$("connected").hidden = !status.connected;
	$("disconnected").hidden = status.connected;

	if (!status.connected) {
		$("apiUrl").value = status.apiUrl || DEFAULT_API_URL;
		if (status.expired) showError($("connectError"), "Your connection expired. Connect again.");
		return;
	}

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
	$("server").textContent = new URL(status.apiUrl).host;
	renderRecent(status.recentAliases);

	const host = await activeTabHost();
	$("create").textContent = host ? `Create private email for ${host}` : "Create private email";
	$("create").dataset.host = host || "";
}

$("connect").addEventListener("click", async () => {
	showError($("connectError"), "");
	let origin;
	try {
		origin = new URL($("apiUrl").value.trim() || DEFAULT_API_URL).origin;
	} catch {
		showError($("connectError"), "Enter your Inboxies server address.");
		return;
	}
	// Self-hosted servers need host access; ask while we still have the click.
	if (origin !== DEFAULT_API_URL) {
		const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
		if (!granted) {
			showError($("connectError"), `The extension needs access to ${origin} to create private emails there.`);
			return;
		}
	}
	const res = await send({ action: "START_PAIR", apiUrl: origin });
	if (!res?.ok) showError($("connectError"), res?.error || "Couldn't start connecting.");
	else window.close();
});

$("mailbox").addEventListener("change", (event) => {
	send({ action: "SELECT_MAILBOX", mailboxId: event.target.value });
});

$("create").addEventListener("click", async () => {
	const button = $("create");
	const label = button.textContent;
	button.disabled = true;
	button.textContent = "Creating…";
	showError($("createError"), "");
	const res = await send({ action: "CREATE_ALIAS", host: button.dataset.host || null });
	button.disabled = false;
	button.textContent = label;
	if (res?.ok) {
		$("resultEmail").textContent = res.email;
		$("result").hidden = false;
		copy(res.email, $("copyResult"));
		render();
	} else if (res?.error === "session_expired" || res?.error === "not_connected") {
		render();
	} else {
		showError($("createError"), res?.error === "network_error" ? "Couldn't reach Inboxies." : res?.error);
	}
});

$("copyResult").addEventListener("click", () => copy($("resultEmail").textContent, $("copyResult")));

$("disconnect").addEventListener("click", async () => {
	await send({ action: "DISCONNECT" });
	render();
});

render();

// Inboxies Private Email — background service worker.
//
// Holds the only copy of the session token. Content scripts and the popup
// talk to it through messages; content scripts never read storage.
//
// Session tokens come from <server>/extension/connect after the user presses
// Connect in the popup, and are scoped by the Worker to private emails only
// (list mailboxes, list/create aliases).

const DEFAULT_API_URL = "https://inboxies.email";
const PAIR_WINDOW_MS = 10 * 60 * 1000;
const RECENT_LIMIT = 50;

// Keep storage away from content scripts (Chrome 120+ for storage.local).
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

function originOf(url) {
	try {
		const u = new URL(url);
		if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) {
			return null;
		}
		return u.origin;
	} catch {
		return null;
	}
}

async function getState() {
	const state = await chrome.storage.local.get([
		"apiUrl",
		"token",
		"expiresAt",
		"mailboxes",
		"mailboxId",
		"pendingPair",
		"recentAliases",
	]);
	return { apiUrl: DEFAULT_API_URL, mailboxes: [], recentAliases: [], ...state };
}

function isConnected(state) {
	return Boolean(state.token && state.mailboxId && (!state.expiresAt || Date.parse(state.expiresAt) > Date.now()));
}

async function publicStatus() {
	const state = await getState();
	return {
		connected: isConnected(state),
		expired: Boolean(state.token && state.expiresAt && Date.parse(state.expiresAt) <= Date.now()),
		apiUrl: state.apiUrl,
		mailboxes: state.mailboxes,
		mailboxId: state.mailboxId ?? null,
		recentAliases: state.recentAliases.slice(0, 5),
	};
}

async function startPair(apiUrl) {
	const origin = originOf(apiUrl || DEFAULT_API_URL);
	if (!origin) return { ok: false, error: "Use an https:// server address." };
	await chrome.storage.local.set({ pendingPair: { origin, at: Date.now() } });
	await chrome.tabs.create({ url: `${origin}/extension/connect` });
	return { ok: true };
}

/** Accept a token only from the server the user just chose to connect to. */
async function completePair(payload, sender) {
	const state = await getState();
	const pending = state.pendingPair;
	const senderOrigin = originOf(sender.url || "");
	if (!pending || Date.now() - pending.at > PAIR_WINDOW_MS) {
		return { ok: false, error: "Start connecting from the extension's Connect button." };
	}
	if (!senderOrigin || senderOrigin !== pending.origin || originOf(payload?.apiUrl) !== pending.origin) {
		return { ok: false, error: "This page isn't the server you chose to connect to." };
	}
	if (typeof payload.token !== "string" || !payload.token) {
		return { ok: false, error: "Missing session token." };
	}
	const mailboxes = Array.isArray(payload.mailboxes)
		? payload.mailboxes.filter((m) => typeof m === "string" && m.includes("@"))
		: [];
	await chrome.storage.local.set({
		apiUrl: pending.origin,
		token: payload.token,
		expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
		mailboxes,
		mailboxId: mailboxes.includes(state.mailboxId) ? state.mailboxId : (mailboxes[0] ?? null),
		pendingPair: null,
	});
	return { ok: true };
}

async function disconnect() {
	await chrome.storage.local.remove(["token", "expiresAt", "mailboxes", "mailboxId", "pendingPair"]);
	return { ok: true };
}

async function selectMailbox(mailboxId) {
	const state = await getState();
	if (!state.mailboxes.includes(mailboxId)) return { ok: false, error: "Unknown mailbox." };
	await chrome.storage.local.set({ mailboxId });
	return { ok: true };
}

async function createAlias(host) {
	const state = await getState();
	if (!isConnected(state)) {
		return { ok: false, error: state.token ? "session_expired" : "not_connected" };
	}
	const label = typeof host === "string" && host ? host.slice(0, 100) : null;
	let res;
	try {
		res = await fetch(`${state.apiUrl}/api/v1/mailboxes/${encodeURIComponent(state.mailboxId)}/aliases`, {
			method: "POST",
			credentials: "omit",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${state.token}`,
			},
			body: JSON.stringify({ label, pausedAction: "drop" }),
		});
	} catch {
		return { ok: false, error: "network_error" };
	}
	if (res.status === 401 || res.status === 403) {
		return { ok: false, error: "session_expired" };
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		return { ok: false, error: body.error || `Request failed (${res.status})` };
	}
	const { alias } = await res.json();
	const recents = [{ email: alias.alias_email, host: label || "", createdAt: alias.created_at }, ...state.recentAliases];
	await chrome.storage.local.set({ recentAliases: recents.slice(0, RECENT_LIMIT) });
	return { ok: true, email: alias.alias_email };
}

const isExtensionPage = (sender) => sender.id === chrome.runtime.id && !sender.tab;
const isOurContentScript = (sender) => sender.id === chrome.runtime.id && Boolean(sender.tab);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (sender.id !== chrome.runtime.id || !message || typeof message.action !== "string") return false;

	let work = null;
	switch (message.action) {
		case "CREATE_ALIAS":
			// From the popup (active tab host) or a sign-up form's pill.
			work = createAlias(message.host);
			break;
		case "PAIR":
			if (isOurContentScript(sender)) work = completePair(message.payload, sender);
			break;
		case "STATUS":
			if (isExtensionPage(sender)) work = publicStatus();
			break;
		case "START_PAIR":
			if (isExtensionPage(sender)) work = startPair(message.apiUrl);
			break;
		case "SELECT_MAILBOX":
			if (isExtensionPage(sender)) work = selectMailbox(message.mailboxId);
			break;
		case "DISCONNECT":
			if (isExtensionPage(sender)) work = disconnect();
			break;
	}
	if (!work) return false;
	work.then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
	return true;
});

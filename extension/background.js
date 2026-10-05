// Boxies Masked Email - Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "GENERATE_ALIAS") {
		handleGenerateAlias(message.host).then(sendResponse);
		return true; // Keep message channel open for async response
	}

	if (message.action === "GET_CONFIG") {
		chrome.storage.sync.get(["apiUrl", "mailboxId", "token"], (res) => {
			sendResponse(res);
		});
		return true;
	}

	if (message.action === "SAVE_CONFIG") {
		chrome.storage.sync.set(message.config, () => {
			sendResponse({ success: true });
		});
		return true;
	}

	if (message.action === "GET_RECENT_ALIASES") {
		chrome.storage.local.get(["recentAliases"], (res) => {
			sendResponse({ aliases: res.recentAliases || [] });
		});
		return true;
	}
});

async function handleGenerateAlias(host) {
	const config = await new Promise((resolve) => {
		chrome.storage.sync.get(["apiUrl", "mailboxId", "token"], resolve);
	});

	if (!config.apiUrl || !config.mailboxId || !config.token) {
		return { success: false, error: "not_configured" };
	}

	const cleanUrl = config.apiUrl.replace(/\/+$/, "");
	const cleanMailboxId = encodeURIComponent(config.mailboxId.trim().toLowerCase());

	try {
		const res = await fetch(`${cleanUrl}/api/v1/mailboxes/${cleanMailboxId}/aliases`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.token}`,
			},
			body: JSON.stringify({
				label: host ? `${host}` : undefined,
				pausedAction: "drop",
			}),
		});

		if (!res.ok) {
			const errText = await res.text();
			console.error("Boxies API generate alias failed:", res.status, errText);
			return { success: false, error: `api_error_${res.status}` };
		}

		const data = await res.json();
		const aliasEmail = data.alias.alias_email;

		// Store in local recent aliases cache
		const localData = await new Promise((resolve) => {
			chrome.storage.local.get(["recentAliases"], resolve);
		});
		const recents = localData.recentAliases || [];
		recents.unshift({
			email: aliasEmail,
			host: host || "Unknown",
			createdAt: new Date().toISOString(),
		});
		// Keep up to 50 recent aliases
		await new Promise((resolve) => {
			chrome.storage.local.set({ recentAliases: recents.slice(0, 50) }, resolve);
		});

		return { success: true, email: aliasEmail };
	} catch (err) {
		console.error("Failed to connect to Boxies backend:", err);
		return { success: false, error: "network_error" };
	}
}

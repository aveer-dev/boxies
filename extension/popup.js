// Boxies Masked Email - Popup Controller

document.addEventListener("DOMContentLoaded", async () => {
	const tabGenerate = document.getElementById("tabGenerate");
	const tabSettings = document.getElementById("tabSettings");
	const sectionGenerate = document.getElementById("sectionGenerate");
	const sectionSettings = document.getElementById("sectionSettings");
	const statusDot = document.getElementById("statusDot");
	const siteHostEl = document.getElementById("siteHost");
	const btnGenerate = document.getElementById("btnGenerate");
	const resultBox = document.getElementById("resultBox");
	const resultEmail = document.getElementById("resultEmail");
	const btnCopy = document.getElementById("btnCopy");
	const recentItems = document.getElementById("recentItems");

	const cfgApiUrl = document.getElementById("cfgApiUrl");
	const cfgMailboxId = document.getElementById("cfgMailboxId");
	const cfgToken = document.getElementById("cfgToken");
	const btnSaveConfig = document.getElementById("btnSaveConfig");

	let currentHost = "general";

	// 1. Detect current tab host
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tab && tab.url) {
			const url = new URL(tab.url);
			if (url.protocol.startsWith("http")) {
				currentHost = url.hostname;
				siteHostEl.textContent = currentHost;
			}
		}
	} catch (e) {
		siteHostEl.textContent = "any site";
	}

	// 2. Load stored config
	chrome.storage.sync.get(["apiUrl", "mailboxId", "token"], (cfg) => {
		if (cfg.apiUrl) cfgApiUrl.value = cfg.apiUrl;
		if (cfg.mailboxId) cfgMailboxId.value = cfg.mailboxId;
		if (cfg.token) cfgToken.value = cfg.token;

		if (cfg.apiUrl && cfg.mailboxId && cfg.token) {
			statusDot.classList.add("connected");
			statusDot.title = "Connected to Boxies";
		} else {
			statusDot.classList.remove("connected");
			statusDot.title = "Not configured — open Settings tab";
		}
	});

	// 3. Tab switching
	tabGenerate.addEventListener("click", () => {
		tabGenerate.classList.add("active");
		tabSettings.classList.remove("active");
		sectionGenerate.classList.add("active");
		sectionSettings.classList.remove("active");
	});

	tabSettings.addEventListener("click", () => {
		tabSettings.classList.add("active");
		tabGenerate.classList.remove("active");
		sectionSettings.classList.add("active");
		sectionGenerate.classList.remove("active");
	});

	// 4. Save Settings
	btnSaveConfig.addEventListener("click", () => {
		const config = {
			apiUrl: cfgApiUrl.value.trim(),
			mailboxId: cfgMailboxId.value.trim(),
			token: cfgToken.value.trim(),
		};

		chrome.storage.sync.set(config, () => {
			if (config.apiUrl && config.mailboxId && config.token) {
				statusDot.classList.add("connected");
				statusDot.title = "Connected to Boxies";
			} else {
				statusDot.classList.remove("connected");
			}
			btnSaveConfig.textContent = "Saved!";
			setTimeout(() => {
				btnSaveConfig.textContent = "Save Settings";
				tabGenerate.click();
			}, 800);
		});
	});

	// 5. Generate Alias
	btnGenerate.addEventListener("click", async () => {
		btnGenerate.disabled = true;
		btnGenerate.textContent = "Generating...";
		resultBox.style.display = "none";

		const response = await chrome.runtime.sendMessage({
			action: "GENERATE_ALIAS",
			host: currentHost,
		});

		btnGenerate.disabled = false;
		btnGenerate.textContent = "Generate Private Email";

		if (response && response.success && response.email) {
			resultEmail.textContent = response.email;
			resultBox.style.display = "flex";
			loadRecent();
		} else if (response?.error === "not_configured") {
			alert("Please configure Boxies API URL and Token in Settings first.");
			tabSettings.click();
		} else {
			alert(`Generation failed: ${response?.error || "Unknown error"}`);
		}
	});

	// 6. Copy button
	btnCopy.addEventListener("click", async () => {
		await navigator.clipboard.writeText(resultEmail.textContent);
		btnCopy.textContent = "Copied!";
		setTimeout(() => {
			btnCopy.textContent = "Copy";
		}, 1200);
	});

	// 7. Load recent aliases
	function loadRecent() {
		chrome.storage.local.get(["recentAliases"], (res) => {
			const aliases = res.recentAliases || [];
			recentItems.innerHTML = "";
			if (aliases.length === 0) {
				recentItems.innerHTML = `<div style="color: #64748b; font-size: 11px;">No aliases generated yet</div>`;
				return;
			}
			for (const item of aliases.slice(0, 5)) {
				const row = document.createElement("div");
				row.className = "recent-item";
				row.innerHTML = `
					<div>
						<div class="recent-email">${item.email}</div>
						<div style="color: #64748b; font-size: 10px;">${item.host}</div>
					</div>
					<button class="btn-copy">Copy</button>
				`;
				row.querySelector(".btn-copy").addEventListener("click", async (e) => {
					await navigator.clipboard.writeText(item.email);
					e.target.textContent = "Copied!";
					setTimeout(() => {
						e.target.textContent = "Copy";
					}, 1200);
				});
				recentItems.appendChild(row);
			}
		});
	}

	loadRecent();
});

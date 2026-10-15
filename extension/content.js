// Inboxies Private Email — content script.
//
// 1. On sign-up forms, shows a "Private email" pill next to email fields. If
//    the site already has private emails it offers those first; otherwise it
//    creates one and fills it in.
// 2. On <server>/extension/connect, relays the pairing message from the page
//    to the background worker (which checks the origin the user chose).
(function () {
	const PING = "inboxies:extension-ping";
	const READY = "inboxies:extension-ready";
	const PAIR = "inboxies:extension-pair";
	const PAIRED = "inboxies:extension-paired";

	if (window.top !== window) return;

	if (location.pathname.startsWith("/extension/connect")) {
		const announce = () => window.postMessage({ type: READY }, location.origin);
		window.addEventListener("message", async (event) => {
			if (event.source !== window || event.origin !== location.origin) return;
			const data = event.data;
			if (!data || typeof data.type !== "string") return;
			if (data.type === PING) {
				announce();
				return;
			}
			if (data.type !== PAIR) return;
			let res;
			try {
				res = await chrome.runtime.sendMessage({
					action: "PAIR",
					payload: {
						token: data.token,
						expiresAt: data.expiresAt,
						apiUrl: data.apiUrl,
						mailboxes: data.mailboxes,
					},
				});
			} catch {
				res = { ok: false, error: "The extension isn't available. Reload this page and try again." };
			}
			window.postMessage({ type: PAIRED, ok: Boolean(res?.ok), error: res?.error }, location.origin);
		});
		announce();
		return;
	}

	// Never decorate Inboxies itself.
	if (location.hostname === "inboxies.email") return;

	const TEXT_TYPES = new Set(["", "email", "text"]);
	const attached = new Map(); // input -> cleanup()

	// Private emails this site already has. Asked once per page (the background
	// worker caches the list), again after creating one or if asking failed.
	let siteAliasesRequest = null;
	let siteAliasesSite = null;
	function loadSiteAliases() {
		siteAliasesRequest ??= chrome.runtime
			.sendMessage({ action: "SITE_ALIASES" })
			.catch(() => null)
			.then((res) => {
				if (!res?.ok || !Array.isArray(res.aliases)) {
					siteAliasesRequest = null;
					return [];
				}
				siteAliasesSite = res.site || null;
				return res.aliases;
			});
		return siteAliasesRequest;
	}

	function isEmailInput(el) {
		if (!(el instanceof HTMLInputElement)) return false;
		const type = (el.getAttribute("type") || "").toLowerCase();
		if (!TEXT_TYPES.has(type)) return false;
		if (el.disabled || el.readOnly) return false;
		if (type === "email") return true;

		const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
		if (autocomplete.split(/\s+/).includes("email")) return true;
		const hints = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")]
			.map((v) => (v || "").toLowerCase());
		// "email" but not e.g. "email_password" / "email-confirmation-code"
		return hints.some((h) => /(^|[^a-z])e-?mail([^a-z]|$)/.test(h) && !/pass|code|otp/.test(h));
	}

	function setInputValue(input, value) {
		input.focus();
		// Native setter so React/Vue controlled inputs see the change.
		const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		if (nativeSetter) nativeSetter.call(input, value);
		else input.value = value;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function attachPill(input) {
		const host = document.createElement("div");
		host.style.cssText = "position:absolute;z-index:2147483647;display:none;";
		document.documentElement.appendChild(host);

		const shadow = host.attachShadow({ mode: "closed" });
		shadow.innerHTML = `
			<style>
				:host { all: initial; }
				.pill {
					display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px 0 6px;
					border-radius: 9999px; border: 1px solid #e3e2e0; background: #ffffff; color: #37352f;
					font: 500 12px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
					box-shadow: 0 1px 3px rgba(15, 15, 15, 0.12); cursor: pointer; white-space: nowrap;
				}
				.pill:hover { border-color: #2383e2; }
				.pill:focus-visible { outline: 2px solid #2383e2; outline-offset: 2px; }
				.pill[aria-busy="true"] { cursor: progress; opacity: 0.7; }
				.icon { width: 16px; height: 16px; flex-shrink: 0; border-radius: 4px; overflow: hidden; }
				.chevron { display: none; width: 10px; height: 10px; margin-left: -2px; color: #787774; }
				.pill[aria-haspopup] .chevron { display: block; }
				[hidden] { display: none !important; }
				.menu {
					position: absolute; top: 30px; right: 0; min-width: 240px; max-width: 320px; padding: 4px;
					border-radius: 10px; border: 1px solid #e3e2e0; background: #ffffff; color: #37352f;
					font: 400 13px/1.4 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
					box-shadow: 0 8px 24px rgba(15, 15, 15, 0.16), 0 1px 3px rgba(15, 15, 15, 0.08);
				}
				.menu.up { top: auto; bottom: 30px; }
				.menu.left { right: auto; left: 0; }
				.heading { padding: 6px 8px 4px; font-size: 11px; font-weight: 600; color: #787774; }
				.item {
					display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: none;
					color: inherit; font: inherit; text-align: left; cursor: pointer; overflow-wrap: anywhere;
				}
				.item:hover, .item:focus-visible { background: #f1f1ef; outline: none; }
				.item.create { color: #2383e2; font-weight: 500; }
				.sep { height: 1px; margin: 4px 0; background: #e9e9e7; }
				@media (prefers-color-scheme: dark) {
					.pill { background: #252525; color: #e6e6e5; border-color: #3a3a3a; }
					.chevron, .heading { color: #9b9a97; }
					.menu { background: #252525; color: #e6e6e5; border-color: #3a3a3a; }
					.item:hover, .item:focus-visible { background: #2f2f2f; }
					.item.create { color: #529cca; }
					.sep { background: #2f2f2f; }
				}
			</style>
			<button type="button" class="pill" aria-label="Create a private email for this site">
				<svg class="icon" aria-hidden="true" viewBox="0 0 512 512" style="border-radius: 3px; overflow: hidden;">
					<rect width="512" height="512" rx="112" ry="112" fill="#FFFFFF" />
					<rect width="506" height="506" x="3" y="3" rx="109" ry="109" fill="none" stroke="#D1D5DB" stroke-width="6" />
					<path d="M 384.7,107.2 L 398.9,109.1 L 409.2,117.2 L 413.5,128.5 L 412.1,141.7 L 308.2,391.1 L 303.0,400.0 L 294.0,404.8 L 288.8,404.8 L 281.7,401.9 L 228.4,357.5 L 195.3,399.6 L 187.8,403.3 L 177.4,400.5 L 172.2,393.0 L 154.2,289.1 L 102.3,238.1 L 98.5,230.5 L 99.0,221.5 L 104.6,213.5 L 112.7,209.7 L 371.9,111.0 L 384.2,107.7 Z M 404.5,115.7 L 400.7,112.4 L 393.2,109.6 L 380.9,110.1 L 106.5,214.9 L 101.3,221.5 L 101.3,225.8 L 124.9,228.1 L 396.5,122.3 L 404.1,116.2 Z M 407.8,119.5 L 406.4,117.6 L 405.0,118.1 L 397.0,128.0 L 290.7,375.5 L 294.5,401.9 L 299.7,400.0 L 304.9,393.4 L 409.2,143.1 L 411.1,137.0 L 411.1,127.1 L 408.3,120.0 Z M 387.1,129.0 L 388.0,128.5 L 386.6,128.0 L 130.6,227.2 L 244.4,228.1 L 386.6,129.4 Z M 393.2,132.3 L 386.1,137.9 L 272.8,257.9 L 290.2,372.2 L 392.7,132.7 Z M 385.6,133.7 L 385.2,132.7 L 378.6,137.0 L 247.3,228.1 L 245.8,230.0 L 248.2,242.8 L 244.9,231.4 L 240.7,229.6 L 126.8,231.0 L 176.4,274.9 L 177.8,273.9 L 176.9,275.4 L 180.7,300.9 L 184.0,357.5 L 184.0,354.7 L 182.6,354.2 L 176.0,278.2 L 158.5,288.6 L 159.9,285.8 L 174.1,276.8 L 174.1,275.4 L 124.0,230.5 L 100.9,227.7 L 103.2,235.7 L 150.9,281.5 L 156.1,288.1 L 174.1,391.5 L 179.3,399.1 L 183.0,401.0 L 184.0,400.0 L 199.6,332.0 L 214.2,316.9 L 223.2,319.8 L 259.5,354.2 L 278.0,368.9 L 287.9,374.1 L 270.4,259.8 L 230.7,301.8 L 218.0,312.7 L 269.9,257.4 L 269.5,246.6 L 201.0,313.1 L 196.3,321.6 L 193.4,335.8 L 192.5,334.4 L 191.5,349.5 L 191.1,348.1 L 190.1,350.0 L 190.6,343.4 L 195.3,320.2 L 202.4,308.9 L 222.2,289.1 L 341.7,174.3 L 340.3,175.7 L 341.7,176.7 L 271.3,244.7 L 272.3,255.1 L 380.0,141.7 L 379.0,140.8 L 374.3,144.1 L 367.7,152.1 L 363.9,155.4 L 363.0,154.0 L 361.6,155.4 L 385.2,134.2 Z M 236.9,233.3 L 239.2,233.8 L 223.2,245.1 L 200.0,260.7 L 197.2,260.7 L 196.7,263.1 L 195.8,261.7 L 195.8,263.6 L 193.0,263.6 L 236.4,233.8 Z M 271.3,367.5 L 271.3,375.5 L 263.3,383.5 L 282.7,400.0 L 288.4,402.4 L 292.6,401.9 L 288.8,376.9 L 270.9,367.0 Z" fill="#111111" fill-rule="evenodd" />
					<g transform="translate(44, 40) scale(0.40)">
						<path d="M 108,36 C 96,46 62,56 46,60 L 46,122 C 46,162 80,188 108,198 L 108,36 Z" fill="#FFFFFF" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
						<path d="M 108,36 L 108,198 C 136,188 170,162 170,122 L 170,60 C 154,56 120,46 108,36 Z" fill="#111111" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
					</g>
				</svg>
				<span class="label">Private email</span>
				<svg class="chevron" aria-hidden="true" viewBox="0 0 10 10">
					<path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			<div class="menu" role="menu" aria-label="Private emails for this site" hidden>
				<div class="heading"></div>
				<div class="items"></div>
				<div class="sep" role="separator"></div>
				<button type="button" class="item create" role="menuitem">Create new private email</button>
			</div>
		`;
		const btn = shadow.querySelector(".pill");
		const label = shadow.querySelector(".label");
		const menu = shadow.querySelector(".menu");
		const menuHeading = shadow.querySelector(".heading");
		const menuItems = shadow.querySelector(".items");
		const createItem = shadow.querySelector(".create");
		let hideTimer = null;
		let busy = false;

		function position() {
			const rect = input.getBoundingClientRect();
			if (!input.isConnected || rect.width === 0 || rect.height === 0) {
				host.style.display = "none";
				return;
			}
			host.style.display = "block";
			const pillWidth = btn.offsetWidth || 110;
			host.style.top = `${window.scrollY + rect.top + (rect.height - 24) / 2}px`;
			host.style.left = `${window.scrollX + Math.max(rect.left, rect.right - pillWidth - 6)}px`;
		}
		function show() {
			clearTimeout(hideTimer);
			position();
			// Learn whether this site already has private emails before the pill is pressed.
			loadSiteAliases().then((aliases) => setHasMatches(aliases.length > 0));
		}
		const focusInside = () => document.activeElement === input || document.activeElement === host;
		function scheduleHide() {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => {
				if (busy || focusInside()) return;
				closeMenu();
				host.style.display = "none";
			}, 300);
		}
		function reposition() {
			if (host.style.display !== "none") position();
		}
		function setHasMatches(hasMatches) {
			if (hasMatches === btn.hasAttribute("aria-haspopup")) return;
			if (hasMatches) {
				btn.setAttribute("aria-haspopup", "menu");
				btn.setAttribute("aria-expanded", "false");
				btn.setAttribute("aria-label", "Choose a private email for this site");
			} else {
				btn.removeAttribute("aria-haspopup");
				btn.removeAttribute("aria-expanded");
				btn.setAttribute("aria-label", "Create a private email for this site");
			}
			reposition();
		}
		function resetLabel(delay) {
			setTimeout(() => {
				label.textContent = "Private email";
				btn.removeAttribute("aria-busy");
				busy = false;
				scheduleHide();
			}, delay);
		}

		function onOutsidePointer(event) {
			if (!event.composedPath().includes(host)) closeMenu();
		}
		function openMenu(aliases, site, focusFirst) {
			menuHeading.textContent = site ? `Used on ${site}` : "Used on this site";
			menuItems.replaceChildren(
				...aliases.map((alias) => {
					const item = document.createElement("button");
					item.type = "button";
					item.className = "item";
					item.setAttribute("role", "menuitem");
					item.textContent = alias.email;
					item.addEventListener("click", (event) => {
						if (!event.isTrusted) return;
						closeMenu();
						setInputValue(input, alias.email);
						label.textContent = "Filled";
						busy = true;
						resetLabel(1200);
					});
					return item;
				}),
			);
			menu.classList.remove("up", "left");
			menu.hidden = false;
			btn.setAttribute("aria-expanded", "true");
			const rect = menu.getBoundingClientRect();
			if (rect.bottom > window.innerHeight - 8 && rect.height + 40 < host.getBoundingClientRect().top) {
				menu.classList.add("up");
			}
			if (rect.left < 8) menu.classList.add("left");
			document.addEventListener("pointerdown", onOutsidePointer, true);
			if (focusFirst) shadow.querySelector(".item")?.focus();
		}
		function closeMenu() {
			if (menu.hidden) return;
			menu.hidden = true;
			btn.setAttribute("aria-expanded", "false");
			document.removeEventListener("pointerdown", onOutsidePointer, true);
		}
		function onMenuKeydown(event) {
			if (menu.hidden) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				closeMenu();
				input.focus();
				return;
			}
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			event.preventDefault();
			const items = [...shadow.querySelectorAll(".item")];
			const at = items.indexOf(shadow.activeElement);
			const step = event.key === "ArrowDown" ? 1 : -1;
			items[(at + step + items.length) % items.length]?.focus();
		}

		async function createAndFill() {
			busy = true;
			btn.setAttribute("aria-busy", "true");
			label.textContent = "Creating…";
			let res;
			try {
				res = await chrome.runtime.sendMessage({ action: "CREATE_ALIAS", host: location.hostname });
			} catch {
				res = { ok: false, error: "unavailable" };
			}
			if (res?.ok && res.email) {
				siteAliasesRequest = null;
				setInputValue(input, res.email);
				label.textContent = "Filled";
				resetLabel(1200);
			} else {
				label.textContent =
					res?.error === "not_connected" || res?.error === "session_expired"
						? "Connect the extension first"
						: "Couldn't create one";
				resetLabel(2400);
			}
		}

		async function onClick(event) {
			// Pages can't script a closed shadow root, but refuse synthetic clicks anyway.
			if (!event.isTrusted || busy) return;
			event.preventDefault();
			event.stopPropagation();
			if (!menu.hidden) {
				closeMenu();
				return;
			}
			// Addresses this site already has come first; creating another is the last option.
			const aliases = await loadSiteAliases();
			setHasMatches(aliases.length > 0);
			if (aliases.length) openMenu(aliases, siteAliasesSite, event.detail === 0);
			else createAndFill();
		}
		function onCreateItem(event) {
			if (!event.isTrusted || busy) return;
			closeMenu();
			createAndFill();
		}

		input.addEventListener("focus", show);
		input.addEventListener("mouseenter", show);
		input.addEventListener("mouseleave", scheduleHide);
		input.addEventListener("blur", scheduleHide);
		host.addEventListener("mouseenter", show);
		host.addEventListener("mouseleave", scheduleHide);
		host.addEventListener("focusout", scheduleHide);
		btn.addEventListener("click", onClick);
		createItem.addEventListener("click", onCreateItem);
		shadow.addEventListener("keydown", onMenuKeydown);
		window.addEventListener("resize", reposition, { passive: true });
		window.addEventListener("scroll", reposition, { passive: true, capture: true });

		return function cleanup() {
			clearTimeout(hideTimer);
			closeMenu();
			input.removeEventListener("focus", show);
			input.removeEventListener("mouseenter", show);
			input.removeEventListener("mouseleave", scheduleHide);
			input.removeEventListener("blur", scheduleHide);
			window.removeEventListener("resize", reposition);
			window.removeEventListener("scroll", reposition, { capture: true });
			host.remove();
		};
	}

	function scan() {
		for (const [input, cleanup] of attached) {
			if (!input.isConnected || !isEmailInput(input)) {
				cleanup();
				attached.delete(input);
			}
		}
		for (const input of document.querySelectorAll("input")) {
			if (!attached.has(input) && isEmailInput(input)) attached.set(input, attachPill(input));
		}
	}

	let scheduled = false;
	function scheduleScan() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			scan();
		});
	}

	scan();
	new MutationObserver(scheduleScan).observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["type", "disabled", "readonly"],
	});
})();

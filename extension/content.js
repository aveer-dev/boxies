// Boxies Masked Email - Content Script
(function () {
	const PROCESSED_ATTR = "data-boxies-injected";

	function isEmailInput(el) {
		if (!el || el.tagName !== "INPUT") return false;
		if (el.getAttribute(PROCESSED_ATTR)) return false;
		if (el.type === "hidden" || el.type === "submit" || el.type === "button" || el.type === "checkbox" || el.type === "radio") return false;
		if (el.disabled || el.readOnly) return false;

		const type = (el.type || "").toLowerCase();
		if (type === "email") return true;

		const name = (el.name || "").toLowerCase();
		const id = (el.id || "").toLowerCase();
		const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
		const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
		const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();

		return (
			autocomplete.includes("email") ||
			name.includes("email") ||
			id.includes("email") ||
			placeholder.includes("email") ||
			ariaLabel.includes("email")
		);
	}

	function setInputValue(input, value) {
		input.focus();
		// Use native HTMLInputElement prototype setter for React / framework compatibility
		const nativeSetter = Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		)?.set;

		if (nativeSetter) {
			nativeSetter.call(input, value);
		} else {
			input.value = value;
		}

		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		input.blur();
	}

	function attachPill(input) {
		input.setAttribute(PROCESSED_ATTR, "true");

		const host = document.createElement("div");
		host.style.position = "absolute";
		host.style.zIndex = "2147483647";
		host.style.display = "none";
		host.style.pointerEvents = "auto";
		document.body.appendChild(host);

		const shadow = host.attachShadow({ mode: "closed" });
		shadow.innerHTML = `
			<style>
				.boxies-pill {
					display: inline-flex;
					align-items: center;
					gap: 5px;
					background: #0f172a;
					color: #f8fafc;
					border: 1px solid rgba(255, 255, 255, 0.15);
					border-radius: 9999px;
					padding: 3px 8px;
					font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
					font-size: 11px;
					font-weight: 500;
					cursor: pointer;
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
					transition: all 0.15s ease;
					user-select: none;
				}
				.boxies-pill:hover {
					background: #1e293b;
					border-color: #38bdf8;
					transform: translateY(-1px);
				}
				.boxies-icon {
					width: 14px;
					height: 14px;
					flex-shrink: 0;
				}
				.boxies-spinner {
					width: 10px;
					height: 10px;
					border: 2px solid rgba(255, 255, 255, 0.3);
					border-top-color: #38bdf8;
					border-radius: 50%;
					animation: spin 0.6s linear infinite;
				}
				@keyframes spin {
					to { transform: rotate(360deg); }
				}
			</style>
			<button type="button" class="boxies-pill" title="Generate Private Email">
				<svg class="boxies-icon" viewBox="0 0 512 512" style="border-radius: 3px; overflow: hidden;">
					<rect width="512" height="512" rx="112" ry="112" fill="#FFFFFF" />
					<rect width="506" height="506" x="3" y="3" rx="109" ry="109" fill="none" stroke="#D1D5DB" stroke-width="6" />
					<path d="M 384.7,107.2 L 398.9,109.1 L 409.2,117.2 L 413.5,128.5 L 412.1,141.7 L 308.2,391.1 L 303.0,400.0 L 294.0,404.8 L 288.8,404.8 L 281.7,401.9 L 228.4,357.5 L 195.3,399.6 L 187.8,403.3 L 177.4,400.5 L 172.2,393.0 L 154.2,289.1 L 102.3,238.1 L 98.5,230.5 L 99.0,221.5 L 104.6,213.5 L 112.7,209.7 L 371.9,111.0 L 384.2,107.7 Z M 404.5,115.7 L 400.7,112.4 L 393.2,109.6 L 380.9,110.1 L 106.5,214.9 L 101.3,221.5 L 101.3,225.8 L 124.9,228.1 L 396.5,122.3 L 404.1,116.2 Z M 407.8,119.5 L 406.4,117.6 L 405.0,118.1 L 397.0,128.0 L 290.7,375.5 L 294.5,401.9 L 299.7,400.0 L 304.9,393.4 L 409.2,143.1 L 411.1,137.0 L 411.1,127.1 L 408.3,120.0 Z M 387.1,129.0 L 388.0,128.5 L 386.6,128.0 L 130.6,227.2 L 244.4,228.1 L 386.6,129.4 Z M 393.2,132.3 L 386.1,137.9 L 272.8,257.9 L 290.2,372.2 L 392.7,132.7 Z M 385.6,133.7 L 385.2,132.7 L 378.6,137.0 L 247.3,228.1 L 245.8,230.0 L 248.2,242.8 L 244.9,231.4 L 240.7,229.6 L 126.8,231.0 L 176.4,274.9 L 177.8,273.9 L 176.9,275.4 L 180.7,300.9 L 184.0,357.5 L 184.0,354.7 L 182.6,354.2 L 176.0,278.2 L 158.5,288.6 L 159.9,285.8 L 174.1,276.8 L 174.1,275.4 L 124.0,230.5 L 100.9,227.7 L 103.2,235.7 L 150.9,281.5 L 156.1,288.1 L 174.1,391.5 L 179.3,399.1 L 183.0,401.0 L 184.0,400.0 L 199.6,332.0 L 214.2,316.9 L 223.2,319.8 L 259.5,354.2 L 278.0,368.9 L 287.9,374.1 L 270.4,259.8 L 230.7,301.8 L 218.0,312.7 L 269.9,257.4 L 269.5,246.6 L 201.0,313.1 L 196.3,321.6 L 193.4,335.8 L 192.5,334.4 L 191.5,349.5 L 191.1,348.1 L 190.1,350.0 L 190.6,343.4 L 195.3,320.2 L 202.4,308.9 L 222.2,289.1 L 341.7,174.3 L 340.3,175.7 L 341.7,176.7 L 271.3,244.7 L 272.3,255.1 L 380.0,141.7 L 379.0,140.8 L 374.3,144.1 L 367.7,152.1 L 363.9,155.4 L 363.0,154.0 L 361.6,155.4 L 385.2,134.2 Z M 236.9,233.3 L 239.2,233.8 L 223.2,245.1 L 200.0,260.7 L 197.2,260.7 L 196.7,263.1 L 195.8,261.7 L 195.8,263.6 L 193.0,263.6 L 236.4,233.8 Z M 271.3,367.5 L 271.3,375.5 L 263.3,383.5 L 282.7,400.0 L 288.4,402.4 L 292.6,401.9 L 288.8,376.9 L 270.9,367.0 Z" fill="#111111" fill-rule="evenodd" />
					<g transform="translate(44, 40) scale(0.40)">
						<path d="M 108,36 C 96,46 62,56 46,60 L 46,122 C 46,162 80,188 108,198 L 108,36 Z" fill="#FFFFFF" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
						<path d="M 108,36 L 108,198 C 136,188 170,162 170,122 L 170,60 C 154,56 120,46 108,36 Z" fill="#111111" stroke="#111111" stroke-width="16" stroke-linejoin="round" />
					</g>
				</svg>
				<span class="label">Private email</span>
			</button>
		`;

		const btn = shadow.querySelector(".boxies-pill");
		const label = shadow.querySelector(".label");

		function updatePosition() {
			if (!input.offsetParent) {
				host.style.display = "none";
				return;
			}
			const rect = input.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				host.style.display = "none";
				return;
			}
			host.style.display = "block";
			host.style.top = `${window.scrollY + rect.top + (rect.height - 24) / 2}px`;
			host.style.left = `${window.scrollX + rect.right - 92}px`;
		}

		input.addEventListener("focus", updatePosition);
		window.addEventListener("resize", updatePosition, { passive: true });
		window.addEventListener("scroll", updatePosition, { passive: true });

		// Show when input or button is hovered or focused
		let hideTimer = null;
		function show() {
			clearTimeout(hideTimer);
			updatePosition();
		}
		function scheduleHide() {
			hideTimer = setTimeout(() => {
				if (document.activeElement !== input) {
					host.style.display = "none";
				}
			}, 300);
		}

		input.addEventListener("mouseenter", show);
		input.addEventListener("mouseleave", scheduleHide);
		host.addEventListener("mouseenter", show);
		host.addEventListener("mouseleave", scheduleHide);
		input.addEventListener("blur", scheduleHide);

		btn.addEventListener("click", async (e) => {
			e.preventDefault();
			e.stopPropagation();

			label.innerHTML = `<span class="boxies-spinner"></span>`;
			btn.style.pointerEvents = "none";

			try {
				const response = await chrome.runtime.sendMessage({
					action: "GENERATE_ALIAS",
					host: window.location.hostname,
				});

				if (response && response.success && response.email) {
					setInputValue(input, response.email);
					label.textContent = "Done!";
					setTimeout(() => {
						label.textContent = "Hide Email";
						btn.style.pointerEvents = "auto";
						scheduleHide();
					}, 1200);
				} else {
					label.textContent = response?.error === "not_configured" ? "Setup required" : "Failed";
					setTimeout(() => {
						label.textContent = "Hide Email";
						btn.style.pointerEvents = "auto";
					}, 2000);
				}
			} catch (err) {
				label.textContent = "Error";
				setTimeout(() => {
					label.textContent = "Hide Email";
					btn.style.pointerEvents = "auto";
				}, 2000);
			}
		});
	}

	function scanForInputs() {
		const inputs = document.querySelectorAll("input");
		for (const input of inputs) {
			if (isEmailInput(input)) {
				attachPill(input);
			}
		}
	}

	// Initial scan
	scanForInputs();

	// Observe dynamic DOM changes (SPAs, modals, forms)
	const observer = new MutationObserver(() => {
		scanForInputs();
	});
	observer.observe(document.body, { childList: true, subtree: true });
})();

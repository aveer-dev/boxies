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
					width: 12px;
					height: 12px;
					fill: currentColor;
					color: #38bdf8;
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
			<button type="button" class="boxies-pill" title="Generate Boxies Masked Email">
				<svg class="boxies-icon" viewBox="0 0 24 24">
					<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
				</svg>
				<span class="label">Hide Email</span>
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

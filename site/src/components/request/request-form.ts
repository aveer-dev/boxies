// The request form (AVE-81): asks GET /api/requests whether it can send, loads
// Turnstile with the site key it gets back, checks fields with the endpoint's own
// rules (request-rules.ts), posts JSON to /api/requests and shows the outcome in
// place. If the form is offline, it says so and points at email, so nothing is lost.
import { SUPPORT_EMAIL } from "../../config";
import {
	KINDS,
	REQUEST_LIMITS,
	checkField,
	kindInfo,
	type RequestField,
	type RequestFieldError,
	type RequestValues,
} from "./request-rules";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Reply = { ok?: boolean; error?: string; errors?: Partial<Record<RequestField, RequestFieldError>> };

interface Turnstile {
	render(el: HTMLElement, options: Record<string, unknown>): string;
	reset(id?: string): void;
	remove(id?: string): void;
}
declare global {
	interface Window {
		turnstile?: Turnstile;
	}
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Fields with their own control, in form order (kind is the radio group).
const CONTROLS: Exclude<RequestField, "kind">[] = ["title", "platform", "details", "email"];

const form = document.querySelector<HTMLFormElement>("form[data-request]");
const sent = document.querySelector<HTMLElement>("[data-request-sent]");

if (form && sent) {
	const $ = <T extends Element>(selector: string) => form.querySelector<T>(selector)!;
	const controls = Object.fromEntries(CONTROLS.map((f) => [f, form.elements.namedItem(f) as Control])) as Record<(typeof CONTROLS)[number], Control>;
	const kinds = [...form.querySelectorAll<HTMLInputElement>('input[name="kind"]')];
	const website = form.elements.namedItem("website") as HTMLInputElement;
	const status = $<HTMLElement>(".form-status");
	const submit = $<HTMLButtonElement>('button[type="submit"]');
	const platformField = $<HTMLElement>("[data-platform-field]");
	const widget = $<HTMLElement>("[data-turnstile]");
	const counter = $<HTMLElement>(".counter");
	const count = $<HTMLElement>("[data-count]");
	let submitted = false;
	let available = false;
	let token = "";
	let widgetId: string | null = null;
	let shownAt = performance.now();

	const say = (text: string) => (status.textContent = text);
	const kind = () => kinds.find((k) => k.checked)?.value ?? "";

	// ?type=bug (or feature, feedback) picks the kind.
	const wanted = new URLSearchParams(location.search).get("type");
	if (wanted && kindInfo(wanted)) kinds.forEach((k) => (k.checked = k.value === wanted));

	const onKind = () => {
		const info = kindInfo(kind()) ?? KINDS[0];
		(controls.title as HTMLInputElement).placeholder = info.titlePlaceholder;
		(controls.details as HTMLTextAreaElement).placeholder = info.detailsPlaceholder;
		const isBug = info.value === "bug";
		platformField.hidden = !isBug;
		controls.platform.required = isBug;
		if (!isBug) showError("platform", null);
	};
	kinds.forEach((k) => k.addEventListener("change", onKind));

	const updateCount = () => {
		const n = [...controls.details.value].length;
		count.textContent = n.toLocaleString("en-US");
		counter.classList.toggle("is-over", n > REQUEST_LIMITS.detailsMax);
	};
	controls.details.addEventListener("input", updateCount);

	const values = (): RequestValues => ({
		kind: kind(),
		title: controls.title.value.replace(/\s+/g, " ").trim(),
		details: controls.details.value.trim(),
		email: controls.email.value.trim(),
		platform: kind() === "bug" ? controls.platform.value : "",
	});

	const messageFor = (field: RequestField, error: RequestFieldError): string => {
		switch (field) {
			case "kind":
				return "Choose what it is.";
			case "title":
				if (error === "long") return `Keep the title under ${REQUEST_LIMITS.titleMax} characters.`;
				return "Give it a short title.";
			case "details":
				if (error === "long") return `That’s over ${REQUEST_LIMITS.detailsMax.toLocaleString("en-US")} characters. Please shorten it.`;
				return `Add a few more words (at least ${REQUEST_LIMITS.detailsMin} characters).`;
			case "email":
				return "Enter an email address we can reach you at.";
			case "platform":
				return "Choose where it happened.";
		}
	};

	function showError(field: RequestField, error: RequestFieldError | null) {
		if (field === "kind") return; // a radio group with one always checked
		const control = controls[field];
		const slot = document.getElementById(`${control.id}-err`);
		if (error) control.setAttribute("aria-invalid", "true");
		else control.removeAttribute("aria-invalid");
		if (!slot) return;
		slot.textContent = error ? messageFor(field, error) : "";
		slot.hidden = !error;
	}

	const showErrors = (errors: Partial<Record<RequestField, RequestFieldError | null>>) => {
		CONTROLS.forEach((f) => showError(f, errors[f] ?? null));
		return CONTROLS.filter((f) => errors[f]);
	};

	form.addEventListener("focusout", (e) => {
		const name = (e.target as Control).name as RequestField;
		if (submitted && (CONTROLS as string[]).includes(name)) showError(name, checkField(name, values()));
	});

	const ready = () => {
		submit.disabled = !available || !token;
	};

	const offline = () => {
		available = false;
		ready();
		say(`The request form is offline right now. Email ${SUPPORT_EMAIL} instead and we’ll file it for you.`);
	};

	let renderedTheme: "dark" | "light" | null = null;
	const theme = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

	const renderWidget = (siteKey: string) => {
		if (!window.turnstile) return offline();
		widget.replaceChildren();
		renderedTheme = theme();
		widgetId = window.turnstile.render(widget, {
			sitekey: siteKey,
			theme: renderedTheme,
			size: "flexible",
			action: "request",
			callback: (t: string) => {
				token = t;
				ready();
			},
			"expired-callback": () => {
				token = "";
				ready();
			},
			"error-callback": () => {
				token = "";
				ready();
				say("The spam check couldn’t load. Reload the page to try again.");
				return true;
			},
		});
	};

	const loadTurnstile = (siteKey: string) => {
		if (window.turnstile) return renderWidget(siteKey);
		const script = document.createElement("script");
		script.src = TURNSTILE_SRC;
		script.async = true;
		script.addEventListener("load", () => renderWidget(siteKey));
		script.addEventListener("error", offline);
		document.head.appendChild(script);
	};

	// The widget doesn't follow a theme switch by itself; draw it again in the new one.
	let siteKeyInUse: string | null = null;
	window.addEventListener("theme-change", () => {
		if (!siteKeyInUse || !window.turnstile || !widgetId || theme() === renderedTheme) return;
		window.turnstile.remove(widgetId);
		token = "";
		ready();
		renderWidget(siteKeyInUse);
	});

	fetch("/api/requests", { headers: { accept: "application/json" } })
		.then((res) => res.json() as Promise<{ available?: boolean; siteKey?: string | null }>)
		.then((info) => {
			if (!info.available || !info.siteKey) return offline();
			available = true;
			siteKeyInUse = info.siteKey;
			loadTurnstile(info.siteKey);
		})
		.catch(offline);

	const busy = (on: boolean) => {
		submit.disabled = on || !available || !token;
		submit.textContent = on ? "Sending…" : "Send request";
		if (on) submit.setAttribute("aria-busy", "true");
		else submit.removeAttribute("aria-busy");
	};

	const freshCheck = () => {
		token = "";
		ready();
		if (window.turnstile && widgetId) window.turnstile.reset(widgetId);
	};

	const showSent = (email: string) => {
		sent.querySelector("[data-sent-email]")!.textContent = email;
		sent.querySelector("[data-sent-noun]")!.textContent = kindInfo(kind())?.noun ?? "request";
		form.hidden = true;
		sent.hidden = false;
		sent.setAttribute("data-reveal", "");
		sent.focus();
	};

	sent.querySelector("[data-send-another]")?.addEventListener("click", () => {
		form.reset();
		submitted = false;
		showErrors({});
		say("");
		onKind();
		updateCount();
		freshCheck();
		shownAt = performance.now();
		sent.hidden = true;
		form.hidden = false;
		controls.title.focus();
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (submit.disabled) return;
		submitted = true;
		say("");

		const data = values();
		const invalid = showErrors(Object.fromEntries(CONTROLS.map((f) => [f, checkField(f, data)])));
		if (invalid.length) {
			controls[invalid[0]].focus();
			return;
		}

		busy(true);
		let res: Response | null = null;
		let body: Reply | null = null;
		try {
			res = await fetch("/api/requests", {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify({ ...data, website: website.value, t: Math.round(performance.now() - shownAt), token }),
			});
			body = (await res.json().catch(() => null)) as Reply | null;
		} catch {
			res = null;
		}
		busy(false);

		if (res?.ok && body?.ok) return showSent(data.email);

		// A Turnstile token is good for one check, so every other outcome needs a new one.
		freshCheck();

		if (res?.status === 400 && body?.errors && Object.keys(body.errors).length) {
			const invalid = showErrors(body.errors);
			if (invalid.length) return controls[invalid[0]].focus();
		}

		submit.focus();
		if (res?.status === 400 && body?.error === "turnstile") {
			say("The spam check didn’t go through. Wait for it to finish, then send again.");
		} else if (res?.status === 429) {
			say("That’s a few requests in a row. Try again in a minute.");
		} else if (res?.status === 503) {
			offline();
		} else {
			say(`That didn’t send. Try again, or email ${SUPPORT_EMAIL}.`);
		}
	});

	onKind();
	updateCount();
	ready();
}

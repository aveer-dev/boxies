// The contact form, with JS: checks fields before sending, posts JSON to
// /api/contact and shows the outcome in place. If the form can't send, the
// message goes into a ready-made email instead, so nothing typed is lost.
// Without JS the form posts itself and the endpoint redirects to a result page.
import { EMAIL_RE, LIMITS, type FieldError, type FieldName } from "./contact-rules";
import { copyText, flashCopied } from "./copy";

const SUPPORT = "support@inboxies.email";
const FIELDS: FieldName[] = ["email", "name", "topic", "mailbox", "message"];

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
// What /api/contact answers with JSON.
type Reply = { ok?: boolean; fallback?: string; errors?: Partial<Record<FieldName, FieldError>> };

const form = document.querySelector<HTMLFormElement>("form[data-contact]");
const sent = document.querySelector<HTMLElement>("[data-contact-sent]");

if (form && sent) {
	const $ = <T extends Element>(selector: string) => form.querySelector<T>(selector)!;
	const controls = Object.fromEntries(FIELDS.map((f) => [f, form.elements.namedItem(f) as Control])) as Record<FieldName, Control>;
	const website = form.elements.namedItem("website") as HTMLInputElement;
	const status = $<HTMLElement>(".form-status");
	const fallback = $<HTMLElement>("[data-fallback]");
	const mailtoLink = $<HTMLAnchorElement>("[data-mailto]");
	const copyButton = $<HTMLButtonElement>("[data-copy-message]");
	const submit = $<HTMLButtonElement>('button[type="submit"]');
	const counter = $<HTMLElement>(".counter");
	const count = $<HTMLElement>("[data-count]");
	const topic = controls.topic as HTMLSelectElement;
	let submitted = false;
	// When the form appeared, on this page's own clock. The endpoint gets the time
	// since then, so a device clock that's off can't make a person look like a bot.
	let shownAt = performance.now();

	// The browser's own checks are for the no-JS form; with JS the messages below replace them.
	form.noValidate = true;

	// ?topic=security picks the topic, if it's one of ours.
	const wanted = new URLSearchParams(location.search).get("topic");
	if (wanted && [...topic.options].some((o) => o.value === wanted && !o.disabled)) topic.value = wanted;

	const updateCount = () => {
		const n = controls.message.value.length;
		count.textContent = String(n);
		counter.classList.toggle("is-over", n > LIMITS.messageMax);
	};
	controls.message.addEventListener("input", updateCount);
	updateCount();

	const values = () => ({
		email: controls.email.value.trim(),
		name: controls.name.value.trim(),
		topic: topic.value,
		mailbox: controls.mailbox.value.trim(),
		message: controls.message.value.trim(),
		website: website.value,
		t: Math.round(performance.now() - shownAt),
	});

	// The same rules as the endpoint (contact-rules.ts).
	const check = (field: FieldName): FieldError | null => {
		const v = values()[field];
		switch (field) {
			case "email":
				return !v ? "required" : v.length > LIMITS.email ? "long" : EMAIL_RE.test(v) ? null : "format";
			case "name":
				return v.length > LIMITS.name ? "long" : null;
			case "topic":
				return v ? null : "required";
			case "mailbox":
				return !v ? null : v.length > LIMITS.email || !EMAIL_RE.test(v) ? "format" : null;
			case "message":
				return v.length > LIMITS.messageMax ? "long" : v.length < LIMITS.messageMin ? "short" : null;
		}
	};

	const messageFor = (field: FieldName, error: FieldError): string => {
		switch (field) {
			case "email":
				return "Enter an email address we can reply to.";
			case "topic":
				return "Choose a topic.";
			case "mailbox":
				return "That doesn’t look like an email address.";
			case "name":
				return "That’s over 100 characters. Please shorten it.";
			case "message":
				return error === "long" ? "That’s over 5,000 characters. Please shorten it." : "Add a few more words (at least 10 characters).";
		}
	};

	const showError = (field: FieldName, error: FieldError | null) => {
		const control = controls[field];
		const slot = document.getElementById(`${control.id}-err`);
		if (error) control.setAttribute("aria-invalid", "true");
		else control.removeAttribute("aria-invalid");
		if (!slot) return;
		slot.textContent = error ? messageFor(field, error) : "";
		slot.hidden = !error;
	};

	// Show every error, and return the fields that have one, in form order.
	const showErrors = (errors: Partial<Record<FieldName, FieldError | null>>) => {
		FIELDS.forEach((f) => showError(f, errors[f] ?? null));
		return FIELDS.filter((f) => errors[f]);
	};

	// After the first attempt, a field re-checks itself as the visitor leaves it.
	form.addEventListener("focusout", (e) => {
		const name = (e.target as Control).name as FieldName;
		if (submitted && FIELDS.includes(name)) showError(name, check(name));
	});

	const say = (text: string) => (status.textContent = text);

	const clearOutcome = () => {
		say("");
		fallback.hidden = true;
	};

	const mailto = (d: ReturnType<typeof values>) => {
		const label = topic.selectedOptions[0]?.value ? topic.selectedOptions[0].text : "Support";
		const tail = d.mailbox ? `\n\nInboxies address: ${d.mailbox}` : "";
		// Long mailto links get cut off by some mail apps; 1,800 characters gets through.
		// A cut through an emoji leaves half of it, which encodeURIComponent throws on, so that half goes too.
		const body = d.message.slice(0, Math.max(0, 1800 - tail.length)).replace(/[\uD800-\uDBFF]$/, "") + tail;
		return `mailto:${SUPPORT}?subject=${encodeURIComponent(`[${label}] Inboxies support`)}&body=${encodeURIComponent(body)}`;
	};

	const offer = (d: ReturnType<typeof values>, withCopy: boolean) => {
		mailtoLink.href = mailto(d);
		copyButton.hidden = !withCopy;
		fallback.hidden = false;
	};

	copyButton.addEventListener("click", async () => {
		if (await copyText(controls.message.value.trim())) flashCopied(copyButton);
	});

	const busy = (on: boolean) => {
		submit.disabled = on;
		submit.textContent = on ? "Sending…" : "Send message";
		if (on) submit.setAttribute("aria-busy", "true");
		else submit.removeAttribute("aria-busy");
	};

	const showSent = (email: string) => {
		sent.querySelector("[data-sent-email]")!.textContent = email;
		form.hidden = true;
		sent.hidden = false;
		sent.setAttribute("data-reveal", "");
		sent.focus();
	};

	sent.querySelector("[data-send-another]")?.addEventListener("click", () => {
		form.reset();
		submitted = false;
		showErrors({});
		clearOutcome();
		updateCount();
		shownAt = performance.now();
		sent.hidden = true;
		form.hidden = false;
		controls.email.focus();
	});

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		if (submit.disabled) return;
		submitted = true;
		clearOutcome();

		const invalid = showErrors(Object.fromEntries(FIELDS.map((f) => [f, check(f)])));
		if (invalid.length) {
			controls[invalid[0]].focus();
			return;
		}

		const data = values();
		busy(true);
		let res: Response | null = null;
		let body: Reply | null = null;
		try {
			res = await fetch("/api/contact", {
				method: "POST",
				headers: { "content-type": "application/json", accept: "application/json" },
				body: JSON.stringify(data),
			});
			body = (await res.json().catch(() => null)) as Reply | null;
		} catch {
			res = null;
		}
		busy(false);

		if (res?.ok && body?.ok) return showSent(data.email);

		if (res?.status === 400 && body?.errors) {
			const invalid = showErrors(body.errors);
			if (invalid.length) return controls[invalid[0]].focus();
		}

		// The button was disabled while sending, which drops focus; put it back.
		submit.focus();

		if (res?.status === 429) {
			say(`Too many messages in a row. Try again in a minute, or email ${SUPPORT}.`);
		} else if (res?.status === 503 && body?.fallback === "mailto") {
			say("Our form is offline right now, so your message is ready to send from your own email app.");
			offer(data, true);
		} else {
			// Offline, or something else went wrong: keep the message safe on the clipboard.
			const copied = await copyText(data.message);
			say(copied ? `That didn’t send. Email ${SUPPORT} instead; your message is copied.` : `That didn’t send. Email ${SUPPORT} instead.`);
			offer(data, !copied);
		}
	});
}

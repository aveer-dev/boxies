// POST /api/contact: the support form, sent to support@inboxies.email through
// the SUPPORT_INBOX send_email binding (§4.4). The only route that isn't
// prerendered.
//
// The page's script posts JSON and reads JSON back. Without JS the browser
// posts the form itself, so every outcome becomes a 303 to a result page
// instead. Nothing is stored, and the logs never hold what someone wrote.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";
import { EMAIL_RE, LIMITS, type FieldError, type FieldName } from "../../components/support/contact-rules";
import { CONTACT_TOPICS, topicLabel } from "../../components/support/contact-topics";

export const prerender = false;

const FROM = "site@inboxies.co";
const TO = "support@inboxies.email";
// Sized for the no-JS form, which percent-encodes every byte: 5,000 characters
// of Chinese or emoji come to about 60 KB. The per-field limits keep the mail small.
const MAX_BYTES = 65536;

type Outcome = "sent" | "honeypot" | "too_fast" | "too_large" | "origin" | "invalid" | "rate" | "unconfigured" | "send_failed";

interface Fields {
	email: string;
	name: string;
	topic: string;
	mailbox: string;
	message: string;
	website: string;
	t: number;
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
	});

// One line per request: the outcome and topic, never what anyone wrote. A failed
// send adds the binding's error, which names our addresses, not theirs.
const log = (outcome: Outcome, topic: string | null, error?: string) =>
	console.log(JSON.stringify({ event: "contact", outcome, topic, ...(error ? { error } : {}) }));

// Anything but POST.
export const ALL: APIRoute = () => json(405, { ok: false, error: "method" }, { allow: "POST" });

export const POST: APIRoute = async ({ request }) => {
	const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;

	// JSON for the script; for a plain form post, a 303 to the page that says what happened.
	// Bots get the same "sent" as people, so they learn nothing.
	const respond = (outcome: Outcome, status: number, body: Record<string, unknown>, topic: string | null = null, error?: string) => {
		log(outcome, topic, error);
		if (wantsJson) return json(status, body);
		const page = status === 200 ? "/support/sent" : "/support/unavailable";
		return new Response(null, { status: 303, headers: { location: new URL(page, request.url).href, "cache-control": "no-store" } });
	};

	if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
		return respond("too_large", 413, { ok: false, error: "too_large" });
	}

	const origin = request.headers.get("origin");
	if (origin && hostOf(origin) !== new URL(request.url).host) {
		return respond("origin", 403, { ok: false, error: "origin" });
	}

	// A chunked post has no content-length, so the bytes are counted as they arrive.
	const raw = await readCapped(request, MAX_BYTES);
	if (!raw) return respond("too_large", 413, { ok: false, error: "too_large" });

	const contentType = request.headers.get("content-type") ?? "";
	const fields = await parse(raw, contentType);
	if (!fields) return respond("invalid", 400, { ok: false, error: "invalid", errors: {} });

	// Honeypot and time trap: pretend it worked, send nothing. The page's script
	// sends `t`, how long the form was open (ms, on the visitor's own clock), so
	// JSON without a real `t` didn't come from us. A plain form post has no `t`.
	if (fields.website) return respond("honeypot", 200, { ok: true });
	if (contentType.includes("application/json") && !(fields.t >= LIMITS.minFillTime)) {
		return respond("too_fast", 200, { ok: true });
	}

	const errors = validate(fields);
	const topic = topicLabel(fields.topic) ? fields.topic : null;
	if (Object.keys(errors).length) return respond("invalid", 400, { ok: false, error: "invalid", errors }, topic);

	if (env.CONTACT_RATE) {
		const { success } = await env.CONTACT_RATE.limit({ key: rateKey(request.headers.get("cf-connecting-ip")) });
		if (!success) return respond("rate", 429, { ok: false, error: "rate" }, topic);
	}

	// Until Email Routing is set up for the binding, the page hands the visitor a mailto instead.
	const unavailable = { ok: false, error: "unavailable", fallback: "mailto", to: TO };
	if (!env.SUPPORT_INBOX) return respond("unconfigured", 503, unavailable, topic);

	try {
		const mime = buildMime(fields, request);
		await env.SUPPORT_INBOX.send(new EmailMessage(FROM, TO, mime));
	} catch (err) {
		return respond("send_failed", 503, unavailable, topic, String(err).slice(0, 200));
	}

	return respond("sent", 200, { ok: true }, topic);
};

// The body, or null once it runs past `limit`. Stops reading there, so an
// oversized post is never held in memory.
async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

// Who the rate limit counts. An IPv6 visitor holds a whole /64 and can rotate
// through it, so the key is that prefix; IPv4 (and IPv4-mapped) as is.
function rateKey(ip: string | null): string {
	if (!ip) return "anon";
	if (!ip.includes(":") || ip.includes(".")) return ip;
	const [head, tail] = ip.toLowerCase().split("::");
	const groups = head ? head.split(":") : [];
	if (tail !== undefined) {
		const rest = tail ? tail.split(":") : [];
		groups.push(...Array<string>(Math.max(0, 8 - groups.length - rest.length)).fill("0"), ...rest);
	}
	return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

// JSON from the page's script; urlencoded or multipart from a plain form post.
async function parse(raw: Uint8Array<ArrayBuffer>, contentType: string): Promise<Fields | null> {
	let get: (key: string) => unknown;
	try {
		if (contentType.includes("application/json")) {
			const data: unknown = JSON.parse(new TextDecoder().decode(raw));
			if (!data || typeof data !== "object" || Array.isArray(data)) return null;
			get = (key) => (data as Record<string, unknown>)[key];
		} else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
			const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
			get = (key) => form.get(key);
		} else {
			return null;
		}
	} catch {
		return null;
	}

	const text = (key: string) => {
		const v = get(key);
		return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
	};
	// Fields that end up in mail headers or one-line labels can't carry line breaks.
	const line = (key: string) => text(key).replace(/[\r\n]+/g, "");

	return {
		email: line("email"),
		name: line("name"),
		topic: line("topic"),
		mailbox: line("mailbox"),
		message: text("message").replace(/\r\n?/g, "\n"),
		website: text("website"),
		t: Number(text("t")) || 0,
	};
}

function validate(f: Fields): Partial<Record<FieldName, FieldError>> {
	const errors: Partial<Record<FieldName, FieldError>> = {};

	if (!f.email) errors.email = "required";
	else if (f.email.length > LIMITS.email) errors.email = "long";
	else if (!EMAIL_RE.test(f.email)) errors.email = "format";

	if (f.name.length > LIMITS.name) errors.name = "long";

	if (!f.topic) errors.topic = "required";
	else if (!CONTACT_TOPICS.some((t) => t.value === f.topic)) errors.topic = "format";

	if (f.mailbox) {
		if (f.mailbox.length > LIMITS.email) errors.mailbox = "long";
		else if (!EMAIL_RE.test(f.mailbox)) errors.mailbox = "format";
	}

	if (!f.message) errors.message = "required";
	else if (f.message.length < LIMITS.messageMin) errors.message = "short";
	else if (f.message.length > LIMITS.messageMax) errors.message = "long";

	return errors;
}

// A plain-text email, built by hand (no dependency). The subject and body are
// UTF-8 in base64, so nothing a visitor types can reach the headers.
function buildMime(f: Fields, request: Request): string {
	const label = topicLabel(f.topic) ?? "Something else";
	const firstLine = f.message.split("\n").find((l) => l.trim())?.trim() ?? "";

	const body = [
		`Topic: ${label}`,
		`From: ${f.name || "(no name)"} <${f.email}>`,
		`Inboxies address: ${f.mailbox || "(not given)"}`,
		`Page: ${refererPath(request) ?? "/support"}`,
		`User agent: ${(request.headers.get("user-agent") ?? "(unknown)").slice(0, 300)}`,
		"",
		f.message,
	].join("\n");

	const headers = [
		`From: Inboxies site <${FROM}>`,
		`To: ${TO}`,
		`Reply-To: ${f.email}`,
		// By code point, so an emoji is never cut in half.
		`Subject: ${encodeWords(`[inboxies.co] ${label}: ${[...firstLine].slice(0, 60).join("")}`)}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@inboxies.co>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: base64",
	];

	// Mail wants CRLF everywhere, in the text as well as between headers.
	const encoded = base64(body.replace(/\n/g, "\r\n")).replace(/.{76}(?=.)/g, "$&\r\n");
	return `${headers.join("\r\n")}\r\n\r\n${encoded}\r\n`;
}

function refererPath(request: Request): string | null {
	const ref = request.headers.get("referer");
	if (!ref) return null;
	try {
		return new URL(ref).pathname;
	} catch {
		return null;
	}
}

function base64(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let binary = "";
	// In chunks: spreading a long message into one call overflows the argument limit.
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

// RFC 2047 encoded-words: an encoded word may be at most 75 characters, so a
// long subject is split (never inside a character) and folded onto new lines.
// 36 bytes per word keeps every header line under 78 columns.
function encodeWords(s: string): string {
	const words: string[] = [];
	let chunk = "";
	for (const ch of s) {
		if (new TextEncoder().encode(chunk + ch).length > 36) {
			words.push(chunk);
			chunk = "";
		}
		chunk += ch;
	}
	if (chunk) words.push(chunk);
	return words.map((w) => `=?UTF-8?B?${base64(w)}?=`).join("\r\n ");
}

// POST /api/requests (AVE-81): a feature request, bug report or piece of feedback
// from inboxies.co/request becomes a Linear issue in the AVE team's Triage, labelled
// `user-request` plus `feature`, `bug` or `feedback`. src/pages/api/requests.ts wires
// the Worker's env into handleRequestPost; everything else lives here, with its
// dependencies handed in, so test/requests.test.mjs covers it in node.
//
// The submitter's email never goes into the issue's title or description. It's kept
// on a Linear attachment ("Requester", url REQUESTER_URL?ref=…, metadata.requesterEmail),
// which /api/roadmap never reads, so a later status email can find it. The roadmap
// also only reads issues labelled `public-roadmap`, so requests stay off it until
// someone labels one by hand. The details are quoted in the description, so a
// submitter can't plant a "Public summary" section for the roadmap to pick up.
//
// Order of checks: configured → size and origin → shape → honeypot and time trap →
// field rules → per-IP rate limit → Turnstile → Linear. Logs carry the outcome and
// kind only, never what anyone wrote, their address or a key.
import {
	REQUEST_LABEL,
	REQUEST_LIMITS,
	checkAll,
	kindInfo,
	platformLabel,
	type RequestField,
	type RequestFieldError,
	type RequestKind,
} from "../components/request/request-rules.ts";
import { hostOf, rateKey, readCapped } from "./http.ts";

export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const DEFAULT_TEAM_KEY = "AVE";
/** The Requester attachment's url, plus ?ref=<request id>. The status-email job finds requests by this prefix. */
export const REQUESTER_URL = "https://inboxies.co/request";
/** Confirmation emails go out from here (the REQUEST_MAIL binding allows only this sender). */
export const CONFIRMATION_FROM = "support@inboxies.email";

// 4,000 characters of details at up to 4 bytes each, plus the rest, with room to spare.
export const MAX_BYTES = 32768;
const FETCH_TIMEOUT_MS = 8000;
const TURNSTILE_TOKEN_MAX = 2048;
// Team, Triage state and label ids barely change; look them up once an hour per isolate.
const TARGET_TTL_MS = 60 * 60 * 1000;

const TITLE_PREFIX: Record<RequestKind, string> = { feature: "Feature request", bug: "Bug", feedback: "Feedback" };

export type RequestOutcome =
	| "created"
	| "honeypot"
	| "too_fast"
	| "too_large"
	| "origin"
	| "invalid"
	| "rate"
	| "turnstile"
	| "turnstile_error"
	| "unconfigured"
	| "linear_failed";

/** What the Worker hands in. Every binding and secret is optional: missing ones mean "unavailable", not a crash. */
export interface RequestDeps {
	linearKey?: string;
	turnstileSecret?: string;
	turnstileSiteKey?: string;
	teamKey?: string;
	rateLimit?: { limit(options: { key: string }): Promise<{ success: boolean }> };
	mailer?: { send(message: { from: string | { email: string; name: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
	fetch: typeof fetch;
	waitUntil: (promise: Promise<unknown>) => void;
	log?: (line: string) => void;
}

export interface RequestFields {
	kind: string;
	title: string;
	details: string;
	email: string;
	platform: string;
	website: string;
	t: number;
	token: string;
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
	});

export const isConfigured = (deps: Pick<RequestDeps, "linearKey" | "turnstileSecret" | "turnstileSiteKey">): boolean =>
	!!(deps.linearKey?.trim() && deps.turnstileSecret?.trim() && deps.turnstileSiteKey?.trim());

/** GET /api/requests: whether the form can send, and the Turnstile site key it needs (public by design). */
export function handleRequestInfo(deps: Pick<RequestDeps, "linearKey" | "turnstileSecret" | "turnstileSiteKey">): Response {
	const available = isConfigured(deps);
	return json(200, { available, siteKey: available ? deps.turnstileSiteKey!.trim() : null });
}

export const methodNotAllowed = () => json(405, { ok: false, error: "method" }, { allow: "GET, POST" });

export async function handleRequestPost(request: Request, deps: RequestDeps): Promise<Response> {
	const log = deps.log ?? ((line: string) => console.log(line));
	const respond = (outcome: RequestOutcome, status: number, body: Record<string, unknown>, kind: string | null = null, extra: Record<string, unknown> = {}) => {
		log(JSON.stringify({ event: "request", outcome, kind, ...extra }));
		return json(status, body);
	};
	const unavailable = { ok: false, error: "unavailable" };

	if (!isConfigured(deps)) return respond("unconfigured", 503, unavailable);

	if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return respond("too_large", 413, { ok: false, error: "too_large" });

	const origin = request.headers.get("origin");
	if (origin && hostOf(origin) !== new URL(request.url).host) return respond("origin", 403, { ok: false, error: "origin" });

	const raw = await readCapped(request, MAX_BYTES);
	if (!raw) return respond("too_large", 413, { ok: false, error: "too_large" });

	// The form needs JS for Turnstile, so it always posts JSON.
	if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
		return respond("invalid", 415, { ok: false, error: "invalid", errors: {} });
	}
	const fields = parseFields(raw);
	if (!fields) return respond("invalid", 400, { ok: false, error: "invalid", errors: {} });

	// Honeypot and time trap: pretend it worked, file nothing. `t` is how long the
	// form was open (ms, on the visitor's own clock).
	if (fields.website) return respond("honeypot", 200, { ok: true });
	if (!(fields.t >= REQUEST_LIMITS.minFillTime)) return respond("too_fast", 200, { ok: true });

	const errors = checkAll(fields);
	const kind = kindInfo(fields.kind) ? (fields.kind as RequestKind) : null;
	if (Object.keys(errors).length) return respond("invalid", 400, { ok: false, error: "invalid", errors }, kind);

	const ip = request.headers.get("cf-connecting-ip");
	if (deps.rateLimit) {
		const { success } = await deps.rateLimit.limit({ key: rateKey(ip) });
		if (!success) return respond("rate", 429, { ok: false, error: "rate" }, kind);
	}

	const verdict = await verifyTurnstile(deps.fetch, deps.turnstileSecret!.trim(), fields.token, ip);
	if (verdict === "failed") return respond("turnstile", 400, { ok: false, error: "turnstile" }, kind);
	if (verdict === "error") return respond("turnstile_error", 503, unavailable, kind);

	const requestId = crypto.randomUUID();
	let issue: { id: string; identifier: string };
	try {
		const target = await resolveTarget(deps.fetch, deps.linearKey!.trim(), (deps.teamKey?.trim() || DEFAULT_TEAM_KEY).toUpperCase(), log);
		issue = await createIssue(deps.fetch, deps.linearKey!.trim(), target, fields, request.headers.get("user-agent"));
	} catch (err) {
		return respond("linear_failed", 503, unavailable, kind, { reason: reason(err) });
	}

	// The issue is filed; the attachment and the email are follow-ups, so neither
	// failing undoes it. A failed attachment is logged with the issue's identifier
	// (never the address), and the request still answers OK.
	let attached = true;
	try {
		await attachRequester(deps.fetch, deps.linearKey!.trim(), issue.id, fields, requestId);
	} catch (err) {
		attached = false;
		log(JSON.stringify({ event: "request", outcome: "attachment_failed", kind, issue: issue.identifier, reason: reason(err) }));
	}

	if (deps.mailer) {
		deps.waitUntil(
			deps.mailer
				.send(confirmationEmail(fields))
				.then(() => log(JSON.stringify({ event: "request", outcome: "confirmation_sent", kind, issue: issue.identifier })))
				.catch((err: unknown) =>
					log(JSON.stringify({ event: "request", outcome: "confirmation_failed", kind, issue: issue.identifier, reason: reason(err) })),
				),
		);
	}

	return respond("created", 200, { ok: true }, kind, { issue: issue.identifier, attached, confirmation: !!deps.mailer });
}

// Only our own error text: Linear's and Turnstile's messages can quote the account or the query.
const reason = (err: unknown) => (err instanceof Error ? err.message.slice(0, 100) : "unknown");

/** The JSON body as trimmed, single-purpose strings; null when it isn't an object. */
export function parseFields(raw: Uint8Array): RequestFields | null {
	let data: unknown;
	try {
		data = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return null;
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const get = (key: string) => {
		const v = (data as Record<string, unknown>)[key];
		return typeof v === "string" || typeof v === "number" ? String(v) : "";
	};
	return {
		kind: oneLine(get("kind")),
		title: oneLine(get("title")),
		details: get("details")
			.replace(/\r\n?/g, "\n")
			// Control and bidi-override characters go; line breaks and tabs stay.
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "")
			.trim(),
		email: oneLine(get("email")),
		platform: oneLine(get("platform")),
		website: get("website").trim(),
		t: Number(get("t")) || 0,
		token: get("token").trim(),
	};
}

/** One line: no control or bidi-override characters, whitespace runs collapsed. */
function oneLine(s: string): string {
	return s
		.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** "ok", "failed" (a bad, used or missing token) or "error" (siteverify itself failed). */
export async function verifyTurnstile(fetcher: typeof fetch, secret: string, token: string, ip: string | null): Promise<"ok" | "failed" | "error"> {
	if (!token || token.length > TURNSTILE_TOKEN_MAX) return "failed";
	const body = new URLSearchParams({ secret, response: token });
	if (ip) body.set("remoteip", ip);
	let res: Response;
	try {
		res = await fetcher(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	} catch {
		return "error";
	}
	if (!res.ok) {
		await res.body?.cancel();
		return "error";
	}
	const result = (await res.json().catch(() => null)) as { success?: unknown; "error-codes"?: unknown } | null;
	if (!result || typeof result !== "object") return "error";
	if (result.success === true) return "ok";
	// Our own misconfiguration isn't the visitor's fault.
	const codes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
	if (codes.some((c) => c === "missing-input-secret" || c === "invalid-input-secret" || c === "internal-error")) return "error";
	return "failed";
}

// ── Linear ──

export interface LinearTarget {
	teamId: string;
	/** The team's Triage state, or null when the team has Triage off (the issue then lands in the default state). */
	stateId: string | null;
	/** Lowercased label name → id, for the labels that exist or could be created. */
	labelIds: Record<string, string>;
}

// Shared config, not request state: the same for every request this isolate serves.
let targetCache: { teamKey: string; target: LinearTarget; at: number } | null = null;

/** For tests. */
export function resetTargetCache(): void {
	targetCache = null;
}

const LABEL_NAMES = [REQUEST_LABEL, "feature", "bug", "feedback"];

const TARGET_QUERY = `query RequestTarget($teamKey: String!, $labels: IssueLabelFilter!) {
  teams(filter: { key: { eq: $teamKey } }) {
    nodes { id states(filter: { type: { eq: "triage" } }) { nodes { id } } }
  }
  issueLabels(filter: $labels, first: 100) { nodes { id name team { id } } }
}`;

const LABEL_CREATE = `mutation CreateRequestLabel($input: IssueLabelCreateInput!) {
  issueLabelCreate(input: $input) { success issueLabel { id name } }
}`;

export const ISSUE_CREATE = `mutation CreateRequest($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier } }
}`;

export const ATTACHMENT_CREATE = `mutation AttachRequester($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) { success }
}`;

async function linear(fetcher: typeof fetch, key: string, query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await fetcher(LINEAR_GRAPHQL_URL, {
		method: "POST",
		// A personal API key goes in as is; Linear only wants "Bearer" for OAuth tokens.
		headers: { authorization: key, "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		await res.body?.cancel();
		throw new Error(`linear: http ${res.status}`);
	}
	const body = (await res.json().catch(() => null)) as { data?: unknown; errors?: unknown } | null;
	if (!body || typeof body !== "object") throw new Error("linear: not an object");
	if (Array.isArray(body.errors) && body.errors.length) throw new Error("linear: graphql errors");
	if (!isObject(body.data)) throw new Error("linear: unexpected shape");
	return body.data;
}

/**
 * The team, its Triage state and the four label ids. A label is looked up by name
 * (any case), the team's own winning over a workspace one; a missing label is
 * created on the team. If that fails (the key may not be allowed to), the issue
 * goes out without it and the log says which.
 */
export async function resolveTarget(fetcher: typeof fetch, key: string, teamKey: string, log: (line: string) => void): Promise<LinearTarget> {
	if (targetCache && targetCache.teamKey === teamKey && Date.now() - targetCache.at < TARGET_TTL_MS) return targetCache.target;

	const data = await linear(fetcher, key, TARGET_QUERY, {
		teamKey,
		labels: { or: LABEL_NAMES.map((name) => ({ name: { eqIgnoreCase: name } })) },
	});
	const team = nodes(data.teams)[0];
	if (!team || typeof team.id !== "string") throw new Error("linear: team not found");
	const teamId = team.id;
	const triage = nodes(team.states)[0];
	const stateId = triage && typeof triage.id === "string" ? triage.id : null;

	const labelIds: Record<string, string> = {};
	const fromTeam = new Set<string>();
	for (const label of nodes(data.issueLabels)) {
		if (typeof label.id !== "string" || typeof label.name !== "string") continue;
		const name = label.name.toLowerCase();
		const labelTeam = isObject(label.team) ? label.team.id : null;
		if (labelTeam && labelTeam !== teamId) continue; // another team's label can't go on this team's issue
		if (fromTeam.has(name)) continue;
		labelIds[name] = label.id;
		if (labelTeam) fromTeam.add(name);
	}

	let complete = true;
	for (const name of LABEL_NAMES) {
		if (labelIds[name]) continue;
		try {
			const created = await linear(fetcher, key, LABEL_CREATE, { input: { name, teamId } });
			const result = isObject(created.issueLabelCreate) ? created.issueLabelCreate : null;
			const label = result && isObject(result.issueLabel) ? result.issueLabel : null;
			if (result?.success === true && label && typeof label.id === "string") labelIds[name] = label.id;
			else throw new Error("linear: label not created");
		} catch (err) {
			complete = false;
			log(JSON.stringify({ event: "request", outcome: "label_missing", label: name, reason: reason(err) }));
		}
	}
	if (!stateId) log(JSON.stringify({ event: "request", outcome: "no_triage_state", team: teamKey }));

	const target = { teamId, stateId, labelIds };
	// A partial answer isn't cached, so a label added by hand is picked up on the next request.
	if (complete) targetCache = { teamKey, target, at: Date.now() };
	return target;
}

export function issueTitle(f: Pick<RequestFields, "kind" | "title">): string {
	return `${TITLE_PREFIX[f.kind as RequestKind] ?? "Request"}: ${f.title}`;
}

/**
 * Markdown for the issue. No email address: that's on the Requester attachment.
 * The details go in a quote, line by line, so nothing a visitor writes can become a
 * heading, a "Public summary" section or a rule.
 */
export function issueDescription(f: Pick<RequestFields, "kind" | "details" | "platform">, userAgent: string | null): string {
	const info = kindInfo(f.kind);
	const lines = [`**${info?.label ?? "Request"}** from the form on inboxies.co/request.`, ""];
	if (f.kind === "bug") {
		lines.push(`- Platform: ${platformLabel(f.platform) ?? "Not given"}`);
		if (userAgent) lines.push(`- Browser that sent the form: \`${userAgent.replace(/[`\r\n]/g, "").slice(0, 300)}\``);
		lines.push("");
	}
	lines.push(...f.details.split("\n").map((l) => `> ${l}`.trimEnd()));
	lines.push("", "---", "", "_The submitter’s email is on this issue’s Requester link, not in this description. Add `public-roadmap` only if this should be on the public roadmap._");
	return lines.join("\n");
}

async function createIssue(fetcher: typeof fetch, key: string, target: LinearTarget, f: RequestFields, userAgent: string | null): Promise<{ id: string; identifier: string }> {
	const info = kindInfo(f.kind)!;
	const labelIds = [REQUEST_LABEL, info.linearLabel].map((n) => target.labelIds[n]).filter((id): id is string => !!id);
	const input: Record<string, unknown> = {
		teamId: target.teamId,
		title: issueTitle(f),
		description: issueDescription(f, userAgent),
		labelIds,
	};
	if (target.stateId) input.stateId = target.stateId;
	const data = await linear(fetcher, key, ISSUE_CREATE, { input });
	const result = isObject(data.issueCreate) ? data.issueCreate : null;
	const issue = result && isObject(result.issue) ? result.issue : null;
	if (result?.success !== true || !issue || typeof issue.id !== "string") throw new Error("linear: issue not created");
	return { id: issue.id, identifier: typeof issue.identifier === "string" ? issue.identifier : issue.id };
}

async function attachRequester(fetcher: typeof fetch, key: string, issueId: string, f: RequestFields, requestId: string): Promise<void> {
	const data = await linear(fetcher, key, ATTACHMENT_CREATE, {
		input: {
			issueId,
			title: "Requester",
			subtitle: f.email,
			url: `${REQUESTER_URL}?ref=${requestId}`,
			metadata: { requesterEmail: f.email, kind: f.kind, requestId, source: "inboxies.co/request" },
		},
	});
	const result = isObject(data.attachmentCreate) ? data.attachmentCreate : null;
	if (result?.success !== true) throw new Error("linear: attachment not created");
}

// ── Confirmation email ──

export function confirmationEmail(f: Pick<RequestFields, "kind" | "title" | "email">) {
	const noun = kindInfo(f.kind)?.noun ?? "request";
	const title = [...f.title].slice(0, 120).join("");
	const text = [
		`Thanks for your ${noun}. It reached us:`,
		"",
		`  “${title}”`,
		"",
		"We read every one. If we need more detail, we’ll write to you from this address, and you can reply to this email to add anything.",
		"",
		"— Inboxies",
		"",
		"You’re getting this because this address was entered on inboxies.co/request. If that wasn’t you, ignore it.",
	].join("\n");
	const html = `<p>Thanks for your ${noun}. It reached us:</p><p><strong>${escapeHtml(title)}</strong></p><p>We read every one. If we need more detail, we’ll write to you from this address, and you can reply to this email to add anything.</p><p>— Inboxies</p><p style="color:#6b6b6b;font-size:12px">You’re getting this because this address was entered on inboxies.co/request. If that wasn’t you, ignore it.</p>`;
	return {
		from: { email: CONFIRMATION_FROM, name: "Inboxies" },
		to: f.email,
		subject: `We got your ${noun}`,
		text,
		html,
	};
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodes(connection: unknown): Record<string, unknown>[] {
	if (!isObject(connection) || !Array.isArray(connection.nodes)) return [];
	return connection.nodes.filter(isObject);
}

export type { RequestField, RequestFieldError };

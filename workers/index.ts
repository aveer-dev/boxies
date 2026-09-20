// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import {
	assertOutboundMessageSize,
	OutboundSizeError,
} from "./lib/outbound-limits";
import { deliverOutboundInBackground } from "./lib/outbound-delivery";
import { storeAttachments, attachmentKey, sanitizeAttachmentFilename, deleteR2Keys, type StoredAttachment } from "./lib/attachments";
import {
	computeSnippet,
	storeEmailContent,
	emailContentKeys,
} from "./lib/email-content";
import { computeSearchText } from "./lib/email-fts";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	getMailboxStub,
	textToHtml,
} from "./lib/email-helpers";
import {
	displayNameFromAddressField,
	normalizeDisplayName,
	senderNameFromRawHeaders,
} from "../shared/sender";
import { SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders, SYSTEM_FOLDER_IDS } from "../shared/folders";
import {
	AUTO_CONVERSATION_ID,
	agentInstanceName,
} from "../shared/agent-conversations";
import { resolveGreetingName } from "./lib/inbox-digest";
import { composePushAlert } from "./lib/push-payload";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import {
	applyIncomingAcl,
	authorizeMailbox,
	canManageAcl,
	creatorAcl,
	filterMailboxesForPrincipal,
	mailboxAccessPayload,
	principalKeys,
	type RequestPrincipal,
} from "./lib/mailbox-acl";
import { isDomainAdmin } from "./lib/domain-admin";
import {
	registerAdminAndInviteRoutes,
	resolveCreateGate,
} from "./routes/admin-invites";
import {
	issueMobileSessionToken,
	verifyAppleIdentityToken,
} from "./lib/apple-auth";
import { verifyGoogleIdentityToken } from "./lib/google-auth";
import { sendAPNsPush, type APNsPayload } from "./lib/apns";
import { sendFcmPush } from "./lib/fcm";
import {
	allowedMailboxSet,
	canonicalMailboxId,
	isDuplicateInbound,
	mailboxMetadataKey,
	routeInboundEnvelope,
} from "./lib/mailbox-routing";
import { mailDomainConfig } from "./lib/mail-domain";
import {
	classifyInboundEmail,
	shouldAutoDraft,
	shouldClassifyInbound,
	shouldFallbackToInbox,
	shouldSendPush,
	type ClassifyAi,
	type EmailClassification,
} from "./lib/classify-email";
import {
	appendXLoop,
	autoReplySubject,
	automationSettingsError,
	buildAutoReplyHeaders,
	headerMapFromSource,
	headersForEmailSend,
	mergeMailboxSettingsBlob,
	parseAutomationSettings,
	shouldAutoReply,
	shouldForward,
	type HeaderSource,
	type MailboxAutomationSettings,
} from "./lib/mail-automations";
import {
	applyInboxFilters,
	inboxFiltersError,
	parseInboxFilters,
} from "./lib/inbox-filters";
import {
	allowOutboundRecipients,
	isScreenerDestination,
	normalizeTriageSender,
	parseScreenerEnabled,
	resolveInboundFolder,
	screenerSettingsError,
} from "./lib/sender-triage";
import {
	normalizeSenderPreferenceAddress,
	senderPreferenceUpsertError,
} from "./lib/sender-preferences";
import {
	mergeTrustedAuthHeaders,
	parseAuthSignals,
	serializeEmailAuth,
} from "./lib/email-auth";

type AppContext = Context<MailboxContext>;

type DeviceTokenRow = { token: string; platform: string };

async function dispatchPushToDevices(
	env: Env,
	stub: { getDeviceTokens: () => Promise<DeviceTokenRow[]>; unregisterDeviceToken: (token: string) => Promise<unknown> },
	payload: APNsPayload,
): Promise<{ deviceCount: number; ios: unknown; android: unknown }> {
	const rows = await stub.getDeviceTokens();
	const iosTokens = rows.filter((r) => r.platform !== "android").map((r) => r.token);
	const androidTokens = rows.filter((r) => r.platform === "android").map((r) => r.token);

	const ios = await sendAPNsPush(env, iosTokens, payload);
	const android = await sendFcmPush(env, androidTokens, payload);

	for (const stale of [...ios.staleTokens, ...android.staleTokens]) {
		await stub.unregisterDeviceToken(stale);
	}

	return { deviceCount: rows.length, ios, android };
}

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const { mailDomain, domains } = mailDomainConfig(c.env);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ mailDomain, domains, emailAddresses });
});

app.get("/api/v1/me", async (c) => {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const admin = await isDomainAdmin(c.env, principal);
	const { mailDomain, domains } = mailDomainConfig(c.env);
	return c.json({
		email: principal.email ?? null,
		sub: principal.sub ?? null,
		keys: principalKeys(principal),
		isAdmin: admin,
		mailDomain,
		domains,
	});
});

registerAdminAndInviteRoutes(app);

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	if (!principal) return c.json({ error: "Forbidden" }, 403);
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	const allowed = await filterMailboxesForPrincipal(c.env.BUCKET, allMailboxes, principal);
	return c.json(allowed.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	if (!principal || principalKeys(principal).length === 0) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const createGate = await resolveCreateGate(c.env, principal);
	if (!createGate.allowed) {
		return c.json(
			{
				error:
					createGate.policy === "admin_only"
						? "Only domain admins can create mailboxes"
						: "Forbidden",
			},
			403,
		);
	}
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = canonicalMailboxId(rawEmail);
	if (!email) return c.json({ error: "Invalid mailbox email address" }, 400);
	const allowed = allowedMailboxSet((c.env.EMAIL_ADDRESSES ?? []) as string[]);
	if (allowed.size > 0 && !allowed.has(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = mailboxMetadataKey(email);
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		screener: { enabled: true },
	};

	const finalSettings = { ...defaultSettings, ...settings, acl: creatorAcl(principal) };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.reviveMailbox();
	await stub.getFolders();
	return c.json({ ...mailboxAccessPayload(email, finalSettings, principal), name }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const authz = await authorizeMailbox(
		c.env.BUCKET,
		c.get("principal") as RequestPrincipal | undefined,
		c.req.param("mailboxId"),
	);
	if (!authz.ok) return c.json({ error: authz.error }, authz.status);
	return c.json(
		mailboxAccessPayload(
			authz.mailboxId,
			authz.settings,
			c.get("principal") as RequestPrincipal | undefined,
		),
	);
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	const authz = await authorizeMailbox(c.env.BUCKET, principal, c.req.param("mailboxId"));
	if (!authz.ok) return c.json({ error: authz.error }, authz.status);
	if (!principal) return c.json({ error: "Forbidden" }, 403);
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const existing = authz.settings;
	const merged = mergeMailboxSettingsBlob(existing, settings);
	const aclResult = applyIncomingAcl(existing, merged, settings, principal);
	if (!aclResult.ok) return c.json({ error: aclResult.error }, 400);
	const next = aclResult.settings;
	const automationError = automationSettingsError(
		parseAutomationSettings(next),
		authz.mailboxId,
	);
	if (automationError) return c.json({ error: automationError }, 400);
	const filtersError = inboxFiltersError(parseInboxFilters(next), authz.mailboxId);
	if (filtersError) return c.json({ error: filtersError }, 400);
	const screenerError = screenerSettingsError(next);
	if (screenerError) return c.json({ error: screenerError }, 400);
	await c.env.BUCKET.put(mailboxMetadataKey(authz.mailboxId), JSON.stringify(next));
	return c.json(mailboxAccessPayload(authz.mailboxId, next, principal));
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	const authz = await authorizeMailbox(c.env.BUCKET, principal, c.req.param("mailboxId"));
	if (!authz.ok) return c.json({ error: authz.error }, authz.status);
	if (!canManageAcl(authz.settings, principal)) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const mailboxId = authz.mailboxId;

	// Purge DO + R2 and remove metadata inside the DO RPC (closes inbound HEAD).
	const stub = getMailboxStub(c.env, mailboxId);
	const { conversationIds } = await stub.purgeMailbox(mailboxId);
	const agentNames = new Set<string>([
		mailboxId, // legacy single-chat EmailAgent name
		...conversationIds.map((id) => agentInstanceName(mailboxId, id)),
	]);
	for (const name of agentNames) {
		try {
			const agentStub = c.env.EMAIL_AGENT.get(c.env.EMAIL_AGENT.idFromName(name));
			// Prefer RPC; fall back to HTTP for agent stubs that only expose fetch.
			const purgable = agentStub as {
				purge?: () => Promise<unknown>;
				fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
			};
			if (typeof purgable.purge === "function") {
				await purgable.purge();
			} else {
				await purgable.fetch(new Request("https://agents/purge", { method: "POST" }));
			}
		} catch (e) {
			// Best-effort: conversation ids are already captured; chat storage
			// orphans are lower impact than blocking mailbox delete.
			console.error(
				`EmailAgent purge failed for ${name}:`,
				(e as Error).message,
			);
		}
	}

	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const reply_later = boolQuery(c, "reply_later");
	const include_junk = boolQuery(c, "include_junk");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder && !reply_later) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		if (folder === Folders.INBOX) {
			const sections = await (stub as any).countThreadedEmailSections(folder);
			return c.json({
				emails,
				totalCount: sections.totalCount ?? totalCount,
				newCount: sections.newCount,
				seenCount: sections.seenCount,
			});
		}
		return c.json({ emails, totalCount });
	}

	const emails = await stub.getEmails({
		folder,
		thread_id,
		page,
		limit,
		sortColumn,
		sortDirection,
		reply_later: reply_later || undefined,
		include_junk: include_junk || undefined,
	});
	if (folder || reply_later) {
		const totalCount = await stub.countEmails({
			folder,
			thread_id,
			reply_later: reply_later || undefined,
			include_junk: include_junk || undefined,
		});
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	try {
		assertOutboundMessageSize({ html, text, attachments });
	} catch (e) {
		if (e instanceof OutboundSizeError) return c.json({ error: e.message }, 413);
		throw e;
	}
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	let resolvedThreadId = thread_id;
	if (!resolvedThreadId && (in_reply_to || (references && references.length > 0))) {
		const refs: string[] = [];
		if (in_reply_to) refs.push(in_reply_to);
		if (references) {
			for (let i = references.length - 1; i >= 0; i--) {
				if (references[i] && !refs.includes(references[i])) refs.push(references[i]);
			}
		}
		resolvedThreadId = (await (stub as any).findThreadIdByReferences(refs)) || null;
	}
	if (!resolvedThreadId) {
		resolvedThreadId = messageId;
	}

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail,
		sender_name: displayNameFromAddressField(from),
		recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: resolvedThreadId, message_id: outgoingMessageId,
		delivery_status: "queued", delivery_error: null,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	// Screener-lite: people you email bypass the review queue on reply.
	await allowOutboundRecipients(stub as any, to, cc, bcc);
	if (in_reply_to || thread_id) {
		await (stub as any).clearReplyLaterForThread(resolvedThreadId);
	}

	c.executionCtx.waitUntil(
		deliverOutboundInBackground(c.env, mailboxId, messageId, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	const now = new Date().toISOString();

	let resolvedThreadId = thread_id || null;
	if (!resolvedThreadId && in_reply_to) {
		resolvedThreadId = (await stub.findThreadIdByReferences([in_reply_to])) || null;
	}

	const draftFields = {
		subject: subject || "",
		recipient: (to || "").toLowerCase(),
		cc: cc?.toLowerCase() || null,
		bcc: bcc?.toLowerCase() || null,
		body,
		date: now,
		in_reply_to: in_reply_to || null,
		thread_id: resolvedThreadId,
	};

	if (draft_id) {
		const updated = await stub.updateDraft(draft_id, {
			...draftFields,
			thread_id: resolvedThreadId || draft_id,
		});
		if (updated) {
			await stub.deleteSiblingDrafts(draft_id, {
				threadId: updated.thread_id,
				inReplyTo: in_reply_to || updated.in_reply_to,
			});
			return c.json({
				id: draft_id,
				draft_id,
				status: "draft",
				subject: subject || "",
				recipient: to || "",
				date: now,
			});
		}
	}

	const messageId = crypto.randomUUID();
	if (!resolvedThreadId) {
		resolvedThreadId = messageId;
	}

	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: draftFields.subject, sender: mailboxId.toLowerCase(),
		recipient: draftFields.recipient, cc: draftFields.cc, bcc: draftFields.bcc,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: resolvedThreadId,
	}, []);
	await stub.deleteSiblingDrafts(messageId, {
		threadId: resolvedThreadId,
		inReplyTo: in_reply_to,
	});
	return c.json({ id: messageId, draft_id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred, reply_later } = (await c.req.json()) as {
		read?: boolean;
		starred?: boolean;
		reply_later?: boolean;
	};
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, {
		read,
		starred,
		reply_later,
	});
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const body = (await c.req.json()) as {
		folderId: string;
		setSenderPreference?: boolean;
	};
	const { folderId, setSenderPreference } = body;
	const emailId = c.req.param("id")!;
	const stub = c.var.mailboxStub;

	const success = await stub.moveEmail(emailId, folderId);
	if (!success) return c.json({ error: "Folder not found" }, 400);

	if (!setSenderPreference) {
		return c.json({ status: "moved" });
	}

	const email = await stub.getEmail(emailId);
	if (!email?.sender) {
		return c.json({ status: "moved" });
	}

	const upsertError = senderPreferenceUpsertError({
		address: email.sender,
		folderId,
	});
	if (upsertError) {
		// Move already succeeded; preference is optional on this path.
		return c.json({ status: "moved", preferenceError: upsertError });
	}

	const result = await stub.upsertSenderPreference({
		address: email.sender,
		folderId,
		displayName: email.sender_name ?? null,
		source: "user",
		refile: true,
	});
	const triageSender = normalizeTriageSender(email.sender);
	if (triageSender) {
		const triage = await (stub as any).getSenderTriage?.(triageSender);
		if (triage?.status === "allowed") {
			await (stub as any).upsertSenderTriage({
				sender: triageSender,
				status: "allowed",
				destination_folder_id: folderId,
				display_name: email.sender_name ?? triage.display_name ?? null,
			});
		}
	}
	return c.json({
		status: "moved",
		preference: result?.preference ?? null,
		refiledCount: result?.refiledCount ?? 0,
	});
});

// -- Sender purpose-box preferences ---------------------------------

app.get("/api/v1/mailboxes/:mailboxId/sender-preferences", async (c: AppContext) => {
	const stub = c.var.mailboxStub as {
		listSenderPreferences: (opts: {
			q?: string;
			folder?: string;
			limit?: number;
		}) => Promise<unknown>;
	};
	const preferences = await stub.listSenderPreferences({
		q: c.req.query("q") || "",
		folder: c.req.query("folder") || undefined,
		limit: intQuery(c, "limit"),
	});
	return c.json({ preferences });
});

app.get(
	"/api/v1/mailboxes/:mailboxId/sender-preferences/:address",
	async (c: AppContext) => {
		const address = normalizeSenderPreferenceAddress(
			decodeURIComponent(c.req.param("address")!),
		);
		if (!address) return c.json({ error: "Invalid sender address" }, 400);
		const preference = await c.var.mailboxStub.getSenderPreference(address);
		if (!preference) return c.json({ error: "Not found" }, 404);
		return c.json(preference);
	},
);

app.put(
	"/api/v1/mailboxes/:mailboxId/sender-preferences/:address",
	async (c: AppContext) => {
		const addressParam = decodeURIComponent(c.req.param("address")!);
		const body = (await c.req.json()) as {
			folderId?: string;
			displayName?: string | null;
			refile?: boolean;
			source?: string;
		};
		const folderId = body.folderId ?? "";
		const upsertError = senderPreferenceUpsertError({
			address: addressParam,
			folderId,
			displayName: body.displayName,
			source: body.source as "user" | "screener" | "seeded" | undefined,
			refile: body.refile,
		});
		if (upsertError) return c.json({ error: upsertError }, 400);

		const result = await c.var.mailboxStub.upsertSenderPreference({
			address: addressParam,
			folderId,
			displayName: body.displayName,
			source: body.source ?? "user",
			refile: body.refile !== false,
		});
		if (!result) return c.json({ error: "Invalid preference" }, 400);

		// Keep Screener allow-list destination in sync when a preference changes.
		const address = normalizeSenderPreferenceAddress(addressParam);
		if (address) {
			const stub = c.var.mailboxStub as any;
			const triage = await stub.getSenderTriage?.(address);
			if (triage?.status === "allowed") {
				await stub.upsertSenderTriage({
					sender: address,
					status: "allowed",
					destination_folder_id: folderId,
					display_name: body.displayName ?? triage.display_name ?? null,
				});
			}
		}

		return c.json(result);
	},
);

app.delete(
	"/api/v1/mailboxes/:mailboxId/sender-preferences/:address",
	async (c: AppContext) => {
		const address = normalizeSenderPreferenceAddress(
			decodeURIComponent(c.req.param("address")!),
		);
		if (!address) return c.json({ error: "Invalid sender address" }, 400);
		const deleted = await c.var.mailboxStub.deleteSenderPreference(address);
		if (!deleted) return c.json({ error: "Not found" }, 404);
		return c.body(null, 204);
	},
);

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Real-Time Events Stream (SSE) ----------------------------------

app.get("/api/v1/mailboxes/:mailboxId/events", async (c: AppContext) => {
	const stream = await (c.var.mailboxStub as any).subscribeEvents();
	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
		},
	});
});

// -- Push Notification Device Tokens --------------------------------

app.post("/api/v1/mailboxes/:mailboxId/device-token", async (c: AppContext) => {
	const { token, platform } = (await c.req.json()) as { token: string; platform?: string };
	if (!token) return c.json({ error: "Missing token" }, 400);
	await (c.var.mailboxStub as any).registerDeviceToken(token, platform || "ios");
	return c.json({ status: "registered" });
});

app.delete("/api/v1/mailboxes/:mailboxId/device-token/:token", async (c: AppContext) => {
	const token = c.req.param("token");
	if (!token) return c.json({ error: "Missing token" }, 400);
	await (c.var.mailboxStub as any).unregisterDeviceToken(token);
	return c.json({ status: "unregistered" });
});

app.post("/api/v1/mailboxes/:mailboxId/test-push", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const rows = await (c.var.mailboxStub as any).getDeviceTokens();
	console.log(`[Push Test] Found ${rows?.length ?? 0} token(s) for ${mailboxId}`);
	if (!rows || rows.length === 0) {
		return c.json({
			status: "no_devices",
			message: `No device tokens registered for mailbox "${mailboxId}". Launch the Inboxies iOS or Android app and grant notification permission.`,
			deviceTokens: [],
		});
	}

	const result = await dispatchPushToDevices(c.env, c.var.mailboxStub as any, {
		title: "Inboxies Push Test",
		body: "Your push notification pipeline is working live!",
		mailboxId,
		emailId: "test-push-" + Date.now(),
		folderId: "inbox",
	});

	return c.json({
		status: "completed",
		deviceCount: result.deviceCount,
		result,
	});
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.get("/api/v1/mailboxes/:mailboxId/workflow-piles", async (c: AppContext) => {
	const piles = await (c.var.mailboxStub as any).getWorkflowPiles();
	return c.json({ piles });
});

app.get("/api/v1/mailboxes/:mailboxId/inbox-digest", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const obj = await c.env.BUCKET.get(mailboxMetadataKey(mailboxId));
	const settings = obj ? ((await obj.json()) as { fromName?: string }) : {};
	const greetingName = resolveGreetingName({
		fromName: settings.fromName,
		mailboxName: mailboxId,
		mailboxEmail: mailboxId,
	});
	const digest = await (c.var.mailboxStub as any).getInboxDigest(greetingName);
	return c.json(digest);
});

app.post("/api/v1/mailboxes/:mailboxId/inbox-digest/todos/:todoId/complete", async (c: AppContext) => {
	const todoId = c.req.param("todoId")!;
	const result = await (c.var.mailboxStub as any).completeDigestTodo(todoId);
	if (!result) return c.json({ error: "Not found" }, 404);
	return c.json(result);
});

app.post("/api/v1/mailboxes/:mailboxId/inbox-digest/topics/:topicId/mark-read", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => ({}))) as { emailIds?: string[] };
	const emailIds = Array.isArray(body.emailIds) ? body.emailIds : [];
	if (emailIds.length === 0) {
		return c.json({ error: "emailIds required" }, 400);
	}
	const result = await (c.var.mailboxStub as any).markDigestTopicRead(emailIds);
	return c.json(result);
});

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	if ((SYSTEM_FOLDER_IDS as readonly string[]).includes(slug)) {
		return c.json({ error: "Folder with this name already exists" }, 409);
	}
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Sender triage (Screener-lite) ----------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/sender-triage", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	await stub.bootstrapSenderTriage();
	const status = c.req.query("status") || undefined;
	const limit = Number(c.req.query("limit") || "50");
	const offset = Number(c.req.query("offset") || "0");
	const rows = await stub.listSenderTriage({
		status,
		limit: Number.isFinite(limit) ? limit : 50,
		offset: Number.isFinite(offset) ? offset : 0,
	});
	return c.json(rows);
});

app.post("/api/v1/mailboxes/:mailboxId/sender-triage/bootstrap", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
	const result = await stub.bootstrapSenderTriage(Boolean(body.force));
	return c.json(result);
});

app.post("/api/v1/mailboxes/:mailboxId/sender-triage/approve", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const body = (await c.req.json()) as {
		sender?: string;
		destinationFolderId?: string;
		emailId?: string;
		displayName?: string;
		refileQueued?: boolean;
	};
	const sender = normalizeTriageSender(body.sender);
	if (!sender) return c.json({ error: "sender is required" }, 400);
	const destinationFolderId = (body.destinationFolderId || Folders.INBOX).trim();
	if (!isScreenerDestination(destinationFolderId)) {
		return c.json(
			{ error: "destinationFolderId must be inbox, promotions, or updates" },
			400,
		);
	}

	const triage = await stub.upsertSenderTriage({
		sender,
		status: "allowed",
		destination_folder_id: destinationFolderId,
		display_name: body.displayName ?? null,
	});
	await stub.upsertSenderPreference({
		address: sender,
		folderId: destinationFolderId,
		displayName: body.displayName ?? null,
		source: "screener",
		refile: false,
	});

	const refileQueued = body.refileQueued !== false;
	let moved = { moved: 0, ids: [] as string[] };
	if (refileQueued) {
		moved = await stub.refileSenderInFolder(
			sender,
			Folders.SCREENER,
			destinationFolderId,
		);
	}
	if (body.emailId) {
		await stub.moveEmail(body.emailId, destinationFolderId);
	}

	return c.json({ triage, moved });
});

app.post("/api/v1/mailboxes/:mailboxId/sender-triage/reject", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const body = (await c.req.json()) as {
		sender?: string;
		emailId?: string;
		displayName?: string;
		refileQueued?: boolean;
	};
	const sender = normalizeTriageSender(body.sender);
	if (!sender) return c.json({ error: "sender is required" }, 400);

	const triage = await stub.upsertSenderTriage({
		sender,
		status: "rejected",
		destination_folder_id: null,
		display_name: body.displayName ?? null,
	});
	await stub.deleteSenderPreference(sender);

	const refileQueued = body.refileQueued !== false;
	let moved = { moved: 0, ids: [] as string[] };
	if (refileQueued) {
		moved = await stub.refileSenderInFolder(
			sender,
			Folders.SCREENER,
			Folders.SCREENED_OUT,
		);
	}
	if (body.emailId) {
		await stub.moveEmail(body.emailId, Folders.SCREENED_OUT);
	}

	return c.json({ triage, moved });
});

app.patch("/api/v1/mailboxes/:mailboxId/sender-triage/:sender", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const sender = normalizeTriageSender(
		decodeURIComponent(c.req.param("sender") || ""),
	);
	if (!sender) return c.json({ error: "Invalid sender" }, 400);
	const body = (await c.req.json()) as {
		status?: "allowed" | "rejected";
		destinationFolderId?: string;
		displayName?: string;
		refileQueued?: boolean;
	};

	const existing = await stub.getSenderTriage(sender);
	const status = body.status ?? existing?.status ?? "allowed";
	if (status !== "allowed" && status !== "rejected") {
		return c.json({ error: "status must be allowed or rejected" }, 400);
	}

	let destinationFolderId: string | null = null;
	if (status === "allowed") {
		destinationFolderId = (
			body.destinationFolderId ||
			existing?.destination_folder_id ||
			Folders.INBOX
		).trim();
		if (!isScreenerDestination(destinationFolderId)) {
			return c.json(
				{ error: "destinationFolderId must be inbox, promotions, or updates" },
				400,
			);
		}
	}

	const triage = await stub.upsertSenderTriage({
		sender,
		status,
		destination_folder_id: destinationFolderId,
		display_name: body.displayName ?? existing?.display_name ?? null,
	});
	if (status === "allowed" && destinationFolderId) {
		await stub.upsertSenderPreference({
			address: sender,
			folderId: destinationFolderId,
			displayName: body.displayName ?? existing?.display_name ?? null,
			source: "screener",
			refile: false,
		});
	} else if (status === "rejected") {
		await stub.deleteSenderPreference(sender);
	}

	let moved = { moved: 0, ids: [] as string[] };
	if (body.refileQueued) {
		const toFolder =
			status === "rejected" ? Folders.SCREENED_OUT : destinationFolderId!;
		moved = await stub.refileSenderInFolder(sender, Folders.SCREENER, toFolder);
		if (status === "allowed") {
			const fromOut = await stub.refileSenderInFolder(
				sender,
				Folders.SCREENED_OUT,
				toFolder,
			);
			moved = {
				moved: moved.moved + fromOut.moved,
				ids: [...moved.ids, ...fromOut.ids],
			};
		}
	}

	return c.json({ triage, moved });
});

app.delete("/api/v1/mailboxes/:mailboxId/sender-triage/:sender", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const sender = normalizeTriageSender(
		decodeURIComponent(c.req.param("sender") || ""),
	);
	if (!sender) return c.json({ error: "Invalid sender" }, 400);
	const ok = await stub.deleteSenderTriage(sender);
	return ok ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
});

// -- Agent conversations (multi-chat registry for mobile / future web) ----

app.get("/api/v1/mailboxes/:mailboxId/agent/conversations", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	await stub.ensureAutoAgentConversation();
	return c.json(await stub.listAgentConversations());
});

app.post("/api/v1/mailboxes/:mailboxId/agent/conversations", async (c: AppContext) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		id?: string;
		title?: string;
		lastMessagePreview?: string | null;
	};
	const id = typeof body.id === "string" ? body.id.trim() : "";
	if (id === AUTO_CONVERSATION_ID) {
		return c.json({ error: "Reserved conversation id" }, 400);
	}
	const stub = c.var.mailboxStub as any;
	const conversation = await stub.createAgentConversation({
		id: id || undefined,
		title: body.title,
		lastMessagePreview: body.lastMessagePreview,
	});
	return c.json(conversation, 201);
});

app.patch(
	"/api/v1/mailboxes/:mailboxId/agent/conversations/:conversationId",
	async (c: AppContext) => {
		const conversationId = c.req.param("conversationId")!;
		const body = (await c.req.json()) as {
			title?: string;
			lastMessagePreview?: string | null;
		};
		const stub = c.var.mailboxStub as any;
		const updated = await stub.updateAgentConversation(conversationId, body);
		return updated
			? c.json(updated)
			: c.json({ error: "Conversation not found" }, 404);
	},
);

app.delete(
	"/api/v1/mailboxes/:mailboxId/agent/conversations/:conversationId",
	async (c: AppContext) => {
		const conversationId = c.req.param("conversationId")!;
		if (conversationId === AUTO_CONVERSATION_ID) {
			return c.json({ error: "Cannot delete the auto-drafts conversation" }, 400);
		}
		const stub = c.var.mailboxStub as any;
		const ok = await stub.deleteAgentConversation(conversationId);
		return ok ? c.body(null, 204) : c.json({ error: "Conversation not found" }, 404);
	},
);

// -- Auth (mobile Sign in with Apple) --------------------------------

const AppleAuthBody = z.object({
	identityToken: z.string().min(1),
	fullName: z
		.object({
			givenName: z.string().optional(),
			familyName: z.string().optional(),
		})
		.optional(),
});

app.post("/api/v1/auth/apple", async (c) => {
	const appleClientId = c.env.APPLE_CLIENT_ID;
	const mobileSecret = c.env.MOBILE_JWT_SECRET;
	if (!appleClientId || !mobileSecret) {
		return c.json(
			{
				error:
					"Apple Sign In is not configured. Set APPLE_CLIENT_ID and MOBILE_JWT_SECRET secrets.",
			},
			503,
		);
	}

	const parsed = AppleAuthBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "identityToken is required" }, 400);
	}

	try {
		const claims = await verifyAppleIdentityToken(
			parsed.data.identityToken,
			appleClientId,
		);
		const session = await issueMobileSessionToken(mobileSecret, {
			sub: claims.sub,
			email: claims.email,
			auth: "apple",
		});
		return c.json({
			token: session.token,
			expiresAt: session.expiresAt,
			user: {
				id: claims.sub,
				email: claims.email ?? null,
				fullName: parsed.data.fullName ?? null,
			},
		});
	} catch (e) {
		console.error("Apple auth failed:", (e as Error).message);
		return c.json({ error: "Invalid Apple identity token" }, 401);
	}
});

const GoogleAuthBody = z.object({
	idToken: z.string().min(1),
});

app.post("/api/v1/auth/google", async (c) => {
	const googleClientId = c.env.GOOGLE_CLIENT_ID;
	const mobileSecret = c.env.MOBILE_JWT_SECRET;
	if (!googleClientId || !mobileSecret) {
		return c.json(
			{
				error:
					"Google Sign In is not configured. Set GOOGLE_CLIENT_ID and MOBILE_JWT_SECRET secrets.",
			},
			503,
		);
	}

	const parsed = GoogleAuthBody.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json({ error: "idToken is required" }, 400);
	}

	try {
		const claims = await verifyGoogleIdentityToken(
			parsed.data.idToken,
			googleClientId,
		);
		const session = await issueMobileSessionToken(mobileSecret, {
			sub: claims.sub,
			email: claims.email,
			auth: "google",
		});
		return c.json({
			token: session.token,
			expiresAt: session.expiresAt,
			user: {
				id: claims.sub,
				email: claims.email ?? null,
				fullName: claims.name
					? { givenName: claims.name, familyName: undefined }
					: null,
			},
		});
	} catch (e) {
		console.error("Google auth failed:", (e as Error).message);
		return c.json({ error: "Invalid Google identity token" }, 401);
	}
});

/**
 * Local-only helper so the iOS simulator can exercise the app without a real
 * Apple identity token. Disabled outside development.
 */
app.post("/api/v1/auth/dev", async (c) => {
	if (!import.meta.env.DEV) {
		return c.json({ error: "Dev auth is only available in local development" }, 404);
	}
	const mobileSecret =
		c.env.MOBILE_JWT_SECRET || "dev-mobile-jwt-secret-change-me";
	const body = (await c.req.json().catch(() => ({}))) as { email?: string };
	const email = body.email?.trim() || "dev@example.com";
	const session = await issueMobileSessionToken(mobileSecret, {
		sub: `dev:${email}`,
		email,
		auth: "dev",
	});
	return c.json({
		token: session.token,
		expiresAt: session.expiresAt,
		user: { id: `dev:${email}`, email, fullName: null },
	});
});

// -- Recipients (people I've emailed) -------------------------------

app.get("/api/v1/mailboxes/:mailboxId/recipients", async (c: AppContext) => {
	const stub = c.var.mailboxStub as any;
	const recipients = await stub.listRecentRecipients({
		q: c.req.query("q") || "",
		limit: intQuery(c, "limit"),
	});
	return c.json({ recipients });
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"),
		is_reply_later: boolQuery(c, "is_reply_later"),
		has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(attachmentKey(emailId, attachmentId, attachment.filename));
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

type AutomationStub = {
	claimAutoReply: (sender: string) => Promise<boolean>;
	releaseAutoReply: (sender: string) => Promise<void>;
	checkSendRateLimit: () => Promise<string | null>;
	createEmail: (
		folder: string,
		email: Record<string, unknown>,
		attachments: unknown[],
	) => Promise<unknown>;
};

async function loadMailboxSettingsRaw(
	env: Env,
	mailboxId: string,
): Promise<Record<string, unknown>> {
	const obj = await env.BUCKET.get(mailboxMetadataKey(mailboxId));
	if (!obj) return {};
	try {
		const parsed = await obj.json();
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* ignore */
	}
	return {};
}

async function loadAutomationSettings(
	env: Env,
	mailboxId: string,
): Promise<MailboxAutomationSettings> {
	return parseAutomationSettings(await loadMailboxSettingsRaw(env, mailboxId));
}

async function applyInboundForward(options: {
	message: ForwardableEmailMessage;
	mailboxId: string;
	sender: string;
	settings: MailboxAutomationSettings;
	classification: EmailClassification;
	headers: HeaderSource;
	/** When set (including from a matched filter), overrides global forwarding. */
	forwardToOverride?: string | null;
}): Promise<void> {
	const {
		message, mailboxId, sender, settings, classification, headers, forwardToOverride,
	} = options;
	const override = typeof forwardToOverride === "string" ? forwardToOverride.trim() : "";
	const useOverride = Boolean(override);
	const decision = shouldForward({
		enabled: useOverride ? true : Boolean(settings.forwarding?.enabled),
		dest: useOverride ? override : settings.forwarding?.email,
		mailboxId,
		sender,
		classification,
		headers,
		canBeForwarded: (message as { canBeForwarded?: boolean }).canBeForwarded,
	});
	if (!decision.ok) {
		if (useOverride || settings.forwarding?.enabled) {
			console.log(`Skipping forward for ${mailboxId}: ${decision.reason}`);
		}
		return;
	}
	try {
		const extra = new Headers();
		const existing = (headerMapFromSource(headers).get("x-loop") ?? []).join(", ");
		extra.set("X-Loop", appendXLoop(existing, mailboxId));
		await message.forward(decision.dest, extra);
		console.log(`Forwarded inbound mail for ${mailboxId} to ${decision.dest}`);
	} catch (e) {
		console.error(
			`Forwarding failed for ${mailboxId} to ${decision.dest}:`,
			(e as Error).message,
		);
	}
}

async function sendInboundAutoReply(options: {
	env: Env;
	stub: AutomationStub;
	mailboxId: string;
	sender: string;
	fromName?: string;
	subject: string;
	originalMessageId: string | null;
	threadId: string;
	settings: MailboxAutomationSettings;
	classification: EmailClassification;
	headers: HeaderSource;
}): Promise<void> {
	const {
		env, stub, mailboxId, sender, fromName, subject, originalMessageId,
		threadId, settings, classification, headers,
	} = options;
	const decision = shouldAutoReply({
		enabled: Boolean(settings.autoReply?.enabled),
		message: settings.autoReply?.message,
		mailboxId,
		sender,
		classification,
		headers,
	});
	if (!decision.ok) {
		if (settings.autoReply?.enabled) {
			console.log(`Skipping auto-reply for ${mailboxId}: ${decision.reason}`);
		}
		return;
	}

	const fromDomain = mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`Skipping auto-reply for ${mailboxId}: invalid mailbox`);
		return;
	}

	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) {
		console.log(`Skipping auto-reply for ${mailboxId}: ${rateLimitError}`);
		return;
	}

	const claimed = await stub.claimAutoReply(sender);
	if (!claimed) {
		console.log(`Skipping auto-reply for ${mailboxId}: already sent to ${sender} in 24h`);
		return;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const replySubject = autoReplySubject(settings.autoReply?.subject, subject);
	const text = settings.autoReply?.message || "";
	const html = textToHtml(text);
	const autoHeaders = headersForEmailSend(
		buildAutoReplyHeaders({
			mailboxId,
			originalMessageId,
			existingXLoop: (headerMapFromSource(headers).get("x-loop") ?? []).join(", "),
		}),
	);
	const from = fromName ? { email: mailboxId, name: fromName } : mailboxId;

	try {
		assertOutboundMessageSize({ html, text });
	} catch (e) {
		if (e instanceof OutboundSizeError) {
			console.error(`Skipping auto-reply for ${mailboxId}: ${e.message}`);
			try {
				await stub.releaseAutoReply(sender);
			} catch (releaseError) {
				console.error(
					`Failed to release auto-reply claim for ${mailboxId}:`,
					(releaseError as Error).message,
				);
			}
			return;
		}
		throw e;
	}

	let providerMessageId: string;
	try {
		const result = await sendEmail(env.EMAIL, {
			to: sender,
			from,
			subject: replySubject,
			text,
			html,
			headers: autoHeaders,
		});
		providerMessageId = result.messageId;
	} catch (e) {
		console.error(`Auto-reply send failed for ${mailboxId}:`, (e as Error).message);
		try {
			await stub.releaseAutoReply(sender);
		} catch (releaseError) {
			console.error(
				`Failed to release auto-reply claim for ${mailboxId}:`,
				(releaseError as Error).message,
			);
		}
		return;
	}

	const fromHeader = fromName ? `${fromName} <${mailboxId}>` : mailboxId;
	try {
		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject: replySubject,
				sender: mailboxId,
				sender_name: fromName || null,
				recipient: sender,
				cc: null,
				bcc: null,
				date: new Date().toISOString(),
				body: html,
				in_reply_to: originalMessageId,
				email_references: originalMessageId ? JSON.stringify([originalMessageId]) : null,
				thread_id: threadId,
				message_id: outgoingMessageId,
				provider_message_id: providerMessageId,
				delivery_status: "accepted",
				delivery_error: null,
				raw_headers: JSON.stringify([
					{ key: "from", value: fromHeader },
					{ key: "to", value: sender },
					{ key: "subject", value: replySubject },
					{ key: "auto-submitted", value: "auto-replied" },
					{ key: "precedence", value: "bulk" },
					{ key: "x-loop", value: autoHeaders["X-Loop"] },
					{ key: "message-id", value: `<${outgoingMessageId}>` },
				]),
			},
			[],
		);
	} catch (e) {
		console.error(
			`Auto-reply sent but failed to store in Sent for ${mailboxId}:`,
			(e as Error).message,
		);
	}
	console.log(`Sent auto-reply from ${mailboxId} to ${sender}`);
}

async function receiveEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
	const route = await routeInboundEnvelope(message.to, async (mailboxId) =>
		Boolean(await env.BUCKET.head(mailboxMetadataKey(mailboxId))),
	);
	if (route.action === "reject") {
		console.log(`Rejecting email for ${message.to}: ${route.reason}`);
		message.setReject(route.reason);
		return;
	}
	const mailboxId = route.mailboxId;

	const rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const recipient = allRecipients.join(", ") || message.to.toLowerCase();

	const messageId = crypto.randomUUID();

	const stub = getMailboxStub(env, mailboxId);
	if (!(await stub.isWritable())) {
		console.log(`Skipping inbound for deleted mailbox ${mailboxId}`);
		return;
	}
	const fromRaw = (parsedEmail.from?.address || message.from || "").toLowerCase();
	const fromAddress = normalizeTriageSender(fromRaw) ?? fromRaw;
	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	// Same mailbox is one Durable Object, so concurrent hello@ + hello+tag@
	// (or a retry after a successful write) serialize here. Skip duplicates
	// instead of inserting a second copy.
	if (originalMessageId) {
		const existing = await stub.findEmailByMessageId(originalMessageId);
		if (
			!shouldClassifyInbound({
				routeAction: "deliver",
				isDuplicate: isDuplicateInbound(originalMessageId, Boolean(existing)),
			})
		) {
			console.log(`Skipping duplicate inbound message ${originalMessageId} for ${mailboxId}`);
			return;
		}
	}

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = sanitizeAttachmentFilename(att.filename);
			await env.BUCKET.put(attachmentKey(messageId, attId, filename), att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];

	// Build candidate message IDs to find an existing thread (newest to oldest)
	const candidateReferences: string[] = [];
	if (inReplyTo) candidateReferences.push(inReplyTo);
	for (let i = emailReferences.length - 1; i >= 0; i--) {
		const ref = emailReferences[i];
		if (ref && !candidateReferences.includes(ref)) {
			candidateReferences.push(ref);
		}
	}

	let threadId: string | null = null;
	if (candidateReferences.length > 0) {
		threadId = await (stub as any).findThreadIdByReferences(candidateReferences);
	}

	if (!threadId) {
		threadId = await (stub as any).findThreadBySubject(
			parsedEmail.subject || "",
			parsedEmail.from?.address || undefined,
		);
	}

	if (!threadId) {
		threadId = messageId;
	}

	const auth = parseAuthSignals({
		mimeHeaders: parsedEmail.headers,
		envelopeHeaders: message.headers,
		headerFrom: parsedEmail.from?.address || fromAddress,
		envelopeFrom: message.from,
	});
	const storedHeaders = mergeTrustedAuthHeaders(
		parsedEmail.headers,
		message.headers,
	);
	const fromHeaders = JSON.stringify(storedHeaders);
	const senderName =
		normalizeDisplayName(parsedEmail.from?.name) ??
		senderNameFromRawHeaders(fromHeaders);

	const classification = await classifyInboundEmail(
		{
			headers: storedHeaders,
			subject: parsedEmail.subject,
			sender: fromAddress,
			bodyText: parsedEmail.text,
			bodyHtml: parsedEmail.html,
			auth,
		},
		env.AI as ClassifyAi,
	);
	console.log(
		`Classified inbound mail for ${mailboxId} as ${classification.class} (${classification.folderId}): ${classification.reason}`,
	);

	const bodyText = parsedEmail.html || parsedEmail.text || "";
	// Store HTML + original MIME in R2 before the DO row (metadata + snippet only).
	await storeEmailContent(env.BUCKET, messageId, {
		htmlOrText: bodyText,
		rawMime: rawEmail,
	});

	const inboundEmail = {
		id: messageId, subject: parsedEmail.subject || "",
		sender: fromAddress, sender_name: senderName, recipient,
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		snippet: computeSnippet(bodyText),
		search_text: computeSearchText(bodyText, { plainText: parsedEmail.text }),
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: fromHeaders,
		auth: serializeEmailAuth(auth),
	};

	const rawMailboxSettings = await loadMailboxSettingsRaw(env, mailboxId);
	const automationSettings = parseAutomationSettings(rawMailboxSettings);
	const filterHit = applyInboxFilters(parseInboxFilters(rawMailboxSettings), {
		sender: fromAddress,
		subject: parsedEmail.subject || "",
		headers: storedHeaders,
		auth,
	});
	if (filterHit) {
		console.log(
			`Inbox filter ${filterHit.ruleId} matched for ${mailboxId}` +
				(filterHit.folderId ? ` -> ${filterHit.folderId}` : ""),
		);
	}

	const screenerEnabled = parseScreenerEnabled(rawMailboxSettings);
	if (screenerEnabled) {
		try {
			await (stub as any).bootstrapSenderTriage();
		} catch (e) {
			console.error(
				`Sender triage bootstrap failed for ${mailboxId}:`,
				(e as Error).message,
			);
		}
	}
	const triageSender = normalizeTriageSender(fromAddress);
	const triageRow = triageSender
		? await (stub as any).getSenderTriage(triageSender)
		: null;
	const purposePref =
		classification.folderId === Folders.SPAM
			? null
			: await stub.getSenderPreference(fromAddress);
	const triageDecision = resolveInboundFolder({
		classification,
		triage: triageRow,
		filterHit,
		screenerEnabled,
		preferenceFolderId: purposePref?.folderId ?? null,
	});
	console.log(
		`Triage for ${mailboxId} sender=${fromAddress}: action=${triageDecision.triageAction} -> ${triageDecision.folderId}`,
	);
	if (purposePref && triageDecision.folderId === purposePref.folderId) {
		console.log(
			`Sender preference filed ${fromAddress} → ${purposePref.folderId} for ${mailboxId}`,
		);
	}

	const targetFolder = triageDecision.folderId;
	let filedFolder: string = targetFolder;
	try {
		await stub.createEmail(targetFolder, inboundEmail, attachmentData);
	} catch (e) {
		if ((e as Error).message === "Mailbox has been deleted") {
			console.log(`Discarding inbound for deleted mailbox ${mailboxId}`);
			await deleteR2Keys(env.BUCKET, [
				...emailContentKeys(messageId),
				...attachmentData.map((att) =>
					attachmentKey(messageId, att.id, att.filename),
				),
			]);
			return;
		}
		if (!shouldFallbackToInbox(targetFolder, e)) throw e;
		console.error(
			`Failed to file inbound mail to ${targetFolder}, falling back to inbox:`,
			(e as Error).message,
		);
		try {
			await stub.createEmail(Folders.INBOX, inboundEmail, attachmentData);
		} catch (inboxErr) {
			if ((inboxErr as Error).message === "Mailbox has been deleted") {
				console.log(`Discarding inbound for deleted mailbox ${mailboxId}`);
				await deleteR2Keys(env.BUCKET, [
					...emailContentKeys(messageId),
					...attachmentData.map((att) =>
						attachmentKey(messageId, att.id, att.filename),
					),
				]);
				return;
			}
			throw inboxErr;
		}
		filedFolder = Folders.INBOX;
	}

	try {
		if (!triageDecision.skipForward) {
			await applyInboundForward({
				message,
				mailboxId,
				sender: fromAddress,
				settings: automationSettings,
				classification,
				headers: message.headers,
				forwardToOverride: filterHit?.forwardTo,
			});
		}
		if (!triageDecision.skipAutoReply) {
			ctx.waitUntil(
				sendInboundAutoReply({
					env,
					stub: stub as unknown as AutomationStub,
					mailboxId,
					sender: fromAddress,
					fromName: automationSettings.fromName,
					subject: parsedEmail.subject || "",
					originalMessageId,
					threadId: threadId ?? messageId,
					settings: automationSettings,
					classification,
					headers: message.headers,
				}).catch((e) =>
					console.error("Auto-reply failed:", (e as Error).message),
				),
			);
		}
	} catch (e) {
		console.error(
			`Inbound automations failed for ${mailboxId}:`,
			(e as Error).message,
		);
	}

	// Auto-draft personal ham only. Spam, bulk, and Screener skip the agent.
	if (
		!triageDecision.skipAutoDraft &&
		shouldAutoDraft(classification, auth) &&
		!filterHit?.skipAutoDraft
	) {
		ctx.waitUntil(
			(async () => {
				await stub.ensureAutoAgentConversation();
				const agentName = agentInstanceName(mailboxId, AUTO_CONVERSATION_ID);
				const agentStub = env.EMAIL_AGENT.get(
					env.EMAIL_AGENT.idFromName(agentName),
				);
				await agentStub.fetch(
					new Request("https://agents/onNewEmail", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							mailboxId,
							emailId: messageId,
							sender: (parsedEmail.from?.address || "").toLowerCase(),
							subject: parsedEmail.subject || "",
							threadId,
						}),
					}),
				);
			})().catch((e) =>
				console.error("Auto-draft trigger failed:", (e as Error).message),
			),
		);
	}

	if (triageDecision.skipPush || !shouldSendPush(classification)) {
		return;
	}

	// Send push notifications to registered iOS (APNs) and Android (FCM) devices
	ctx.waitUntil(
		(async () => {
			const rows = await (stub as any).getDeviceTokens();
			console.log(`[Push] Inbound email for "${mailboxId}". Registered device tokens: ${rows?.length ?? 0}`);
			if (rows && rows.length > 0) {
				const alert = composePushAlert({
					subject: parsedEmail.subject,
					snippet: inboundEmail.snippet,
				});
				const result = await dispatchPushToDevices(env, stub as any, {
					title: senderName || fromAddress,
					body: alert.body,
					fcmBody: alert.fcmBody,
					subtitle: alert.subtitle,
					mailboxId,
					emailId: messageId,
					folderId: filedFolder,
				});
				console.log(
					`[Push] Results for "${mailboxId}": ios=${JSON.stringify(result.ios)} android=${JSON.stringify(result.android)}`,
				);
			}
		})().catch((e) =>
			console.error("[Push] Push notification trigger failed:", (e as Error).message),
		),
	);
}

export { app, receiveEmail };

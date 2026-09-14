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
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	computeSnippet,
	storeEmailContent,
} from "./lib/email-content";
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
	resolveMailboxParam,
	routeInboundEnvelope,
} from "./lib/mailbox-routing";
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
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = canonicalMailboxId(rawEmail);
	if (!email) return c.json({ error: "Invalid mailbox email address" }, 400);
	const allowed = allowedMailboxSet((c.env.EMAIL_ADDRESSES ?? []) as string[]);
	if (allowed.size > 0 && !allowed.has(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = mailboxMetadataKey(email);
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = resolveMailboxParam(c.req.param("mailboxId"));
	if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
	const obj = await c.env.BUCKET.get(mailboxMetadataKey(mailboxId));
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = resolveMailboxParam(c.req.param("mailboxId"));
	if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = mailboxMetadataKey(mailboxId);
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json({ error: "Not found" }, 404);
	let existing: Record<string, unknown> = {};
	try {
		const parsed = await obj.json();
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch {
		existing = {};
	}
	const merged = mergeMailboxSettingsBlob(existing, settings);
	const automationError = automationSettingsError(
		parseAutomationSettings(merged),
		mailboxId,
	);
	if (automationError) return c.json({ error: automationError }, 400);
	await c.env.BUCKET.put(key, JSON.stringify(merged));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: merged });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = resolveMailboxParam(c.req.param("mailboxId"));
	if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
	const key = mailboxMetadataKey(mailboxId);
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
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
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

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

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
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
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
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

async function loadAutomationSettings(
	env: Env,
	mailboxId: string,
): Promise<MailboxAutomationSettings> {
	const obj = await env.BUCKET.get(mailboxMetadataKey(mailboxId));
	if (!obj) return {};
	try {
		return parseAutomationSettings(await obj.json());
	} catch {
		return {};
	}
}

async function applyInboundForward(options: {
	message: ForwardableEmailMessage;
	mailboxId: string;
	sender: string;
	settings: MailboxAutomationSettings;
	classification: EmailClassification;
	headers: HeaderSource;
}): Promise<void> {
	const { message, mailboxId, sender, settings, classification, headers } = options;
	const decision = shouldForward({
		enabled: Boolean(settings.forwarding?.enabled),
		dest: settings.forwarding?.email,
		mailboxId,
		sender,
		classification,
		headers,
		canBeForwarded: (message as { canBeForwarded?: boolean }).canBeForwarded,
	});
	if (!decision.ok) {
		if (settings.forwarding?.enabled) {
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
	const fromAddress = (parsedEmail.from?.address || message.from || "").toLowerCase();
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
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
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

	const fromHeaders = JSON.stringify(parsedEmail.headers);
	const senderName =
		normalizeDisplayName(parsedEmail.from?.name) ??
		senderNameFromRawHeaders(fromHeaders);

	const classification = await classifyInboundEmail(
		{
			headers: parsedEmail.headers,
			subject: parsedEmail.subject,
			sender: fromAddress,
			bodyText: parsedEmail.text,
			bodyHtml: parsedEmail.html,
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
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: fromHeaders,
	};

	let filedFolder: string = classification.folderId;
	try {
		await stub.createEmail(classification.folderId, inboundEmail, attachmentData);
	} catch (e) {
		if (!shouldFallbackToInbox(classification.folderId, e)) throw e;
		console.error(
			`Failed to file inbound mail to ${classification.folderId}, falling back to inbox:`,
			(e as Error).message,
		);
		await stub.createEmail(Folders.INBOX, inboundEmail, attachmentData);
		filedFolder = Folders.INBOX;
	}

	try {
		const automationSettings = await loadAutomationSettings(env, mailboxId);
		await applyInboundForward({
			message,
			mailboxId,
			sender: fromAddress,
			settings: automationSettings,
			classification,
			headers: message.headers,
		});
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
	} catch (e) {
		console.error(
			`Inbound automations failed for ${mailboxId}:`,
			(e as Error).message,
		);
	}

	// Auto-draft personal ham only. Spam and bulk skip the agent entirely.
	if (shouldAutoDraft(classification)) {
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

	if (!shouldSendPush(classification)) {
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

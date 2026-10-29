// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { oneClickUnsubscribeUrl, sendOneClickUnsubscribe } from "./lib/list-unsubscribe";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { isDevRuntime } from "./lib/dev-runtime";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import {
	assertOutboundMessageSize,
	OutboundSizeError,
} from "./lib/outbound-limits";
import { enqueueOutboundSendFromEnv } from "./lib/outbound-send-queue";
import {
	checkIdempotencyKey,
	discardReplayedSend,
	idempotentReplayResponse,
	type CreateEmailResult,
} from "./lib/outbound-idempotency";
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
import { inboxSectionTotal, parseInboxSectionQuery } from "../shared/list-sections";
import {
	AUTO_CONVERSATION_ID,
	agentInstanceName,
} from "../shared/agent-conversations";
import { getEmailAgent, purgeEmailAgent, purgeEmailAgents } from "./lib/email-agent";
import { getPlanTier, tryConsumeAiQuota } from "./lib/ai-quota";
import { resolveGreetingName } from "./lib/inbox-digest";
import { composePushAlert } from "./lib/push-payload";
import { seedWelcomeEmailsForMailbox } from "./lib/welcome-emails";
import type { Env } from "./types";
import type { AiSummaryResponse } from "../shared/ai-summaries";
import type { MailboxSummaryResult } from "./durableObject";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import {
	CreateThreadNoteSchema,
	UpdateThreadNoteSchema,
	isValidNoteRouteId,
} from "./lib/thread-notes";
import {
	authDb,
	canCreateMailbox,
	listMailboxMembers,
	isDomainAdmin,
	listMailboxesForUser,
	type AuthDb,
} from "./auth/authz";
import { deviceTokenOwnerKeys } from "./auth/principal";
import {
	deleteMailboxRows,
	mailboxPayload,
	MailboxExistsError,
	provisionMailbox,
	stripAclFromSettings,
} from "./auth/mailboxes";
import type { MailboxRole } from "./auth/schema";
import { registerAccountRoutes } from "./routes/account";
import { registerAdminAndInviteRoutes } from "./routes/admin-invites";
import { registerOnboardingRoutes } from "./routes/onboarding";
import { registerDomainDnsRoutes } from "./routes/domain-dns";
import { registerBillingRoutes } from "./routes/billing";
import { registerExportAndOffboardingRoutes } from "./routes/export-and-offboarding";
import { registerAliasRoutes } from "./routes/aliases";
import { blockSuppressedSend, registerSuppressionRoutes } from "./routes/suppressions";
import {
	applyInboundDsn,
	parseDeliveryStatusReport,
	type AppliedDsn,
	type DsnStub,
} from "./lib/inbound-dsn";
import { getDomainMetadata } from "./lib/domain-registry";
import { isMailboxSuspended, mailboxServiceSummary, suspendedDomains } from "./lib/domain-service";
import { dispatchPushToDevices } from "./lib/push-dispatch";
import { parseReminderInput } from "./lib/reply-later-reminders";
import {
	aliasMetadataKey,
	allowedMailboxSet,
	canonicalMailboxId,
	isAddressTaken,
	isReservedLocalPart,
	isDuplicateInbound,
	mailboxMetadataKey,
	routeInboundEnvelope,
} from "./lib/mailbox-routing";
import {
	autoReplySender,
	isAliasExpired,
	isPrivateAliasMeta,
	type AnyAliasMetadata,
} from "./lib/alias-utils";
import {
	findInboundThreadId,
	findThreadAliasId,
	resolveOutboundSender,
	type AliasSenderStub,
	type InboundThreadStub,
} from "./lib/alias-sender";
import { mailDomainConfig } from "./lib/mail-domain";
import {
	inboundClassificationReason,
	storedAuthTier,
} from "./lib/classification-reason";
import {
	decidingSenderRuleId,
	normalizeSenderRuleInput,
	triageWithSenderRule,
	type SenderRule,
} from "./lib/sender-rules";
import { ClassificationReasons } from "../shared/spam-reason";
import {
	classifyInboundEmail,
	applySenderTrust,
	deferAuthenticatedAiSpamToScreener,
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
	senderTrustOf,
	senderLessonForMove,
	normalizeTriageSender,
	parseScreenerEnabled,
	pinnedPreferenceFolderId,
	resolveInboundFolder,
	screenerAcceptDestination,
	screenerSettingsError,
} from "./lib/sender-triage";
import { recordSenderAllow, recordSenderBlock } from "./lib/sender-verdicts";
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

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt reaches the AI after the fixed SAFETY_PREAMBLE (lib/agent-safety.ts)
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

// Malformed client input is a 400, not a 500: zod parse failures, unparseable
// JSON bodies, and invalid base64 attachments (atob).
app.onError((err, c) => {
	if (err instanceof HTTPException) return err.getResponse();
	if (err instanceof z.ZodError) {
		const issue = err.issues[0];
		const where = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
		return c.json({ error: `${where}${issue?.message ?? "Invalid request body"}` }, 400);
	}
	if (err instanceof SyntaxError) {
		return c.json({ error: "Request body must be valid JSON" }, 400);
	}
	if ((err as { name?: string })?.name === "InvalidCharacterError") {
		return c.json({ error: "Attachment content must be valid base64" }, 400);
	}
	console.error("Unhandled API error:", err);
	return c.json({ error: "Internal server error" }, 500);
});
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
// Also matches /api/v1/mailboxes/:mailboxId itself.
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const { mailDomain, domains } = mailDomainConfig(c.env);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({
		mailDomain,
		domains,
		emailAddresses,
		/** OAuth Web client id for GIS / Connect Google (same aud as mobile). */
		googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
		/** True when Sign in with Apple can be verified (iOS bundle aud). */
		appleSignInConfigured: Boolean(c.env.APPLE_CLIENT_ID),
		/** Services ID for Sign in with Apple on the web login page; null hides the button. */
		appleWebClientId: c.env.APPLE_CLIENT_ID ? (c.env.APPLE_WEB_SERVICES_ID ?? null) : null,
	});
});

registerAccountRoutes(app);
registerAdminAndInviteRoutes(app);
registerOnboardingRoutes(app);
registerDomainDnsRoutes(app);
registerBillingRoutes(app);
registerExportAndOffboardingRoutes(app);
registerAliasRoutes(app);
registerSuppressionRoutes(app);

// -- Mailboxes ------------------------------------------------------

/**
 * `settings.acl` for app builds that still render it. Display only: the keys
 * are `email:` strings clients know how to show, and PUT ignores `acl`
 * (membership changes go through invites and the members routes).
 */
async function compatAcl(db: AuthDb, mailboxId: string) {
	const members = await listMailboxMembers(db, mailboxId);
	return {
		owners: members.filter((m) => m.role === "owner").map((m) => `email:${m.email}`),
		members: members.filter((m) => m.role === "member").map((m) => `email:${m.email}`),
	};
}

async function mailboxResponse(
	env: Env,
	db: AuthDb,
	mailboxId: string,
	role: MailboxRole | null,
	settings?: Record<string, unknown>,
) {
	const payload = mailboxPayload(mailboxId, settings ?? (await loadMailboxSettingsRaw(env, mailboxId)), role);
	return { ...payload, settings: { ...payload.settings, acl: await compatAcl(db, mailboxId) } };
}

/** Purge a mailbox's DO + R2 data, its EmailAgent conversations and its AUTH_DB rows. */
export async function purgeMailboxAndAgents(env: Env, mailboxId: string): Promise<void> {
	// Purge DO + R2 and remove metadata inside the DO RPC (closes inbound HEAD).
	const stub = getMailboxStub(env, mailboxId);
	const { conversationIds } = await stub.purgeMailbox(mailboxId);
	await purgeEmailAgents(env, mailboxId, conversationIds);
	await deleteMailboxRows(authDb(env.AUTH_DB), mailboxId);
}

app.get("/api/v1/mailboxes", async (c) => {
	const principal = c.get("principal");
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listMailboxesForUser(authDb(c.env.AUTH_DB), principal.userId);
	const suspended = await suspendedDomains(
		c.env,
		rows.map(({ mailboxId }) => mailboxId.slice(mailboxId.lastIndexOf("@") + 1)),
	);
	return c.json(
		rows.map(({ mailboxId, role }) => ({
			id: mailboxId,
			email: mailboxId,
			name: mailboxId,
			role,
			canManage: role === "owner",
			// The domain's subscription ended: read and export only.
			readOnly: suspended.has(mailboxId.slice(mailboxId.lastIndexOf("@") + 1)),
		})),
	);
});

app.post("/api/v1/mailboxes", async (c) => {
	const principal = c.get("principal");
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = canonicalMailboxId(rawEmail);
	if (!email) return c.json({ error: "Invalid mailbox email address" }, 400);
	const allowed = allowedMailboxSet((c.env.EMAIL_ADDRESSES ?? []) as string[]);
	if (allowed.size > 0 && !allowed.has(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const db = authDb(c.env.AUTH_DB);
	// `admin_only` keeps the shared platform domains closed: addresses there
	// then come from sign-up or an operator (/ops).
	const platformDomains =
		c.env.MAILBOX_CREATE_POLICY?.trim().toLowerCase() === "admin_only" ? [] : mailDomainConfig(c.env).domains;
	const check = await canCreateMailbox(db, { userId: principal.userId, address: email, platformDomains });
	if (!check.ok) return c.json({ error: check.error }, check.status);
	try {
		const stored = await provisionMailbox(c.env, {
			mailboxId: check.mailboxId,
			ownerUserId: principal.userId,
			name,
			settings: settings ? stripAclFromSettings(settings) : undefined,
		});
		return c.json({ ...(await mailboxResponse(c.env, db, check.mailboxId, "owner", stored)), name }, 201);
	} catch (e) {
		if (e instanceof MailboxExistsError) return c.json({ error: "Address is already in use" }, 409);
		throw e;
	}
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const db = authDb(c.env.AUTH_DB);
	const domain = c.var.mailboxId.slice(c.var.mailboxId.lastIndexOf("@") + 1);
	const [mailbox, summary, canManage] = await Promise.all([
		mailboxResponse(c.env, db, c.var.mailboxId, c.var.mailboxRole),
		mailboxServiceSummary(c.env, c.var.mailboxId),
		isDomainAdmin(db, c.get("principal")?.userId ?? "", domain),
	]);
	// canManage: whether this user may renew (domain owner/admin).
	const service = summary ? { ...summary, canManage } : null;
	// readOnly follows the same D1 status the write gates check.
	return c.json({ ...mailbox, service, readOnly: await isMailboxSuspended(c.env, c.var.mailboxId) });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const db = authDb(c.env.AUTH_DB);
	const mailboxId = c.var.mailboxId;
	const role = c.var.mailboxRole;
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const existing = await loadMailboxSettingsRaw(c.env, mailboxId);
	// Clients send their cached `settings.acl` back on every save; membership
	// lives in AUTH_DB, so it is ignored here (never a way to grant access).
	const incoming =
		settings && typeof settings === "object" && !Array.isArray(settings) ? stripAclFromSettings(settings) : {};
	const next = stripAclFromSettings(mergeMailboxSettingsBlob(existing, incoming));
	// Settings that send mail elsewhere or steer the agent are owner-only: a
	// member could otherwise forward the mailbox to themselves and keep it after
	// being removed. Clients PUT the whole blob, so compare against what's stored.
	if (role !== "owner") {
		const ownerOnlyKeys = ["forwarding", "autoReply", "filters", "agentSystemPrompt"] as const;
		const changed = ownerOnlyKeys.filter(
			(key) => JSON.stringify(existing[key] ?? null) !== JSON.stringify(next[key] ?? null),
		);
		if (changed.length > 0) {
			return c.json({ error: `Only mailbox owners can change ${changed.join(", ")}` }, 403);
		}
	}
	const automationError = automationSettingsError(parseAutomationSettings(next), mailboxId);
	if (automationError) return c.json({ error: automationError }, 400);
	const filtersError = inboxFiltersError(parseInboxFilters(next), mailboxId);
	if (filtersError) return c.json({ error: filtersError }, 400);
	const screenerError = screenerSettingsError(next);
	if (screenerError) return c.json({ error: screenerError }, 400);
	await c.env.BUCKET.put(mailboxMetadataKey(mailboxId), JSON.stringify(next));
	// Turning Screener off (AVE-104) lets waiting mail through: it moves to
	// Inbox. Turning it back on screens only new mail.
	if (parseScreenerEnabled(existing) && !parseScreenerEnabled(next)) {
		const { moved } = await c.var.mailboxStub.releaseScreenerToInbox();
		if (moved > 0) console.log(`Screener off for ${mailboxId}: moved ${moved} message(s) to Inbox`);
	}
	return c.json(await mailboxResponse(c.env, db, mailboxId, role, next));
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	if (c.var.mailboxRole !== "owner") return c.json({ error: "Forbidden" }, 403);
	await purgeMailboxAndAgents(c.env, c.var.mailboxId);
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
		// Inbox: `section=new|seen` lists one section; `new_limit=N` keeps the
		// newest N New conversations above every Seen one (AVE-23).
		const inboxSections =
			folder === Folders.INBOX
				? parseInboxSectionQuery(c.req.query("section"), c.req.query("new_limit"))
				: undefined;
		const emails = await (stub as any).getThreadedEmails({
			folder,
			page,
			limit,
			userId: c.get("principal")?.userId,
			inboxSections,
		});
		if (folder === Folders.INBOX) {
			const sections = await (stub as any).countThreadedEmailSections(folder);
			return c.json({
				emails,
				totalCount: inboxSectionTotal(sections, inboxSections ?? {}),
				newCount: sections.newCount,
				seenCount: sections.seenCount,
			});
		}
		const totalCount = await (stub as any).countThreadedEmails(folder);
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
	const stub = c.var.mailboxStub;
	// A retried send with a stored Idempotency-Key returns the original row.
	const idem = await checkIdempotencyKey(c, stub);
	if ("response" in idem) return idem.response;

	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

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

	const aliasStub = stub as unknown as AliasSenderStub;
	const sender = await resolveOutboundSender({
		stub: aliasStub,
		mailboxId,
		requestedFrom: body.from,
		threadAliasId: await findThreadAliasId(aliasStub, { threadId: resolvedThreadId }),
	});
	if (!sender.ok) {
		return c.json({ error: sender.error, ...(sender.code ? { code: sender.code } : {}) }, sender.status);
	}
	const from = sender.from;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(
			to,
			from,
			mailboxId,
			sender.aliasId ? [sender.fromEmail] : undefined,
		));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	// Suppressed recipients (hard bounce / complaint) block the send before a
	// slot is reserved or a Sent row exists.
	const suppressed = await blockSuppressedSend(c, { fromEmail, to, cc, bcc });
	if (suppressed) return suppressed;

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	// Validate before reserving a send slot, so a refused message is free.
	try {
		assertOutboundMessageSize({ html, text, attachments });
	} catch (e) {
		if (e instanceof OutboundSizeError) return c.json({ error: e.message }, 413);
		throw e;
	}
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);

	if (!resolvedThreadId) {
		resolvedThreadId = messageId;
	}

	let created: CreateEmailResult | undefined;
	let attachmentData: Awaited<ReturnType<typeof storeAttachments>> = [];
	try {
		attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);
		created = await stub.createEmail(Folders.SENT, {
			id: messageId, subject, sender: fromEmail,
			sender_name: displayNameFromAddressField(from),
			recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(), body: html || text || "",
			in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
			thread_id: resolvedThreadId, message_id: outgoingMessageId,
			delivery_status: "queued", delivery_error: null,
			alias_id: sender.aliasId,
			idempotency_key: idem.key,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${outgoingMessageId}>` },
			]),
		}, attachmentData);
	} catch (e) {
		// Not accepted, so it shouldn't count against the send quota.
		await (stub as any).releaseSendSlot().catch(() => {});
		throw e;
	}
	if (created?.replayed) {
		// A concurrent request with this key won: send nothing more.
		await discardReplayedSend(c.env, stub, messageId, attachmentData);
		return idempotentReplayResponse(c, created.id);
	}

	// Screener-lite: people you email bypass the review queue on reply.
	await allowOutboundRecipients(stub as any, to, cc, bcc);
	if (in_reply_to || thread_id) {
		await (stub as any).clearReplyLaterForThread(resolvedThreadId);
	}

	await enqueueOutboundSendFromEnv(c.env, mailboxId, messageId, {
		to, cc, bcc, from, subject, html, text,
		attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
		...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
	});
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
			source: null,
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

	// A reply draft in a private-email thread carries the alias, so clients
	// reopening it show the alias as From (the send path enforces it anyway).
	const aliasStub = stub as unknown as AliasSenderStub;
	const draftAliasId = await findThreadAliasId(aliasStub, { threadId: resolvedThreadId });
	const draftAlias = draftAliasId ? await aliasStub.getAlias(draftAliasId) : null;

	const messageId = crypto.randomUUID();
	if (!resolvedThreadId) {
		resolvedThreadId = messageId;
	}

	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: draftFields.subject,
		sender: (draftAlias?.alias_email ?? mailboxId).toLowerCase(),
		recipient: draftFields.recipient, cc: draftFields.cc, bcc: draftFields.bcc,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: resolvedThreadId,
		alias_id: draftAlias?.id ?? null,
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
	const body = (await c.req.json()) as {
		read?: boolean;
		starred?: boolean;
		reply_later?: boolean;
		/** UTC ISO reminder time, or null to clear (AVE-86). Setting one implies reply_later. */
		reply_later_remind_at?: string | null;
	};
	const { read, starred, reply_later } = body;
	let reply_later_remind_at: string | null | undefined;
	if (body.reply_later_remind_at !== undefined) {
		const parsed = parseReminderInput(body.reply_later_remind_at);
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		reply_later_remind_at = parsed.remindAt;
	}
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, {
		read,
		starred,
		reply_later,
		reply_later_remind_at,
	}, c.var.mailboxId);
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	// Outside Trash this moves to Trash (restorable); from Trash/Drafts it is permanent.
	const result = await (c.var.mailboxStub as any).trashOrDeleteEmail(id);
	if (result === null) return c.json({ error: "Not found" }, 404);
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/folders/trash/empty", async (c: AppContext) => {
	const deleted = await (c.var.mailboxStub as any).emptyTrash();
	return c.json({ deleted });
});

/**
 * Move a message. Every move into or out of Spam teaches the mailbox about
 * the sender, whichever client path made it (Not spam / Report spam, the
 * move menu, swipe, multi-select; docs/spam-management-plan.md §5–6):
 * - into Spam ("Report spam"): the sender is rejected (future mail is
 *   screened out) and loses any purpose-box default;
 * - out of Spam ("Not spam"): the sender is allowed, filed to the
 *   destination when it's a purpose box. Leaving Spam for Trash or
 *   Screened out teaches nothing.
 * With `setSenderPreference`, a move between purpose boxes also changes the
 * sender's default box. Agent/MCP `move_email` doesn't come through here and
 * stays neutral.
 *
 * A Spam verdict is retroactive and undoable (AVE-98, lib/sender-verdict-undo):
 * Not spam also rescues the sender's other Spam from the last 30 days, and
 * Report spam also moves their Inbox / Promotions / Updates mail to Spam
 * unless `refileSender` is false. The response carries `rescuedCount` (other
 * messages moved) and an `undoToken` for `POST sender-rules/undo`.
 */
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const body = (await c.req.json()) as {
		folderId: string;
		setSenderPreference?: boolean;
		/** Report spam on RFC 8058 bulk mail: also send the one-click unsubscribe (AVE-99). */
		unsubscribe?: boolean;
		/** Report spam: also move the sender's Inbox / Promotions / Updates mail to Spam. Default true (AVE-98). */
		refileSender?: boolean;
	};
	const { folderId, setSenderPreference } = body;
	const emailId = c.req.param("id")!;
	const stub = c.var.mailboxStub;

	// Read first: whether the move crosses Spam depends on where it came from.
	const before = await stub.getEmail(emailId);
	const success = await stub.moveEmail(emailId, folderId);
	if (!success) return c.json({ error: "Email or destination folder not found" }, 400);

	const lesson = senderLessonForMove({
		sender: before?.sender,
		mailboxId: c.var.mailboxId,
		fromFolderId: before?.folder_id,
		toFolderId: folderId,
		remember: setSenderPreference === true,
	});
	if (lesson.kind === "none") return c.json({ status: "moved" });
	const { sender } = lesson;
	const displayName = before?.sender_name ?? null;
	// What the verdict overwrites, so Undo can put it back (AVE-98).
	const verdictState =
		lesson.kind === "reject" || lesson.kind === "allow"
			? await stub.captureSenderVerdictState(sender)
			: null;

	if (lesson.kind === "reject") {
		const triage = await recordSenderBlock(stub, { sender, displayName });
		const retro = verdictState
			? await stub.finishSenderVerdict({
					kind: "block",
					state: verdictState,
					primary: {
						id: emailId,
						from: before!.folder_id,
						to: folderId,
						replyLater: Boolean(before?.reply_later),
						replyLaterAt: before?.reply_later_at ?? null,
					},
					refile: body.refileSender !== false,
				})
			: { rescuedCount: 0, undoToken: null };
		// Only a real move into Spam unsubscribes, and only once per message:
		// a retry sees the message already in Spam (lesson "none"), and the
		// DO claim stops a concurrent double tap.
		const unsubscribeUrl =
			body.unsubscribe === true ? oneClickUnsubscribeUrl(before?.raw_headers) : null;
		if (unsubscribeUrl && (await stub.claimOneClickUnsubscribe(emailId))) {
			const result = await sendOneClickUnsubscribe(unsubscribeUrl);
			return c.json({
				status: "moved",
				senderStatus: "rejected",
				triage,
				unsubscribe: result.status,
				...retro,
			});
		}
		return c.json({ status: "moved", senderStatus: "rejected", triage, ...retro });
	}

	if (lesson.kind === "allow") {
		const triage = await recordSenderAllow(stub, {
			sender,
			destination: lesson.destination,
			displayName,
		});
		const retro = verdictState
			? await stub.finishSenderVerdict({
					kind: "allow",
					state: verdictState,
					primary: { id: emailId, from: before!.folder_id, to: folderId },
					refile: true,
				})
			: { rescuedCount: 0, undoToken: null };
		return c.json({ status: "moved", senderStatus: "allowed", triage, ...retro });
	}

	const upsertError = senderPreferenceUpsertError({
		address: sender,
		folderId,
	});
	if (upsertError) {
		// Move already succeeded; preference is optional on this path.
		return c.json({ status: "moved", preferenceError: upsertError });
	}

	const result = await stub.upsertSenderPreference({
		address: sender,
		folderId,
		displayName,
		source: "user",
		refile: true,
	});
	const triage = await stub.getSenderTriage(sender);
	if (triage?.status === "allowed") {
		await stub.upsertSenderTriage({
			sender,
			status: "allowed",
			destination_folder_id: folderId,
			display_name: displayName ?? triage.display_name ?? null,
		});
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

		// Removing a sender's purpose box hands them back to automatic sorting.
		const stub = c.var.mailboxStub as any;
		const triage = await stub.getSenderTriage?.(address);
		if (triage?.status === "allowed" && triage.destination_folder_id) {
			await stub.upsertSenderTriage({
				sender: address,
				status: "allowed",
				destination_folder_id: null,
				display_name: triage.display_name ?? null,
			});
		}
		return c.body(null, 204);
	},
);

// -- Sender rules (explicit allow / block list) ----------------------
// docs/spam-management-plan.md §5, §7. Same mailbox access as the other
// sender settings: any owner or member of the mailbox.

app.get("/api/v1/mailboxes/:mailboxId/sender-rules", async (c: AppContext) => {
	const rules = await c.var.mailboxStub.listSenderRules({
		verdict: c.req.query("verdict") || null,
		kind: c.req.query("kind") || null,
		q: c.req.query("q") || null,
		limit: intQuery(c, "limit") ?? null,
	});
	return c.json({ rules });
});

/**
 * Create or update the rule for an address or domain: `{kind, value,
 * verdict}`. Domains are stored as the registrable domain; public suffixes
 * (`co.uk`) and free-mail providers (`gmail.com`) are refused with a `code`
 * clients can show inline. 201 when created, 200 when an existing rule for
 * the same value changed.
 */
app.put("/api/v1/mailboxes/:mailboxId/sender-rules", async (c: AppContext) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const checked = normalizeSenderRuleInput(body, { mailboxId: c.var.mailboxId });
	if (!checked.ok) return c.json({ error: checked.error, code: checked.code }, 400);
	const { rule, created } = await c.var.mailboxStub.upsertSenderRule(checked.rule);
	return c.json({ rule }, created ? 201 : 200);
});

/**
 * Undo a Not spam / Report spam (AVE-98): `{undoToken}` from the move
 * response. Puts the sender's rule, Screener status and purpose box back and
 * moves the messages back where they were (unless moved again since). 404
 * when the token is unknown, already used or expired.
 */
app.post("/api/v1/mailboxes/:mailboxId/sender-rules/undo", async (c: AppContext) => {
	let body: { undoToken?: unknown };
	try {
		body = (await c.req.json()) as { undoToken?: unknown };
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const token = typeof body?.undoToken === "string" ? body.undoToken.trim() : "";
	if (!token || token.length > 128) return c.json({ error: "undoToken is required" }, 400);
	const result = await c.var.mailboxStub.undoSenderVerdict(token);
	if (!result) return c.json({ error: "Nothing to undo", code: "undo_expired" }, 404);
	return c.json({ status: "undone", restoredCount: result.restoredCount });
});

app.delete("/api/v1/mailboxes/:mailboxId/sender-rules/:ruleId", async (c: AppContext) => {
	const ruleId = c.req.param("ruleId")!;
	if (!ruleId || ruleId.length > 128) return c.json({ error: "Invalid rule id" }, 400);
	const deleted = await c.var.mailboxStub.deleteSenderRule(ruleId);
	if (!deleted) return c.json({ error: "Not found" }, 404);
	return c.body(null, 204);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- AI usage meters (AVE-45) ---------------------------------------
// Today's per-mailbox AI counters and limits; read-only, one DO query.
app.get("/api/v1/mailboxes/:mailboxId/ai-usage", async (c: AppContext) => {
	const usage = await c.var.mailboxStub.getAiUsage(getPlanTier(c.var.mailboxId));
	c.header("Cache-Control", "no-store");
	return c.json(usage);
});

// -- AI summaries (AVE-20) ------------------------------------------
// Generated lazily on first open and stored in the mailbox DO. Gating
// (folder, screened-out sender, length, multi-message for quick summaries)
// lives in lib/ai-summary.ts; responses are AiSummaryResponse.

const MAX_SUMMARY_ROUTE_ID = 512;

const GenerateEmailSummaryBody = z.object({ regenerate: z.boolean().optional() }).strict();

async function summaryResponse(
	c: AppContext,
	run: () => Promise<MailboxSummaryResult | null>,
	notFound: string,
) {
	const result = await run();
	if (!result) return c.json({ error: notFound }, 404);
	if (result.status === "generation_failed") {
		console.error("AI summary failed:", result.error);
		return c.json({ error: "Couldn't generate a summary. Try again." }, 502);
	}
	return c.json(result satisfies AiSummaryResponse);
}

function summaryRouteId(c: AppContext, name: string): string | null {
	const id = c.req.param(name);
	return id && id.length <= MAX_SUMMARY_ROUTE_ID ? id : null;
}

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId/summary", async (c: AppContext) => {
	const threadId = summaryRouteId(c, "threadId");
	if (!threadId) return c.json({ error: "Thread not found" }, 404);
	return summaryResponse(c, () => c.var.mailboxStub.getThreadSummary(threadId, "lazy"), "Thread not found");
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/summary/regenerate", async (c: AppContext) => {
	const threadId = summaryRouteId(c, "threadId");
	if (!threadId) return c.json({ error: "Thread not found" }, 404);
	return summaryResponse(c, () => c.var.mailboxStub.getThreadSummary(threadId, "force"), "Thread not found");
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id/summary", async (c: AppContext) => {
	const emailId = summaryRouteId(c, "id");
	if (!emailId) return c.json({ error: "Email not found" }, 404);
	return summaryResponse(c, () => c.var.mailboxStub.getEmailSummary(emailId, "cached"), "Email not found");
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/summary/generate", async (c: AppContext) => {
	const emailId = summaryRouteId(c, "id");
	if (!emailId) return c.json({ error: "Email not found" }, 404);
	const raw = await c.req.text();
	const { regenerate } = GenerateEmailSummaryBody.parse(raw.trim() ? JSON.parse(raw) : {});
	return summaryResponse(
		c,
		() => c.var.mailboxStub.getEmailSummary(emailId, regenerate ? "force" : "lazy"),
		"Email not found",
	);
});

// -- Notes to self --------------------------------------------------
// Private to their author: every call is scoped to the signed-in user, and
// someone else's note is a 404, the same as a missing one.

function noteAuthorId(c: AppContext): string | null {
	return c.get("principal")?.userId ?? null;
}

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId/notes", async (c: AppContext) => {
	const userId = noteAuthorId(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const threadId = c.req.param("threadId");
	if (!isValidNoteRouteId(threadId)) return c.json({ error: "Invalid thread id" }, 400);
	const notes = await c.var.mailboxStub.getThreadNotes(threadId, userId);
	return c.json({ notes });
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/notes", async (c: AppContext) => {
	const userId = noteAuthorId(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const threadId = c.req.param("threadId");
	if (!isValidNoteRouteId(threadId)) return c.json({ error: "Invalid thread id" }, 400);
	const input = CreateThreadNoteSchema.parse(await c.req.json());
	const result = await c.var.mailboxStub.createThreadNote(threadId, userId, input);
	if (!result.ok) {
		return result.error === "thread_not_found"
			? c.json({ error: "Thread not found" }, 404)
			: c.json({ error: "emailId: message is not in this thread" }, 400);
	}
	return c.json(result.note, 201);
});

app.patch("/api/v1/mailboxes/:mailboxId/notes/:noteId", async (c: AppContext) => {
	const userId = noteAuthorId(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const noteId = c.req.param("noteId");
	if (!isValidNoteRouteId(noteId)) return c.json({ error: "Note not found" }, 404);
	const input = UpdateThreadNoteSchema.parse(await c.req.json());
	const note = await c.var.mailboxStub.updateThreadNote(noteId, userId, input);
	return note ? c.json(note) : c.json({ error: "Note not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/notes/:noteId", async (c: AppContext) => {
	const userId = noteAuthorId(c);
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const noteId = c.req.param("noteId");
	if (!isValidNoteRouteId(noteId)) return c.json({ error: "Note not found" }, 404);
	const deleted = await c.var.mailboxStub.deleteThreadNote(noteId, userId);
	return deleted ? c.body(null, 204) : c.json({ error: "Note not found" }, 404);
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
	const principal = c.get("principal");
	await c.var.mailboxStub.registerDeviceToken(
		token,
		platform || "ios",
		principal ? deviceTokenOwnerKeys(principal) : [],
	);
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
	if ("error" in f) {
		switch (f.error) {
			case "not_found":
				return c.json({ error: "Folder not found" }, 404);
			case "system":
				return c.json({ error: "System folders can't be renamed" }, 400);
			case "conflict":
				return c.json({ error: "Folder with this name already exists" }, 409);
			default:
				return c.json({ error: "Folder name is required" }, 400);
		}
	}
	return c.json(f);
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

	// Accept is consent, not a filing rule (AVE-139): Inbox (the default)
	// pins nothing, so the classifier still sorts their newsletters and
	// receipts. Only a picked Promotions / Updates sticks. This message and
	// the queued ones still go where the user accepted them.
	const pinned = screenerAcceptDestination(destinationFolderId);
	const triage = await stub.upsertSenderTriage({
		sender,
		status: "allowed",
		destination_folder_id: pinned,
		display_name: body.displayName ?? null,
	});
	if (pinned) {
		await stub.upsertSenderPreference({
			address: sender,
			folderId: pinned,
			displayName: body.displayName ?? null,
			source: "screener",
			refile: false,
		});
	} else {
		// Drop an earlier Screener pick; a box the user chose elsewhere stays.
		const existingPref = await stub.getSenderPreference(sender);
		if (existingPref?.source === "screener") await stub.deleteSenderPreference(sender);
	}
	// Accepting is implicit trust, not an allow rule; it only stops an earlier
	// address block (a backfilled or Report spam one) from still winning.
	await stub.clearAddressBlockRule(sender);

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
	// The decline shows in Settings → Blocked as an address block rule.
	await stub.setAddressSenderRule(sender, "block", "screener");

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

	// Allowed without a chosen destination stays null → classify files it.
	let destinationFolderId: string | null = null;
	if (status === "allowed") {
		destinationFolderId =
			(body.destinationFolderId || existing?.destination_folder_id || "").trim() ||
			null;
		if (destinationFolderId && !isScreenerDestination(destinationFolderId)) {
			return c.json(
				{ error: "destinationFolderId must be inbox, promotions, or updates" },
				400,
			);
		}
	}
	// Same as approve: Inbox is the default, not a pin (AVE-139).
	const pinned =
		destinationFolderId && isScreenerDestination(destinationFolderId)
			? screenerAcceptDestination(destinationFolderId)
			: null;

	const triage = await stub.upsertSenderTriage({
		sender,
		status,
		destination_folder_id: pinned,
		display_name: body.displayName ?? existing?.display_name ?? null,
	});
	if (status === "allowed" && pinned) {
		await stub.upsertSenderPreference({
			address: sender,
			folderId: pinned,
			displayName: body.displayName ?? existing?.display_name ?? null,
			source: "screener",
			refile: false,
		});
	} else if (status === "rejected") {
		await stub.deleteSenderPreference(sender);
	}
	// Same rule writes as approve / reject, so an address block rule never
	// outlives an unblock here.
	if (status === "rejected") await stub.setAddressSenderRule(sender, "block", "screener");
	else await stub.clearAddressBlockRule(sender);

	let moved = { moved: 0, ids: [] as string[] };
	if (body.refileQueued) {
		const toFolder =
			status === "rejected"
				? Folders.SCREENED_OUT
				: destinationFolderId ?? Folders.INBOX;
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
	// Back to undecided: a leftover address block rule would keep them out.
	const clearedRule = await stub.clearAddressBlockRule(sender);
	return ok || clearedRule ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
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
		if (!ok) return c.json({ error: "Conversation not found" }, 404);
		// The registry row is gone; wipe the chat itself. On failure the
		// tombstone stays and mailbox purge retries it.
		const name = agentInstanceName(c.var.mailboxId, conversationId);
		if (await purgeEmailAgent(c.env, name)) {
			await stub.clearAgentConversationTombstone(conversationId);
		}
		return c.body(null, 204);
	},
);

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
/** SMTP reply for mail over MAX_EMAIL_SIZE (RFC 3463 5.3.4: message too big for system). */
const OVERSIZE_REJECT_REASON = "552 5.3.4 Message size exceeds fixed limit";
/** A mailbox being purged (or already purged) refuses mail with a permanent error. */
const MAILBOX_UNAVAILABLE_REJECT_REASON = "550 5.2.1 Mailbox unavailable";

/** Thrown when an inbound message is (or turns out to be) larger than MAX_EMAIL_SIZE. */
class EmailTooLargeError extends Error {
	readonly size: number;
	constructor(size: number) {
		super(`Email too large: ${size} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
		this.name = "EmailTooLargeError";
		this.size = size;
	}
}

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new EmailTooLargeError(streamSize);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) {
			reader.cancel();
			// rawSize under-reported the message; if the real size is over the
			// limit, treat it as oversize (clean 552) rather than a failure.
			if (bytesRead + value.length > MAX_EMAIL_SIZE) throw new EmailTooLargeError(bytesRead + value.length);
			throw new Error(`Stream exceeds declared size`);
		}
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

type AutomationStub = {
	claimAutoReply: (sender: string) => Promise<boolean>;
	releaseAutoReply: (sender: string) => Promise<void>;
	checkSendRateLimit: () => Promise<string | null>;
	releaseSendSlot: () => Promise<void>;
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

export async function sendInboundAutoReply(options: {
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
	/** Address the reply comes from (a domain alias); defaults to mailboxId. */
	replyFrom?: string;
	/** Retry from here if sending from replyFrom fails. */
	replyFallback?: string | null;
}): Promise<void> {
	const {
		env, stub, mailboxId, sender, fromName, subject, originalMessageId,
		threadId, settings, classification, headers,
	} = options;
	const replyFrom = (options.replyFrom || mailboxId).toLowerCase();
	const replyFallback = options.replyFallback?.toLowerCase() || null;
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

	const fromDomain = replyFrom.split("@")[1];
	if (!fromDomain) {
		console.error(`Skipping auto-reply for ${mailboxId}: invalid mailbox`);
		return;
	}

	// Claim the once-per-sender window before touching the send quota, so
	// inbound mail that gets no reply never costs the user a send.
	const claimed = await stub.claimAutoReply(sender);
	if (!claimed) {
		console.log(`Skipping auto-reply for ${mailboxId}: already sent to ${sender} in 24h`);
		return;
	}

	const rateLimitError = await stub.checkSendRateLimit();
	if (rateLimitError) {
		console.log(`Skipping auto-reply for ${mailboxId}: ${rateLimitError}`);
		await stub.releaseAutoReply(sender).catch(() => {});
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
	const fromField = (address: string) => (fromName ? { email: address, name: fromName } : address);

	try {
		assertOutboundMessageSize({ html, text });
	} catch (e) {
		if (e instanceof OutboundSizeError) {
			console.error(`Skipping auto-reply for ${mailboxId}: ${e.message}`);
			await stub.releaseSendSlot().catch(() => {});
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

	const sendFrom = (address: string) =>
		sendEmail(env.EMAIL, {
			to: sender,
			from: fromField(address),
			subject: replySubject,
			text,
			html,
			headers: autoHeaders,
		});

	let providerMessageId: string;
	let sentFrom = replyFrom;
	try {
		try {
			providerMessageId = (await sendFrom(replyFrom)).messageId;
		} catch (aliasError) {
			// A domain alias may live on a domain that can't send yet.
			if (!replyFallback || replyFallback === replyFrom) throw aliasError;
			console.warn(
				`Auto-reply from ${replyFrom} failed, retrying from ${replyFallback}:`,
				(aliasError as Error).message,
			);
			sentFrom = replyFallback;
			providerMessageId = (await sendFrom(replyFallback)).messageId;
		}
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

	const fromHeader = fromName ? `${fromName} <${sentFrom}>` : sentFrom;
	try {
		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject: replySubject,
				sender: sentFrom,
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
	console.log(`Sent auto-reply from ${sentFrom} to ${sender}`);
}

type InboundClaimStub = {
	abandonInboundDelivery(
		emailId: string,
		messageId: string | null,
	): Promise<"stored" | "not_stored">;
};

/**
 * Inbound delivery failed before its row was stored: give the Message-ID
 * claim back so an Email Routing retry can redeliver, and delete the R2 blobs
 * this delivery wrote. If the DO says the row was stored after all, or can't
 * be asked, the blobs stay (a stuck claim goes stale on its own).
 */
async function abandonUnstoredInbound(
	env: Pick<Env, "BUCKET">,
	stub: InboundClaimStub,
	options: {
		emailId: string;
		originalMessageId: string | null;
		blobKeys: string[];
		/** The DO refused the write, so the row is certainly not stored. */
		knownUnstored?: boolean;
	},
): Promise<void> {
	let outcome: "stored" | "not_stored" | null = null;
	try {
		outcome = await stub.abandonInboundDelivery(options.emailId, options.originalMessageId);
	} catch (e) {
		console.error("Releasing inbound claim failed:", (e as Error).message);
	}
	if (outcome === "stored") return;
	if (outcome === null && !options.knownUnstored) return;
	try {
		await deleteR2Keys(env.BUCKET, options.blobKeys);
	} catch (e) {
		console.error("Deleting orphaned inbound blobs failed:", (e as Error).message);
	}
}

async function receiveEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
	// Oversize mail gets a clean SMTP rejection, not a thrown error (which the
	// email handler would rethrow, causing retries and a generic bounce).
	if (message.rawSize > MAX_EMAIL_SIZE) {
		console.log(`Rejecting email for ${message.to}: ${message.rawSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
		message.setReject(OVERSIZE_REJECT_REASON);
		return;
	}

	// A decommissioned custom domain no longer receives mail here, even if its
	// Email Routing catch-all still points at this Worker.
	// Private aliases live on private.<domain>, which belongs to <domain>.
	const recipientDomain = message.to.split("@")[1]?.toLowerCase().replace(/^private\./, "");
	const recipientDomainMeta = recipientDomain ? await getDomainMetadata(env.BUCKET, recipientDomain) : null;
	if (recipientDomainMeta?.status === "offboarding") {
		message.setReject("Domain is no longer hosted here");
		return;
	}

	// Holder object: TS does not track assignments made inside the callback.
	const aliasMatch: { meta: AnyAliasMetadata | null } = { meta: null };
	const route = await routeInboundEnvelope(
		message.to,
		async (mailboxId) =>
			Boolean(await env.BUCKET.head(mailboxMetadataKey(mailboxId))),
		async (aliasEmail) => {
			const obj = await env.BUCKET.get(aliasMetadataKey(aliasEmail));
			if (!obj) return null;
			try {
				const data = (await obj.json()) as AnyAliasMetadata;
				aliasMatch.meta = data;
				return data.targetMailboxId || null;
			} catch {
				return null;
			}
		},
	);
	if (route.action === "reject") {
		console.log(`Rejecting email for ${message.to}: ${route.reason}`);
		message.setReject(route.reason);
		return;
	}
	const mailboxId = route.mailboxId;
	// A domain whose subscription ended receives nothing, whether the mail is
	// addressed to it or reaches one of its mailboxes through an alias.
	const mailboxDomain = mailboxId.slice(mailboxId.lastIndexOf("@") + 1);
	const mailboxDomainMeta =
		mailboxDomain === recipientDomain ? recipientDomainMeta : await getDomainMetadata(env.BUCKET, mailboxDomain);
	if (recipientDomainMeta?.billing?.serviceEndedAt || mailboxDomainMeta?.billing?.serviceEndedAt) {
		message.setReject("This mailbox is not accepting mail");
		return;
	}
	const routedAliasMeta = route.resolvedViaAlias ? aliasMatch.meta : null;
	const privateAlias = isPrivateAliasMeta(routedAliasMeta) ? routedAliasMeta : null;

	// Paused or expired private email: count it, then drop or bounce.
	if (privateAlias) {
		const isExpired = isAliasExpired(privateAlias.expiresAt);
		const isPaused = privateAlias.isActive === false;
		if (isPaused || isExpired) {
			console.log(`Private email ${privateAlias.aliasEmail} is ${isExpired ? "expired" : "paused"}`);
			const targetStub = getMailboxStub(env, mailboxId);
			await (targetStub as any).recordAliasInbound(privateAlias.aliasEmail, true);
			if (privateAlias.pausedAction === "reject") {
				message.setReject(isExpired ? "Address expired" : "Address paused");
			}
			return;
		}
	}

	let rawEmail: Uint8Array;
	try {
		rawEmail = await streamToArrayBuffer(message.raw, message.rawSize);
	} catch (e) {
		if (!(e instanceof EmailTooLargeError)) throw e;
		console.log(`Rejecting email for ${message.to}: ${e.message}`);
		message.setReject(OVERSIZE_REJECT_REASON);
		return;
	}
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const recipient = allRecipients.join(", ") || message.to.toLowerCase();

	const messageId = crypto.randomUUID();

	const stub = getMailboxStub(env, mailboxId);
	if (!(await stub.isWritable())) {
		console.log(`Rejecting inbound for deleted mailbox ${mailboxId}`);
		message.setReject(MAILBOX_UNAVAILABLE_REJECT_REASON);
		return;
	}
	const fromRaw = (parsedEmail.from?.address || message.from || "").toLowerCase();
	const fromAddress = normalizeTriageSender(fromRaw) ?? fromRaw;
	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	// Same mailbox is one Durable Object, so concurrent hello@ + hello+tag@
	// deliveries and Email Routing retries of one message all meet here. Claim
	// the Message-ID before any R2 write or AI call: the DO checks `emails` and
	// inserts the claim with no await in between, so only one delivery stores
	// the message. Different mailboxes are different DOs and each keeps a copy.
	if (originalMessageId) {
		const claimed = await stub.claimInboundMessageId(originalMessageId, messageId);
		if (
			!shouldClassifyInbound({
				routeAction: "deliver",
				isDuplicate: isDuplicateInbound(originalMessageId, !claimed),
			})
		) {
			console.log(`Skipping duplicate inbound message ${originalMessageId} for ${mailboxId}`);
			return;
		}
	}

	const attachmentData: StoredAttachment[] = [];
	const inboundBlobKeys = () => [
		...emailContentKeys(messageId),
		...attachmentData.map((att) => attachmentKey(messageId, att.id, att.filename)),
	];
	// Until `createEmail` succeeds, a failure gives the claim back (so a retry
	// can redeliver) and deletes this delivery's R2 blobs.
	let stored = false;
	try {
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

		let threadId = await findInboundThreadId(stub as unknown as InboundThreadStub, {
			references: candidateReferences,
			subject: parsedEmail.subject || "",
			from: parsedEmail.from?.address || undefined,
			aliasId: privateAlias?.aliasId ?? null,
		});

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

		// A bounce report for one of our Sent messages updates that message
		// (and the suppression list) and is archived in its thread instead of
		// being filed as new mail. Unmatched reports fall through as normal mail.
		const dsnReport = parseDeliveryStatusReport(rawEmail);
		if (dsnReport) {
			let appliedDsn: AppliedDsn | null = null;
			try {
				appliedDsn = await applyInboundDsn({
					report: dsnReport,
					stub: stub as unknown as DsnStub,
					db: authDb(env.AUTH_DB),
					mailboxId,
					dsnMessageId: originalMessageId,
				});
			} catch (e) {
				console.error(`Applying inbound DSN failed for ${mailboxId}, filing normally:`, (e as Error).message);
			}
			if (appliedDsn) {
				console.log(
					`Inbound DSN for ${mailboxId} matched ${appliedDsn.originalId} (${appliedDsn.status}); suppressed ${appliedDsn.suppressed.length}`,
				);
				const dsnBody = parsedEmail.html || parsedEmail.text || "";
				await storeEmailContent(env.BUCKET, messageId, { htmlOrText: dsnBody, rawMime: rawEmail });
				await stub.createEmail(
					Folders.ARCHIVE,
					{
						id: messageId, subject: parsedEmail.subject || "",
						sender: fromAddress, sender_name: senderName, recipient,
						cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
						date: new Date().toISOString(),
						snippet: computeSnippet(dsnBody),
						search_text: computeSearchText(dsnBody, { plainText: parsedEmail.text }),
						in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
						thread_id: appliedDsn.threadId ?? threadId, message_id: originalMessageId, raw_headers: fromHeaders,
						auth: serializeEmailAuth(auth),
						classification_reason: ClassificationReasons.DELIVERY_REPORT,
						auth_tier: storedAuthTier(auth),
						alias_id: privateAlias?.aliasId || null,
						read: true,
					},
					attachmentData,
				);
				stored = true;
				if (originalMessageId) {
					await stub
						.completeInboundMessageClaim(originalMessageId, messageId)
						.catch((e: unknown) =>
							console.error(`Inbound claim completion failed for ${mailboxId}:`, (e as Error).message),
						);
				}
				return;
			}
		}

		let classification = await classifyInboundEmail(
			{
				headers: storedHeaders,
				subject: parsedEmail.subject,
				sender: fromAddress,
				bodyText: parsedEmail.text,
				bodyHtml: parsedEmail.html,
				auth,
			},
			env.AI as ClassifyAi,
			{
				// Over the daily inbound AI quota (AVE-45): rules-only verdict.
				allowAi: async () => {
					const quota = await tryConsumeAiQuota(stub, mailboxId, "inbound");
					if (quota && !quota.allowed) {
						console.warn(
							`Inbound AI quota reached for ${mailboxId} (${quota.used}/${quota.limit}); classifying by rules only`,
						);
						return false;
					}
					return true;
				},
			},
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
			alias_id: privateAlias?.aliasId || null,
			// Why it was filed where it was (AVE-94); the reason is set below,
			// once the folder is decided.
			classification_reason: classification.reason as string | null,
			auth_tier: storedAuthTier(auth),
			matched_rule_id: null as string | null,
		};

		const rawMailboxSettings = await loadMailboxSettingsRaw(env, mailboxId);
		const automationSettings = parseAutomationSettings(rawMailboxSettings);
		const filterHit = applyInboxFilters(parseInboxFilters(rawMailboxSettings), {
			sender: fromAddress,
			subject: parsedEmail.subject || "",
			headers: storedHeaders,
			auth,
			aliasEmail: privateAlias?.aliasEmail ?? null,
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
		const storedTriage = triageSender
			? await (stub as any).getSenderTriage(triageSender)
			: null;
		// An explicit sender rule (Settings → Senders, AVE-96) beats the
		// Screener row: a block files like a rejected sender, an allow is an
		// explicit allow. Address rules beat domain rules; a domain allow
		// needs verified mail, and failed auth matches no rule.
		let senderRule: SenderRule | null = null;
		if (triageSender) {
			try {
				senderRule = await stub.matchSenderRule(triageSender, inboundEmail.auth_tier);
			} catch (e) {
				console.error(`Sender rule lookup failed for ${mailboxId}:`, (e as Error).message);
			}
		}
		if (senderRule) {
			console.log(
				`Sender rule ${senderRule.id} (${senderRule.kind} ${senderRule.verdict}) matched ${fromAddress} for ${mailboxId}`,
			);
		}
		const triageRow = triageWithSenderRule(storedTriage, senderRule, triageSender ?? "");
		const purposePref =
			classification.reason === "auth-failed"
				? null
				: await stub.getSenderPreference(fromAddress);
		// Senders you've allowed, emailed, accepted, or sorted can't be junked by
		// the AI guess alone; an explicit allow on verified mail also beats
		// upstream spam headers. Failed auth stays Spam. Everything below files,
		// notifies, and drafts on this verdict.
		const trustedClassification = applySenderTrust(
			classification,
			{
				headers: storedHeaders,
				subject: parsedEmail.subject,
				sender: fromAddress,
				auth,
			},
			senderRule?.verdict === "allow" ? "allowed" : senderTrustOf(triageRow, purposePref),
		);
		if (trustedClassification !== classification) {
			console.log(
				`Trusted sender ${fromAddress} overrode ${classification.reason} for ${mailboxId}: ${trustedClassification.reason}`,
			);
			classification = trustedClassification;
		}
		// Authenticated mail from a stranger goes to Screener, not Spam, on an
		// AI guess alone (see deferAuthenticatedAiSpamToScreener).
		const deferredClassification = deferAuthenticatedAiSpamToScreener(classification, {
			screenerEnabled,
			auth,
		});
		if (deferredClassification !== classification) {
			console.log(
				`Authenticated sender ${fromAddress} deferred AI spam verdict to Screener for ${mailboxId}`,
			);
			classification = deferredClassification;
		}
		const triageDecision = resolveInboundFolder({
			classification,
			triage: triageRow,
			filterHit,
			screenerEnabled,
			preferenceFolderId: purposePref?.folderId ?? null,
			preferenceSource: purposePref?.source ?? null,
		});
		console.log(
			`Triage for ${mailboxId} sender=${fromAddress}: action=${triageDecision.triageAction} -> ${triageDecision.folderId}`,
		);
		if (
			pinnedPreferenceFolderId(purposePref?.folderId, purposePref?.source) &&
			triageDecision.folderId === purposePref?.folderId
		) {
			console.log(
				`Sender preference filed ${fromAddress} → ${purposePref.folderId} for ${mailboxId}`,
			);
		}

		inboundEmail.classification_reason = inboundClassificationReason(classification, triageDecision);
		inboundEmail.matched_rule_id = decidingSenderRuleId(senderRule, triageDecision);

		const targetFolder = triageDecision.folderId;
		let filedFolder: string = targetFolder;
		try {
			await stub.createEmail(targetFolder, inboundEmail, attachmentData);
			stored = true;
		} catch (e) {
			if ((e as Error).message === "Mailbox has been deleted") {
				console.log(`Rejecting inbound for deleted mailbox ${mailboxId}`);
				await abandonUnstoredInbound(env, stub, {
					emailId: messageId,
					originalMessageId,
					blobKeys: inboundBlobKeys(),
					knownUnstored: true,
				});
				message.setReject(MAILBOX_UNAVAILABLE_REJECT_REASON);
				return;
			}
			if (!shouldFallbackToInbox(targetFolder, e)) throw e;
			console.error(
				`Failed to file inbound mail to ${targetFolder}, falling back to inbox:`,
				(e as Error).message,
			);
			try {
				await stub.createEmail(Folders.INBOX, inboundEmail, attachmentData);
				stored = true;
			} catch (inboxErr) {
				if ((inboxErr as Error).message === "Mailbox has been deleted") {
					console.log(`Rejecting inbound for deleted mailbox ${mailboxId}`);
					await abandonUnstoredInbound(env, stub, {
						emailId: messageId,
						originalMessageId,
						blobKeys: inboundBlobKeys(),
						knownUnstored: true,
					});
					message.setReject(MAILBOX_UNAVAILABLE_REJECT_REASON);
					return;
				}
				throw inboxErr;
			}
			filedFolder = Folders.INBOX;
		}
		if (privateAlias) {
			// Best effort: the message is stored, so a failed counter must not
			// throw into a retry that dedup drops (losing the push and forward).
			await (stub as any)
				.recordAliasInbound(privateAlias.aliasEmail, false)
				.catch((e: unknown) =>
					console.error(`Recording private email inbound failed for ${mailboxId}:`, (e as Error).message),
				);
		}
		if (originalMessageId) {
			// Best effort: the stored row already blocks redelivery.
			await stub
				.completeInboundMessageClaim(originalMessageId, messageId)
				.catch((e: unknown) =>
					console.error(`Inbound claim completion failed for ${mailboxId}:`, (e as Error).message),
				);
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
			// Private emails never auto-reply; domain aliases reply as themselves.
			const replyPlan = autoReplySender(routedAliasMeta, mailboxId);
			if (!triageDecision.skipAutoReply && !replyPlan.skip) {
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
						replyFrom: replyPlan.from,
						replyFallback: replyPlan.fallback,
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
					// Over the daily inbound AI quota (AVE-45): no auto-draft.
					const quota = await tryConsumeAiQuota(stub, mailboxId, "inbound");
					if (quota && !quota.allowed) {
						console.warn(
							`Inbound AI quota reached for ${mailboxId} (${quota.used}/${quota.limit}); skipping auto-draft`,
						);
						return;
					}
					await stub.ensureAutoAgentConversation();
					const agent = await getEmailAgent(
						env,
						agentInstanceName(mailboxId, AUTO_CONVERSATION_ID),
					);
					await agent.handleNewEmail({
						mailboxId,
						emailId: messageId,
						sender: (parsedEmail.from?.address || "").toLowerCase(),
						subject: parsedEmail.subject || "",
						threadId,
					});
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
	} catch (e) {
		if (!stored) {
			await abandonUnstoredInbound(env, stub, {
				emailId: messageId,
				originalMessageId,
				blobKeys: inboundBlobKeys(),
			});
		}
		throw e;
	}
}

export { app, receiveEmail };

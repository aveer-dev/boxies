// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import {
	assertOutboundMessageSize,
	OutboundSizeError,
} from "../lib/outbound-limits";
import { enqueueOutboundSendFromEnv } from "../lib/outbound-send-queue";
import {
	checkIdempotencyKey,
	discardReplayedSend,
	idempotentReplayResponse,
	type CreateEmailResult,
} from "../lib/outbound-idempotency";
import { storeAttachments } from "../lib/attachments";
import type { EmailFull } from "../lib/schemas";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
	resolveOriginalEmail,
} from "../lib/email-helpers";
import { rewriteSelfReplyTo } from "../../shared/reply-recipients";
import { SendEmailRequestSchema } from "../lib/schemas";
import { countRecipients, recipientCapError } from "../lib/send-quota";
import { buildReplyEnvelope, plainTextToHtml } from "../../shared/reply-envelope";
import { mailboxMetadataKey } from "../lib/mailbox-routing";
import { z } from "zod";
import { appendQuote, buildForwardQuote, buildReplyQuote } from "../../shared/quoted-html";
import { displayNameFromAddressField } from "../../shared/sender";
import { Folders } from "../../shared/folders";
import type { MailboxContext } from "../lib/mailbox";
import { blockSuppressedSend } from "./suppressions";
import { allowOutboundRecipients } from "../lib/sender-triage";
import {
	findThreadAliasId,
	isInboundEmail,
	resolveOutboundSender,
	type AliasSenderStub,
} from "../lib/alias-sender";

type AppContext = Context<MailboxContext>;
type SendEmailRequest = z.infer<typeof SendEmailRequestSchema>;
type RateLimitStub = {
	checkSendRateLimit: (recipients?: number) => Promise<string | null>;
	releaseSendSlot: () => Promise<void>;
};

export async function handleReplyEmail(c: AppContext) {
	const id = c.req.param("id") ?? "";
	// A retried send with a stored Idempotency-Key returns the original row.
	const idem = await checkIdempotencyKey(c, c.var.mailboxStub);
	if ("response" in idem) return idem.response;
	const body = SendEmailRequestSchema.parse(await c.req.json());

	const rawOriginal = (await c.var.mailboxStub.getEmail(id)) as EmailFull | null;
	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	return sendReply(c, rawOriginal, body, idem.key);
}

/** Longest text a quick reply accepts (a notification / watch reply is short). */
export const QUICK_REPLY_MAX_LENGTH = 2000;

export const QuickReplyRequestSchema = z.object({
	text: z
		.string()
		.trim()
		.min(1, "text is required")
		.max(QUICK_REPLY_MAX_LENGTH, `text must be at most ${QUICK_REPLY_MAX_LENGTH} characters`),
	/** IANA zone for the quote's "On <date>" line; defaults to UTC. */
	quote_time_zone: z.string().max(64).optional(),
});

/**
 * `POST /api/v1/mailboxes/:mailboxId/emails/:id/quick-reply { text }` (AVE-140).
 *
 * A Reply composed by the Worker for notification actions and watches, which
 * only have the text. To / Re: subject come from the original the way the web
 * quick reply builds them (`buildReplyEnvelope`, plain Reply), and the send
 * goes through the same path as `/reply`: the thread's private email is the
 * sender when the conversation is bound to one (`resolveOutboundSender`), the
 * original is quoted, and Idempotency-Key, suppression, size and the send
 * rate limit all apply. Responds like `/reply`: 202 `{ id, status: "sent" }`.
 */
export async function handleQuickReply(c: AppContext) {
	const mailboxId = c.var.mailboxId;
	const id = c.req.param("id") ?? "";
	const idem = await checkIdempotencyKey(c, c.var.mailboxStub);
	if ("response" in idem) return idem.response;
	const input = QuickReplyRequestSchema.parse(await c.req.json());

	const rawOriginal = (await c.var.mailboxStub.getEmail(id)) as EmailFull | null;
	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}
	const original = await resolveOriginalEmail(c.var.mailboxStub, rawOriginal);

	const settings = await loadReplySettings(c.env, mailboxId);
	const envelope = buildReplyEnvelope(
		original,
		{ email: mailboxId, fromName: settings.fromName },
		"reply",
	);
	const body: SendEmailRequest = {
		to: envelope.to,
		from: envelope.from,
		subject: envelope.subject,
		html: plainTextToHtml(input.text),
		text: input.text,
		quote_original: true,
		quote_time_zone: input.quote_time_zone,
	};
	return sendReply(c, rawOriginal, body, idem.key);
}

async function loadReplySettings(env: AppContext["env"], mailboxId: string): Promise<{ fromName?: string }> {
	try {
		const obj = await env.BUCKET.get(mailboxMetadataKey(mailboxId));
		const parsed = obj ? ((await obj.json()) as { fromName?: unknown }) : null;
		const fromName = typeof parsed?.fromName === "string" ? parsed.fromName.trim() : "";
		return fromName ? { fromName } : {};
	} catch {
		return {};
	}
}

/** Shared by `/reply` and `/quick-reply`: everything after the request is parsed. */
async function sendReply(
	c: AppContext,
	rawOriginal: EmailFull,
	body: SendEmailRequest,
	idempotencyKey: string | null,
) {
	const mailboxId = c.var.mailboxId;
	const { cc, bcc, subject, attachments } = body;
	const stub = c.var.mailboxStub;

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	// The original as the real message, formatting kept (AVE-133).
	const { html, text } = body.quote_original
		? appendQuote(body, buildReplyQuote(originalEmail, { timeZone: body.quote_time_zone }))
		: body;
	const { originalMsgId, references, threadId: thread_id } = buildReferencesChain(originalEmail);

	const aliasStub = stub as unknown as AliasSenderStub;
	const sender = await resolveOutboundSender({
		stub: aliasStub,
		mailboxId,
		requestedFrom: body.from,
		threadAliasId: await findThreadAliasId(aliasStub, {
			aliasId: rawOriginal.alias_id ?? originalEmail.alias_id ?? null,
			threadId: thread_id,
			originalIsInbound: isInboundEmail(originalEmail),
		}),
	});
	if (!sender.ok) {
		return c.json({ error: sender.error, ...(sender.code ? { code: sender.code } : {}) }, sender.status);
	}
	const from = sender.from;
	// Replying to your own Sent copy must not address the alias you sent from.
	const to = sender.aliasId
		? rewriteSelfReplyTo(rewriteSelfReplyTo(body.to, originalEmail, mailboxId), originalEmail, sender.fromEmail)
		: rewriteSelfReplyTo(body.to, originalEmail, mailboxId);

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

	// 50 recipients at most (AVE-125). The schema checks /reply and /forward
	// bodies; this also covers /quick-reply, whose body the Worker builds.
	const tooMany = recipientCapError(to, cc, bcc);
	if (tooMany) return c.json({ error: tooMany }, 400);

	// Suppressed recipients block the send before a slot or Sent row exists.
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

	// The quota counts recipients (AVE-125).
	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit(countRecipients(to, cc, bcc));
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	let created: CreateEmailResult | undefined;
	let attachmentData: Awaited<ReturnType<typeof storeAttachments>> = [];
	try {
		attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

		created = await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject,
				sender: fromEmail,
				sender_name: displayNameFromAddressField(from),
				recipient: toStr,
				cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
				bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
				date: new Date().toISOString(),
				body: html || text || "",
				in_reply_to: originalMsgId,
				email_references: JSON.stringify(references),
				thread_id: thread_id,
				message_id: outgoingMessageId,
				delivery_status: "queued",
				delivery_error: null,
				alias_id: sender.aliasId,
				idempotency_key: idempotencyKey,
				raw_headers: JSON.stringify([
					{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
					{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
					...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
					...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
					{ key: "subject", value: subject },
					{ key: "date", value: new Date().toISOString() },
					{ key: "message-id", value: `<${outgoingMessageId}>` },
					...(originalMsgId ? [{ key: "in-reply-to", value: `<${originalMsgId}>` }] : []),
					...(references.length > 0 ? [{ key: "references", value: references.map((r: string) => `<${r}>`).join(" ") }] : []),
				]),
			},
			attachmentData,
		);
	} catch (e) {
		// Not accepted, so it shouldn't count against the send quota.
		await (stub as unknown as RateLimitStub).releaseSendSlot().catch(() => {});
		throw e;
	}
	if (created?.replayed) {
		// A concurrent request with this key won: send nothing more.
		await discardReplayedSend(c.env, stub, messageId, attachmentData);
		return idempotentReplayResponse(c, created.id);
	}

	await allowOutboundRecipients(stub as any, to, cc, bcc);
	await stub.markThreadRead(thread_id);
	await stub.deleteDraftsForThread(thread_id);
	await (stub as any).clearReplyLaterForThread(thread_id);

	await enqueueOutboundSendFromEnv(c.env, mailboxId, messageId, {
		to,
		cc,
		bcc,
		from,
		subject,
		html,
		text,
		attachments: attachments?.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			contentId: att.contentId,
		})),
		headers: buildThreadingHeaders(originalMsgId, references),
	});

	return c.json({ id: messageId, status: "sent" }, 202);
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.var.mailboxId;
	const id = c.req.param("id") ?? "";
	// A retried send with a stored Idempotency-Key returns the original row.
	const idem = await checkIdempotencyKey(c, c.var.mailboxStub);
	if ("response" in idem) return idem.response;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, subject, attachments } = body;

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(id)) as EmailFull | null;

	if (!rawOriginal) {
		return c.json({ error: "Original email not found" }, 404);
	}

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	// The forwarded message as the real message, formatting kept (AVE-133).
	const { html, text } = body.quote_original
		? appendQuote(body, buildForwardQuote(originalEmail, { timeZone: body.quote_time_zone }))
		: body;

	// A forward starts a new conversation with someone you chose, so it is
	// not bound to the original's private email — but may still use one.
	const sender = await resolveOutboundSender({
		stub: stub as unknown as AliasSenderStub,
		mailboxId,
		requestedFrom: body.from,
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

	// Suppressed recipients block the send before a slot or Sent row exists.
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

	// The quota counts recipients (AVE-125).
	const rateLimitError = await (stub as unknown as RateLimitStub)
		.checkSendRateLimit(countRecipients(to, cc, bcc));
	if (rateLimitError) {
		return c.json({ error: rateLimitError }, 429);
	}

	let created: CreateEmailResult | undefined;
	let attachmentData: Awaited<ReturnType<typeof storeAttachments>> = [];
	try {
		attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

		created = await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject,
				sender: fromEmail,
				sender_name: displayNameFromAddressField(from),
				recipient: toStr,
				cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
				bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
				date: new Date().toISOString(),
				body: html || text || "",
				in_reply_to: null,
				email_references: null,
				thread_id: messageId,
				message_id: outgoingMessageId,
				delivery_status: "queued",
				delivery_error: null,
				alias_id: sender.aliasId,
				idempotency_key: idem.key,
				raw_headers: JSON.stringify([
					{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
					{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
					...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
					...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
					{ key: "subject", value: subject },
					{ key: "date", value: new Date().toISOString() },
					{ key: "message-id", value: `<${outgoingMessageId}>` },
				]),
			},
			attachmentData,
		);
	} catch (e) {
		// Not accepted, so it shouldn't count against the send quota.
		await (stub as unknown as RateLimitStub).releaseSendSlot().catch(() => {});
		throw e;
	}
	if (created?.replayed) {
		// A concurrent request with this key won: send nothing more.
		await discardReplayedSend(c.env, stub, messageId, attachmentData);
		return idempotentReplayResponse(c, created.id);
	}

	await allowOutboundRecipients(stub as any, to, cc, bcc);

	await enqueueOutboundSendFromEnv(c.env, mailboxId, messageId, {
		to,
		cc,
		bcc,
		from,
		subject,
		html,
		text,
		attachments: attachments?.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			contentId: att.contentId,
		})),
	});

	return c.json({ id: messageId, status: "sent" }, 202);
}

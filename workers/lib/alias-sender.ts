// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound From resolution for private emails.
 *
 * The server — not the client — decides which address a message goes out
 * from. A conversation that started on a private email always replies from
 * that alias, so a stale draft, a buggy client or an agent tool can never
 * reveal the real mailbox address to whoever was given the alias.
 */
import { isAliasUsable, type AliasRow } from "./alias-utils";

export type SenderField = string | { email: string; name: string };

export interface AliasSenderStub {
	getAlias(idOrEmail: string): Promise<AliasRow | null>;
	getThreadAliasId(threadId: string): Promise<string | null>;
}

export type OutboundSender =
	| { ok: true; from: SenderField; fromEmail: string; aliasId: string | null }
	| { ok: false; status: 400 | 409; error: string; code?: "alias_inactive" };

export const ALIAS_INACTIVE_ERROR =
	"This conversation uses a private email that is paused, expired or deleted. Resume it to reply.";

function senderEmail(from: SenderField | null | undefined): string {
	if (!from) return "";
	return (typeof from === "string" ? from : from.email).trim().toLowerCase();
}

/**
 * Private email a reply goes out from: the replied-to message's own alias.
 * A reply to mail that reached the real address goes out from the real
 * address, whatever else the thread holds; otherwise a correspondent could
 * mail both addresses and learn they belong together. Only when there is no
 * received original to go by (own sent mail, or a thread-only compose) does
 * the thread's alias decide.
 */
export async function findThreadAliasId(
	stub: Pick<AliasSenderStub, "getThreadAliasId">,
	thread: {
		aliasId?: string | null;
		threadId?: string | null;
		/** True when replying to a message that was received (not sent or drafted). */
		originalIsInbound?: boolean;
	},
): Promise<string | null> {
	if (thread.aliasId) return thread.aliasId;
	if (thread.originalIsInbound) return null;
	if (thread.threadId) return stub.getThreadAliasId(thread.threadId);
	return null;
}

/** Whether an email was received, as opposed to sent or drafted here. */
export function isInboundEmail(email: { folder_id?: string | null }): boolean {
	return email.folder_id !== "sent" && email.folder_id !== "draft";
}

export async function resolveOutboundSender(options: {
	stub: Pick<AliasSenderStub, "getAlias">;
	mailboxId: string;
	requestedFrom: SenderField | null | undefined;
	/** Alias the conversation is bound to (see findThreadAliasId). */
	threadAliasId?: string | null;
}): Promise<OutboundSender> {
	const { stub, requestedFrom, threadAliasId } = options;
	const mailbox = options.mailboxId.trim().toLowerCase();

	if (threadAliasId) {
		const alias = await stub.getAlias(threadAliasId);
		if (!alias || !isAliasUsable(alias)) {
			return { ok: false, status: 409, error: ALIAS_INACTIVE_ERROR, code: "alias_inactive" };
		}
		// No display name: it would pair the alias with the owner's real name.
		return { ok: true, from: alias.alias_email, fromEmail: alias.alias_email, aliasId: alias.id };
	}

	const requested = senderEmail(requestedFrom);
	if (!requested || requested === mailbox) {
		return { ok: true, from: requestedFrom || mailbox, fromEmail: mailbox, aliasId: null };
	}

	const alias = await stub.getAlias(requested);
	if (alias && alias.alias_email === requested && isAliasUsable(alias)) {
		return { ok: true, from: alias.alias_email, fromEmail: alias.alias_email, aliasId: alias.id };
	}

	return {
		ok: false,
		status: 400,
		error: "From address must match the mailbox email address or an active private email",
	};
}

export interface InboundThreadStub {
	findThreadIdByReferences(references: string[]): Promise<string | null>;
	findThreadBySubject(subject: string, from?: string): Promise<string | null>;
	getThreadAliasId(threadId: string): Promise<string | null>;
}

/**
 * Existing thread an inbound message joins, by References then subject.
 * Mail to a private email and mail to the real address never share a
 * thread: replies take their From from the thread, so merging them would
 * let a correspondent tie the alias to the real address (or reveal the
 * alias to everyone on a real-address thread).
 */
export async function findInboundThreadId(
	stub: InboundThreadStub,
	opts: { references: string[]; subject: string; from?: string; aliasId: string | null },
): Promise<string | null> {
	const sameAddress = async (candidate: string | null) => {
		if (!candidate) return null;
		const threadAlias = (await stub.getThreadAliasId(candidate)) ?? null;
		return threadAlias === opts.aliasId ? candidate : null;
	};
	if (opts.references.length > 0) {
		const byReferences = await sameAddress(await stub.findThreadIdByReferences(opts.references));
		if (byReferences) return byReferences;
	}
	return sameAddress(await stub.findThreadBySubject(opts.subject, opts.from));
}

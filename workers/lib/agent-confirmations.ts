// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Operator confirmation for the chat assistant's risky tools (AVE-222).
 *
 * After reading mail, the chat agent could move messages to Trash or Spam,
 * discard drafts, or draft a new email to an address the operator never gave
 * it, all without asking. A prompt injection that slips past
 * guardEmailToolResult could steer any of those.
 *
 * The gate lives on the server, so every client (web, iOS, Android) gets it
 * without new UI. A gated call does nothing the first time: it records the
 * action as pending and returns `needs_confirmation`, and the agent must ask
 * the operator in plain words. The same call only runs in the operator's
 * next chat turn, after they have sent a new message (that is not a plain
 * "no"). Email content cannot create a user turn, so it cannot confirm.
 *
 * Pure module (no Worker bindings) so it can be unit tested under Node.
 */

import { Folders } from "../../shared/folders";
import { normalizeAddress } from "../../shared/reply-recipients";
import { parseAddresses } from "./agent-safety";

/** Durable Object storage key holding the pending confirmations. */
export const PENDING_CONFIRMATIONS_KEY = "agent:pending-confirmations";

/** A request to confirm expires if the operator doesn't answer within this. */
export const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

/**
 * move_email destinations that need the operator's go-ahead: they take mail
 * out of sight (and Trash/Spam are purged on a timer). Archive, Inbox and
 * the other boxes stay ungated.
 */
export const CONFIRM_MOVE_FOLDERS: ReadonlySet<string> = new Set([
	Folders.TRASH,
	Folders.SPAM,
	Folders.SCREENED_OUT,
]);

/** Tools whose results carry email text written by outside senders. */
export const EMAIL_READ_TOOLS: ReadonlySet<string> = new Set([
	"list_emails",
	"get_email",
	"get_thread",
	"search_emails",
]);

export interface PendingConfirmations {
	/** Id of the user message whose turn asked for confirmation. */
	turnId: string;
	/** Action keys (see actionKey) awaiting the operator's answer. */
	actions: string[];
	createdAt: number;
}

export interface ChatTurn {
	/** Id of the latest user message: one per operator turn. */
	id: string;
	text: string;
}

export function moveNeedsConfirmation(folderId: string): boolean {
	return CONFIRM_MOVE_FOLDERS.has(folderId.trim().toLowerCase());
}

/** Stable key for a gated call, so a repeat call matches the pending one. */
export function actionKey(tool: string, ...parts: string[]): string {
	return [tool, ...parts.map((part) => part.trim().toLowerCase())].join(":");
}

const DECLINE = /^\s*(no|nope|nah|don'?t|do not|stop|cancel|never\s*mind|wait|hold on)\b/i;

/** A reply that plainly refuses never confirms anything. */
export function looksLikeDecline(text: string): boolean {
	return DECLINE.test(text);
}

interface MessageLike {
	id?: string;
	role?: string;
	parts?: unknown[];
	content?: unknown;
}

function textOf(message: MessageLike): string {
	const texts: string[] = [];
	for (const part of message.parts ?? []) {
		if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") texts.push(text);
		}
	}
	if (texts.length === 0 && typeof message.content === "string") texts.push(message.content);
	return texts.join("\n");
}

/** The operator's latest message, which identifies the current turn. */
export function latestUserTurn(messages: readonly MessageLike[]): ChatTurn | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		const text = textOf(message);
		// Clients always send ids; fall back to position + text so a turn
		// still differs from the one before it.
		const id = typeof message.id === "string" && message.id ? message.id : `${i}:${text}`;
		return { id, text };
	}
	return null;
}

/**
 * Pending actions for a new chat turn.
 *
 * - Same turn as the stored record (a regenerate, or another step of the
 *   same answer): nothing is approved and the record keeps accumulating.
 * - A later turn, within the TTL, whose message isn't a plain "no": every
 *   stored action is approved for this turn only. A fresh record starts.
 */
export function beginConfirmationTurn(
	stored: PendingConfirmations | null | undefined,
	turn: ChatTurn,
	now: number = Date.now(),
): { approved: Set<string>; pending: PendingConfirmations } {
	if (stored && stored.turnId === turn.id) {
		return { approved: new Set(), pending: { ...stored, actions: [...stored.actions] } };
	}
	const fresh = Boolean(stored) && now - (stored?.createdAt ?? 0) <= CONFIRMATION_TTL_MS;
	const approved =
		stored && fresh && !looksLikeDecline(turn.text) ? new Set(stored.actions) : new Set<string>();
	return { approved, pending: { turnId: turn.id, actions: [], createdAt: now } };
}

/**
 * Per-turn confirmation state for the chat agent's tools. `check` returns
 * true when the action may run now (approved in this turn); otherwise it
 * records the action as pending and the caller returns needsConfirmation().
 */
export class ConfirmationGate {
	private readonly approved: Set<string>;
	private readonly pending: PendingConfirmations;
	private readonly save: (pending: PendingConfirmations) => Promise<void>;
	private readonly now: () => number;

	constructor(
		approved: Set<string>,
		pending: PendingConfirmations,
		save: (pending: PendingConfirmations) => Promise<void>,
		now: () => number = Date.now,
	) {
		this.approved = approved;
		this.pending = pending;
		this.save = save;
		this.now = now;
	}

	async check(key: string): Promise<boolean> {
		if (this.approved.has(key)) return true;
		if (!this.pending.actions.includes(key)) {
			this.pending.actions.push(key);
			this.pending.createdAt = this.now();
			await this.save(this.pending);
		}
		return false;
	}
}

export interface NeedsConfirmationResult {
	status: "needs_confirmation";
	action: string;
	message: string;
}

export function needsConfirmation(action: string): NeedsConfirmationResult {
	return {
		status: "needs_confirmation",
		action,
		message: `Not done yet: this needs the operator's confirmation. Tell the operator in plain words exactly what you want to do (${action}) and ask them to confirm. Do not call this tool again in this reply. Only if their next message clearly says yes, call it again with the same arguments.`,
	};
}

// ── Drafts to outside addresses ────────────────────────────────────

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Addresses the operator typed in their own chat messages. */
export function operatorAddresses(messages: readonly MessageLike[]): Set<string> {
	const addresses = new Set<string>();
	for (const message of messages) {
		if (message?.role !== "user") continue;
		for (const match of textOf(message).match(EMAIL_IN_TEXT) ?? []) {
			const address = normalizeAddress(match);
			if (address) addresses.add(address);
		}
	}
	return addresses;
}

function toolNameOfPart(part: unknown): string | null {
	if (!part || typeof part !== "object") return null;
	const { type, toolName } = part as { type?: unknown; toolName?: unknown };
	if (type === "dynamic-tool" && typeof toolName === "string") return toolName;
	if (typeof type === "string" && type.startsWith("tool-")) return type.slice("tool-".length);
	return null;
}

/** Whether the model history holds an email read tool result. */
export function historyReadEmail(messages: readonly MessageLike[]): boolean {
	return messages.some((message) =>
		(message?.parts ?? []).some((part) => {
			const name = toolNameOfPart(part);
			return name !== null && EMAIL_READ_TOOLS.has(name);
		}),
	);
}

const HEADER_FIELDS = ["sender", "recipient", "cc", "bcc", "from", "to"] as const;

/**
 * Header addresses (sender, To/Cc/Bcc) of the email records in a read tool
 * result, guarded or raw. Addresses that only appear in a body don't count:
 * that is where an injection would plant one.
 */
export function headerAddresses(result: unknown): string[] {
	const found: string[] = [];
	const visit = (value: unknown, depth: number) => {
		if (depth > 4 || !value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item, depth + 1);
			return;
		}
		const record = value as Record<string, unknown>;
		for (const field of HEADER_FIELDS) {
			const header = record[field];
			if (typeof header === "string") found.push(...parseAddresses(header));
		}
		for (const key of ["data", "messages", "emails"]) visit(record[key], depth + 1);
	};
	visit(result, 0);
	return found;
}

/**
 * Tracks, for one chat turn, whether email content reached the model and
 * which addresses a draft may go to without asking: the operator's own
 * typed addresses, the mailbox, and the senders/recipients of mail read.
 */
export class DraftRecipientPolicy {
	readEmail: boolean;
	private readonly known: Set<string>;

	constructor(options: { readEmail?: boolean; knownAddresses?: Iterable<string> } = {}) {
		this.readEmail = Boolean(options.readEmail);
		this.known = new Set(
			[...(options.knownAddresses ?? [])].map((address) => normalizeAddress(address)).filter(Boolean),
		);
	}

	/** Note a read tool result: email content is now in the turn. */
	noteRead(result: unknown): void {
		this.readEmail = true;
		for (const address of headerAddresses(result)) this.known.add(address);
	}

	/** Recipients that need confirmation before draft_email saves a draft. */
	outsideRecipients(to: string): string[] {
		if (!this.readEmail) return [];
		return parseAddresses(to).filter((address) => !this.known.has(address));
	}
}

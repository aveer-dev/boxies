// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared types and Zod schemas for email data.
 *
 * Types (from email-types.ts): used by the agent, MCP server, and route
 * handlers to avoid `as any` casting.
 *
 * Zod schemas: used across route handlers to eliminate duplication.
 */
import { z } from "zod";
import type { DeliveryRecipient } from "./delivery-recipients";
import { recipientCapError, TOO_MANY_RECIPIENTS_ERROR } from "./send-quota";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailAuthSnapshot {
	spf?: string;
	dkim?: string;
	dmarc?: string;
	dkimDomain?: string;
	spfMailfrom?: string;
	headerFrom?: string;
	envelopeFrom?: string;
	aligned?: boolean | null;
	spoofed?: boolean;
	source?: "authentication-results" | "arc-authentication-results" | "none";
}

export interface EmailMetadata {
	id: string;
	subject: string;
	sender: string;
	sender_name?: string | null;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	read: boolean;
	starred: boolean;
	reply_later?: boolean;
	reply_later_at?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	folder_id?: string | null;
	snippet?: string | null;
	provider_message_id?: string | null;
	delivery_status?: "queued" | "accepted" | "failed" | "bounced" | "complained" | null;
	delivery_error?: string | null;
	auth?: EmailAuthSnapshot | null;
	/** Private email the message arrived on or was sent from. */
	alias_id?: string | null;
	alias_email?: string | null;
	/** Alias still active and unexpired (null when not an alias message). */
	alias_active?: boolean | null;
}

export interface EmailFull extends EmailMetadata {
	body?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: AttachmentInfo[];
	/**
	 * Per-recipient delivery state from Email Sending events (Sent rows;
	 * empty until an event arrives). `delivery_status` stays the summary.
	 */
	delivery_recipients?: DeliveryRecipient[];
}

export interface AttachmentInfo {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
	/** Program, script, disk image or macro document (AVE-114); clients warn before download. */
	dangerous?: boolean;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([
	z.string().email(),
	z.array(z.string().email()).min(1),
]);

export const ErrorResponseSchema = z.object({
	error: z.string(),
});

export const SendEmailRequestSchema = z
	.object({
		to: RecipientFieldSchema,
		cc: RecipientFieldSchema.optional(),
		bcc: RecipientFieldSchema.optional(),
		from: z.union([
			z.string().email(),
			z.object({ email: z.string().email(), name: z.string() }),
		]),
		subject: z.string(),
		html: z.string().optional(),
		text: z.string().optional(),
		attachments: z
			.array(
				z.object({
					content: z.string(), // base64 encoded
					filename: z.string(),
					type: z.string(),
					disposition: z.enum(["attachment", "inline"]),
					contentId: z.string().optional(),
				}),
			)
			.optional(),
		in_reply_to: z.string().optional(),
		references: z.array(z.string()).optional(),
		thread_id: z.string().optional(),
		/**
		 * Reply / forward only: append the original message as a sanitised HTML
		 * quote (and a `> ` text quote) server-side, so every client sends the
		 * same quote (AVE-133). Older clients that inline their own quote omit it.
		 */
		quote_original: z.boolean().optional(),
		/** IANA zone for the quote's "On <date>" line (the sender's); defaults to UTC. */
		quote_time_zone: z.string().max(64).optional(),
	})
	.refine((data) => data.html || data.text, {
		message: "Either 'html' or 'text' must be provided",
	})
	// To + Cc + Bcc together (AVE-125); no path, so the 400 reads as the sentence alone.
	.refine((data) => !recipientCapError(data.to, data.cc, data.bcc), {
		message: TOO_MANY_RECIPIENTS_ERROR,
	});

export const SendEmailResponseSchema = z.object({
	id: z.string(),
	status: z.string(),
});

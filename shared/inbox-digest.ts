// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared JSON contract for the in-time inbox digest API.
 * Consumed by Workers, web, and mirrored on iOS.
 */

export interface InboxDigestTodo {
	id: string;
	email_id: string;
	thread_id: string | null;
	title: string;
	summary: string;
	date: string;
}

export interface InboxDigestTopicItem {
	email_id: string;
	thread_id: string | null;
	subject: string;
	summary: string;
	date: string;
	unread: boolean;
	attachment_count: number;
}

export interface InboxDigestTopic {
	id: string;
	title: string;
	emoji: string;
	caught_up: boolean;
	remaining_summary: string | null;
	items: InboxDigestTopicItem[];
}

export interface InboxDigest {
	greeting_name: string;
	unread_count: number;
	todos: InboxDigestTodo[];
	topics: InboxDigestTopic[];
}

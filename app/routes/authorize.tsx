// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button } from "@cloudflare/kumo";
import { WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { AppLoadContext } from "react-router";
import PrivateEmailLogo from "~/components/PrivateEmailLogo";
import {
	CONSENT_FIELDS,
	MCP_OAUTH_SCOPES,
	MCP_REQUIRED_SCOPE,
	MCP_SCOPE_COPY,
	type McpConsentView,
	type McpOAuthScope,
} from "shared/mcp-consent";

export function meta() {
	return [{ title: "Connect an app — Inboxies" }];
}

/**
 * The view comes only from the Worker's GET /authorize (workers/mcp/oauth.ts),
 * which validated the OAuth request and the session first. Anything else that
 * reaches this route (a client-side navigation, a stale tab) has none.
 */
export function loader({ context }: { context: AppLoadContext }): McpConsentView | null {
	return context.mcpConsent ?? null;
}

/**
 * MCP OAuth consent (AVE-68): which access an app gets, and in which
 * mailboxes. A plain form post back to the Worker, which re-checks
 * everything; this page decides nothing.
 */
export default function AuthorizeRoute({ loaderData }: { loaderData: McpConsentView | null }) {
	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4 py-10">
			<div className="w-full max-w-md rounded-xl border border-kumo-line bg-kumo-base p-6 space-y-5">
				{loaderData ? <ConsentForm view={loaderData} /> : <Expired />}
			</div>
		</div>
	);
}

function Expired() {
	return (
		<>
			<Header title="Can't continue" />
			<p className="text-sm text-kumo-subtle">
				This connection request has expired or is incomplete. Start again from the app you're connecting.
			</p>
		</>
	);
}

function Header({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<PrivateEmailLogo size={32} className="shrink-0 text-kumo-default" />
			<h1 className="text-lg font-semibold text-kumo-default break-words min-w-0">{title}</h1>
		</div>
	);
}

function ConsentForm({ view }: { view: McpConsentView }) {
	const [scopes, setScopes] = useState<Set<McpOAuthScope>>(() => new Set(view.requestedScopes));
	const [mailboxes, setMailboxes] = useState<Set<string>>(
		() => new Set(view.mailboxes.length === 1 ? [view.mailboxes[0].id] : []),
	);
	const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
		const next = new Set(set);
		if (on) next.add(value);
		else next.delete(value);
		return next;
	};
	const noMailboxes = view.mailboxes.length === 0;

	return (
		<form method="post" action="/authorize" className="space-y-5">
			<input type="hidden" name={CONSENT_FIELDS.handle} value={view.handle} />
			<input type="hidden" name={CONSENT_FIELDS.account} value={view.account} />
			{/* The read checkbox is disabled (always granted), so it posts nothing itself. */}
			<input type="hidden" name={CONSENT_FIELDS.scope} value={MCP_REQUIRED_SCOPE} />

			<div className="space-y-2">
				<Header title={`Connect ${view.client.name} to Inboxies?`} />
				<p className="text-sm text-kumo-subtle">
					{view.client.domain ? (
						<>
							Published by <strong className="text-kumo-default">{view.client.domain}</strong>.
						</>
					) : (
						"This app registered itself, so its name isn't verified."
					)}{" "}
					Access goes to <strong className="text-kumo-default break-all">{view.client.redirectHost}</strong>.
				</p>
				<p className="text-sm text-kumo-subtle">
					Signed in as <strong className="text-kumo-default break-all">{view.email}</strong>.
				</p>
			</div>

			{view.client.redirectIsLoopback && (
				<div className="flex items-start gap-2 rounded-lg bg-kumo-warning-tint p-3 text-sm text-kumo-default">
					<WarningIcon size={18} className="mt-0.5 shrink-0 text-kumo-warning" aria-hidden />
					<span>
						This sends access to an app on your computer. Continue only if you just started connecting from it.
					</span>
				</div>
			)}

			<fieldset className="space-y-2">
				<legend className="mb-2 text-sm font-medium text-kumo-default">What it can do</legend>
				{MCP_OAUTH_SCOPES.map((scope) => {
					const required = scope === MCP_REQUIRED_SCOPE;
					return (
						<CheckRow
							key={scope}
							id={`scope-${scope}`}
							name={required ? undefined : CONSENT_FIELDS.scope}
							value={scope}
							checked={required || scopes.has(scope)}
							disabled={required}
							onChange={(on) => setScopes((s) => toggle(s, scope, on))}
							label={MCP_SCOPE_COPY[scope].label}
							description={required ? `${MCP_SCOPE_COPY[scope].description} Always included.` : MCP_SCOPE_COPY[scope].description}
						/>
					);
				})}
			</fieldset>

			<fieldset className="space-y-2">
				<legend className="mb-2 text-sm font-medium text-kumo-default">Which mailboxes</legend>
				{noMailboxes ? (
					<Banner variant="error" text="You don't have any mailboxes to share yet." />
				) : (
					view.mailboxes.map((mailbox) => (
						<CheckRow
							key={mailbox.id}
							id={`mailbox-${mailbox.id}`}
							name={CONSENT_FIELDS.mailbox}
							value={mailbox.id}
							checked={mailboxes.has(mailbox.id)}
							onChange={(on) => setMailboxes((s) => toggle(s, mailbox.id, on))}
							label={mailbox.id}
							description={mailbox.role === "owner" ? "Owner" : "Member"}
						/>
					))
				)}
				{!noMailboxes && mailboxes.size === 0 && (
					<p className="text-xs text-kumo-subtle">Choose at least one mailbox.</p>
				)}
			</fieldset>

			<p className="text-xs text-kumo-subtle">
				You can disconnect the app at any time. It can't see mailboxes you leave unchecked.
			</p>

			<div className="flex gap-2">
				<Button type="submit" name={CONSENT_FIELDS.decision} value="deny" variant="secondary" className="flex-1">
					Deny
				</Button>
				<Button
					type="submit"
					name={CONSENT_FIELDS.decision}
					value="approve"
					variant="primary"
					className="flex-1"
					disabled={mailboxes.size === 0}
				>
					Allow
				</Button>
			</div>
		</form>
	);
}

function CheckRow(props: {
	id: string;
	name?: string;
	value: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	description: string;
}) {
	return (
		<label
			htmlFor={props.id}
			className={`flex items-start gap-3 rounded-lg border border-kumo-line p-3 ${props.disabled ? "" : "cursor-pointer hover:bg-kumo-tint"}`}
		>
			<input
				id={props.id}
				type="checkbox"
				name={props.name}
				value={props.value}
				checked={props.checked}
				disabled={props.disabled}
				onChange={(e) => props.onChange(e.target.checked)}
				className="mt-0.5 shrink-0 rounded border-kumo-line cursor-pointer disabled:cursor-default"
			/>
			<span className="min-w-0 space-y-0.5">
				<span className="block text-sm font-medium text-kumo-default break-all">{props.label}</span>
				<span className="block text-xs text-kumo-subtle">{props.description}</span>
			</span>
		</label>
	);
}

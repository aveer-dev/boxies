// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	RobotIcon,
	ArrowCounterClockwiseIcon,
	CaretRightIcon,
	SignOutIcon,
} from "@phosphor-icons/react";
import { Suspense, useEffect, useState } from "react";
import { useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import ColumnPane from "~/components/columns/ColumnPane";
import { useUIStore } from "~/hooks/useUIStore";
import { useMe, useRecoveryEmail } from "~/queries/account";
import { isScreenerEnabled } from "~/lib/mailbox-settings";
import { queryKeys } from "~/queries/keys";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { signOut } from "~/lib/sign-out";
import AppearanceCard from "./AppearanceCard";
import {
	ACCOUNT_PAGES,
	INCOMING_MAIL_PAGES,
	OUTGOING_MAIL_PAGES,
	SETTINGS_PAGES,
	type SettingsPageId,
} from "./pages";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
// Legal pages live on the marketing site (site/src/pages/legal.astro); these redirect to its anchors.
const TERMS_URL = "https://inboxies.co/terms";
const PRIVACY_URL = "https://inboxies.co/privacy";

const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

function SettingsContent() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { settingsPage, openSettings } = useUIStore();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
		};
		try {
			await updateMailboxMutation.mutateAsync({ mailboxId, settings });
			toastManager.add({ title: "Settings saved!" });
		} catch {
			toastManager.add({
				title: "Failed to save settings",
				variant: "error",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => {
		setAgentPrompt("");
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;

	return (
		<div className="px-4 py-4 md:px-6 md:py-5">

			<div className="space-y-6">
				<AppearanceCard />

				{/* This mailbox */}
				<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Mailbox
					</div>
					<div className="space-y-3">
						<Input
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<Input label="Email" type="email" value={mailbox.email} disabled />
					</div>
				</div>

				<AccountCard settingsPage={settingsPage} openSettings={openSettings} />

				{/* Mail automations */}
				<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Incoming mail
					</div>
					<ScreenerToggle />
					<div className="divide-y divide-kumo-line -mx-2">
						{INCOMING_MAIL_PAGES.map((id) => (
							<SettingsLink
								key={id}
								id={id}
								isOpen={settingsPage === id}
								onOpen={() => openSettings(id)}
							/>
						))}
					</div>
				</div>

				<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Outgoing mail
					</div>
					<div className="divide-y divide-kumo-line -mx-2">
						{OUTGOING_MAIL_PAGES.map((id) => (
							<SettingsLink
								key={id}
								id={id}
								isOpen={settingsPage === id}
								onOpen={() => openSettings(id)}
							/>
						))}
					</div>
				</div>

				{/* Agent System Prompt */}
				<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								AI Agent Prompt
							</span>
							{isCustomPrompt ? (
								<Badge variant="primary">Custom</Badge>
							) : (
								<Badge variant="secondary">Default</Badge>
							)}
						</div>
						{isCustomPrompt && (
							<Button
								variant="ghost"
								size="xs"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetPrompt}
							>
								Reset to default
							</Button>
						)}
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Customize how the AI agent behaves for this mailbox.
						Leave empty to use the built-in default prompt.
					</p>
					<textarea
						value={agentPrompt}
						onChange={(e) => setAgentPrompt(e.target.value)}
						placeholder={PROMPT_PLACEHOLDER}
						rows={12}
						className="w-full resize-y rounded-2xl border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
					/>
					<p className="text-xs text-kumo-subtle mt-2">
						The prompt is sent as the system message to the AI model.
						It controls the agent's personality, writing style, and behavior rules.
					</p>
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save Changes
					</Button>
				</div>

				{/* Legal */}
				<div className="flex justify-center gap-4 text-xs text-kumo-subtle">
					<a
						href={TERMS_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-kumo-default hover:underline underline-offset-2"
					>
						Terms of Use
					</a>
					<a
						href={PRIVACY_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-kumo-default hover:underline underline-offset-2"
					>
						Privacy Policy
					</a>
				</div>
			</div>
		</div>
	);
}

/**
 * Per-mailbox Screener switch (AVE-104). Saves on change. Turning it off moves
 * mail waiting in Screener to Inbox (server side); back on screens new mail only.
 */
function ScreenerToggle() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();
	const saved = isScreenerEnabled(mailbox?.settings);
	const [enabled, setEnabled] = useState(saved);

	useEffect(() => setEnabled(saved), [saved]);

	const handleChange = async (next: boolean) => {
		if (!mailbox || !mailboxId) return;
		setEnabled(next);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: { ...mailbox.settings, screener: { enabled: next } },
			});
			if (!next) {
				queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
				queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			}
			toastManager.add({
				title: next ? "Screener on" : "Screener off: new senders go straight to your Inbox",
			});
		} catch (e) {
			setEnabled(saved);
			toastManager.add({
				title: e instanceof Error && e.message ? e.message : "Failed to update Screener",
				variant: "error",
			});
		}
	};

	return (
		<div className="flex items-start gap-3 mb-3" data-settings-toggle="screener">
			<div className="min-w-0 flex-1">
				<div className="text-sm text-kumo-default">Screener</div>
				<div className="text-xs text-kumo-subtle">
					{enabled
						? "First-time senders wait in Screener until you accept them"
						: "First-time senders go to your Inbox. Spam and blocked senders are still filtered."}
				</div>
			</div>
			<Switch
				aria-label="Screener"
				checked={enabled}
				onCheckedChange={(next) => void handleChange(next)}
				disabled={!mailbox || updateMailboxMutation.isPending}
			/>
		</div>
	);
}

/** The signed-in user (across mailboxes): sign-in, devices, deletion, log out. */
function AccountCard({
	settingsPage,
	openSettings,
}: {
	settingsPage: SettingsPageId | null;
	openSettings: (page: SettingsPageId) => void;
}) {
	const { data: me } = useMe();
	const { data: recovery } = useRecoveryEmail();
	// Reset codes go only to a verified recovery email; without one, "Forgot
	// password" quietly sends nothing.
	const needsRecovery = recovery !== undefined && !recovery.verified;
	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
			<div className="flex items-baseline justify-between gap-3 mb-4">
				<span className="text-sm font-medium text-kumo-default">Your account</span>
				{me?.email && (
					<span className="text-xs text-kumo-subtle truncate">{me.email}</span>
				)}
			</div>
			{needsRecovery && (
				<button
					type="button"
					onClick={() => openSettings("sign-in")}
					className="w-full text-left rounded-md bg-kumo-warning-tint px-3 py-2 mb-3 text-xs text-kumo-default hover:opacity-90"
				>
					{recovery.email
						? `Verify ${recovery.email} so you can reset your password if you forget it.`
						: "Add a recovery email so you can reset your password if you forget it."}
				</button>
			)}
			<div className="divide-y divide-kumo-line -mx-2">
				{ACCOUNT_PAGES.map((id) => (
					<SettingsLink
						key={id}
						id={id}
						isOpen={settingsPage === id}
						onOpen={() => openSettings(id)}
					/>
				))}
			</div>
			<div className="pt-3">
				<Button
					variant="secondary"
					size="sm"
					icon={<SignOutIcon size={14} />}
					onClick={() => void signOut()}
				>
					Log out
				</Button>
			</div>
		</div>
	);
}

function SettingsLink({
	id,
	isOpen,
	onOpen,
}: {
	id: SettingsPageId;
	isOpen: boolean;
	onOpen: () => void;
}) {
	const page = SETTINGS_PAGES[id];
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-current={isOpen ? "true" : undefined}
			data-settings-page={id}
			className={`group w-full flex items-center gap-3 px-3 py-3 text-left rounded-xl transition-colors ${
				isOpen ? "bg-kumo-tint" : "hover:bg-kumo-tint"
			}`}
		>
			<span className="text-kumo-subtle shrink-0">{page.icon}</span>
			<span className="min-w-0 flex-1">
				<span className="block text-sm text-kumo-default">{page.label}</span>
				<span className="block text-xs text-kumo-subtle">{page.description}</span>
			</span>
			<CaretRightIcon
				size={16}
				className={`text-kumo-subtle shrink-0 transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5 ${
					isOpen ? "translate-x-0.5 text-kumo-default" : ""
				}`}
			/>
		</button>
	);
}

/**
 * Settings opens as a panel at the far right of the canvas (it never replaces
 * the list or reader); a sub-page opens in the column beside it.
 */
export default function SettingsColumns() {
	const { settingsPage, closeSettings } = useUIStore();
	const session = useUIStore((s) => s.panelSession.settings);
	const page = settingsPage ? SETTINGS_PAGES[settingsPage] : null;
	return (
		<>
			<ColumnPane
				id="settings"
				title="Settings"
				revealKey={session}
				onClose={closeSettings}
				closeLabel="Close settings"
			>
				<SettingsContent />
			</ColumnPane>
			{page && (
				<ColumnPane
					id="settings-page"
					title={page.label}
					hideHeader
					revealKey={page.id}
				>
					<Suspense
						fallback={
							<div className="flex justify-center py-20">
								<Loader size="lg" />
							</div>
						}
					>
						<div key={page.id} className="animate-reveal">
							<page.Component />
						</div>
					</Suspense>
				</ColumnPane>
			)}
		</>
	);
}

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import SettingsSubpage from "~/components/SettingsSubpage";
import { useFolders } from "~/queries/folders";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import type { InboxFilterRule } from "~/types";

// #region agent log
function dbg(
	hypothesisId: string,
	location: string,
	message: string,
	data: Record<string, unknown> = {},
) {
	const payload = {
		hypothesisId,
		location,
		message,
		data,
		timestamp: Date.now(),
	};
	console.log("[DBG-FILTERS]", payload);
	try {
		fetch("http://127.0.0.1:7399/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}).catch(() => {});
	} catch {
		/* ignore */
	}
}
// #endregion

function createRule(): InboxFilterRule {
	return {
		id: crypto.randomUUID(),
		enabled: true,
		name: "",
		from: "",
		list: "",
		subject: "",
		folderId: "",
		skipAutoDraft: false,
		forwardTo: "",
	};
}

function summarizeRule(rule: InboxFilterRule, folderName?: string): string {
	const conditions: string[] = [];
	if (rule.from?.trim()) conditions.push(`from ${rule.from.trim()}`);
	if (rule.list?.trim()) {
		conditions.push(
			rule.list.trim() === "*" ? "any list" : `list ${rule.list.trim()}`,
		);
	}
	if (rule.subject?.trim()) conditions.push(`subject "${rule.subject.trim()}"`);

	const actions: string[] = [];
	if (rule.folderId?.trim()) actions.push(folderName || rule.folderId);
	if (rule.skipAutoDraft) actions.push("skip auto-draft");
	if (rule.forwardTo?.trim()) actions.push(`forward to ${rule.forwardTo.trim()}`);

	const left = conditions.length ? conditions.join(", ") : "no conditions";
	const right = actions.length ? actions.join(", ") : "no actions";
	return `${left} → ${right}`;
}

function sanitizeRules(rules: InboxFilterRule[]): InboxFilterRule[] {
	return rules.map((rule) => ({
		id: rule.id,
		enabled: rule.enabled !== false,
		name: rule.name?.trim() || undefined,
		from: rule.from?.trim() || undefined,
		list: rule.list?.trim() || undefined,
		subject: rule.subject?.trim() || undefined,
		folderId: rule.folderId?.trim() || undefined,
		skipAutoDraft: rule.skipAutoDraft || undefined,
		forwardTo: rule.forwardTo?.trim() || undefined,
	}));
}

export default function FiltersSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: folders } = useFolders(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [rules, setRules] = useState<InboxFilterRule[]>([]);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	// #region agent log
	useEffect(() => {
		dbg("B", "settings-filters.tsx:mount", "FiltersSettingsRoute mounted", {
			mailboxId: mailboxId ?? null,
		});
		return () => {
			dbg("B", "settings-filters.tsx:unmount", "FiltersSettingsRoute unmounted", {
				mailboxId: mailboxId ?? null,
			});
		};
	}, [mailboxId]);
	// #endregion

	useEffect(() => {
		if (!mailbox) return;
		// #region agent log
		const incoming = mailbox.settings?.filters ?? [];
		dbg("A", "settings-filters.tsx:useEffect[mailbox]", "mailbox effect reset rules", {
			mailboxEmail: mailbox.email,
			incomingCount: incoming.length,
			incomingIds: incoming.map((r) => r.id),
			incomingIdPresent: incoming.map((r) => Boolean(r.id)),
			prevRulesCount: rules.length,
			prevRuleIds: rules.map((r) => r.id),
			editingId,
		});
		// #endregion
		setRules(
			(mailbox.settings?.filters ?? []).map((rule) => ({
				...createRule(),
				...rule,
				enabled: rule.enabled !== false,
			})),
		);
	}, [mailbox]);

	const folderOptions = useMemo(() => folders ?? [], [folders]);
	const folderNameById = useMemo(() => {
		const map = new Map<string, string>();
		for (const folder of folderOptions) map.set(folder.id, folder.name);
		return map;
	}, [folderOptions]);

	const editing = rules.find((rule) => rule.id === editingId) ?? null;

	// #region agent log
	useEffect(() => {
		dbg("A", "settings-filters.tsx:render-state", "rules/editingId state", {
			rulesCount: rules.length,
			ruleIds: rules.map((r) => r.id),
			ruleNames: rules.map((r) => r.name || "Untitled"),
			editingId,
			editingFound: Boolean(editing),
			editingName: editing?.name || null,
		});
	}, [rules, editingId, editing]);
	// #endregion

	const updateRule = (id: string, patch: Partial<InboxFilterRule>) => {
		setRules((prev) =>
			prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
		);
	};

	const handleAdd = () => {
		const rule = createRule();
		// #region agent log
		dbg("D", "settings-filters.tsx:handleAdd", "Add filter clicked", {
			newRuleId: rule.id,
			prevRulesCount: rules.length,
			prevEditingId: editingId,
		});
		// #endregion
		setRules((prev) => [...prev, rule]);
		setEditingId(rule.id);
	};

	const handleDelete = (id: string) => {
		setRules((prev) => prev.filter((rule) => rule.id !== id));
		if (editingId === id) setEditingId(null);
	};

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		const cleaned = sanitizeRules(rules);

		for (const rule of cleaned) {
			const hasCondition = Boolean(rule.from || rule.list || rule.subject);
			const hasAction = Boolean(
				rule.folderId || rule.skipAutoDraft || rule.forwardTo,
			);
			if (!hasCondition) {
				toastManager.add({
					title: "Each filter needs a from, list, or subject condition",
					variant: "error",
				});
				return;
			}
			if (!hasAction) {
				toastManager.add({
					title: "Each filter needs a folder, skip auto-draft, or forward action",
					variant: "error",
				});
				return;
			}
			if (rule.forwardTo) {
				if (!rule.forwardTo.includes("@")) {
					toastManager.add({
						title: "Enter a valid filter forward address",
						variant: "error",
					});
					return;
				}
				if (rule.forwardTo.toLowerCase() === mailbox.email.toLowerCase()) {
					toastManager.add({
						title: "Filter forward address cannot be this mailbox",
						variant: "error",
					});
					return;
				}
			}
		}

		if (cleaned.length > 50) {
			toastManager.add({ title: "At most 50 filters allowed", variant: "error" });
			return;
		}

		setIsSaving(true);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...mailbox.settings,
					filters: cleaned,
				},
			});
			toastManager.add({ title: "Filters saved" });
			setEditingId(null);
		} catch (e) {
			const title =
				e instanceof Error && e.message ? e.message : "Failed to save filters";
			toastManager.add({ title, variant: "error" });
		} finally {
			setIsSaving(false);
		}
	};

	if (!mailbox || !mailboxId) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Filters">
			<div className="space-y-4">
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
					<p className="text-sm text-kumo-default leading-relaxed">
						If a message matches, file it, skip auto-draft, or forward. First
						matching rule wins.
					</p>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						Conditions use AND. For sender, use an address,{" "}
						<code className="text-kumo-default">@domain.com</code>, or a
						substring. For lists, use List-Id text or{" "}
						<code className="text-kumo-default">*</code> for any mailing list.
					</p>
				</div>

				<div className="rounded-lg border border-kumo-line bg-kumo-base divide-y divide-kumo-line">
					{rules.length === 0 && (
						<p className="px-5 py-6 text-sm text-kumo-subtle">No filters yet.</p>
					)}
					{rules.map((rule) => (
						<div key={rule.id} className="px-5 py-3 flex items-start gap-3">
							<div className="pt-1">
								<Switch
									checked={rule.enabled !== false}
									onCheckedChange={(checked) =>
										updateRule(rule.id, { enabled: checked })
									}
									aria-label={`Enable ${rule.name || "filter"}`}
								/>
							</div>
							<button
								type="button"
								className="min-w-0 flex-1 text-left"
								onClick={() => {
									// #region agent log
									const topEl =
										typeof document !== "undefined"
											? document.elementFromPoint(
													window.innerWidth / 2,
													window.innerHeight / 2,
												)
											: null;
									dbg("C", "settings-filters.tsx:rowClick", "filter row clicked", {
										ruleId: rule.id,
										ruleName: rule.name || "Untitled",
										prevEditingId: editingId,
										nextEditingId: editingId === rule.id ? null : rule.id,
										centerElement:
											topEl?.tagName +
											(topEl?.className
												? `.${String(topEl.className).slice(0, 80)}`
												: ""),
									});
									// #endregion
									setEditingId((current) =>
										current === rule.id ? null : rule.id,
									);
								}}
							>
								<div className="text-sm text-kumo-default font-medium">
									{rule.name?.trim() || "Untitled filter"}
								</div>
								<p className="text-xs text-kumo-subtle mt-0.5">
									{summarizeRule(
										rule,
										folderNameById.get(rule.folderId || ""),
									)}
								</p>
							</button>
							<button
								type="button"
								className="p-2 text-kumo-subtle hover:text-kumo-default"
								aria-label="Delete filter"
								onClick={() => handleDelete(rule.id)}
							>
								<TrashIcon size={16} />
							</button>
						</div>
					))}
				</div>

				{editing && (
					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
						<div className="text-sm font-medium text-kumo-default">
							Edit filter
						</div>
						<Input
							label="Name"
							value={editing.name || ""}
							onChange={(e) => updateRule(editing.id, { name: e.target.value })}
							placeholder="Newsletters"
						/>
						<div className="space-y-3">
							<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
								Conditions
							</div>
							<Input
								label="From"
								value={editing.from || ""}
								onChange={(e) =>
									updateRule(editing.id, { from: e.target.value })
								}
								placeholder="boss@company.com or @company.com"
							/>
							<Input
								label="List"
								value={editing.list || ""}
								onChange={(e) =>
									updateRule(editing.id, { list: e.target.value })
								}
								placeholder="* or list-id fragment"
							/>
							<Input
								label="Subject contains"
								value={editing.subject || ""}
								onChange={(e) =>
									updateRule(editing.id, { subject: e.target.value })
								}
								placeholder="invoice"
							/>
						</div>
						<div className="space-y-3">
							<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wide">
								Actions
							</div>
							<label className="block space-y-1.5">
								<span className="text-sm text-kumo-default">Move to folder</span>
								<select
									className="w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
									value={editing.folderId || ""}
									onChange={(e) =>
										updateRule(editing.id, { folderId: e.target.value })
									}
								>
									<option value="">Keep classified folder</option>
									{folderOptions.map((folder) => (
										<option key={folder.id} value={folder.id}>
											{folder.name}
										</option>
									))}
								</select>
							</label>
							<Switch
								label="Skip auto-draft"
								checked={Boolean(editing.skipAutoDraft)}
								onCheckedChange={(checked) =>
									updateRule(editing.id, { skipAutoDraft: checked })
								}
								controlFirst={false}
							/>
							<Input
								label="Forward to"
								type="email"
								value={editing.forwardTo || ""}
								onChange={(e) =>
									updateRule(editing.id, { forwardTo: e.target.value })
								}
								placeholder="optional@example.com"
							/>
						</div>
					</div>
				)}

				<div className="flex items-center justify-between gap-3">
					<Button
						variant="secondary"
						size="sm"
						icon={<PlusIcon size={14} />}
						onClick={() => {
							// #region agent log
							dbg("D", "settings-filters.tsx:AddButton", "Kumo Add filter Button onClick fired", {
								rulesCount: rules.length,
								editingId,
							});
							// #endregion
							handleAdd();
						}}
					>
						Add filter
					</Button>
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save
					</Button>
				</div>
			</div>
		</SettingsSubpage>
	);
}

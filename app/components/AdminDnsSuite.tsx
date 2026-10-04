// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	ArrowClockwiseIcon,
	CheckCircleIcon,
	CloudIcon,
	CopyIcon,
	DownloadSimpleIcon,
	GlobeIcon,
	KeyIcon,
	LockSimpleIcon,
	LockSimpleOpenIcon,
	PencilSimpleIcon,
	PlusIcon,
	ShieldCheckIcon,
	TrashIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import api from "~/services/api";
import type {
	AdminDomainInfo,
	CloudflareDnsRecord,
	DecommissionPreflightResponse,
	DecommissionResponse,
	DomainAvailabilityResponse,
	DomainHealthResponse,
	EmailHealthItem,
	ExportJob,
	NewDnsRecord,
} from "~/types";

interface AdminDnsSuiteProps {
	configuredDomains: string[];
	mailDomain: string;
	initialDomain?: string;
	justPurchased?: boolean;
}

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

const TTL_OPTIONS = [
	{ label: "Auto", value: 1 },
	{ label: "1 minute", value: 60 },
	{ label: "5 minutes", value: 300 },
	{ label: "10 minutes", value: 600 },
	{ label: "30 minutes", value: 1800 },
	{ label: "1 hour", value: 3600 },
	{ label: "1 day", value: 86400 },
];

function formatBytes(bytes?: number): string {
	if (!bytes || bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function AdminDnsSuite({
	configuredDomains,
	mailDomain,
	initialDomain,
	justPurchased,
}: AdminDnsSuiteProps) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();

	// 1. Fetch all domains administered by the current user
	const { data: domainsData, isLoading: domainsLoading } = useQuery({
		queryKey: ["admin-domains"],
		queryFn: () => api.listAdminDomains(),
		staleTime: 30_000,
	});

	const administeredDomains = domainsData?.domains ?? [];
	const availableDomains =
		administeredDomains.length > 0
			? administeredDomains.map((d) => d.domain)
			: configuredDomains.length > 0
				? configuredDomains
				: [mailDomain].filter(Boolean);

	const [selectedDomain, setSelectedDomain] = useState<string>(
		initialDomain || availableDomains[0] || "",
	);

	useEffect(() => {
		if (initialDomain && availableDomains.includes(initialDomain)) {
			setSelectedDomain(initialDomain);
		} else if (!selectedDomain && availableDomains.length > 0) {
			setSelectedDomain(availableDomains[0]);
		}
	}, [availableDomains, initialDomain, selectedDomain]);

	// Export Modal State & Polling
	const [isExportModalOpen, setIsExportModalOpen] = useState(false);
	const [exportJob, setExportJob] = useState<ExportJob | null>(null);
	const [exportLoading, setExportLoading] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);

	// Poll export job status until completed or failed
	useEffect(() => {
		if (!exportJob || (exportJob.status !== "pending" && exportJob.status !== "processing")) {
			return;
		}

		const interval = setInterval(async () => {
			try {
				const updated = await api.getExportJob(exportJob.id);
				setExportJob(updated);
				if (updated.status === "completed" || updated.status === "failed") {
					clearInterval(interval);
				}
			} catch (err) {
				console.error("Failed to poll export job:", err);
			}
		}, 1500);

		return () => clearInterval(interval);
	}, [exportJob]);

	const handleStartDomainExport = async () => {
		setExportLoading(true);
		setExportError(null);
		try {
			const job = await api.exportDomain(selectedDomain);
			setExportJob(job);
			toastManager.add({ title: "Email export job initiated" });
		} catch (err: unknown) {
			setExportError(
				err instanceof Error ? err.message : "Failed to start export job",
			);
		} finally {
			setExportLoading(false);
		}
	};

	// Decommission / Offboarding state
	const [isDecommissionModalOpen, setIsDecommissionModalOpen] = useState(false);
	const [preflight, setPreflight] = useState<DecommissionPreflightResponse | null>(null);
	const [preflightLoading, setPreflightLoading] = useState(false);
	const [confirmDomainInput, setConfirmDomainInput] = useState("");
	const [skipExportAcknowledged, setSkipExportAcknowledged] = useState(false);
	const [decommissioning, setDecommissioning] = useState(false);
	const [decommissionError, setDecommissionError] = useState<string | null>(null);
	const [offboardResult, setOffboardResult] = useState<DecommissionResponse | null>(null);
	const [eppCode, setEppCode] = useState<string | null>(null);
	const [eppLoading, setEppLoading] = useState(false);
	const [transferLocked, setTransferLocked] = useState<boolean>(true);
	const [lockToggling, setLockToggling] = useState(false);

	const openDecommissionModal = async () => {
		setIsDecommissionModalOpen(true);
		setPreflightLoading(true);
		setConfirmDomainInput("");
		setSkipExportAcknowledged(false);
		setDecommissionError(null);
		setOffboardResult(null);
		setEppCode(null);

		try {
			const res = await api.getDecommissionPreflight(selectedDomain);
			setPreflight(res);
			setTransferLocked(res.transferLocked);
		} catch (err: unknown) {
			setDecommissionError(
				err instanceof Error ? err.message : "Failed to load preflight checks",
			);
		} finally {
			setPreflightLoading(false);
		}
	};

	const handleToggleTransferLock = async () => {
		setLockToggling(true);
		try {
			const targetLocked = !transferLocked;
			const res = await api.setDomainTransferLock(selectedDomain, targetLocked);
			setTransferLocked(res.locked);
			toastManager.add({
				title: res.locked ? "Domain transfer locked" : "Domain unlocked for transfer",
			});
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Failed to toggle transfer lock",
				variant: "error",
			});
		} finally {
			setLockToggling(false);
		}
	};

	const handleFetchEppCode = async () => {
		setEppLoading(true);
		try {
			const res = await api.getDomainEppCode(selectedDomain);
			setEppCode(res.eppCode);
			toastManager.add({ title: "EPP Transfer Authorization Code loaded" });
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Failed to fetch EPP code",
				variant: "error",
			});
		} finally {
			setEppLoading(false);
		}
	};

	const handleDecommission = async () => {
		setDecommissioning(true);
		setDecommissionError(null);
		try {
			const res = await api.decommissionDomain(selectedDomain, {
				confirmDomain: confirmDomainInput.trim(),
				skipExportAcknowledged,
			});
			setOffboardResult(res);
			if (res.eppCode) setEppCode(res.eppCode);
			toastManager.add({ title: "Domain email routing disconnected" });
			queryClient.invalidateQueries({ queryKey: ["admin-domains"] });
			queryClient.invalidateQueries({ queryKey: ["admin-dns-health", selectedDomain] });
		} catch (err: unknown) {
			setDecommissionError(
				err instanceof Error ? err.message : "Failed to decommission domain",
			);
		} finally {
			setDecommissioning(false);
		}
	};

	// Add Domain Modal State
	const [isAddDomainModalOpen, setIsAddDomainModalOpen] = useState(false);
	const [newDomainInput, setNewDomainInput] = useState("");
	const [newDomainAvailability, setNewDomainAvailability] = useState<DomainAvailabilityResponse | null>(null);
	const [isCheckingNewDomain, setIsCheckingNewDomain] = useState(false);
	const [addDomainError, setAddDomainError] = useState<string | null>(null);
	const [isConnectingDomain, setIsConnectingDomain] = useState(false);

	useEffect(() => {
		const trimmed = newDomainInput.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
		if (!trimmed || !trimmed.includes(".") || trimmed.endsWith(".")) {
			setNewDomainAvailability(null);
			setIsCheckingNewDomain(false);
			setAddDomainError(null);
			return;
		}

		setIsCheckingNewDomain(true);
		setAddDomainError(null);
		let cancelled = false;

		const timer = setTimeout(async () => {
			try {
				const res = await api.checkDomainAvailability(trimmed);
				if (!cancelled) {
					setNewDomainAvailability(res);
					setAddDomainError(null);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					setNewDomainAvailability(null);
					const msg = err instanceof Error ? err.message : "Failed to check domain availability";
					setAddDomainError(msg);
				}
			} finally {
				if (!cancelled) {
					setIsCheckingNewDomain(false);
				}
			}
		}, 500);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [newDomainInput]);

	const handleConnectDomain = async (domainToConnect: string) => {
		setIsConnectingDomain(true);
		setAddDomainError(null);
		try {
			await api.connectAdminDomain({ domain: domainToConnect });
			toastManager.add({ title: `Domain ${domainToConnect} connected!` });
			await queryClient.invalidateQueries({ queryKey: ["admin-domains"] });
			setSelectedDomain(domainToConnect);
			setIsAddDomainModalOpen(false);
			setNewDomainInput("");
			setNewDomainAvailability(null);
		} catch (err: unknown) {
			setAddDomainError(err instanceof Error ? err.message : "Failed to connect domain");
		} finally {
			setIsConnectingDomain(false);
		}
	};

	const handlePurchaseDomain = async (domainToPurchase: string) => {
		setIsConnectingDomain(true);
		setAddDomainError(null);
		try {
			const returnUrl = `${window.location.origin}/admin?tab=dns&purchased=true`;
			const res = await api.createDomainCheckout({ domain: domainToPurchase, returnUrl });
			window.location.href = res.checkoutUrl;
		} catch (err: unknown) {
			setAddDomainError(err instanceof Error ? err.message : "Failed to create checkout");
			setIsConnectingDomain(false);
		}
	};

	// 2. Fetch DNS Health
	const {
		data: healthData,
		isLoading: healthLoading,
		refetch: refetchHealth,
		isFetching: healthFetching,
	} = useQuery({
		queryKey: ["admin-dns-health", selectedDomain],
		queryFn: () => api.getDomainDnsHealth(selectedDomain),
		enabled: Boolean(selectedDomain),
		staleTime: 15_000,
	});

	// 3. Fetch all DNS records
	const {
		data: recordsData,
		isLoading: recordsLoading,
		refetch: refetchRecords,
	} = useQuery({
		queryKey: ["admin-dns-records", selectedDomain],
		queryFn: () => api.listDomainDnsRecords(selectedDomain),
		enabled: Boolean(selectedDomain),
		staleTime: 15_000,
	});

	const records = recordsData?.records ?? [];
	const audit = healthData?.audit;

	// Copy Nameserver helper
	const [copiedNs, setCopiedNs] = useState<string | null>(null);
	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedNs(text);
		toastManager.add({ title: "Copied to clipboard" });
		setTimeout(() => setCopiedNs(null), 2000);
	};

	// Fix Email DNS Mutation
	const fixDnsMutation = useMutation({
		mutationFn: () => api.fixDomainEmailDns(selectedDomain),
		onSuccess: () => {
			toastManager.add({ title: "Email DNS records repaired & updated" });
			queryClient.invalidateQueries({ queryKey: ["admin-dns-health", selectedDomain] });
			queryClient.invalidateQueries({ queryKey: ["admin-dns-records", selectedDomain] });
		},
		onError: (err: unknown) => {
			toastManager.add({
				title: err instanceof Error ? err.message : "Failed to auto-configure DNS",
				variant: "error",
			});
		},
	});

	// Add / Edit Record Dialog State
	const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
	const [editingRecord, setEditingRecord] = useState<CloudflareDnsRecord | null>(null);
	const [recordType, setRecordType] = useState<RecordType>("A");
	const [recordName, setRecordName] = useState("");
	const [recordContent, setRecordContent] = useState("");
	const [recordTtl, setRecordTtl] = useState(1);
	const [recordProxied, setRecordProxied] = useState(false);
	const [recordPriority, setRecordPriority] = useState<number | undefined>(10);
	const [recordComment, setRecordComment] = useState("");
	const [modalError, setModalError] = useState<string | null>(null);

	// Delete Record Dialog State
	const [deleteTarget, setDeleteTarget] = useState<CloudflareDnsRecord | null>(null);
	const [deleting, setDeleting] = useState(false);

	const openCreateModal = () => {
		setEditingRecord(null);
		setRecordType("A");
		setRecordName("@");
		setRecordContent("");
		setRecordTtl(1);
		setRecordProxied(false);
		setRecordPriority(undefined);
		setRecordComment("");
		setModalError(null);
		setIsRecordModalOpen(true);
	};

	const openEditModal = (rec: CloudflareDnsRecord) => {
		setEditingRecord(rec);
		setRecordType(rec.type as RecordType);
		setRecordName(rec.name);
		setRecordContent(rec.content);
		setRecordTtl(rec.ttl);
		setRecordProxied(rec.proxied);
		setRecordPriority(rec.priority);
		setRecordComment(rec.comment ?? "");
		setModalError(null);
		setIsRecordModalOpen(true);
	};

	const handleSaveRecord = async (e: FormEvent) => {
		e.preventDefault();
		setModalError(null);

		if (!recordName.trim()) {
			setModalError("Record name is required");
			return;
		}
		if (!recordContent.trim()) {
			setModalError("Record content is required");
			return;
		}

		const payload: NewDnsRecord = {
			type: recordType,
			name: recordName.trim(),
			content: recordContent.trim(),
			ttl: recordTtl,
			proxied: ["A", "AAAA", "CNAME"].includes(recordType) ? recordProxied : false,
			priority: recordType === "MX" ? recordPriority ?? 10 : undefined,
			comment: recordComment.trim() || undefined,
		};

		try {
			if (editingRecord) {
				await api.updateDomainDnsRecord(selectedDomain, editingRecord.id, payload);
				toastManager.add({ title: "DNS record updated" });
			} else {
				await api.createDomainDnsRecord(selectedDomain, payload);
				toastManager.add({ title: "DNS record created" });
			}
			setIsRecordModalOpen(false);
			await refetchRecords();
			await refetchHealth();
		} catch (err: unknown) {
			setModalError(
				err instanceof Error ? err.message : "Failed to save DNS record",
			);
		}
	};

	const handleDeleteRecord = async () => {
		if (!deleteTarget) return;
		setDeleting(true);
		try {
			await api.deleteDomainDnsRecord(selectedDomain, deleteTarget.id);
			toastManager.add({ title: "DNS record deleted" });
			setDeleteTarget(null);
			await refetchRecords();
			await refetchHealth();
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Failed to delete record",
				variant: "error",
			});
		} finally {
			setDeleting(false);
		}
	};

	const statusPill = (status: EmailHealthItem["status"]) => {
		switch (status) {
			case "connected":
				return (
					<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
						<CheckCircleIcon size={14} weight="fill" /> Connected
					</span>
				);
			case "conflict":
				return (
					<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400">
						<WarningCircleIcon size={14} weight="fill" /> Conflict
					</span>
				);
			case "missing":
				return (
					<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
						<WarningCircleIcon size={14} weight="fill" /> Missing
					</span>
				);
			case "pending":
			default:
				return (
					<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400">
						<ArrowClockwiseIcon size={14} className="animate-spin" /> Pending
					</span>
				);
		}
	};

	return (
		<div className="space-y-6">
			{/* Domain Purchase Success Celebration */}
			{justPurchased && (
				<div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200 flex items-start gap-3">
					<CheckCircleIcon
						size={24}
						weight="fill"
						className="shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5"
					/>
					<div>
						<div className="font-bold text-sm">
							Domain Purchased & Provisioned Successfully!
						</div>
						<p className="text-xs mt-1 text-emerald-700 dark:text-emerald-300">
							Cloudflare Registrar has registered{" "}
							<strong className="font-semibold">{selectedDomain}</strong>,
							provisioned Anycast DNS, generated Universal SSL certificates, and
							activated automated email routing.
						</p>
					</div>
				</div>
			)}

			{/* Domain Selector & Zone Overview */}
			<div className="rounded-xl border border-kumo-line bg-kumo-base p-6">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-kumo-line">
					<div>
						<h2 className="text-base font-semibold text-kumo-default flex items-center gap-2">
							<GlobeIcon size={20} className="text-kumo-subtle" />
							Domain & Cloudflare Status
						</h2>
						<p className="text-sm text-kumo-subtle mt-0.5">
							Manage Cloudflare DNS, edge security, email export, and migration.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{availableDomains.length > 1 && (
							<div className="w-full sm:w-48">
								<Select
									value={selectedDomain}
									onChange={(val) => setSelectedDomain(String(val))}
								>
									{availableDomains.map((d) => (
										<Select.Option key={d} value={d}>
											{d}
										</Select.Option>
									))}
								</Select>
							</div>
						)}
						<Button
							variant="primary"
							size="sm"
							icon={<PlusIcon size={15} />}
							onClick={() => {
								setIsAddDomainModalOpen(true);
								setNewDomainInput("");
								setNewDomainAvailability(null);
								setAddDomainError(null);
							}}
						>
							Add / Register Domain
						</Button>
						<Button
							variant="secondary"
							size="sm"
							icon={<DownloadSimpleIcon size={15} />}
							onClick={() => {
								setIsExportModalOpen(true);
								setExportJob(null);
								setExportError(null);
							}}
						>
							Export (.mbox)
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onClick={openDecommissionModal}
						>
							Move DNS / Offboard
						</Button>
					</div>
				</div>

				<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="rounded-lg bg-kumo-recessed p-4">
						<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider mb-1">
							Cloudflare Zone
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-semibold text-kumo-default truncate">
								{selectedDomain}
							</span>
							<span
								className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
									healthData?.zoneStatus === "active"
										? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
										: "bg-amber-500/10 text-amber-600 dark:text-amber-400"
								}`}
							>
								{healthData?.zoneStatus === "active"
									? "Active on Cloudflare"
									: "Pending Nameservers"}
							</span>
						</div>
					</div>

					<div className="rounded-lg bg-kumo-recessed p-4">
						<div className="text-xs font-medium text-kumo-subtle uppercase tracking-wider mb-1">
							Assigned Nameservers
						</div>
						{healthData?.nameservers && healthData.nameservers.length > 0 ? (
							<div className="space-y-1">
								{healthData.nameservers.map((ns) => (
									<div
										key={ns}
										className="flex items-center justify-between text-xs text-kumo-default font-mono bg-kumo-base px-2 py-1 rounded border border-kumo-line"
									>
										<span>{ns}</span>
										<button
											type="button"
											onClick={() => handleCopy(ns)}
											className="text-kumo-subtle hover:text-kumo-default transition-colors p-0.5"
											title="Copy nameserver"
										>
											<CopyIcon size={14} />
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="text-xs text-kumo-subtle">
								Standard Cloudflare Nameservers
							</div>
						)}
					</div>
				</div>

				{/* Active Cloudflare Edge Services Showcase */}
				<div className="mt-5 pt-4 border-t border-kumo-line">
					<div className="flex items-center gap-2 mb-3">
						<CloudIcon
							size={16}
							weight="fill"
							className="text-sky-600 dark:text-sky-400"
						/>
						<h4 className="text-xs font-bold text-kumo-default uppercase tracking-wider">
							Active Cloudflare Edge Services
						</h4>
						<span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
							Included by Default
						</span>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
						<div className="p-3 rounded-lg border border-kumo-line bg-kumo-recessed space-y-1">
							<div className="font-semibold text-kumo-default flex items-center gap-1.5">
								<GlobeIcon size={15} className="text-sky-500" />
								Anycast DNS
							</div>
							<p className="text-[11px] text-kumo-subtle">
								Fast DNS resolution routed to 330+ Cloudflare global points of
								presence.
							</p>
						</div>
						<div className="p-3 rounded-lg border border-kumo-line bg-kumo-recessed space-y-1">
							<div className="font-semibold text-kumo-default flex items-center gap-1.5">
								<ShieldCheckIcon size={15} className="text-emerald-500" />
								Universal SSL / TLS
							</div>
							<p className="text-[11px] text-kumo-subtle">
								Automated edge encryption certificates auto-managed with zero
								downtime.
							</p>
						</div>
						<div className="p-3 rounded-lg border border-kumo-line bg-kumo-recessed space-y-1">
							<div className="font-semibold text-kumo-default flex items-center gap-1.5">
								<CheckCircleIcon size={15} className="text-sky-500" />
								Email Routing & DMARC
							</div>
							<p className="text-[11px] text-kumo-subtle">
								Inbound catch-all routing with strict SPF, DKIM, and DMARC
								alignment.
							</p>
						</div>
						<div className="p-3 rounded-lg border border-kumo-line bg-kumo-recessed space-y-1">
							<div className="font-semibold text-kumo-default flex items-center gap-1.5">
								<CloudIcon size={15} className="text-amber-500" />
								DDoS & WAF Protection
							</div>
							<p className="text-[11px] text-kumo-subtle">
								Orange Cloud edge protection mitigating layer 3/4 and layer 7
								attacks.
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Email Health Dashboard */}
			<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
				<div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-kumo-line">
					<div>
						<div className="flex items-center gap-2">
							<h3 className="text-base font-semibold text-kumo-default">
								Email Health Verification
							</h3>
							{audit && (
								<span
									className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
										audit.overallStatus === "healthy"
											? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
											: audit.overallStatus === "action_needed"
												? "bg-red-500/10 text-red-600 dark:text-red-400"
												: "bg-amber-500/10 text-amber-600 dark:text-amber-400"
									}`}
								>
									{audit.overallStatus === "healthy"
										? "All Records Healthy"
										: audit.overallStatus === "action_needed"
											? "Action Needed"
											: "Propagation Pending"}
								</span>
							)}
						</div>
						<p className="text-xs text-kumo-subtle mt-0.5">
							Validates inbound email routing and outbound sender authentication (MX, SPF, DKIM, DMARC).
						</p>
					</div>

					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							icon={
								<ArrowClockwiseIcon
									size={14}
									className={healthFetching ? "animate-spin" : ""}
								/>
							}
							onClick={() => refetchHealth()}
							disabled={healthFetching}
						>
							Refresh
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={() => fixDnsMutation.mutate()}
							disabled={fixDnsMutation.isPending}
						>
							{fixDnsMutation.isPending ? "Repairing..." : "Fix Email DNS"}
						</Button>
					</div>
				</div>

				{healthLoading ? (
					<div className="flex justify-center py-12">
						<Loader size="lg" />
					</div>
				) : (
					<div className="divide-y divide-kumo-line">
						{audit?.items.map((item) => (
							<div
								key={item.type}
								className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-3"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="text-xs font-bold px-1.5 py-0.5 rounded bg-kumo-fill text-kumo-default font-mono">
											{item.type}
										</span>
										<span className="text-sm font-medium text-kumo-default">
											{item.name}
										</span>
									</div>
									<div className="text-xs text-kumo-subtle mt-1 font-mono break-all">
										{item.currentValue ? (
											<span>Current: {item.currentValue}</span>
										) : (
											<span>Expected: {item.expectedValue}</span>
										)}
									</div>
									<p className="text-xs text-kumo-subtle mt-0.5">{item.message}</p>
								</div>
								<div className="shrink-0">{statusPill(item.status)}</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Complete DNS Record Editor */}
			<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
				<div className="p-5 flex items-center justify-between gap-4 border-b border-kumo-line">
					<div>
						<h3 className="text-base font-semibold text-kumo-default">
							DNS Records
						</h3>
						<p className="text-xs text-kumo-subtle mt-0.5">
							All records configured directly on Cloudflare for {selectedDomain}.
						</p>
					</div>
					<Button
						variant="primary"
						size="sm"
						icon={<PlusIcon size={16} />}
						onClick={openCreateModal}
					>
						Add Record
					</Button>
				</div>

				{recordsLoading ? (
					<div className="flex justify-center py-12">
						<Loader size="lg" />
					</div>
				) : records.length === 0 ? (
					<div className="p-12 text-center text-sm text-kumo-subtle">
						No DNS records found for this domain.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead className="bg-kumo-recessed text-kumo-subtle font-medium border-b border-kumo-line">
								<tr>
									<th className="py-2.5 px-4">Type</th>
									<th className="py-2.5 px-4">Name</th>
									<th className="py-2.5 px-4">Content</th>
									<th className="py-2.5 px-4">TTL</th>
									<th className="py-2.5 px-4">Proxy</th>
									<th className="py-2.5 px-4 text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-kumo-line font-mono">
								{records.map((rec) => (
									<tr key={rec.id} className="hover:bg-kumo-tint transition-colors">
										<td className="py-3 px-4 font-bold text-kumo-default">
											<span className="px-1.5 py-0.5 rounded bg-kumo-fill text-xs">
												{rec.type}
											</span>
										</td>
										<td className="py-3 px-4 text-kumo-default font-medium truncate max-w-[160px]">
											{rec.name}
										</td>
										<td className="py-3 px-4 text-kumo-subtle break-all max-w-xs">
											{rec.content}
											{rec.priority != null && ` (Priority: ${rec.priority})`}
										</td>
										<td className="py-3 px-4 text-kumo-subtle">
											{rec.ttl === 1 ? "Auto" : `${rec.ttl}s`}
										</td>
										<td className="py-3 px-4">
											{rec.proxiable ? (
												<span
													className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-sans ${
														rec.proxied
															? "bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
															: "bg-kumo-fill text-kumo-subtle"
													}`}
												>
													{rec.proxied ? "Proxied" : "DNS Only"}
												</span>
											) : (
												<span className="text-kumo-subtle font-sans text-[11px]">
													DNS Only
												</span>
											)}
										</td>
										<td className="py-3 px-4 text-right space-x-1 font-sans">
											<Button
												variant="ghost"
												size="sm"
												shape="square"
												icon={<PencilSimpleIcon size={14} />}
												aria-label="Edit record"
												onClick={() => openEditModal(rec)}
											/>
											<Button
												variant="ghost"
												size="sm"
												shape="square"
												icon={<TrashIcon size={14} />}
												aria-label="Delete record"
												onClick={() => setDeleteTarget(rec)}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{/* Add / Edit Record Dialog */}
			<Dialog.Root open={isRecordModalOpen} onOpenChange={setIsRecordModalOpen}>
				<Dialog size="lg" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						{editingRecord ? "Edit DNS Record" : "Add DNS Record"}
					</Dialog.Title>
					<form onSubmit={handleSaveRecord} className="space-y-4">
						{modalError && (
							<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
								{modalError}
							</div>
						)}

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Type
								</label>
								<Select
									value={recordType}
									onChange={(val) => setRecordType(val as RecordType)}
								>
									{RECORD_TYPES.map((t) => (
										<Select.Option key={t} value={t}>
											{t}
										</Select.Option>
									))}
								</Select>
							</div>

							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									TTL
								</label>
								<Select
									value={String(recordTtl)}
									onChange={(val) => setRecordTtl(Number(val))}
								>
									{TTL_OPTIONS.map((opt) => (
										<Select.Option key={opt.value} value={String(opt.value)}>
											{opt.label}
										</Select.Option>
									))}
								</Select>
							</div>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Name (@ for root, or subdomain)
							</label>
							<Input
								value={recordName}
								onChange={(e) => setRecordName(e.target.value)}
								placeholder="@"
								required
							/>
						</div>

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Content / Value
							</label>
							<Input
								value={recordContent}
								onChange={(e) => setRecordContent(e.target.value)}
								placeholder={
									recordType === "A"
										? "192.0.2.1"
										: recordType === "CNAME"
											? "example.com"
											: "Value"
								}
								required
							/>
						</div>

						{recordType === "MX" && (
							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Priority
								</label>
								<Input
									type="number"
									value={String(recordPriority ?? 10)}
									onChange={(e) => setRecordPriority(Number(e.target.value))}
									min={0}
									max={65535}
								/>
							</div>
						)}

						{["A", "AAAA", "CNAME"].includes(recordType) && (
							<div className="flex items-center gap-2 pt-1">
								<input
									type="checkbox"
									id="proxiedToggle"
									checked={recordProxied}
									onChange={(e) => setRecordProxied(e.target.checked)}
									className="rounded border-kumo-line"
								/>
								<label
									htmlFor="proxiedToggle"
									className="text-xs font-medium text-kumo-default cursor-pointer"
								>
									Proxy through Cloudflare CDN (Orange Cloud)
								</label>
							</div>
						)}

						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Comment (optional)
							</label>
							<Input
								value={recordComment}
								onChange={(e) => setRecordComment(e.target.value)}
								placeholder="Notes about this record"
							/>
						</div>

						<div className="flex justify-end gap-2 pt-4 border-t border-kumo-line">
							<Button
								variant="secondary"
								onClick={() => setIsRecordModalOpen(false)}
							>
								Cancel
							</Button>
							<Button variant="primary" type="submit">
								{editingRecord ? "Save Changes" : "Create Record"}
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete Confirmation Dialog */}
			<Dialog.Root
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete DNS Record
					</Dialog.Title>
					<p className="text-sm text-kumo-subtle mb-5">
						Are you sure you want to delete the {deleteTarget?.type} record for{" "}
						<span className="font-semibold text-kumo-default font-mono">
							{deleteTarget?.name}
						</span>
						? This action cannot be undone.
					</p>
					<div className="flex justify-end gap-2">
						<Button
							variant="secondary"
							onClick={() => setDeleteTarget(null)}
							disabled={deleting}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteRecord}
							disabled={deleting}
						>
							{deleting ? "Deleting..." : "Delete"}
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			{/* Domain Export Modal */}
			<Dialog.Root open={isExportModalOpen} onOpenChange={setIsExportModalOpen}>
				<Dialog size="lg" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-1 flex items-center gap-2">
						<DownloadSimpleIcon size={18} className="text-kumo-subtle" />
						Export Domain Email Data (.mbox)
					</Dialog.Title>
					<p className="text-xs text-kumo-subtle mb-4">
						Generate a standardized RFC 4155 .mbox archive of all mailboxes
						under <span className="font-semibold text-kumo-default">{selectedDomain}</span>.
					</p>

					{exportError && (
						<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 mb-4">
							{exportError}
						</div>
					)}

					<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-2 mb-4 text-xs">
						<div className="font-semibold text-kumo-default">
							Archive Specifications
						</div>
						<div className="text-kumo-subtle space-y-1">
							<div>
								• <strong>Format:</strong> RFC 4155 MBOX (standard unix mailbox format).
							</div>
							<div>
								• <strong>Compatibility:</strong> Apple Mail, Thunderbird, Google Workspace, Outlook.
							</div>
							<div>
								• <strong>Retention:</strong> Encrypted backup retained in R2 for 7 days.
							</div>
						</div>
					</div>

					{/* Export States */}
					{exportJob ? (
						<div className="space-y-4">
							{exportJob.status === "completed" ? (
								<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
									<div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
										<CheckCircleIcon size={20} weight="fill" />
										Export Archive Ready
									</div>
									<div className="text-xs text-kumo-subtle space-y-1">
										<div>
											<strong>Total Emails:</strong> {exportJob.totalEmails}
										</div>
										{exportJob.fileSizeBytes && (
											<div>
												<strong>File Size:</strong>{" "}
												{formatBytes(exportJob.fileSizeBytes)}
											</div>
										)}
										<div>
											<strong>Available Until:</strong>{" "}
											{new Date(exportJob.expiresAt).toLocaleDateString()}
										</div>
									</div>
									<div className="pt-2">
										<a
											href={api.getExportDownloadUrl(exportJob.id)}
											download
											className="no-underline inline-block"
										>
											<Button
												variant="primary"
												size="sm"
												icon={<DownloadSimpleIcon size={16} />}
											>
												Download .mbox Archive
											</Button>
										</a>
									</div>
								</div>
							) : exportJob.status === "failed" ? (
								<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-600 dark:text-red-400">
									Export failed: {exportJob.error || "Unknown error"}
								</div>
							) : (
								<div className="rounded-xl border border-kumo-line bg-kumo-base p-4 space-y-3">
									<div className="flex items-center justify-between text-xs text-kumo-default font-medium">
										<span className="flex items-center gap-2">
											<Loader size="xs" /> Processing mailboxes...
										</span>
										<span>{exportJob.progress?.percent ?? 0}%</span>
									</div>
									<div className="w-full bg-kumo-recessed rounded-full h-2 overflow-hidden border border-kumo-line">
										<div
											className="bg-emerald-500 h-full transition-all duration-300"
											style={{
												width: `${exportJob.progress?.percent ?? 0}%`,
											}}
										/>
									</div>
									<p className="text-[11px] text-kumo-subtle">
										Processed {exportJob.progress?.processedCount ?? 0} of{" "}
										{exportJob.progress?.totalCount ?? 0} emails
									</p>
								</div>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<p className="text-xs text-kumo-subtle">
								Ready to export all mailbox threads, attachments, and headers for {selectedDomain}.
							</p>
							<Button
								variant="primary"
								onClick={handleStartDomainExport}
								disabled={exportLoading}
							>
								{exportLoading ? "Initiating Export..." : "Start Domain Export"}
							</Button>
						</div>
					)}

					<div className="flex justify-end gap-2 pt-5 border-t border-kumo-line mt-5">
						<Button
							variant="secondary"
							onClick={() => setIsExportModalOpen(false)}
						>
							Close
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			{/* Move DNS / Offboard Domain Modal */}
			<Dialog.Root
				open={isDecommissionModalOpen}
				onOpenChange={setIsDecommissionModalOpen}
			>
				<Dialog size="lg" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-1 flex items-center gap-2 text-red-600 dark:text-red-400">
						<WarningCircleIcon size={20} weight="fill" />
						Move DNS / Offboard Domain
					</Dialog.Title>
					<p className="text-xs text-kumo-subtle mb-4">
						Prepare <span className="font-semibold text-kumo-default">{selectedDomain}</span> for
						DNS migration or registrar transfer.
					</p>

					{preflightLoading ? (
						<div className="flex justify-center py-10">
							<Loader size="lg" />
						</div>
					) : offboardResult ? (
						<div className="space-y-4">
							<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
								<div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
									<CheckCircleIcon size={20} weight="fill" />
									Email Routing Safely Disconnected
								</div>
								<p className="text-xs text-kumo-subtle">
									{offboardResult.message}
								</p>
							</div>

							{offboardResult.eppCode && (
								<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-2">
									<div className="text-xs font-bold text-kumo-default uppercase tracking-wider">
										EPP Transfer Authorization Code
									</div>
									<div className="flex items-center justify-between text-xs font-mono bg-kumo-base px-3 py-2 rounded-lg border border-kumo-line">
										<span>{offboardResult.eppCode}</span>
										<button
											type="button"
											onClick={() => handleCopy(offboardResult.eppCode!)}
											className="text-kumo-subtle hover:text-kumo-default p-1"
											title="Copy code"
										>
											<CopyIcon size={16} />
										</button>
									</div>
									<p className="text-[11px] text-kumo-subtle">
										Provide this authorization code to your new domain registrar to complete the transfer.
									</p>
								</div>
							)}

							<div className="flex justify-end pt-3">
								<Button
									variant="primary"
									onClick={() => setIsDecommissionModalOpen(false)}
								>
									Done
								</Button>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							{decommissionError && (
								<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
									{decommissionError}
								</div>
							)}

							<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 text-xs text-red-700 dark:text-red-300 space-y-1">
								<div className="font-semibold flex items-center gap-1.5">
									<WarningCircleIcon size={16} weight="fill" />
									Routing & Inbound Delivery Interruption
								</div>
								<p>
									Moving nameservers away from Cloudflare will halt all incoming email routing for this domain. Any existing mailboxes ({preflight?.activeMailboxCount ?? 0} active) will no longer receive new messages.
								</p>
							</div>

							{/* Backup Safeguard Section */}
							<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-3">
								<div className="text-xs font-bold text-kumo-default uppercase tracking-wider">
									Email Data Safeguard
								</div>
								{preflight?.hasRecentExport && preflight.lastExport ? (
									<div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
										<span className="flex items-center gap-1.5">
											<CheckCircleIcon size={16} weight="fill" />
											Recent backup available ({preflight.lastExport.totalEmails} emails)
										</span>
										<a
											href={api.getExportDownloadUrl(preflight.lastExport.id)}
											download
											className="font-semibold underline text-xs ml-2"
										>
											Download
										</a>
									</div>
								) : (
									<div className="space-y-2">
										<p className="text-xs text-amber-600 dark:text-amber-400">
											No recent backup found for this domain. We strongly recommend downloading a full .mbox archive before offboarding.
										</p>
										<Button
											variant="secondary"
											size="sm"
											icon={<DownloadSimpleIcon size={14} />}
											onClick={() => {
												setIsDecommissionModalOpen(false);
												setIsExportModalOpen(true);
											}}
										>
											Download Backup First (.mbox)
										</Button>

										{/* Explicit Skip Checkbox (User Requested: "They can choose to skip") */}
										<div className="flex items-start gap-2 pt-2 border-t border-kumo-line">
											<input
												type="checkbox"
												id="skipExportCheckbox"
												checked={skipExportAcknowledged}
												onChange={(e) =>
													setSkipExportAcknowledged(e.target.checked)
												}
												className="mt-0.5 rounded border-kumo-line cursor-pointer"
											/>
											<label
												htmlFor="skipExportCheckbox"
												className="text-xs font-medium text-kumo-default cursor-pointer leading-tight"
											>
												I have already backed up my emails or choose to proceed without an export.
											</label>
										</div>
									</div>
								)}
							</div>

							{/* Cloudflare Registrar Transfer Section */}
							{preflight?.isRegistrarDomain && (
								<div className="rounded-xl border border-kumo-line bg-kumo-recessed p-4 space-y-3">
									<div className="text-xs font-bold text-kumo-default uppercase tracking-wider flex items-center gap-1.5">
										<LockSimpleIcon size={14} />
										Cloudflare Registrar Settings
									</div>
									<div className="flex items-center justify-between text-xs">
										<span className="text-kumo-subtle">
											Transfer Lock:{" "}
											<strong className="text-kumo-default">
												{transferLocked ? "Locked (Protected)" : "Unlocked"}
											</strong>
										</span>
										<Button
											variant="secondary"
											size="sm"
											onClick={handleToggleTransferLock}
											disabled={lockToggling}
										>
											{lockToggling
												? "Updating..."
												: transferLocked
													? "Unlock for Transfer"
													: "Lock Domain"}
										</Button>
									</div>

									{/* EPP Code */}
									<div className="pt-2 border-t border-kumo-line">
										{eppCode ? (
											<div className="space-y-1">
												<span className="text-[11px] text-kumo-subtle">
													EPP Transfer Authorization Code:
												</span>
												<div className="flex items-center justify-between text-xs font-mono bg-kumo-base px-2.5 py-1.5 rounded border border-kumo-line">
													<span>{eppCode}</span>
													<button
														type="button"
														onClick={() => handleCopy(eppCode)}
														className="text-kumo-subtle hover:text-kumo-default p-0.5"
													>
														<CopyIcon size={14} />
													</button>
												</div>
											</div>
										) : (
											<Button
												variant="secondary"
												size="sm"
												icon={<KeyIcon size={14} />}
												onClick={handleFetchEppCode}
												disabled={eppLoading}
											>
												{eppLoading ? "Loading..." : "Reveal EPP Auth Code"}
											</Button>
										)}
									</div>
								</div>
							)}

							{/* Confirmation Challenge Input */}
							<div>
								<label className="block text-xs font-medium text-kumo-subtle mb-1">
									Type <strong className="text-kumo-default font-mono">{selectedDomain}</strong> to confirm:
								</label>
								<Input
									placeholder={selectedDomain}
									value={confirmDomainInput}
									onChange={(e) => setConfirmDomainInput(e.target.value)}
								/>
							</div>

							<div className="flex justify-end gap-2 pt-4 border-t border-kumo-line">
								<Button
									variant="secondary"
									onClick={() => setIsDecommissionModalOpen(false)}
									disabled={decommissioning}
								>
									Cancel
								</Button>
								<Button
									variant="destructive"
									onClick={handleDecommission}
									disabled={
										decommissioning ||
										confirmDomainInput.trim().toLowerCase() !==
											selectedDomain.toLowerCase() ||
										(!preflight?.hasRecentExport && !skipExportAcknowledged)
									}
								>
									{decommissioning
										? "Disconnecting..."
										: "Disconnect Email Routing & Offboard"}
								</Button>
							</div>
						</div>
					)}
				</Dialog>
			</Dialog.Root>

			{/* Add / Register Custom Domain Dialog */}
			<Dialog.Root
				open={isAddDomainModalOpen}
				onOpenChange={(open) => {
					setIsAddDomainModalOpen(open);
					if (!open) {
						setNewDomainInput("");
						setNewDomainAvailability(null);
						setAddDomainError(null);
					}
				}}
			>
				<Dialog size="lg" className="p-6">
					<Dialog.Title className="text-base font-semibold text-kumo-default mb-1">
						Add or Register Custom Domain
					</Dialog.Title>
					<Dialog.Description className="text-xs text-kumo-subtle mb-4">
						Connect an existing domain with automated Cloudflare DNS & Email Routing, or register an available domain wholesale.
					</Dialog.Description>

					{addDomainError && (
						<div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 mb-4">
							{addDomainError}
						</div>
					)}

					<div className="space-y-4">
						<div>
							<label className="block text-xs font-medium text-kumo-subtle mb-1">
								Domain Name
							</label>
							<div className="relative">
								<Input
									placeholder="e.g. acmemail.org"
									value={newDomainInput}
									onChange={(e) => setNewDomainInput(e.target.value)}
									autoFocus
								/>
								{isCheckingNewDomain && (
									<div className="absolute right-3 top-2.5">
										<Loader size="sm" />
									</div>
								)}
							</div>
						</div>

						{newDomainAvailability && (
							<div className="rounded-lg border border-kumo-line bg-kumo-recessed p-4 space-y-3">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-kumo-default font-mono">
										{newDomainAvailability.domain}
									</span>
									{newDomainAvailability.available ? (
										<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
											<CheckCircleIcon size={14} weight="fill" /> Available for Registration
										</span>
									) : (
										<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400">
											<GlobeIcon size={14} /> Registered Elsewhere
										</span>
									)}
								</div>

								{newDomainAvailability.available ? (
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-kumo-line">
										<div>
											<div className="text-sm font-bold text-kumo-default">
												${newDomainAvailability.retailPriceUsd.toFixed(2)} / year
											</div>
											<div className="text-[11px] text-kumo-subtle">
												Wholesale via Cloudflare Registrar (zero markup)
											</div>
										</div>
										<div className="flex gap-2">
											<Button
												variant="secondary"
												size="sm"
												disabled={isConnectingDomain}
												onClick={() => handleConnectDomain(newDomainAvailability.domain)}
											>
												Connect DNS Only
											</Button>
											<Button
												variant="primary"
												size="sm"
												disabled={isConnectingDomain}
												onClick={() => handlePurchaseDomain(newDomainAvailability.domain)}
											>
												{isConnectingDomain ? "Redirecting..." : "Purchase Domain"}
											</Button>
										</div>
									</div>
								) : (
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-kumo-line">
										<div className="text-xs text-kumo-subtle">
											Automates Cloudflare Zone creation and Email Routing configuration.
										</div>
										<Button
											variant="primary"
											size="sm"
											disabled={isConnectingDomain}
											onClick={() => handleConnectDomain(newDomainAvailability.domain)}
										>
											{isConnectingDomain ? "Connecting..." : "Connect Domain"}
										</Button>
									</div>
								)}
							</div>
						)}

						<div className="flex justify-end gap-2 pt-2 border-t border-kumo-line">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setIsAddDomainModalOpen(false)}
								disabled={isConnectingDomain}
							>
								Close
							</Button>
						</div>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

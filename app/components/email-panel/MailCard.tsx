// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	CalendarBlankIcon,
	CalendarPlusIcon,
	CalendarXIcon,
	CaretDownIcon,
	CheckIcon,
	ClockIcon,
	CopyIcon,
	DownloadSimpleIcon,
	MapPinIcon,
	NavigationArrowIcon,
	RepeatIcon,
	UserIcon,
	VideoCameraIcon,
	type Icon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import {
	buildIcs,
	compactInviteTime,
	directionsUrl,
	displayLocation,
	googleCalendarUrl,
	icsFilename,
	inviteAddress,
	inviteOrganizerLine,
	inviteTimeSummary,
	inviteTitle,
	inviteVenue,
	recurrenceLabel,
	type InviteSender,
	type ReaderCard,
} from "~/lib/mail-cards";
import type { EmailInvite } from "~/types";

/**
 * Code card and Invite card (AVE-178), pinned at the bottom of the reading pane
 * above the reply bar, like the native apps' cards above their bottom bar.
 * All invite text is sender data: rendered as text, links only http(s).
 */
export default function MailCard({ card, className = "" }: { card: ReaderCard; className?: string }) {
	return (
		<section
			aria-label={card.kind === "code" ? "Verification code" : "Calendar invite"}
			className={`rounded-lg border border-kumo-line bg-kumo-tint px-3 py-2.5 animate-reveal ${className}`}
		>
			{card.kind === "code" ? <CodeCard code={card.code} /> : <InviteCard key={card.emailId} invite={card.invite} sender={card.sender} />}
		</section>
	);
}

const action =
	"inline-flex items-center gap-1.5 rounded-md border border-kumo-hairline bg-kumo-control px-2.5 py-1 text-xs font-medium text-kumo-default no-underline transition-colors hover:bg-kumo-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring";
const primaryAction =
	"inline-flex items-center gap-1.5 rounded-md bg-kumo-brand px-2.5 py-1 text-xs font-medium text-white no-underline transition-colors hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring";

function ActionLink({ href, icon: IconCmp, children, primary }: { href: string; icon: Icon; children: ReactNode; primary?: boolean }) {
	return (
		<a href={href} target="_blank" rel="noopener noreferrer" className={primary ? primaryAction : action}>
			<IconCmp size={14} aria-hidden />
			{children}
		</a>
	);
}

function CodeCard({ code }: { code: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
		} catch {
			// Clipboard blocked (permissions, insecure origin): the code stays selectable.
		}
	};

	return (
		<div className="flex items-center gap-3">
			<div className="min-w-0 flex-1">
				<div className="text-2xs font-medium uppercase tracking-wider text-kumo-subtle" aria-live="polite">
					{copied ? "Copied" : "Verification code"}
				</div>
				<div
					className="truncate font-mono text-lg font-semibold tracking-[0.12em] text-kumo-default select-all"
					aria-label={code.split("").join(" ")}
				>
					{code}
				</div>
			</div>
			<button type="button" onClick={copy} className={primaryAction}>
				{copied ? <CheckIcon size={14} aria-hidden /> : <CopyIcon size={14} aria-hidden />}
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

function DetailRow({ icon: IconCmp, children }: { icon: Icon; children: ReactNode }) {
	return (
		<div className="flex items-start gap-2">
			<IconCmp size={14} className="mt-0.5 shrink-0 text-kumo-subtle" aria-hidden />
			<span className="min-w-0 break-words">{children}</span>
		</div>
	);
}

function downloadIcs(invite: EmailInvite) {
	const ics = buildIcs(invite);
	if (!ics) return;
	const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = icsFilename(invite);
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One line (title, short time, chevron) and one row of actions; clicking the
 * line opens the details in place (AVE-176 review: not too full at first glance).
 */
function InviteCard({ invite, sender }: { invite: EmailInvite; sender: InviteSender }) {
	const [expanded, setExpanded] = useState(false);
	const detailsId = useId();
	const title = inviteTitle(invite);
	const compact = compactInviteTime(invite);
	const summary = inviteTimeSummary(invite);
	const repeats = recurrenceLabel(invite.recurrence);
	const location = displayLocation(invite);
	const organizer = inviteOrganizerLine(invite, sender);
	const venue = inviteVenue(invite);
	const address = inviteAddress(invite);
	const google = googleCalendarUrl(invite);
	const cancelled = invite.cancelled;
	const TitleIcon = cancelled ? CalendarXIcon : CalendarBlankIcon;

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				aria-controls={detailsId}
				className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-kumo-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
			>
				<TitleIcon size={16} className={`shrink-0 ${cancelled ? "text-kumo-destructive" : "text-kumo-default"}`} aria-hidden />
				<span className={`min-w-0 truncate text-sm font-semibold ${cancelled ? "text-kumo-subtle line-through" : "text-kumo-default"}`}>
					{title}
				</span>
				{(cancelled || compact) && (
					<span className={`shrink-0 whitespace-nowrap text-xs ${cancelled ? "font-medium text-kumo-destructive" : "text-kumo-subtle"}`}>
						{cancelled ? "Cancelled" : compact}
					</span>
				)}
				<CaretDownIcon
					size={14}
					className={`ml-auto shrink-0 text-kumo-subtle transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
					aria-hidden
				/>
				<span className="sr-only">{expanded ? "Hide event details" : "Show event details"}</span>
			</button>

			{expanded && (
				<div id={detailsId} className="ml-6 flex flex-col gap-1.5 text-xs text-kumo-default animate-reveal">
					{summary && <DetailRow icon={ClockIcon}>{summary}</DetailRow>}
					{repeats && <DetailRow icon={RepeatIcon}>{repeats}</DetailRow>}
					{location && (
						<DetailRow icon={MapPinIcon}>
							{/* With a meeting link, Join is the action; the address still gets directions here. */}
							{!cancelled && venue.kind === "link" && address ? (
								<a href={directionsUrl(address)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
									{location}
								</a>
							) : (
								location
							)}
						</DetailRow>
					)}
					{organizer.kind === "organizer" && <DetailRow icon={UserIcon}>{organizer.label}</DetailRow>}
					{organizer.kind === "claimed" && (
						// AVE-220: the organizer doesn't match the From, so the sender
						// leads and the organizer is only what the invite claims.
						<DetailRow icon={UserIcon}>
							{organizer.sender && <span className="block">From {organizer.sender}</span>}
							<span className="block text-kumo-subtle">Claims organizer: {organizer.claimed}</span>
						</DetailRow>
					)}
				</div>
			)}

			{!cancelled && (venue.kind !== "none" || google) && (
				<div className="flex flex-wrap items-center gap-1.5">
					{venue.kind === "link" && <ActionLink href={venue.url} icon={VideoCameraIcon} primary>Join</ActionLink>}
					{venue.kind === "address" && (
						<ActionLink href={directionsUrl(venue.address)} icon={NavigationArrowIcon} primary>Directions</ActionLink>
					)}
					{google && <ActionLink href={google} icon={CalendarPlusIcon}>Google Calendar</ActionLink>}
					{google && (
						<button type="button" onClick={() => downloadIcs(invite)} className={action}>
							<DownloadSimpleIcon size={14} aria-hidden />
							Download .ics
						</button>
					)}
				</div>
			)}
		</div>
	);
}
